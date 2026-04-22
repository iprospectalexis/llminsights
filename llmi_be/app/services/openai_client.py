"""
OpenAI client for competitor extraction and sentiment analysis.

Replaces the Supabase edge functions extract-competitors and analyze-sentiment.
Uses asyncio.Semaphore to control concurrency and avoid rate limiting.
"""

import json
import logging
import asyncio
import re
from typing import Optional

from openai import AsyncOpenAI

from app.config import get_settings
from app.services import cost_tracker

logger = logging.getLogger(__name__)
settings = get_settings()

# Concurrency control — max 30 parallel OpenAI calls.
# Rationale: pipeline handlers use batch_size=20 and the scheduler runs up to
# 3 audits concurrently → up to ~60 potential in-flight calls at once. A
# semaphore below batch_size forces wait-states inside every gather (tasks
# queued even when the network / provider could serve them). 30 matches
# the hot-path demand without exceeding OpenAI TPM limits for gpt-5-nano /
# gpt-5-mini at our current audit throughput.
_semaphore = asyncio.Semaphore(30)

# Official async OpenAI client
_client = AsyncOpenAI(api_key=settings.openai_api_key)

MODEL = "gpt-5-mini"                   # default / legacy fallback
MODEL_COMPETITORS = "gpt-5-nano"       # competitor extraction (structured JSON, simpler task)
MODEL_SENTIMENT = "gpt-5-mini"         # sentiment analysis (needs nuanced scoring + reasoning)
SENTIMENT_PROMPT_VERSION = "v2.1-2026-04-07"


# Strict schema for competitor extraction. Using json_schema instead of
# json_object lets OpenAI constrain the output shape without the model
# spending reasoning tokens planning the JSON structure — big latency win
# on gpt-5-nano. Shape mirrors what the prompt has always asked for.
COMPETITORS_SCHEMA = {
    "name": "competitor_brands",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "brands": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "name": {"type": "string"},
                        "strengths": {"type": "array", "items": {"type": "string"}},
                        "weaknesses": {"type": "array", "items": {"type": "string"}},
                        "mention_type": {
                            "type": "string",
                            "enum": ["recommended", "compared", "mentioned"],
                        },
                        "rank": {"type": ["integer", "null"]},
                    },
                    "required": [
                        "name", "strengths", "weaknesses", "mention_type", "rank",
                    ],
                },
            },
        },
        "required": ["brands"],
    },
}


async def _call_openai(messages: list[dict], max_tokens: int = 2048,
                        response_format: Optional[dict] = None,
                        _ctx: Optional[dict] = None,
                        _operation: Optional[str] = None,
                        model: Optional[str] = None) -> Optional[str]:
    """Call OpenAI chat completions API with concurrency control.

    `_ctx` carries audit_id/project_id/user_id from the caller so the cost
    tracker can attribute the spend. `_operation` is the high-level operation
    name ('competitors_extract' or 'sentiment_analyze') stored on the event.

    NOTE: do NOT add a `reasoning` / `reasoning_effort` parameter here. The
    Chat Completions API on gpt-5-nano / gpt-5-mini rejects it with
    "unexpected keyword argument 'reasoning'" and crashes every call. If you
    need reasoning-effort control, switch to the Responses API instead.
    """
    effective_model = model or MODEL
    async with _semaphore:
        kwargs: dict = {
            "model": effective_model,
            "messages": messages,
            "max_completion_tokens": max_tokens,
        }
        if response_format:
            kwargs["response_format"] = response_format

        try:
            # Hard per-call timeout (60s). Healthy gpt-5-nano / gpt-5-mini
            # calls complete in 3-8s once max_tokens is correctly sized.
            # 60s is enough headroom for the slow-but-working tail (long
            # Perplexity / Gemini inputs, slow pods) while still bounding
            # how long a single call can hold a semaphore slot. The
            # extract_competitors retry-loop also retries on timeout, so a
            # one-off 60s stall triggers a 2s-backoff retry inside the
            # same call instead of waiting 15s for the next scheduler tick.
            resp = await _client.chat.completions.create(timeout=60.0, **kwargs)
            choice = resp.choices[0]
            content = choice.message.content
            if not content:
                # gpt-5-mini can burn the whole completion budget on hidden
                # reasoning tokens and return empty content with finish_reason=length.
                # Log enough to diagnose without leaking the prompt.
                finish = getattr(choice, "finish_reason", "?")
                usage = getattr(resp, "usage", None)
                logger.warning(
                    f"OpenAI returned empty content (finish_reason={finish}, "
                    f"usage={usage}, model={effective_model}, max_tokens={max_tokens})"
                )
            # Best-effort cost capture (never breaks the call on failure)
            try:
                usage = getattr(resp, "usage", None)
                if usage is not None and _operation:
                    finish_reason = getattr(choice, "finish_reason", None)
                    await cost_tracker.record_openai_call(
                        ctx=_ctx,
                        model=effective_model,
                        operation=_operation,
                        usage=usage,
                        metadata={"finish_reason": finish_reason} if finish_reason else None,
                    )
            except Exception as ce:
                logger.warning(f"cost_tracker: openai event not recorded: {ce}")
            return content
        except Exception as e:
            logger.error(f"OpenAI API error: {e}")
            raise


