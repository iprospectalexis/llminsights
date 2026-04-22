// Competitor dashboard aggregation utilities.
//
// The Competitors page joins three data sources:
//   1. `brands` (+ aliases)                          → which names are competitors vs. own
//   2. `llm_responses.answer_competitors` JSONB      → mentions + strengths/weaknesses + rank + mention_type
//   3. `response_brand_sentiment`                    → per-brand sentiment rows
//
// These helpers are pure (no side effects, no Supabase calls). The page loads raw
// data once and re-runs aggregation whenever a filter changes.

// ──────── types ─────────────────────────────────────────────────────

export interface BrandRow {
  id: string;
  brand_name: string;
  is_competitor: boolean;
  aliases?: string[] | null;
}

export interface ResponseRow {
  id: string;
  audit_id: string;
  prompt_id: string;
  llm: string;
  answer_competitors: {
    brands?: Array<{
      name?: string;
      strengths?: string[];
      weaknesses?: string[];
      mention_type?: 'recommended' | 'compared' | 'mentioned' | string;
      rank?: number | null;
    }>;
  } | null;
  created_at?: string;
  audit_created_at?: string;
}

export interface SentimentRow {
  response_id: string;
  audit_id: string;
  brand: string;
  brand_kind: 'own' | 'competitor' | 'none' | string;
  label: 'positive' | 'neutral' | 'negative' | 'mention_only' | string;
  score: number | null;
  is_fallback?: boolean;
}

export interface PromptMeta {
  id: string;
  prompt_group: string;
}

export interface AuditMeta {
  id: string;
  created_at: string;
}

export interface CompetitorStats {
  name: string;
  key: string;
  isOwn: boolean;
  mentions: number;
  sov: number; // 0..1 — share of total mentions across all brands
  sentimentAvg: number; // mean score, 0 if no sentiment rows
  sentimentCounts: {
    positive: number;
    neutral: number;
    negative: number;
    mention_only: number;
  };
  mentionTypeCounts: {
    recommended: number;
    compared: number;
    mentioned: number;
  };
  avgRank: number | null;
  topStrengths: { text: string; count: number }[];
  topWeaknesses: { text: string; count: number }[];
  mentionsByPromptGroup: Record<string, number>;
  mentionsByLlm: Record<string, number>;
  trendByAudit: {
    auditId: string;
    createdAt: string;
    mentions: number;
    sentimentAvg: number;
  }[];
}

// ──────── canonicalisation ──────────────────────────────────────────

// Lowercase, strip accents, collapse whitespace. Used for deduping brands
// across inconsistent capitalisation / accents coming from LLM extraction.
export function canonicalBrandKey(name: string): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining marks (é → e)
    .trim()
    .replace(/\s+/g, ' ');
}

// Given an LLM-extracted brand name, find which known brand (if any) it refers to.
// Matches against brand_name AND each alias, canonical-keyed.
export function matchBrand(name: string, brands: BrandRow[]): BrandRow | null {
  const key = canonicalBrandKey(name);
  if (!key) return null;
  for (const b of brands) {
    if (canonicalBrandKey(b.brand_name) === key) return b;
    for (const alias of b.aliases || []) {
      if (canonicalBrandKey(alias) === key) return b;
    }
  }
  return null;
}

// ──────── main aggregation ──────────────────────────────────────────

