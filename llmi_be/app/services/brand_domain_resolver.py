"""Resolve brand names to their official-site domains (for brand favicons).

Tiered like the domain classifier:
  Tier 0 — the project's own citation domains: a mentioned brand almost
           always gets its site cited; match the registrable label against
           the normalized brand name, pick the most-cited candidate. Free.
  Tier 1 — gpt-5-nano batch ("official website domain of brand X") for
           brands never cited. Fractions of a cent, once per unique brand.

Results are global (brand_domains table, keyed by normalized name) — a
brand resolved for one project is resolved for all. 'manual' rows are
never overwritten. Runs incrementally from handle_finalize.
"""
import json
import logging
import re
import unicodedata
from typing import Optional

from app.services.supabase_db import db
from app.services import openai_client

logger = logging.getLogger(__name__)

_DOMAIN_RE = re.compile(r"^[a-z0-9-]+(\.[a-z0-9-]+)+$")


def normalize_brand(name: str) -> str:
    """Mirror of the frontend normalizeBrandKey: lowercase, strip accents,
    keep [a-z0-9] only."""
    s = unicodedata.normalize("NFD", (name or "").lower())
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]", "", s)


def _clean_domain(domain: str) -> Optional[str]:
    d = (domain or "").strip().lower()
    if "://" in d:
        d = d.split("://", 1)[1]
    d = d.split("/", 1)[0].split("?", 1)[0].split(":", 1)[0]
    if d.startswith("www."):
        d = d[4:]
    d = d.rstrip(".")
    if not _DOMAIN_RE.match(d) or "google." in d:
        return None
    return d


BRAND_DOMAIN_SCHEMA = {
    "name": "brand_domains",
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
                        "domain": {"type": "string"},
                    },
                    "required": ["brand", "domain"],
                },
            },
        },
        "required": ["brands"],
    },
}


async def _resolve_batch_llm(names: list) -> dict:
    """brand name -> domain via one gpt-5-nano structured call. Raises on
    empty/unusable responses so callers count the batch as failed."""
    messages = [
        {
            "role": "system",
            "content": (
                "For each brand, return the registrable domain of its official "
                "website, lowercase, without www or path (e.g. 'salomon.com', "
                "'credit-agricole.fr'). Brands are mostly French/European "
                "companies. If you do not confidently know the official site, "
                "return an empty string for that brand. Never guess."
            ),
        },
        {
            "role": "user",
            "content": "Brands:\n" + json.dumps(names, ensure_ascii=False),
        },
    ]
    raw = await openai_client._call_openai(
        messages,
        max_tokens=16384,
        response_format={"type": "json_schema", "json_schema": BRAND_DOMAIN_SCHEMA},
        _operation="brand_domain_resolve",
        model=openai_client.MODEL_COMPETITORS,
    )
    if not raw:
        raise RuntimeError("empty model response")
    parsed = json.loads(raw)
    out: dict = {}
    for entry in parsed.get("brands", []):
        key = normalize_brand(entry.get("brand") or "")
        dom = _clean_domain(entry.get("domain") or "")
        if key and dom:
            out[key] = dom
    return out


async def resolve_new_brands(audit_id: str) -> dict:
    """Resolve domains for this audit's project brands that have no
    brand_domains row yet. Returns {"citations": n, "llm": n}."""
    names = await db.get_project_brand_names(audit_id)
    if not names:
        return {"citations": 0, "llm": 0}

    by_norm: dict = {}
    for n in names:
        key = normalize_brand(n)
        if key and key not in by_norm:
            by_norm[key] = n
    existing = await db.get_brand_domains(list(by_norm.keys()))
    unresolved = {k: v for k, v in by_norm.items() if k not in existing}
    if not unresolved:
        return {"citations": 0, "llm": 0}

    # Tier 0: most-cited matching domain among the project's citations.
    cit_rows: list = []
    domain_counts = await db.get_project_citation_domains(audit_id)
    best: dict = {}  # norm -> (count, domain)
    for domain, cnt in domain_counts:
        d = (domain or "").lower()
        if d.startswith("www."):
            d = d[4:]
        labels = d.split(".")
        if len(labels) < 2:
            continue
        key = normalize_brand(labels[-2])
        if len(key) < 3 or key not in unresolved:
            continue
        if key not in best or cnt > best[key][0]:
            best[key] = (cnt, d)
    for key, (cnt, dom) in best.items():
        cit_rows.append({
            "brand_norm": key, "brand_name": unresolved.pop(key),
            "domain": dom, "source": "citations", "confidence": 0.9,
        })
    if cit_rows:
        await db.upsert_brand_domains(cit_rows)

    # Tier 1: nano for the rest, in batches of 30.
    llm_count = 0
    remaining = list(unresolved.items())
    for i in range(0, len(remaining), 30):
        chunk = remaining[i:i + 30]
        try:
            mapping = await _resolve_batch_llm([name for _, name in chunk])
        except Exception as e:
            logger.warning(f"[brand-domains] LLM batch failed ({len(chunk)} brands): {e}")
            continue
        rows = [
            {"brand_norm": key, "brand_name": name,
             "domain": mapping[key], "source": "llm", "confidence": 0.7}
            for key, name in chunk if key in mapping
        ]
        if rows:
            await db.upsert_brand_domains(rows)
        llm_count += len(rows)

    logger.info(
        f"[brand-domains] audit {audit_id}: resolved {len(cit_rows)} from "
        f"citations, {llm_count} via LLM ({len(remaining) - llm_count} unknown)"
    )
    return {"citations": len(cit_rows), "llm": llm_count}