def _extract_json(text: str) -> dict:
    """Extract JSON from OpenAI response, handling markdown code blocks."""
    # Direct parse
    try:
        return json.loads(text.strip())
    except json.JSONDecodeError:
        pass
    # Code block
    m = re.search(r"```(?:json)?\s*(\{[\s\S]*?\})\s*```", text)
    if m:
        try:
            return json.loads(m.group(1))
        except json.JSONDecodeError:
            pass
    # Find outermost braces
    first = text.find("{")
    last = text.rfind("}")
    if first != -1 and last > first:
        try:
            return json.loads(text[first:last + 1])
        except json.JSONDecodeError:
            pass
    raise ValueError(f"Could not extract JSON from response: {text[:200]}")


# ── Competitor extraction ─────────────────────────────────────────────

def _has_proper_nouns(text: str) -> bool:
    """Quick heuristic: does the text contain words that look like brand names?
    Checks for capitalized words mid-sentence (not at start of line/sentence)."""
    # Find capitalized words that are NOT at the start of a sentence
    mid_caps = re.findall(r'(?<=[a-zà-ÿ,;:]\s)[A-ZÀ-Ý][a-zà-ÿ]+', text)
    # Also look for known patterns: product model names (e-Kangoo, Transit, etc.)
    model_patterns = re.findall(r'\b[eE]-[A-Z][a-z]+|\b[A-Z][A-Za-z]*\d+[A-Za-z]*', text)
    return len(mid_caps) >= 1 or len(model_patterns) >= 1


