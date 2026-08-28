/**
 * Unpackers for the packed columnar window RPCs
 * (project_responses_window_packed / project_citations_window_packed).
 *
 * The RPCs ship the dashboard's data window as dictionary-encoded
 * row-tuples (see supabase/migrations/20260828170000_window_packed_rpcs.sql
 * for the tuple layouts). These helpers rebuild row objects that are
 * indistinguishable from the previous REST shapes for every consumer:
 * llm_responses.citations arrives in its citations_slim projection,
 * all_sources as {url, domain}, links_attached as {url},
 * answer_competitors as null | {brands:[{name}]} | {} (truthiness of
 * the original error-shaped objects is preserved via comp_kind).
 *
 * Equivalence was verified field-by-field against the REST reference
 * on live projects (6k responses / 40k citations, zero diffs).
 */
import { supabase } from './supabase';

const iso = (epoch: number | null): string | null =>
  epoch === null || epoch === undefined ? null : new Date(epoch * 1000).toISOString();

export function unpackCitations(p: any, idPrefix = ''): any[] {
  const { urls, domains, texts, llms, audits, prompts, rows } = p;
  const out: any[] = new Array(rows.length);
  for (let i = 0; i < rows.length; i++) {
    const [u, d, x, l, a, pr, pos, cited, ss, sl, ch] = rows[i];
    out[i] = {
      // Synthetic id — citation ids are only used as list keys.
      id: `pc${idPrefix}${i}`,
      audit_id: a === null ? null : audits[a],
      prompt_id: pr === null ? null : prompts[pr],
      llm: l === null ? null : llms[l],
      page_url: u === null ? null : urls[u],
      domain: d === null ? null : domains[d],
      citation_text: x === null ? null : texts[x],
      position: pos,
      cited,
      sentiment_score: ss,
      sentiment_label: sl,
      checked_at: iso(ch),
    };
  }
  return out;
}

export function unpackResponses(p: any): any[] {
  const { urls, titles, sdomains, brands, llms, audits, prompts, rows } = p;
  const out: any[] = new Array(rows.length);
  for (let i = 0; i < rows.length; i++) {
    const [rid, a, pr, l, text, cr, ss, sl, shop, ismap, ad, wsq,
           citp, lnp, srp, ck, cp] = rows[i];
    let citations: any = null;
    if (citp !== null) {
      citations = citp.map(([u, c, x]: any[]) => ({
        url: u === null ? undefined : urls[u],
        cited: c === null ? undefined : c,
        title: x === null ? undefined : titles[x],
      }));
    }
    out[i] = {
      id: rid,
      audit_id: a === null ? null : audits[a],
      prompt_id: pr === null ? null : prompts[pr],
      llm: l === null ? null : llms[l],
      answer_text: text,
      created_at: iso(cr),
      sentiment_score: ss,
      sentiment_label: sl,
      shopping_visible: shop === null ? null : shop === 1,
      is_map: ismap === null ? null : ismap === 1,
      ad_name: ad,
      web_search_query: wsq,
      citations,
      links_attached: lnp === null ? null
        : lnp.map((u: number | null) => ({ url: u === null ? undefined : urls[u] })),
      all_sources: srp === null ? null
        : srp.map(([u, d]: any[]) => ({
            url: u === null ? undefined : urls[u],
            domain: d === null ? undefined : sdomains[d],
          })),
      answer_competitors: ck === 0 ? null
        : ck === 1
          ? { brands: (cp || []).map((b: number | null) => ({ name: b === null ? undefined : brands[b] })) }
          : {},
    };
  }
  return out;
}

/**
 * Fetch one packed window, adaptively splitting the audit set in half
 * (parallel) when the server hits its statement timeout on a very
 * dense slice. Returns the packed payloads of every part.
 */
export async function fetchPackedWindow(
  fn: 'project_responses_window_packed' | 'project_citations_window_packed',
  projectId: string,
  fromIso: string,
  toIso: string,
  auditIds: string[],
  signal?: AbortSignal,
): Promise<any[]> {
  const call = async (ids: string[]): Promise<any[]> => {
    let q = supabase.rpc(fn, {
      p_project: projectId,
      p_from: fromIso,
      p_to: toIso,
      p_audit_ids: ids,
    });
    if (signal) q = q.abortSignal(signal);
    const { data, error } = await q;
    if (error) {
      const msg = `${(error as any).code || ''} ${(error as any).message || ''}`;
      const isTimeout = msg.includes('57014') || /statement timeout|timeout/i.test(msg);
      if (isTimeout && ids.length >= 2) {
        const mid = Math.ceil(ids.length / 2);
        const [left, right] = await Promise.all([
          call(ids.slice(0, mid)),
          call(ids.slice(mid)),
        ]);
        return [...left, ...right];
      }
      throw error;
    }
    return [data];
  };
  return call(auditIds);
}
