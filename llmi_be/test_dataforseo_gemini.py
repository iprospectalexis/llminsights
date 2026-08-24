"""Live smoke-test for the DataForSEO Gemini integration.

Makes ONE real Gemini call (ai_optimization/gemini/llm_responses/live) using
the creds in llmi_be/.env, and prints the parsed record: answer length,
fan-out queries, and citations with their RESOLVED final URLs (the Vertex
grounding redirects followed to destination). Billed (~$0.05).

Run from the llmi_be directory:
    venv/Scripts/python.exe test_dataforseo_gemini.py
"""

import asyncio
import importlib.util
from pathlib import Path

_spec = importlib.util.spec_from_file_location(
    "dfs_gemini", str(Path(__file__).parent / "app" / "services" / "dataforseo_client.py")
)
dfs = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(dfs)

PROMPT = "best marathon shoes 2026"


def safe(s: str) -> str:
    return (s or "").encode("ascii", "replace").decode("ascii")


async def main():
    c = dfs.DataForSeoClient()
    if not c.login or not c.password:
        print("!! DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD not set in .env")
        return
    print(f"login present: {bool(c.login)}  model={c.gemini_model}  web_search={c.gemini_web_search}")
    results, failed = await c.process_all_prompts(prompts=[PROMPT], source="gemini")
    print(f"\nresults={len(results)} failed={len(failed)} cost=${c.total_cost:.4f}")
    for r in results:
        print("\n-- record --")
        print("prompt        :", safe(r["prompt"]))
        print("answer_text   :", safe(r["answer_text"])[:200], "...")
        print("fan-out       :", [safe(q) for q in r["web_search_query"]])
        print("citations     :", len(r["citations"]))
        for cit in r["citations"][:6]:
            print("   -", safe(cit.get("domain") or ""), "->", safe(cit.get("url") or "")[:90])
    if failed:
        print("FAILED:", [safe(f) for f in failed])


if __name__ == "__main__":
    asyncio.run(main())