async def extract_competitors(
    prompt_text: str,
    answer_text: str,
    industry: str = "",
    known_brands: list[str] | None = None,
    known_competitors: list[str] | None = None,
    _ctx: Optional[dict] = None,
) -> dict:
    """
    Extract brand/company names from an LLM response.
    Returns {"brands": [...]} dict.
    """
    known_brands = known_brands or []
    known_competitors = known_competitors or []

    # Pre-filter: skip API call if text has no proper nouns and no known brands
    text_lower = answer_text.lower()
    all_known = known_brands + known_competitors
    has_known = any(b.lower() in text_lower for b in all_known if b)
    if not has_known and not _has_proper_nouns(answer_text):
        return {"brands": [], "_skipped": True}

    # Build context-aware system prompt
    context_lines = []
    if industry:
        context_lines.append(f"- Industry/sector: {industry}")
    if known_brands:
        context_lines.append(f"- Our brands (the client's own brands): {', '.join(known_brands)}")
    if known_competitors:
        context_lines.append(f"- Known competitors: {', '.join(known_competitors)}")
    context_block = "\n".join(context_lines)

    messages = [
        {
            "role": "system",
            "content": (
                "You are a brand intelligence analyst. Your task is to extract all brand/company names "
                "mentioned in LLM-generated text, along with their context.\n\n"
                + (f"Project context:\n{context_block}\n\n" if context_block else "")
                + "Rules:\n"
                "- Extract ALL real brand names, company names, named products, named services, "
                "and named platforms mentioned in the text\n"
                "- Product model names ARE brand mentions (e.g., 'Kangoo' = Renault, 'Transit' = Ford, "
                "'Sprinter' = Mercedes, 'e-Expert' = brand mention)\n"
                "- Include brands from the 'known competitors' list if they appear in the text\n"
                "- Also extract brands NOT in the known lists — they are new/unknown competitors\n"
                "- DO NOT extract: regulatory standards (DPE, RE2020), certifications, legal terms "
                "(GFA, GPA), generic categories ('online insurers'), or government agencies\n"
                "- Normalize brand names to their most common form (e.g., 'NIKE' → 'Nike')\n"
                "- If the same brand appears multiple times, merge into one entry with combined strengths/weaknesses\n"
                "- Strengths = positive attributes, recommendations, advantages mentioned\n"
                "- Weaknesses = negative attributes, limitations, criticisms mentioned\n"
                "- If a brand is ranked or positioned (e.g., '#1', 'top 3', 'best'), capture the rank\n"
                "- Mention type: 'recommended' if explicitly suggested, 'compared' if part of a comparison, "
                "'mentioned' if just referenced\n"
                "- Respond in the SAME LANGUAGE as the analyzed text\n"
                "- If no brands/companies are mentioned, return {\"brands\": []}\n"
                "- Return valid JSON only"
            ),
        },
        {
            "role": "user",
            "content": (
                f"Extract all brands/companies mentioned in this LLM response.\n\n"
                f"Context prompt that generated this response: \"{prompt_text}\"\n\n"
                f"LLM response text:\n\"\"\"\n{answer_text}\n\"\"\"\n\n"
                "Return JSON:\n"
                "{\n"
                '  "brands": [\n'
                "    {\n"
                '      "name": "Brand Name",\n'
                '      "strengths": ["strength 1", "strength 2"],\n'
                '      "weaknesses": ["weakness 1"],\n'
                '      "mention_type": "recommended" | "compared" | "mentioned",\n'
                '      "rank": null or number (if ranked in text)\n'
                "    }\n"
                "  ]\n"
                "}"
            ),
        },
    ]

    for attempt in range(2):  # Retry once on empty output / transient errors
        try:
            # max_tokens: 4096 is ample for brand extraction (successful outputs
            # are <500 tokens in practice) and avoids the gpt-5-nano "think-a-lot"
            # behaviour triggered by 16384. If we ever see finish_reason=length in
            # the warning log (see _call_openai line ~81), bump back up to 8192.
            # response_format: strict json_schema skips JSON-shape planning inside
            # the model and guarantees valid output — also removes the need for
            # the defensive "Invalid structure" branch below.
            raw = await _call_openai(
                messages,
                max_tokens=4096,
                response_format={"type": "json_schema", "json_schema": COMPETITORS_SCHEMA},
                _ctx=_ctx,
                _operation="competitors_extract",
                model=MODEL_COMPETITORS,
            )
            if not raw:
                if attempt == 0:
                    logger.warning("OpenAI returned empty output, retrying...")
                    await asyncio.sleep(1)
                    continue
                return {"brands": [], "error": "No output from OpenAI"}

            data = json.loads(raw)
            if not isinstance(data.get("brands"), list):
                return {"brands": [], "warning": "Invalid structure", "original": data}
            return data

        except Exception as e:
            # Retry once on transient provider failures. Previously only "rate"
            # matched, which missed the dominant failure mode: request timeouts
            # and connection resets on slow OpenAI pods. Catching those here
            # recovers in ~2s instead of waiting a full 15s scheduler tick.
            msg = str(e).lower()
            transient = (
                "rate" in msg
                or "timeout" in msg
                or "timed out" in msg
                or "connection" in msg
                or " 502" in msg or " 503" in msg or " 504" in msg
            )
            if attempt == 0 and transient:
                await asyncio.sleep(2)
                continue
            logger.error(f"Competitor extraction failed: {e}")
            return {"brands": [], "error": str(e)}

    return {"brands": [], "error": "Max retries exceeded"}