export function aggregateCompetitors(params: {
  responses: ResponseRow[];
  sentimentRows: SentimentRow[];
  brands: BrandRow[];
  prompts: PromptMeta[];
  audits: AuditMeta[];
}): CompetitorStats[] {
  const { responses, sentimentRows, brands, prompts, audits } = params;

  // Own-brand canonical keys — anything matching these is isOwn = true.
  const ownKeys = new Set<string>();
  for (const b of brands) {
    if (!b.is_competitor) {
      ownKeys.add(canonicalBrandKey(b.brand_name));
      for (const a of b.aliases || []) ownKeys.add(canonicalBrandKey(a));
    }
  }

  const promptGroupById = new Map<string, string>();
  for (const p of prompts) promptGroupById.set(p.id, p.prompt_group || 'General');

  const auditById = new Map<string, AuditMeta>();
  for (const a of audits) auditById.set(a.id, a);

  // Accumulator keyed by canonical brand key.
  interface Acc {
    name: string; // first-seen display form
    key: string;
    isOwn: boolean;
    mentions: number;
    sentimentScores: number[];
    sentimentCounts: CompetitorStats['sentimentCounts'];
    mentionTypeCounts: CompetitorStats['mentionTypeCounts'];
    ranks: number[];
    strengths: Map<string, number>;
    weaknesses: Map<string, number>;
    mentionsByPromptGroup: Record<string, number>;
    mentionsByLlm: Record<string, number>;
    perAudit: Map<string, { mentions: number; scores: number[] }>;
  }

  const acc = new Map<string, Acc>();
  const emptyAcc = (name: string, key: string, isOwn: boolean): Acc => ({
    name,
    key,
    isOwn,
    mentions: 0,
    sentimentScores: [],
    sentimentCounts: { positive: 0, neutral: 0, negative: 0, mention_only: 0 },
    mentionTypeCounts: { recommended: 0, compared: 0, mentioned: 0 },
    ranks: [],
    strengths: new Map(),
    weaknesses: new Map(),
    mentionsByPromptGroup: {},
    mentionsByLlm: {},
    perAudit: new Map(),
  });

  // Pass 1 — walk every response.answer_competitors.brands[] entry.
  for (const r of responses) {
    const brandList = r.answer_competitors?.brands;
    if (!Array.isArray(brandList)) continue;
    const group = promptGroupById.get(r.prompt_id) || 'General';

    for (const b of brandList) {
      const rawName = (b?.name || '').trim();
      if (!rawName) continue;
      const key = canonicalBrandKey(rawName);
      if (!key) continue;

      let slot = acc.get(key);
      if (!slot) {
        slot = emptyAcc(rawName, key, ownKeys.has(key));
        acc.set(key, slot);
      }
      slot.mentions += 1;

      // mention_type
      const mt = (b.mention_type || 'mentioned').toLowerCase();
      if (mt === 'recommended') slot.mentionTypeCounts.recommended += 1;
      else if (mt === 'compared') slot.mentionTypeCounts.compared += 1;
      else slot.mentionTypeCounts.mentioned += 1;

      // rank
      if (typeof b.rank === 'number' && Number.isFinite(b.rank)) {
        slot.ranks.push(b.rank);
      }

      // strengths / weaknesses (dedup on normalised text)
      for (const s of b.strengths || []) {
        const t = (s || '').trim();
        if (!t) continue;
        const k = t.toLowerCase();
        slot.strengths.set(k, (slot.strengths.get(k) || 0) + 1);
      }
      for (const w of b.weaknesses || []) {
        const t = (w || '').trim();
        if (!t) continue;
        const k = t.toLowerCase();
        slot.weaknesses.set(k, (slot.weaknesses.get(k) || 0) + 1);
      }

      slot.mentionsByPromptGroup[group] = (slot.mentionsByPromptGroup[group] || 0) + 1;
      slot.mentionsByLlm[r.llm] = (slot.mentionsByLlm[r.llm] || 0) + 1;

      const audit = auditById.get(r.audit_id);
      if (audit) {
        let per = slot.perAudit.get(audit.id);
        if (!per) {
          per = { mentions: 0, scores: [] };
          slot.perAudit.set(audit.id, per);
        }
        per.mentions += 1;
      }
    }
  }

  // Pass 2 — sentiment rows. Skip sentinel brands (__none__, __error__, __stuck__).
  for (const s of sentimentRows) {
    const rawName = (s.brand || '').trim();
    if (!rawName || rawName.startsWith('__')) continue;
    const key = canonicalBrandKey(rawName);
    if (!key) continue;

    let slot = acc.get(key);
    if (!slot) {
      // Sentiment exists but no answer_competitors mention — still track it
      slot = emptyAcc(rawName, key, s.brand_kind === 'own' || ownKeys.has(key));
      acc.set(key, slot);
    }

    const label = (s.label || '').toLowerCase();
    if (label === 'positive') slot.sentimentCounts.positive += 1;
    else if (label === 'negative') slot.sentimentCounts.negative += 1;
    else if (label === 'neutral') slot.sentimentCounts.neutral += 1;
    else if (label === 'mention_only') slot.sentimentCounts.mention_only += 1;

    if (typeof s.score === 'number' && Number.isFinite(s.score)) {
      slot.sentimentScores.push(s.score);
      const per = slot.perAudit.get(s.audit_id);
      if (per) per.scores.push(s.score);
    }
  }

  // Finalise — compute derived fields.
  const totalMentions = Array.from(acc.values()).reduce((sum, a) => sum + a.mentions, 0);

  // Chronological audit order for trend arrays.
  const orderedAudits = [...audits].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  const result: CompetitorStats[] = Array.from(acc.values()).map((a) => {
    const topStrengths = Array.from(a.strengths.entries())
      .sort((x, y) => y[1] - x[1])
      .slice(0, 5)
      .map(([text, count]) => ({ text, count }));
    const topWeaknesses = Array.from(a.weaknesses.entries())
      .sort((x, y) => y[1] - x[1])
      .slice(0, 5)
      .map(([text, count]) => ({ text, count }));

    const sentimentAvg =
      a.sentimentScores.length > 0
        ? a.sentimentScores.reduce((s, v) => s + v, 0) / a.sentimentScores.length
        : 0;

    const avgRank = a.ranks.length > 0 ? a.ranks.reduce((s, v) => s + v, 0) / a.ranks.length : null;

    const trendByAudit = orderedAudits.map((au) => {
      const per = a.perAudit.get(au.id);
      return {
        auditId: au.id,
        createdAt: au.created_at,
        mentions: per?.mentions || 0,
        sentimentAvg:
          per && per.scores.length > 0
            ? per.scores.reduce((s, v) => s + v, 0) / per.scores.length
            : 0,
      };
    });

    return {
      name: a.name,
      key: a.key,
      isOwn: a.isOwn,
      mentions: a.mentions,
      sov: totalMentions > 0 ? a.mentions / totalMentions : 0,
      sentimentAvg,
      sentimentCounts: a.sentimentCounts,
      mentionTypeCounts: a.mentionTypeCounts,
      avgRank,
      topStrengths,
      topWeaknesses,
      mentionsByPromptGroup: a.mentionsByPromptGroup,
      mentionsByLlm: a.mentionsByLlm,
      trendByAudit,
    };
  });

  // Default sort: SOV descending. Own brands first within the same SOV tier so
  // they're easy to find in the leaderboard.
  result.sort((x, y) => {
    if (y.sov !== x.sov) return y.sov - x.sov;
    if (y.isOwn !== x.isOwn) return y.isOwn ? 1 : -1;
    return x.name.localeCompare(y.name);
  });
  return result;
}

// ──────── aggregated strengths / weaknesses across the whole project ──

// Returns tags sorted by frequency (desc), with the list of brands that had each.
export function aggregateTags(
  stats: CompetitorStats[],
  kind: 'strengths' | 'weaknesses'
): { text: string; count: number; brands: string[] }[] {
  const agg = new Map<string, { count: number; brands: Set<string> }>();
  for (const c of stats) {
    const src = kind === 'strengths' ? c.topStrengths : c.topWeaknesses;
    for (const t of src) {
      let slot = agg.get(t.text);
      if (!slot) {
        slot = { count: 0, brands: new Set() };
        agg.set(t.text, slot);
      }
      slot.count += t.count;
      slot.brands.add(c.name);
    }
  }
  return Array.from(agg.entries())
    .map(([text, v]) => ({ text, count: v.count, brands: Array.from(v.brands) }))
    .sort((a, b) => b.count - a.count);
}
