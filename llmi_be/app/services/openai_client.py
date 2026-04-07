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

logger = logging.getLogger(__name__)
settings = get_settings()

# Concurrency control — max 5 parallel OpenAI calls
_semaphore = asyncio.Semaphore(5)

# Official async OpenAI client
_client = AsyncOpenAI(api_key=settings.openai_api_key)

MODEL = "gpt-5-mini"
SENTIMENT_PROMPT_VERSION = "v2-2026-04-07"


async def _call_openai(messages: list[dict], max_tokens: int = 2048,
                        response_format: Optional[dict] = None) -> Optional[str]:
    """Call OpenAI chat completions API with concurrency control."""
    async with _semaphore:
        kwargs: dict = {
            "model": MODEL,
            "messages": messages,
            "max_completion_tokens": max_tokens,
        }
        if response_format:
            kwargs["response_format"] = response_format

        try:
            resp = await _client.chat.completions.create(**kwargs)
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
                    f"usage={usage}, max_tokens={max_tokens})"
                )
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

    for attempt in range(2):  # Retry once on empty output
        try:
            raw = await _call_openai(messages, max_tokens=4096,
                                      response_format={"type": "json_object"})
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
            if attempt == 0 and "rate" in str(e).lower():
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
        '- label: "positive" (favorable opinion), "negative" (unfavorable opinion / warning), '
        '"neutral" (balanced or factual opinion), or "mention_only" '
        "(brand is listed/named but no opinion is attached).\n"
        "- score: signed float in [-1, 1]. mention_only -> 0; neutral -> 0; "
        "positive in (0, 1]; negative in [-1, 0). Magnitude reflects strength.\n"
        "- confidence: float in [0, 1] for how sure you are.\n"
        "- reasoning: one short sentence quoting the relevant part of the answer.\n\n"
        "Use the user query to disambiguate framing (e.g. 'worst running shoes' inverts "
        "the sentiment of a 'top recommendation').\n\n"
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
            # reasoning tokens, so allocate generously per brand.
            max_tokens=4000,
            response_format={"type": "json_schema", "json_schema": SENTIMENT_SCHEMA},
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
            )
            for r in batch
        ]
        batch_results = await asyncio.gather(*tasks, return_exceptions=True)
        for r, res in zip(batch, batch_results):
            if isinstance(res, Exception):
                competitors = {"brands": [], "error": str(res)}
            else:
                competitors = res
                if res.get("_skipped"):
                    skipped += 1
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