# ── Sentiment analysis V2 (multi-brand structured output) ────────────

SENTIMENT_SCHEMA = {
    "name": "brand_sentiments",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "brands": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "brand": {"type": "string"},
                        "label": {
                            "type": "string",
                            "enum": ["positive", "neutral", "negative", "mention_only"],
                        },
                        "score": {"type": "number", "minimum": -1, "maximum": 1},
                        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                        "reasoning": {"type": "string"},
                    },
                    "required": ["brand", "label", "score", "confidence", "reasoning"],
                },
            }
        },
        "required": ["brands"],
    },
}


async def analyze_response_sentiment(
    prompt_text: str,
    answer_text: str,
    brands_to_score: list[str],
    industry: str = "",
    _ctx: Optional[dict] = None,
) -> dict:
    """
    Score every brand in `brands_to_score` against a single LLM answer in one call.
    Uses OpenAI structured outputs (json_schema) so the response is guaranteed valid.

    Returns:
        {
            "brands": [
                {"brand": str, "label": str, "score": float,
                 "confidence": float, "reasoning": str},
                ...
            ],
            "_fallback": bool   # only set on hard failure
        }
    """
    if not brands_to_score:
        return {"brands": []}

    industry_line = f"Industry context: {industry}\n" if industry else ""
    brands_json = json.dumps(brands_to_score, ensure_ascii=False)

    system_msg = (
        "You are a brand-perception analyst. You read AI-assistant answers to user "
        "queries and decide, for each brand in a given list, how the answer portrays "
        "that brand. You always respond with a JSON object matching the provided schema."
    )

    user_msg = (
        "For each brand in the 'Brands to score' list, output one entry with:\n"
        '- label: one of "positive", "negative", "neutral", "mention_only".\n'
        "- score: signed float in [-1, 1]. mention_only -> 0; neutral -> 0; "
        "positive in (0, 1]; negative in [-1, 0). Magnitude reflects strength.\n"
        "- confidence: float in [0, 1] for how sure you are.\n"
        "- reasoning: one short sentence quoting the relevant part of the answer.\n\n"
        "LABEL DEFINITIONS — read carefully:\n"
        '  • "positive": the answer expresses a clearly favorable evaluation of the brand '
        "(praises quality, recommends it, highlights specific strengths).\n"
        '  • "negative": the answer expresses a clearly unfavorable evaluation '
        "(criticism, warning, problem reports, advises against).\n"
        '  • "neutral": the answer expresses a balanced or explicitly factual evaluation '
        "(e.g. compares trade-offs, gives specs without judgment, says 'depends on use case').\n"
        '  • "mention_only": the brand is named or listed but the answer attaches NO '
        "evaluation to it.\n\n"
        "CRITICAL — words that DO NOT count as an opinion (use mention_only):\n"
        '  - "popular", "well-known", "common", "widely used", "famous", "leading", '
        '"major", "top brand" describe market presence, NOT the speaker\'s evaluation.\n'
        '  - Pure enumeration ("brands include X, Y, Z") is mention_only for every brand '
        "even if a generic adjective like 'popular' or 'major' is attached to the list.\n"
        '  - A brand named only as a category example ("German automakers like BMW") is '
        "mention_only.\n\n"
        "TIE-BREAKERS:\n"
        "  - In a side-by-side comparison where the same generic adjective ('solid', "
        "'good', 'capable') is applied symmetrically to two or more brands and the rest "
        "of the sentence describes their differences factually, label each brand neutral, "
        "not positive.\n"
        "  - In a multi-brand answer, score each brand independently — one brand being "
        "praised does not change the label of another.\n"
        "  - Use the user query to flip framing: 'worst running shoes' inverts the "
        "sentiment of a 'top recommendation'.\n\n"
        f"{industry_line}"
        f"User query:\n{prompt_text}\n\n"
        f"Answer:\n{answer_text}\n\n"
        f"Brands to score: {brands_json}"
    )

    try:
        raw = await _call_openai(
            [
                {"role": "system", "content": system_msg},
                {"role": "user", "content": user_msg},
            ],
            # gpt-5-mini reserves a large slice of this budget for invisible
            # reasoning tokens, so allocate generously.
            max_tokens=16384,
            response_format={"type": "json_schema", "json_schema": SENTIMENT_SCHEMA},
            _ctx=_ctx,
            _operation="sentiment_analyze",
            model=MODEL_SENTIMENT,
        )
        if not raw:
            return _sentiment_fallback(brands_to_score, "empty_response")

        parsed = json.loads(raw)
        # Normalize: ensure every requested brand has an entry; clamp scores
        by_brand = {b["brand"]: b for b in parsed.get("brands", []) if isinstance(b, dict)}
        out = []
        for brand in brands_to_score:
            entry = by_brand.get(brand)
            if not entry:
                out.append({
                    "brand": brand, "label": "mention_only", "score": 0.0,
                    "confidence": 0.0, "reasoning": "Model did not return an entry for this brand.",
                })
                continue
            label = entry.get("label", "mention_only")
            if label not in ("positive", "neutral", "negative", "mention_only"):
                label = "mention_only"
            try:
                score = float(entry.get("score", 0.0))
            except (TypeError, ValueError):
                score = 0.0
            score = max(-1.0, min(1.0, score))
            try:
                confidence = float(entry.get("confidence", 0.0))
            except (TypeError, ValueError):
                confidence = 0.0
            confidence = max(0.0, min(1.0, confidence))
            out.append({
                "brand": brand,
                "label": label,
                "score": score,
                "confidence": confidence,
                "reasoning": str(entry.get("reasoning", ""))[:500],
            })
        return {"brands": out}

    except Exception as e:
        logger.error(f"analyze_response_sentiment failed: {e}")
        return _sentiment_fallback(brands_to_score, str(e))


