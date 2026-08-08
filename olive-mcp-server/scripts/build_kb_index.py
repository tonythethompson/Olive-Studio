#!/usr/bin/env python3
"""Build shipped KB embedding indexes (Phase 1).

Run from repo root or olive-mcp-server with the project venv::

  olive-mcp-server/.venv/Scripts/python olive-mcp-server/scripts/build_kb_index.py

Requires sentence-transformers. Writes under olive_mcp_server/knowledge_base/indexes/.
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parent.parent
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))


def main() -> int:
    from olive_mcp_server.tools import load_studio_troubleshooting, load_troubleshooting
    from olive_mcp_server.tools.docs_search import _load_kb_text
    from olive_mcp_server.tools.embeddings import MODEL_NAME, build_kb_index
    from olive_mcp_server.tools.index_store import (
        content_hash_pairs,
        save_entry_index,
        save_pair_index,
        write_manifest,
    )
    from olive_mcp_server.tools.troubleshooting import _entry_embed_text, _entries_fingerprint

    t0 = time.perf_counter()
    print(f"Building indexes with model={MODEL_NAME} …")

    pairs = _load_kb_text()
    print(f"  docs_kb: {len(pairs)} snippets")
    docs_emb = build_kb_index([t for _, t in pairs])
    docs_meta = save_pair_index("docs_kb", pairs, docs_emb)
    print(f"  docs_kb hash={docs_meta['content_hash'][:12]}…")

    manifest_indexes: dict = {
        "docs_kb": {
            "content_hash": docs_meta["content_hash"],
            "count": docs_meta["count"],
        }
    }

    for stem, loader in (
        ("ts_olive", load_troubleshooting),
        ("ts_studio", load_studio_troubleshooting),
    ):
        entries = list(loader())
        texts = [_entry_embed_text(e) for e in entries]
        ids = [str(e.get("id") or "") for e in entries]
        chash = _entries_fingerprint(entries)
        print(f"  {stem}: {len(entries)} entries")
        emb = build_kb_index(texts) if texts else build_kb_index([])
        meta = save_entry_index(
            stem,
            ids,
            texts,
            emb,
            content_hash=chash,
        )
        manifest_indexes[stem] = {
            "content_hash": meta["content_hash"],
            "count": meta["count"],
        }
        print(f"  {stem} hash={meta['content_hash'][:12]}…")

    path = write_manifest(manifest_indexes)
    elapsed = time.perf_counter() - t0
    print(f"Wrote {path} in {elapsed:.1f}s")
    assert content_hash_pairs(pairs) == docs_meta["content_hash"]
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
