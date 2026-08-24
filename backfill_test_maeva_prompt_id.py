"""
backfill_test_maeva_prompt_id.py

One-shot backfill for audit e960ba53 (Test_Maeva) whose llm_responses
rows were inserted with prompt_id=NULL. This is a one-off — every other
audit in the last 7 days has prompt_id populated, so we do NOT touch
the Python pipeline here, just repair the data.

Consequence of the bug: Citation Rate by Prompt Group, Mention Rate by
Prompt Group, and the Prompts table on ProjectDetailPage all join
llm_responses -> prompts via prompt_id, so they render empty.

Strategy:
  1. For rows whose raw_response_data.prompt (or raw_response_data.input.prompt)
     exactly matches a project prompt — use that. This nails every row
     with answer_text (32 rows: google-ai-overview, perplexity, grok,
     searchgpt — all 4 LLMs store the original prompt in the raw JSON).
  2. For remaining rows (bing-copilot, 8 rows, all terminal with
     raw_response_data=NULL) — positional fallback ORDER BY created_at
     per LLM, matching to project prompts ordered by created_at.

Dry-run by default, --apply to write.

Usage:
    python backfill_test_maeva_prompt_id.py
    python backfill_test_maeva_prompt_id.py --apply
"""
from __future__ import annotations

import argparse
import asyncio
import json
import ssl
import sys
from typing import Any

import asyncpg

DSN = (
    "postgresql://postgres.gpjkhdsonsdbnvmicgqf:8yixUcNRE8wAjUsR"
    "@aws-1-eu-west-3.pooler.supabase.com:5432/postgres"
)
PROJECT_ID = "624ccdcf-f9a8-4cea-884a-1bb38d4d987d"
AUDIT_ID = "e960ba53-0099-4d67-8541-fb4b9669872b"


def _extract_prompt_text(raw: Any) -> str | None:
    if raw is None:
        return None
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except Exception:
            return None
    if not isinstance(raw, dict):
        return None
    # Preferred: top-level .prompt (seen on all 4 working LLMs in e960ba53).
    v = raw.get("prompt")
    if isinstance(v, str) and v.strip():
        return v
    # Fallback: .input.prompt (also present on all 4).
    inp = raw.get("input")
    if isinstance(inp, dict):
        v = inp.get("prompt")
        if isinstance(v, str) and v.strip():
            return v
    return None


async def main(apply: bool) -> int:
    sslctx = ssl.create_default_context()
    sslctx.check_hostname = False
    sslctx.verify_mode = ssl.CERT_NONE
    conn = await asyncpg.connect(DSN, ssl=sslctx)
    try:
        print("=" * 72)
        print("Collect data")
        print("=" * 72)

        prompts = await conn.fetch(
            """
            SELECT id, prompt_text, prompt_group, created_at
            FROM prompts
            WHERE project_id = $1
            ORDER BY created_at, id
            """,
            PROJECT_ID,
        )
        print(f"  {len(prompts)} prompts in project")
        text_to_id: dict[str, str] = {}
        for p in prompts:
            if p["prompt_text"]:
                text_to_id[p["prompt_text"]] = str(p["id"])

        rows = await conn.fetch(
            """
            SELECT id, llm, prompt_id, raw_response_data, created_at
            FROM llm_responses
            WHERE audit_id = $1
            ORDER BY llm, created_at, id
            """,
            AUDIT_ID,
        )
        print(f"  {len(rows)} llm_responses rows")
        already_set = sum(1 for r in rows if r["prompt_id"] is not None)
        print(f"  with prompt_id already set: {already_set}")
        if already_set == len(rows):
            print()
            print("Nothing to do — every row already has prompt_id. Exiting.")
            return 0

        # ── Strategy 1: exact text match on raw_response_data ──────────
        print()
        print("=" * 72)
        print("Strategy 1 — raw_response_data.prompt exact match")
        print("=" * 72)
        plan: list[tuple[str, str, str]] = []  # (response_id, prompt_id, reason)
        unmatched: list[dict] = []
        for r in rows:
            if r["prompt_id"] is not None:
                continue
            ptext = _extract_prompt_text(r["raw_response_data"])
            if ptext and ptext in text_to_id:
                plan.append((str(r["id"]), text_to_id[ptext], "raw.prompt exact match"))
            else:
                unmatched.append(dict(r))
        print(f"  matched {len(plan)} rows via raw_response_data")
        print(f"  unmatched remaining: {len(unmatched)}")

        # ── Strategy 2: positional fallback per LLM ────────────────────
        if unmatched:
            print()
            print("=" * 72)
            print("Strategy 2 — positional fallback per LLM")
            print("=" * 72)
            by_llm: dict[str, list[dict]] = {}
            for r in unmatched:
                by_llm.setdefault(r["llm"], []).append(r)
            for llm, lrows in by_llm.items():
                lrows.sort(key=lambda x: (x["created_at"], str(x["id"])))
                print(f"  {llm}: {len(lrows)} rows to map positionally")
                if len(lrows) > len(prompts):
                    print(f"    WARN: more responses ({len(lrows)}) than "
                          f"prompts ({len(prompts)}) — refusing positional map")
                    continue
                for i, r in enumerate(lrows):
                    if i >= len(prompts):
                        break
                    plan.append((
                        str(r["id"]),
                        str(prompts[i]["id"]),
                        f"positional [{i}] fallback",
                    ))

        print()
        print("=" * 72)
        print(f"Final plan: {len(plan)} updates")
        print("=" * 72)
        # Summary per reason
        reasons: dict[str, int] = {}
        for _, _, reason in plan:
            reasons[reason] = reasons.get(reason, 0) + 1
        for reason, n in reasons.items():
            print(f"  {n:4d}  {reason}")

        if not plan:
            print("  nothing to update")
            return 0

        if not apply:
            print()
            print("DRY RUN — rerun with --apply to write.")
            return 0

        print()
        print("Applying updates inside a transaction...")
        async with conn.transaction():
            for rid, pid, _ in plan:
                await conn.execute(
                    "UPDATE llm_responses SET prompt_id = $1 WHERE id = $2 AND prompt_id IS NULL",
                    pid,
                    rid,
                )
        print(f"  done — {len(plan)} rows updated")

        # ── Verify ────────────────────────────────────────────────────
        print()
        print("=" * 72)
        print("Verification")
        print("=" * 72)
        remaining_null = await conn.fetchval(
            "SELECT count(*) FROM llm_responses WHERE audit_id = $1 AND prompt_id IS NULL",
            AUDIT_ID,
        )
        print(f"  rows still with prompt_id=NULL: {remaining_null}")

        by_group = await conn.fetch(
            """
            SELECT p.prompt_group, count(*) AS total,
                   count(*) FILTER (WHERE lr.answer_text IS NOT NULL) AS with_ans
            FROM llm_responses lr
            JOIN prompts p ON p.id = lr.prompt_id
            WHERE lr.audit_id = $1
            GROUP BY p.prompt_group
            ORDER BY p.prompt_group
            """,
            AUDIT_ID,
        )
        for g in by_group:
            print(f"  group={g['prompt_group']!r:<20} total={g['total']:<4} with_answer={g['with_ans']}")
        return 0
    finally:
        await conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Backfill prompt_id on Test_Maeva audit e960ba53."
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Actually write UPDATEs. Default is dry-run.",
    )
    args = parser.parse_args()
    sys.exit(asyncio.run(main(apply=args.apply)))