def _sentiment_fallback(brands: list[str], error: str) -> dict:
    """Build a fallback result when the LLM call fails outright."""
    return {
        "brands": [
            {
                "brand": b, "label": "mention_only", "score": 0.0,
                "confidence": 0.0, "reasoning": f"Fallback (error: {error[:80]})",
            }
            for b in brands
        ],
        "_fallback": True,
        "_error": error,
    }


# ── Legacy sentiment analysis (kept temporarily for backwards compat) ─

async def analyze_sentiment(brand: str, answer_text: str) -> dict:
    """
    Analyze sentiment toward a brand in an LLM response.
    Returns {"perception": "positive"|"neutral"|"negative", "magnitude": 1-5}.
    """
    prompt = (
        f"Tu es un client potentiel qui vient de lire le texte suivant à propos de la marque {brand}. "
        "En te mettant dans la peau d'un consommateur qui envisage un achat, quelle est ta perception "
        "de cette marque dans cette réponse ?\n\n"
        f"Réponse :\n{answer_text}\n\n"
        "IMPORTANT: Ta réponse doit être UNIQUEMENT un objet JSON strict sans aucun texte supplémentaire.\n\n"
        'Format requis: {"perception": "positive", "magnitude": 3}\n\n'
        "Les valeurs autorisées :\n"
        '- "perception" : "positive", "neutral", ou "negative"\n'
        '- "magnitude" : nombre entier entre 1 et 5\n\n'
        "Réponds SEULEMENT avec l'objet JSON, rien d'autre."
    )

    try:
        raw = await _call_openai(
            [{"role": "user", "content": prompt}],
            max_tokens=50,
        )
        if not raw:
            return {"perception": "neutral", "magnitude": 3, "_fallback": True}

        result = _extract_json(raw)

        # Validate
        if (result.get("perception") not in ("positive", "neutral", "negative") or
                not isinstance(result.get("magnitude"), (int, float)) or
                result["magnitude"] < 1 or result["magnitude"] > 5):
            return {"perception": "neutral", "magnitude": 3, "_fallback": True}

        return result

    except Exception as e:
        logger.error(f"Sentiment analysis failed for brand '{brand}': {e}")
        return {"perception": "neutral", "magnitude": 3, "_fallback": True, "_error": str(e)}


