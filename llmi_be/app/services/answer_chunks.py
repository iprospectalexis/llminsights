"""Chunk-level source attribution for ChatGPT/SearchGPT answers.

A web-search answer is assembled from chunks, each ending with one or more
source markers like " ... standout right now. [1]" whose numbers map 1:1 to
links_attached[].position. Splitting the answer on those markers gives every
source the exact text it backs — the foundation for per-source brand
analysis (which competitor is mentioned in the chunk sourced from URL X).

Pure functions, no I/O. Mirrored on the frontend in src/lib/answerChunks.ts —
keep the two implementations in sync.
"""
import re

_MARKER_RUN = re.compile(r"(?:\s*\[\d+\])+")
_MARKER_NUM = re.compile(r"\[(\d+)\]")


def parse_answer_chunks(answer_text: str, links_attached: list) -> list:
    """Split an answer into source-attributed chunks.

    Returns [{"text", "positions": [int], "urls": [str]}]. A chunk is the text
    preceding a run of consecutive markers ("...text [1][2]") and is
    attributed to every marker in the run. Trailing text after the last
    marker (or a marker-less answer) yields a final chunk with no positions.
    """
    text = answer_text or ""
    url_by_pos = {}
    for i, link in enumerate(links_attached or []):
        pos = link.get("position") or (i + 1)
        if pos not in url_by_pos and link.get("url"):
            url_by_pos[pos] = link["url"]

    chunks = []
    cursor = 0
    for m in _MARKER_RUN.finditer(text):
        chunk_text = text[cursor:m.start()].strip()
        positions = [int(n) for n in _MARKER_NUM.findall(m.group(0))]
        if chunk_text or positions:
            chunks.append({
                "text": chunk_text,
                "positions": positions,
                "urls": [url_by_pos[p] for p in positions if p in url_by_pos],
            })
        cursor = m.end()
    tail = text[cursor:].strip()
    if tail:
        chunks.append({"text": tail, "positions": [], "urls": []})
    return chunks


def chunks_for_url(answer_text: str, links_attached: list, url: str) -> list:
    """Texts of all chunks attributed to the given source URL."""
    return [
        c["text"] for c in parse_answer_chunks(answer_text, links_attached)
        if url in c["urls"] and c["text"]
    ]
