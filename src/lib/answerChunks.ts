// Chunk-level source attribution for ChatGPT/SearchGPT answers.
//
// A web-search answer is assembled from chunks, each ending with one or more
// markers like "... standout right now. [1]" whose numbers map 1:1 to
// links_attached[].position. Splitting on those markers gives every source
// the exact text it backs. Mirror of llmi_be/app/services/answer_chunks.py —
// keep the two implementations in sync.

export interface AnswerChunk {
  text: string;
  positions: number[];
  urls: string[];
}

const MARKER_RUN = /(?:\s*\[\d+\])+/g;
const MARKER_NUM = /\[(\d+)\]/g;

export function parseAnswerChunks(
  answerText: string | null | undefined,
  linksAttached: Array<{ url?: string; position?: number }> | null | undefined
): AnswerChunk[] {
  const text = answerText || '';
  const urlByPos = new Map<number, string>();
  (linksAttached || []).forEach((link, i) => {
    const pos = link.position ?? i + 1;
    if (!urlByPos.has(pos) && link.url) urlByPos.set(pos, link.url);
  });

  const chunks: AnswerChunk[] = [];
  let cursor = 0;
  for (const m of text.matchAll(MARKER_RUN)) {
    const chunkText = text.slice(cursor, m.index).trim();
    const positions = Array.from(m[0].matchAll(MARKER_NUM)).map(x => parseInt(x[1], 10));
    if (chunkText || positions.length > 0) {
      chunks.push({
        text: chunkText,
        positions,
        urls: positions.map(p => urlByPos.get(p)).filter((u): u is string => !!u),
      });
    }
    cursor = (m.index ?? 0) + m[0].length;
  }
  const tail = text.slice(cursor).trim();
  if (tail) chunks.push({ text: tail, positions: [], urls: [] });
  return chunks;
}
