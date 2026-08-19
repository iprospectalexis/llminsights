// Brand name → official-site domain resolution (Tier 0, client-side, free).
//
// A brand that LLMs mention almost always gets its own site cited, so the
// project's citations are the best source: match the domain's registrable
// label against the normalized brand name ("Crédit Agricole" ↔
// credit-agricole.fr) and pick the most-cited candidate. Brands never cited
// fall back to the global brand_domains table (filled by gpt-5-nano after
// each audit).

export function normalizeBrandKey(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

export function buildBrandDomainMapFromCitations(
  citations: Array<{ domain?: string | null }>
): Record<string, string> {
  // brandKey -> domain -> citation count
  const counts = new Map<string, Map<string, number>>();
  citations.forEach(c => {
    if (!c.domain) return;
    const d = String(c.domain).toLowerCase().replace(/^www\./, '');
    const labels = d.split('.');
    if (labels.length < 2) return;
    const key = normalizeBrandKey(labels[labels.length - 2]);
    if (key.length < 3) return;
    let byDomain = counts.get(key);
    if (!byDomain) {
      byDomain = new Map();
      counts.set(key, byDomain);
    }
    byDomain.set(d, (byDomain.get(d) || 0) + 1);
  });
  const out: Record<string, string> = {};
  counts.forEach((byDomain, key) => {
    let best = '';
    let bestN = -1;
    byDomain.forEach((n, d) => {
      if (n > bestN) {
        bestN = n;
        best = d;
      }
    });
    if (best) out[key] = best;
  });
  return out;
}
