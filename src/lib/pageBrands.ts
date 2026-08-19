// Page ↔ brand attribution for the Pages report.
//
// A badge means "this page is provably tied to this brand", by two exact
// evidence tiers (see the approved methodology):
//   1. chunk-level (searchgpt/chatgpt): the brand appears in the answer
//      chunk whose [N] markers cite this page — parseAnswerChunks maps
//      marker positions to links_attached URLs 1:1;
//   2. title-level (all LLMs): the brand appears in the citation's own
//      title/snippet (citation_text).
// Response-level co-mentions (brand somewhere in an answer citing the page)
// are returned separately and shown only in tooltips — attributing every
// answer brand to every cited page would over-attribute.

import { parseAnswerChunks } from './answerChunks';
import { canonicalBrandKey } from '../utils/competitors';

export interface PageBrandRow {
  brand_name: string;
  is_competitor?: boolean;
  aliases?: string[] | null;
}

export interface PageBrands {
  exact: PageBrandRow[];
  comention: string[];
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface BrandMatcher {
  row: PageBrandRow;
  patterns: RegExp[];
}

function buildMatchers(projectBrands: PageBrandRow[]): BrandMatcher[] {
  const matchers: BrandMatcher[] = [];
  for (const row of projectBrands) {
    const names = [row.brand_name, ...(row.aliases || [])]
      .map(n => canonicalBrandKey(n || ''))
      // Short names ("On", "3M") produce word-boundary false positives at
      // scale — chunk texts are long; require ≥ 3 chars like elsewhere.
      .filter(n => n.length >= 3);
    if (names.length === 0) continue;
    matchers.push({
      row,
      patterns: names.map(
        n => new RegExp(`(?:^|[^a-z0-9])${escapeRegex(n)}(?:[^a-z0-9]|$)`)
      ),
    });
  }
  return matchers;
}

export function findBrandsInText(
  text: string | null | undefined,
  projectBrands: PageBrandRow[],
  matchers?: BrandMatcher[]
): PageBrandRow[] {
  if (!text) return [];
  const canon = canonicalBrandKey(text);
  if (!canon) return [];
  const ms = matchers || buildMatchers(projectBrands);
  return ms.filter(m => m.patterns.some(p => p.test(canon))).map(m => m.row);
}

export function buildPageBrandIndex(opts: {
  responses: Array<{
    audit_id?: string; prompt_id?: string; llm?: string;
    answer_text?: string | null;
    links_attached?: Array<{ url?: string; position?: number }> | null;
  }>;
  citations: Array<{
    audit_id?: string; prompt_id?: string; llm?: string;
    page_url?: string | null; citation_text?: string | null;
  }>;
  projectBrands: PageBrandRow[];
  normalizeUrl: (url: string) => string;
}): Map<string, PageBrands> {
  const { responses, citations, projectBrands, normalizeUrl } = opts;
  const matchers = buildMatchers(projectBrands);
  const out = new Map<string, { exact: Set<PageBrandRow>; co: Set<string> }>();
  if (matchers.length === 0) return new Map();

  const respKey = (r: any) => `${r.audit_id}|${r.prompt_id}|${r.llm}`;
  const responsesByKey = new Map<string, any>();
  responses.forEach(r => {
    const k = respKey(r);
    if (!responsesByKey.has(k)) responsesByKey.set(k, r);
  });

  // Per-response caches: chunk parse + per-chunk / whole-answer brand hits.
  const chunkIndexCache = new Map<string, Map<string, PageBrandRow[]>>();
  const answerBrandsCache = new Map<string, PageBrandRow[]>();

  const chunkBrandsForUrl = (resp: any, url: string): PageBrandRow[] => {
    const k = respKey(resp);
    let byUrl = chunkIndexCache.get(k);
    if (!byUrl) {
      byUrl = new Map();
      const links = Array.isArray(resp.links_attached) ? resp.links_attached : [];
      if (links.length > 0 && resp.answer_text) {
        for (const chunk of parseAnswerChunks(resp.answer_text, links)) {
          if (!chunk.text || chunk.urls.length === 0) continue;
          const found = findBrandsInText(chunk.text, projectBrands, matchers);
          if (found.length === 0) continue;
          for (const u of chunk.urls) {
            const nu = normalizeUrl(u);
            const prev = byUrl.get(nu) || [];
            byUrl.set(nu, [...prev, ...found]);
          }
        }
      }
      chunkIndexCache.set(k, byUrl);
    }
    return byUrl.get(url) || [];
  };

  const answerBrands = (resp: any): PageBrandRow[] => {
    const k = respKey(resp);
    let found = answerBrandsCache.get(k);
    if (!found) {
      found = findBrandsInText(resp.answer_text, projectBrands, matchers);
      answerBrandsCache.set(k, found);
    }
    return found;
  };

  for (const c of citations) {
    if (!c.page_url) continue;
    const url = normalizeUrl(c.page_url);
    let entry = out.get(url);
    if (!entry) {
      entry = { exact: new Set(), co: new Set() };
      out.set(url, entry);
    }
    // Tier 2: brand in the citation's own title/snippet.
    findBrandsInText(c.citation_text, projectBrands, matchers)
      .forEach(b => entry!.exact.add(b));
    const resp = responsesByKey.get(respKey(c));
    if (resp) {
      // Tier 1: brand inside the chunk that cites this page.
      chunkBrandsForUrl(resp, url).forEach(b => entry!.exact.add(b));
      // Tier 3: co-mentions (tooltip only).
      answerBrands(resp).forEach(b => entry!.co.add(b.brand_name));
    }
  }

  // Materialize in settings order (own brands first), co minus exact.
  const result = new Map<string, PageBrands>();
  out.forEach((entry, url) => {
    const exact = projectBrands.filter(b => entry.exact.has(b));
    const exactNames = new Set(exact.map(b => b.brand_name));
    const comention = projectBrands
      .map(b => b.brand_name)
      .filter(n => entry.co.has(n) && !exactNames.has(n));
    if (exact.length > 0 || comention.length > 0) {
      result.set(url, { exact, comention });
    }
  });
  return result;
}
