"""
Fetch generated SEO briefs from YourText.Guru for finished guides (audits).

Equivalent of:
    curl -X GET 'https://yourtext.guru/api/v2/guides/<GUIDE_ID>/brief' \
         -H 'accept: application/json' \
         -H 'X-CSRF-TOKEN: <API_KEY>'

The YourText.Guru "guide" id is the audit id from the example (16238012).

Usage:
    # token read from env YTG_API_KEY (or llmi_be/.env)
    python fetch_ytg_brief.py 16238012
    python fetch_ytg_brief.py 16238012 16240000 -o briefs
    python fetch_ytg_brief.py 16238012 --token <API_KEY>

Env:
    YTG_API_KEY   YourText.Guru API token, sent as the X-CSRF-TOKEN header.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import httpx

try:
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parent / "llmi_be" / ".env")
except ImportError:
    pass

DEFAULT_BASE_URL = "https://yourtext.guru/api/v2"


def get_token(cli_token: str | None) -> str:
    token = cli_token or os.environ.get("YTG_API_KEY") or os.environ.get("YTG_TOKEN")
    if not token:
        sys.exit(
            "ERROR: no API token. Pass --token or set YTG_API_KEY "
            "(in your environment or in llmi_be/.env)."
        )
    return token


def fetch_brief(client: httpx.Client, base_url: str, guide_id: str, token: str) -> dict:
    resp = client.get(
        f"{base_url}/guides/{guide_id}/brief",
        headers={"accept": "application/json", "X-CSRF-TOKEN": token},
    )
    resp.raise_for_status()
    return resp.json()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Fetch YourText.Guru SEO briefs by guide (audit) id."
    )
    parser.add_argument("guide_ids", nargs="+", help="YourText.Guru guide (audit) id(s).")
    parser.add_argument("-t", "--token", help="API token (overrides YTG_API_KEY env).")
    parser.add_argument("-o", "--out", help="Directory to save brief_<id>.json files.")
    parser.add_argument(
        "--base-url", default=DEFAULT_BASE_URL, help=f"API base (default: {DEFAULT_BASE_URL})."
    )
    parser.add_argument(
        "--timeout", type=float, default=60.0, help="Request timeout in seconds (default: 60)."
    )
    args = parser.parse_args()

    token = get_token(args.token)

    out_dir: Path | None = None
    if args.out:
        out_dir = Path(args.out)
        out_dir.mkdir(parents=True, exist_ok=True)

    exit_code = 0
    with httpx.Client(timeout=args.timeout) as client:
        for guide_id in args.guide_ids:
            print(f"\n{'=' * 60}\nGuide {guide_id} — brief\n{'=' * 60}")
            try:
                brief = fetch_brief(client, args.base_url, guide_id, token)
            except httpx.HTTPStatusError as e:
                exit_code = 1
                print(f"ERROR {e.response.status_code}: {e.response.text[:500]}")
                if e.response.is_client_error:
                    print("(guide may not exist, token may be wrong, or the brief is not ready yet)")
                continue
            except httpx.HTTPError as e:
                exit_code = 1
                print(f"ERROR: request failed: {e}")
                continue

            if out_dir is not None:
                path = out_dir / f"brief_{guide_id}.json"
                path.write_text(
                    json.dumps(brief, ensure_ascii=False, indent=2), encoding="utf-8"
                )
                print(f"Saved -> {path}")
            else:
                print(json.dumps(brief, ensure_ascii=False, indent=2))

    sys.exit(exit_code)


if __name__ == "__main__":
    main()
