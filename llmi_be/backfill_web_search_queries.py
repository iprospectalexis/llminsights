"""One-off backfill: recompute llm_responses.web_search_query for SearchGPT /
ChatGPT rows from the last N days, using the (now fixed) JsonConverter on the
retained raw job files in /app/results.

Existing rows store the sent prompt (the "… (use web search to answer)" text)
instead of the model's real web-search queries, because the old extractor
missed metadata.search_model_queries. The raw ChatGPT stream isn't kept on the
row, but it IS in the per-job result files. This re-runs the same conversion
the pipeline uses and writes the real queries (or NULL when the model didn't
search) back onto the rows.

Runs INSIDE the container (where /app/results, the fixed converter and the
Supabase creds all live). Dry-run by default — pass --apply to write.

    docker exec llmi python backfill_web_search_queries.py            # dry-run, 7d
    docker exec llmi python backfill_web_search_queries.py 7 --apply  # write
    BACKFILL_MAX_FILE_MB=400 docker exec -e BACKFILL_MAX_FILE_MB llmi \
        python backfill_web_search_queries.py 7 --apply

Notes:
- Only touches searchgpt/chatgpt (other sources don't emit search queries).
- Skips raw files larger than BACKFILL_MAX_FILE_MB (default 250) so json.load
  can't OOM the app container; those job_ids are logged — re-run those audits or
  bump the limit if the container has spare RAM.
- Only covers audits whose raw files are still retained.
"""
import asyncio
import glob
import json
import os
import sys
import tempfile
import unicodedata
from datetime import datetime, timezone, timedelta

from sqlalchemy import text

from app.database import AsyncSessionLocal
from app.services.json_converter import json_converter
from app.services.prompt_augmentation import strip_known_provider_suffixes

RESULTS_DIR = "/app/results"
MAX_FILE_BYTES = int(os.environ.get("BACKFILL_MAX_FILE_MB", "250")) * 1024 * 1024

DAYS = 7
APPLY = False
for arg in sys.argv[1:]:
    if arg == "--apply":
        APPLY = True
    elif arg.isdigit():
        DAYS = int(arg)


def _norm(s: str) -> str:
    """Normalize a prompt for matching: strip any provider-appended suffix
    (e.g. ' (use web search to answer)'), NFC, collapse whitespace."""
    s = strip_known_provider_suffixes((s or "").strip())
    s = unicodedata.normalize("NFC", s)
    return " ".join(s.split())


def _find_raw_file(job_id: str):
    cands = [
        p for p in glob.glob(os.path.join(RESULTS_DIR, f"{job_id}_*.json"))
        if not p.endswith("_converted.json")
    ]
    # Prefer the largest (the full raw dump) if several timestamps exist.
    cands.sort(key=lambda p: os.path.getsize(p), reverse=True)
    return cands[0] if cands else None


def _convert_raw(path: str):
    """Return list of converted records (each has prompt + web_search_query),
    or None. Reuses the pipeline's converter so the format handling matches."""
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, list) or not data:
        return None
    is_bd = any(
        isinstance(it, dict) and ("response_raw" in it or "answer_html" in it)
        for it in data[:5]
    )
    tmp = tempfile.NamedTemporaryFile("w", suffix="_conv.json", delete=False)
    out = tmp.name
    tmp.close()
    try:
        if is_bd:
            json_converter.convert_brightdata_data(data, out)
        else:
            json_converter.convert_data(data, out)
        del data
        with open(out, "r", encoding="utf-8") as f:
            return json.load(f)
    finally:
        try:
            os.remove(out)
        except OSError:
            pass


def _wsq_value(v):
    """web_search_query column is text: store a JSON array for a real query
    list, or NULL for None/empty."""
    if isinstance(v, list):
        return json.dumps(v, ensure_ascii=False) if v else None
    if isinstance(v, str) and v.strip():
        return v
    return None


async def main():
    cutoff = datetime.now(timezone.utc) - timedelta(days=DAYS)
    async with AsyncSessionLocal() as s:
        rows = (await s.execute(text("""
            SELECT r.id::text AS id, r.job_id, p.prompt_text
            FROM llm_responses r
            JOIN audits  a ON a.id = r.audit_id
            JOIN prompts p ON p.id = r.prompt_id
            WHERE r.llm IN ('searchgpt', 'chatgpt')
              AND r.job_id IS NOT NULL
              AND a.started_at >= :cutoff
        """), {"cutoff": cutoff})).mappings().all()

    by_job: dict[str, list] = {}
    for r in rows:
        by_job.setdefault(r["job_id"], []).append(r)

    mode = "APPLY" if APPLY else "DRY-RUN"
    print(f"[backfill] {mode}: {len(rows)} rows / {len(by_job)} jobs, last {DAYS}d, "
          f"max file {MAX_FILE_BYTES // 1024 // 1024}MB")

    n_updated = n_null = no_file = too_big = failed = no_match = 0
    jobs_done = 0

    for job_id, job_rows in by_job.items():
        path = _find_raw_file(job_id)
        if not path:
            no_file += len(job_rows)
            continue
        try:
            if os.path.getsize(path) > MAX_FILE_BYTES:
                too_big += len(job_rows)
                print(f"[skip-big] {os.path.basename(path)} "
                      f"({os.path.getsize(path)//1024//1024}MB, {len(job_rows)} rows)")
                continue
            records = _convert_raw(path)
        except Exception as e:  # noqa: BLE001
            failed += len(job_rows)
            print(f"[fail] {job_id}: {type(e).__name__}: {e}")
            continue
        if not records:
            failed += len(job_rows)
            continue

        wsq_by_prompt = {}
        for rec in records:
            pr = rec.get("prompt") or (rec.get("input") or {}).get("prompt")
            if pr is not None:
                wsq_by_prompt[_norm(pr)] = _wsq_value(rec.get("web_search_query"))

        pending = []
        for r in job_rows:
            key = _norm(r["prompt_text"])
            if key in wsq_by_prompt:
                pending.append((r["id"], wsq_by_prompt[key]))
            else:
                no_match += 1

        if pending and APPLY:
            async with AsyncSessionLocal() as s:
                for rid, val in pending:
                    await s.execute(
                        text("UPDATE llm_responses SET web_search_query = :v WHERE id = :id"),
                        {"v": val, "id": rid},
                    )
                await s.commit()

        for _, val in pending:
            if val is None:
                n_null += 1
            else:
                n_updated += 1
        jobs_done += 1
        if jobs_done % 25 == 0:
            print(f"  …{jobs_done}/{len(by_job)} jobs  "
                  f"queries={n_updated} cleared={n_null}")

    print(
        f"[backfill] done ({mode}). "
        f"real_queries={n_updated} cleared_to_null={n_null} "
        f"no_prompt_match={no_match} no_file={no_file} too_big={too_big} failed={failed}"
    )
    if not APPLY:
        print("[backfill] dry-run only — re-run with --apply to write.")


if __name__ == "__main__":
    asyncio.run(main())
