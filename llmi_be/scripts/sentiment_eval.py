"""
Sentiment V2 evaluation harness.

Reads sentiment_eval_set.yaml, runs each example through
openai_client.analyze_response_sentiment, and reports:
  - per-label accuracy
  - confusion matrix
  - failures (expected vs got)
  - overall accuracy

Exit code 1 if accuracy < threshold (default 0.80).

Usage:
    python -m scripts.sentiment_eval                       # default threshold
    python -m scripts.sentiment_eval --threshold 0.85
    python -m scripts.sentiment_eval --quiet               # only summary
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

import yaml

# Allow running as `python scripts/sentiment_eval.py` from llmi_be/
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import openai_client  # noqa: E402

LABELS = ("positive", "neutral", "negative", "mention_only")


async def run_one(example: dict) -> list[dict]:
    """Run one example. Returns list of {brand, expected, got, ok}."""
    result = await openai_client.analyze_response_sentiment(
        prompt_text=example["prompt"],
        answer_text=example["answer"],
        brands_to_score=example["brands"],
        industry=example.get("industry", ""),
    )
    by_brand = {b["brand"]: b for b in result.get("brands", [])}
    rows = []
    for brand, expected_label in example["expected"].items():
        got = by_brand.get(brand, {})
        got_label = got.get("label", "<missing>")
        rows.append({
            "brand": brand,
            "expected": expected_label,
            "got": got_label,
            "ok": got_label == expected_label,
            "score": got.get("score"),
            "confidence": got.get("confidence"),
            "reasoning": got.get("reasoning"),
        })
    return rows


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--threshold", type=float, default=0.80,
                        help="Minimum accuracy required to pass (default: 0.80)")
    parser.add_argument("--quiet", action="store_true", help="Only print summary")
    parser.add_argument("--file", type=Path,
                        default=Path(__file__).parent / "sentiment_eval_set.yaml")
    args = parser.parse_args()

    if not args.file.exists():
        print(f"ERROR: eval set not found at {args.file}", file=sys.stderr)
        return 2

    with args.file.open(encoding="utf-8") as f:
        data = yaml.safe_load(f)

    examples = data.get("examples", [])
    if not examples:
        print("ERROR: no examples in eval set", file=sys.stderr)
        return 2

    print(f"Running {len(examples)} examples (model={openai_client.MODEL}, "
          f"version={openai_client.SENTIMENT_PROMPT_VERSION})...\n")

    all_rows: list[dict] = []
    for idx, ex in enumerate(examples, 1):
        try:
            rows = await run_one(ex)
        except Exception as e:
            print(f"  [{idx}] ERROR: {e}", file=sys.stderr)
            for brand, expected in ex["expected"].items():
                all_rows.append({
                    "brand": brand, "expected": expected,
                    "got": "<error>", "ok": False, "reasoning": str(e),
                })
            continue
        all_rows.extend(rows)
        if not args.quiet:
            for r in rows:
                mark = "OK " if r["ok"] else "XX "
                print(f"  {mark} [{idx}] {r['brand']:20s} expected={r['expected']:12s} got={r['got']}")
                if not r["ok"] and r.get("reasoning"):
                    print(f"        reasoning: {r['reasoning'][:120]}")

    # Summary
    total = len(all_rows)
    correct = sum(1 for r in all_rows if r["ok"])
    accuracy = correct / total if total else 0.0

    # Confusion matrix
    matrix = {e: {g: 0 for g in (*LABELS, "<missing>", "<error>")} for e in LABELS}
    for r in all_rows:
        if r["expected"] in matrix:
            matrix[r["expected"]][r["got"]] = matrix[r["expected"]].get(r["got"], 0) + 1

    print()
    print("=" * 60)
    print(f"Accuracy: {correct}/{total} = {accuracy:.1%}")
    print()
    print("Confusion matrix (rows=expected, cols=got):")
    print(f"  {'':14s}" + "".join(f"{g[:9]:>11s}" for g in LABELS))
    for e in LABELS:
        row = matrix[e]
        print(f"  {e:14s}" + "".join(f"{row.get(g, 0):>11d}" for g in LABELS))

    print()
    print(f"Threshold: {args.threshold:.0%} → "
          f"{'PASS' if accuracy >= args.threshold else 'FAIL'}")

    return 0 if accuracy >= args.threshold else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
