"""
Unit tests for brand_matcher.

Run with: python -m pytest tests/test_brand_matcher.py -v
"""
import importlib.util
import sys
from pathlib import Path

# Load brand_matcher.py directly without triggering app.services.__init__,
# which imports DB-bound modules (asyncpg, sqlalchemy engine, etc.).
_BM_PATH = Path(__file__).resolve().parents[1] / "app" / "services" / "brand_matcher.py"
_spec = importlib.util.spec_from_file_location("brand_matcher_under_test", _BM_PATH)
_mod = importlib.util.module_from_spec(_spec)
sys.modules["brand_matcher_under_test"] = _mod
_spec.loader.exec_module(_mod)

BrandSpec = _mod.BrandSpec
detect_brands_in_text = _mod.detect_brands_in_text


def test_basic_match():
    brands = [BrandSpec(name="Salomon")]
    assert detect_brands_in_text("I bought Salomon shoes.", brands) == ["Salomon"]


def test_case_insensitive():
    brands = [BrandSpec(name="Nike")]
    assert detect_brands_in_text("nike is a brand", brands) == ["Nike"]
    assert detect_brands_in_text("NIKE Air", brands) == ["Nike"]


def test_word_boundary_no_false_positive():
    """Brand 'On' should not match 'concerning' or 'online'."""
    brands = [BrandSpec(name="On")]
    assert detect_brands_in_text("This is concerning and online.", brands) == []
    assert detect_brands_in_text("On Cloud is great.", brands) == ["On"]


def test_substring_no_false_positive_apple():
    """Brand 'Apple' must not match 'pineapple'."""
    brands = [BrandSpec(name="Apple")]
    assert detect_brands_in_text("I love pineapple.", brands) == []
    assert detect_brands_in_text("Apple released a new phone.", brands) == ["Apple"]


def test_hyphen_whitespace_variants():
    """Coca-Cola should match Coca Cola, Coca-Cola, and CocaCola."""
    brands = [BrandSpec(name="Coca-Cola")]
    assert detect_brands_in_text("I like Coca Cola.", brands) == ["Coca-Cola"]
    assert detect_brands_in_text("Coca-Cola is famous.", brands) == ["Coca-Cola"]
    assert detect_brands_in_text("CocaCola sells drinks.", brands) == ["Coca-Cola"]


def test_diacritics_normalized():
    """Salomón / Salomon should match the same brand."""
    brands = [BrandSpec(name="Salomon")]
    assert detect_brands_in_text("La marque Salomón fabrique des chaussures.", brands) == ["Salomon"]


def test_aliases():
    """Aliases should match in addition to the canonical name."""
    brands = [BrandSpec(name="Volkswagen", aliases=["VW", "Volks"])]
    assert detect_brands_in_text("I drive a VW.", brands) == ["Volkswagen"]
    assert detect_brands_in_text("Volks cars are popular.", brands) == ["Volkswagen"]
    assert detect_brands_in_text("My Volkswagen is reliable.", brands) == ["Volkswagen"]


def test_multiple_brands_in_text():
    brands = [
        BrandSpec(name="Salomon"),
        BrandSpec(name="Hoka"),
        BrandSpec(name="Nike"),
    ]
    text = "Salomon makes great shoes, Hoka has cushion, Nike dominates."
    result = detect_brands_in_text(text, brands)
    assert set(result) == {"Salomon", "Hoka", "Nike"}


def test_brand_appears_once_in_result_even_if_mentioned_twice():
    brands = [BrandSpec(name="Nike")]
    assert detect_brands_in_text("Nike is great. I love Nike.", brands) == ["Nike"]


def test_empty_inputs():
    assert detect_brands_in_text("", [BrandSpec(name="Nike")]) == []
    assert detect_brands_in_text("Some text", []) == []


def test_no_match_returns_empty():
    brands = [BrandSpec(name="Salomon")]
    assert detect_brands_in_text("I went hiking.", brands) == []


def test_mixed_aliases_and_canonical():
    brands = [BrandSpec(name="HP", aliases=["Hewlett-Packard", "Hewlett Packard"])]
    assert detect_brands_in_text("I bought a Hewlett-Packard laptop.", brands) == ["HP"]
    # Word boundary protects against false positive
    assert detect_brands_in_text("phpMyAdmin is a tool.", brands) == []
