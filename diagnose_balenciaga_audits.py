"""Diagnose Balenciaga audit issues in Supabase."""
import asyncio
import asyncpg

DATABASE_URL = (
    "postgresql://postgres.gpjkhdsonsdbnvmicgqf:8yixUcNRE8wAjUsR"
    "@aws-1-eu-west-3.pooler.supabase.com:5432/postgres"
)


async def main():
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        # 1. Find Balenciaga projects
        projects = await conn.fetch(
            "SELECT id, name, domain FROM projects WHERE name ILIKE '%balenciaga%'"
        )
        print(f"=== Found {len(projects)} Balenciaga projects ===\n")
        for p in projects:
            print(f"  Project: {p['name']}")
            print(f"  ID: {p['id']}  Domain: {p['domain']}\n")

        # 2. For each project, get audits
        for p in projects:
            print(f"\n{'='*80}")
            print(f"PROJECT: {p['name']}")
            print(f"{'='*80}")

            audits = await conn.fetch(
                """
                SELECT id, status, pipeline_state, progress, error_message,
                       started_at, finished_at, last_activity_at,
                       responses_expected, responses_received,
                       competitors_processed, competitors_total,
                       sentiment_processed, sentiment_total,
                       llms
                FROM audits WHERE project_id = $1
                ORDER BY created_at DESC
                """,
                p["id"],
            )
            print(f"  Total audits: {len(audits)}\n")

            for a in audits:
                status = a["status"]
                pipeline = a["pipeline_state"]
                print(f"  --- Audit {a['id']} ---")
                print(f"  Status: {status}  Pipeline: {pipeline}  Progress: {a['progress']}")
                print(f"  Started: {a['started_at']}  Finished: {a['finished_at']}")
                print(f"  Last activity: {a['last_activity_at']}")
                print(f"  Responses expected/received: {a['responses_expected']}/{a['responses_received']}")
                print(f"  Competitors processed/total: {a['competitors_processed']}/{a['competitors_total']}")
                print(f"  Sentiment processed/total: {a['sentiment_processed']}/{a['sentiment_total']}")
                print(f"  LLMs: {a['llms']}")
                if a["error_message"]:
                    print(f"  ERROR: {a['error_message']}")

                # 3. Diagnose non-completed audits
                is_ok = status == "completed" and pipeline in (None, "completed", "done")
                if not is_ok:
                    print(f"\n  >> DIAGNOSING (status={status}, pipeline={pipeline}) <<")

                    # Response stats
                    row = await conn.fetchrow(
                        """
                        SELECT
                          count(*) as total,
                          count(*) FILTER (WHERE answer_text IS NOT NULL) as with_answer,
                          count(*) FILTER (WHERE answer_text IS NULL AND poll_terminal_reason IS NOT NULL) as terminal_no_answer,
                          count(*) FILTER (WHERE answer_text IS NULL AND poll_terminal_reason IS NULL) as still_pending
                        FROM llm_responses WHERE audit_id = $1
                        """,
                        a["id"],
                    )
                    print(f"  Response stats: total={row['total']}, with_answer={row['with_answer']}, "
                          f"terminal_no_answer={row['terminal_no_answer']}, still_pending={row['still_pending']}")

                    # Terminal reasons
                    reasons = await conn.fetch(
                        """
                        SELECT poll_terminal_reason, count(*)
                        FROM llm_responses
                        WHERE audit_id = $1 AND poll_terminal_reason IS NOT NULL
                        GROUP BY poll_terminal_reason
                        """,
                        a["id"],
                    )
                    if reasons:
                        print("  Terminal reasons:")
                        for r in reasons:
                            print(f"    {r['poll_terminal_reason']}: {r['count']}")

                    # Pipeline log
                    logs = await conn.fetch(
                        """
                        SELECT state, phase, level, message, created_at
                        FROM audit_pipeline_log
                        WHERE audit_id = $1
                        ORDER BY created_at DESC LIMIT 10
                        """,
                        a["id"],
                    )
                    if logs:
                        print("  Recent pipeline logs:")
                        for lg in logs:
                            print(f"    [{lg['created_at']}] {lg['level']} | {lg['state']}/{lg['phase']}: {lg['message']}")

                    # Sentiment coverage
                    sent = await conn.fetchval(
                        "SELECT count(*) FROM response_brand_sentiment WHERE audit_id = $1",
                        a["id"],
                    )
                    print(f"  Sentiment rows: {sent}")

                print()

    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