# ── Batch helpers ─────────────────────────────────────────────────────

async def extract_competitors_batch(
    responses: list[dict],
    batch_size: int = 10,
    delay: float = 0.2,
    industry: str = "",
    known_brands: list[str] | None = None,
    known_competitors: list[str] | None = None,
    _ctx: Optional[dict] = None,
) -> list[dict]:
    """
    Run competitor extraction on a list of responses.
    Each dict must have: id, answer_text, prompt_text.
    Returns list of {"id": ..., "competitors": {...}}.
    """
    results = []
    skipped = 0
    for i in range(0, len(responses), batch_size):
        batch = responses[i:i + batch_size]
        tasks = [
            extract_competitors(
                r["prompt_text"], r["answer_text"],
                industry=industry,
                known_brands=known_brands,
                known_competitors=known_competitors,
                _ctx=_ctx,
            )
            for r in batch
        ]
        batch_results = await asyncio.gather(*tasks, return_exceptions=True)
        for r, res in zip(batch, batch_results):
            if isinstance(res, Exception):
                # Increment _retry counter so the SQL filter can cap retries
                prev = r.get("answer_competitors")
                prev_retry = 0
                if isinstance(prev, dict):
                    prev_retry = prev.get("_retry", 0)
                elif isinstance(prev, str):
                    try:
                        prev_retry = json.loads(prev).get("_retry", 0)
                    except Exception:
                        pass
                competitors = {"brands": [], "error": str(res), "_retry": prev_retry + 1}
            else:
                competitors = res
                if res.get("_skipped"):
                    skipped += 1
                elif res.get("error"):
                    # extract_competitors returned an error dict (not exception).
                    # Add _retry counter so the SQL filter can cap retries.
                    # Without this, error-dict results loop forever (no _retry key
                    # → COALESCE defaults to 0 → always < 3).
                    prev = r.get("answer_competitors")
                    prev_retry = 0
                    if isinstance(prev, dict):
                        prev_retry = prev.get("_retry", 0)
                    elif isinstance(prev, str):
                        try:
                            prev_retry = json.loads(prev).get("_retry", 0)
                        except Exception:
                            pass
                    competitors["_retry"] = prev_retry + 1
            results.append({"id": r["id"], "competitors": json.dumps(competitors)})

        processed = min(i + batch_size, len(responses))
        logger.info(f"Competitors: {processed}/{len(responses)} processed ({skipped} skipped)")
        if i + batch_size < len(responses):
            await asyncio.sleep(delay)

    return results


async def analyze_sentiment_batch(
    responses: list[dict], brands: list[str], batch_size: int = 15
) -> list[dict]:
    """
    Run sentiment analysis on responses that mention any of the given brands.
    Returns list of {"id": ..., "score": float, "label": str}.
    """
    results = []
    for i in range(0, len(responses), batch_size):
        batch = responses[i:i + batch_size]

        async def _process_one(resp: dict):
            answer_lower = (resp.get("answer_text") or "").lower()
            for brand in brands:
                if brand.lower() in answer_lower:
                    result = await analyze_sentiment(brand, resp["answer_text"])
                    score = (result["magnitude"] / 5 if result["perception"] == "positive"
                             else -result["magnitude"] / 5 if result["perception"] == "negative"
                             else 0)
                    return {"id": resp["id"], "score": score, "label": result["perception"]}
            return None

        tasks = [_process_one(r) for r in batch]
        batch_results = await asyncio.gather(*tasks, return_exceptions=True)
        for res in batch_results:
            if isinstance(res, Exception):
                logger.error(f"Sentiment error: {res}")
            elif res:
                results.append(res)

        processed = min(i + batch_size, len(responses))
        logger.info(f"Sentiment: {processed}/{len(responses)} processed")

    return results
