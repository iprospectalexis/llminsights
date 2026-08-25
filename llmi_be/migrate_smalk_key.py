"""Carry the smalk_ai partner API key from the legacy host service into
Postgres, so the same key keeps working on the containerized backend.

One-shot, idempotent (ON CONFLICT DO NOTHING). The key row joins the existing
"Smalk_AI" group so it shows up in the UI next to the newer smalk_TXIp key.

Usage (inside the llmi container):
    python migrate_smalk_key.py <legacy_key_id> <full_sha256_key_hash> <key_prefix>
"""
import asyncio
import sys

from sqlalchemy import text

from app.database import AsyncSessionLocal


async def main() -> None:
    key_id, key_hash, key_prefix = sys.argv[1], sys.argv[2], sys.argv[3]
    if len(key_hash) != 64:
        raise SystemExit(f"refusing: key_hash must be a full sha256 hex (64 chars), got {len(key_hash)}")

    async with AsyncSessionLocal() as s:
        ref = (await s.execute(text(
            "SELECT group_id, created_by FROM api_keys WHERE key_prefix = 'smalk_TXIp'"
        ))).mappings().first()
        if not ref:
            raise SystemExit("refusing: reference key smalk_TXIp not found — no group to attach to")

        await s.execute(text("""
            INSERT INTO api_keys (id, key_hash, key_prefix, group_id, name, created_by,
                                  is_active, created_at, updated_at, expires_at)
            VALUES (CAST(:id AS uuid), :hash, :prefix, :gid, 'smalk_ai (legacy key)', :uid,
                    true, '2026-03-17T15:12:08Z', now(), NULL)
            ON CONFLICT (id) DO NOTHING
        """), {"id": key_id, "hash": key_hash, "prefix": key_prefix,
               "gid": ref["group_id"], "uid": ref["created_by"]})
        await s.commit()

        row = (await s.execute(text(
            "SELECT id::text, key_prefix, name, is_active FROM api_keys WHERE id = CAST(:id AS uuid)"
        ), {"id": key_id})).mappings().first()
        print("row in Postgres:", dict(row) if row else "MISSING")


if __name__ == "__main__":
    asyncio.run(main())
