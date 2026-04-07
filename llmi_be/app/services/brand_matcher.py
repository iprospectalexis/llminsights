"""
Brand detection in free-form LLM answer text.

Replaces the legacy substring match (`brand.lower() in answer.lower()`) which
suffers from false positives ("On" matches "concerning") and false negatives
("Coca-Cola" misses "Coca Cola"). Uses Unicode normalization, word boundaries,
and per-brand alias lists.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field


@dataclass
class BrandSpec:
    """A brand and its known surface forms (aliases)."""
    name: str
    aliases: list[str] = field(default_factory=list)


def _normalize(text: str) -> str:
    """Lowercase + strip diacritics (NFKD decomposition)."""
    decomposed = unicodedata.normalize("NFKD", text)
    stripped = "".join(c for c in decomposed if not unicodedata.combining(c))
    return stripped.lower()


def _build_pattern(surface: str) -> re.Pattern:
    """
    Build a word-boundary regex for a brand surface form.
    Treats internal whitespace and hyphens as interchangeable so
    "Coca-Cola" matches "Coca Cola" / "CocaCola" / "Coca-Cola".
    """
    norm = _normalize(surface).strip()
    # Split on whitespace/hyphen runs, escape each piece, rejoin with optional separator
    pieces = [re.escape(p) for p in re.split(r"[\s\-]+", norm) if p]
    if not pieces:
        return re.compile(r"(?!)")  # never matches
    body = r"[\s\-]?".join(pieces)
    return re.compile(rf"(?<![\w]){body}(?![\w])")


def detect_brands_in_text(text: str, brands: list[BrandSpec]) -> list[str]:
    """
    Return canonical brand names found in `text`.

    Order is preserved from the input `brands` list. Each brand appears at most
    once in the result, even if it has multiple matching surface forms.
    """
    if not text or not brands:
        return []
    norm_text = _normalize(text)
    found: list[str] = []
    for brand in brands:
        surfaces = [brand.name] + (brand.aliases or [])
        for surface in surfaces:
            pattern = _build_pattern(surface)
            if pattern.search(norm_text):
                found.append(brand.name)
                break
    return found
