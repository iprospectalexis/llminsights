/**
 * SentimentDashboard
 *
 * Aggregated views over response_brand_sentiment for a project:
 *   - Share-of-voice heatmap (brand x LLM)
 *   - Sentiment over time (line per brand)
 *   - Brand vs. competitor delta
 *   - Per-LLM bias bar chart
 *
 * Powered by SQL aggregates over the new per-brand-per-response table — no
 * model calls. Falls back gracefully when no V2 data exists yet (during
 * rollout, before any audit has run on the new pipeline).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Card } from '../ui/Card';
import { LoadingSpinner } from '../ui/LoadingSpinner';
import { supabase } from '../../lib/supabase';
import { Info } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend,
} from 'recharts';

interface SentimentRow {
  brand: string;
  brand_kind: 'own' | 'competitor';
  label: 'positive' | 'neutral' | 'negative' | 'mention_only';
  score: number;
  confidence: number | null;
  audit_id: string;
  response_id: string;
  llm: string;
  audit_started_at: string;
}

interface Props {
  projectId: string;
}

const LABEL_COLORS: Record<string, string> = {
  positive: '#22c55e',
  neutral: '#6b7280',
  negative: '#ef4444',
  mention_only: '#a855f7',
};

export const SentimentDashboard: React.FC<Props> = ({ projectId }) => {
  const [rows, setRows] = useState<SentimentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        // Pull project audits, then sentiment rows joined with llm_responses for the LLM column
        const { data: audits, error: auditErr } = await supabase
          .from('audits')
          .select('id, started_at')
          .eq('project_id', projectId)
          .eq('status', 'completed')
          .order('started_at', { ascending: true });
        if (auditErr) throw auditErr;
        const auditIds = (audits || []).map((a) => a.id);
        if (auditIds.length === 0) {
          if (!cancelled) setRows([]);
          return;
        }
        const startedMap = new Map<string, string>(
          (audits || []).map((a) => [a.id, a.started_at as string])
        );

        const { data, error: rbsErr } = await supabase
          .from('response_brand_sentiment')
          .select(`
            brand, brand_kind, label, score, confidence, audit_id, response_id,
            llm_responses!inner(llm)
          `)
          .in('audit_id', auditIds);
        if (rbsErr) throw rbsErr;

        const flat: SentimentRow[] = (data || []).map((r: any) => ({
          brand: r.brand,
          brand_kind: r.brand_kind,
          label: r.label,
          score: Number(r.score),
          confidence: r.confidence != null ? Number(r.confidence) : null,
          audit_id: r.audit_id,
          response_id: r.response_id,
          llm: r.llm_responses?.llm ?? 'unknown',
          audit_started_at: startedMap.get(r.audit_id) || '',
        }));
        if (!cancelled) setRows(flat);
      } catch (e: any) {
        if (!cancelled) setError(e.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // ── Aggregations ────────────────────────────────────────────────────
  const brands = useMemo(
    () => Array.from(new Set(rows.map((r) => r.brand))).sort(),
    [rows]
  );
  const llms = useMemo(
    () => Array.from(new Set(rows.map((r) => r.llm))).sort(),
    [rows]
  );

  // Share of voice (sentiment-weighted) per brand x LLM
  const sovMatrix = useMemo(() => {
    const cells: Record<string, Record<string, { pos: number; neg: number; tot: number }>> = {};
    for (const r of rows) {
      cells[r.brand] ||= {};
      cells[r.brand][r.llm] ||= { pos: 0, neg: 0, tot: 0 };
      const c = cells[r.brand][r.llm];
      c.tot += 1;
      if (r.label === 'positive') c.pos += 1;
      else if (r.label === 'negative') c.neg += 1;
    }
    return cells;
  }, [rows]);

  // Sentiment over time: average score per brand per audit
  const timeSeries = useMemo(() => {
    const byAudit: Record<string, Record<string, { sum: number; n: number; date: string }>> = {};
    for (const r of rows) {
      byAudit[r.audit_id] ||= {};
      byAudit[r.audit_id][r.brand] ||= { sum: 0, n: 0, date: r.audit_started_at };
      byAudit[r.audit_id][r.brand].sum += r.score;
      byAudit[r.audit_id][r.brand].n += 1;
    }
    const sortedAudits = Object.entries(byAudit).sort(
      (a, b) => new Date(a[1][Object.keys(a[1])[0]]?.date || 0).getTime() -
                new Date(b[1][Object.keys(b[1])[0]]?.date || 0).getTime()
    );
    return sortedAudits.map(([auditId, brandMap]) => {
      const point: any = {
        date: new Date(brandMap[Object.keys(brandMap)[0]]?.date || 0).toLocaleDateString(),
      };
      for (const brand of brands) {
        const cell = brandMap[brand];
        point[brand] = cell ? +(cell.sum / cell.n).toFixed(2) : null;
      }
      return point;
    });
  }, [rows, brands]);

  // Brand vs competitor delta
  const ownVsComp = useMemo(() => {
    let ownSum = 0, ownN = 0, compSum = 0, compN = 0;
    for (const r of rows) {
      if (r.brand_kind === 'own') { ownSum += r.score; ownN += 1; }
      else { compSum += r.score; compN += 1; }
    }
    const ownAvg = ownN ? ownSum / ownN : 0;
    const compAvg = compN ? compSum / compN : 0;
    return { ownAvg, compAvg, delta: ownAvg - compAvg };
  }, [rows]);

  // Per-LLM bias: avg score across all brands per LLM
  const perLlmBias = useMemo(() => {
    const agg: Record<string, { sum: number; n: number }> = {};
    for (const r of rows) {
      agg[r.llm] ||= { sum: 0, n: 0 };
      agg[r.llm].sum += r.score;
      agg[r.llm].n += 1;
    }
    return Object.entries(agg).map(([llm, v]) => ({
      llm,
      avg: +(v.sum / v.n).toFixed(2),
    }));
  }, [rows]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <LoadingSpinner />
      </div>
    );
  }

  if (error) {
    return (
      <Card className="p-6">
        <p className="text-red-600 dark:text-red-400">Error loading sentiment data: {error}</p>
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <Card className="p-6" hover={false}>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
          No sentiment data yet
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Run an audit with sentiment analysis enabled to populate this dashboard.
          Sentiment V2 produces per-brand-per-response scores for both your own brands
          and tracked competitors.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Brand vs competitor delta */}
      <Card className="p-6" hover={false}>
        <div className="flex items-center mb-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Own brands vs. competitors
          </h3>
          <div className="group relative inline-block ml-2">
            <Info className="w-4 h-4 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 cursor-help transition-colors" />
            <div className="absolute top-full left-0 mt-2 w-80 p-3 bg-gray-900 text-white text-xs rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 pointer-events-none z-10">
              <div className="font-semibold mb-1">Sentiment Score Scale</div>
              <div className="mb-2">Scores range from -1.0 (strongly negative) to +1.0 (strongly positive).</div>
              <ul className="list-disc list-inside space-y-0.5 mb-2">
                <li>+0.5 to +1.0 — Strongly positive (enthusiastic recommendation)</li>
                <li>+0.1 to +0.5 — Mildly positive (favorable mention)</li>
                <li>0.0 — Neutral or mention-only (no opinion expressed)</li>
                <li>-0.1 to -0.5 — Mildly negative (criticism or concern)</li>
                <li>-0.5 to -1.0 — Strongly negative (warning or discouragement)</li>
              </ul>
              <div className="text-white/70 italic">Delta = Own avg − Competitor avg. Positive delta means AI engines perceive your brand more favorably than competitors.</div>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <div className="text-sm text-gray-500">Own avg score</div>
            <div className="text-3xl font-bold text-blue-600">
              {ownVsComp.ownAvg.toFixed(2)}
            </div>
          </div>
          <div>
            <div className="text-sm text-gray-500">Competitor avg score</div>
            <div className="text-3xl font-bold text-purple-600">
              {ownVsComp.compAvg.toFixed(2)}
            </div>
          </div>
          <div>
            <div className="text-sm text-gray-500">Delta (own − competitors)</div>
            <div
              className={`text-3xl font-bold ${
                ownVsComp.delta >= 0 ? 'text-green-600' : 'text-red-600'
              }`}
            >
              {ownVsComp.delta >= 0 ? '+' : ''}
              {ownVsComp.delta.toFixed(2)}
            </div>
          </div>
        </div>
      </Card>

      {/* Sentiment over time */}
      {timeSeries.length > 1 && (
        <Card className="p-6" hover={false}>
          <div className="flex items-center mb-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Sentiment over time
            </h3>
            <div className="group relative inline-block ml-2">
              <Info className="w-4 h-4 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 cursor-help transition-colors" />
              <div className="absolute top-full left-0 mt-2 w-80 p-3 bg-gray-900 text-white text-xs rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 pointer-events-none z-10">
                <div className="font-semibold mb-1">Sentiment Over Time</div>
                <div className="mb-2">Average sentiment score per brand for each audit run. The Y-axis ranges from -1.0 (negative) to +1.0 (positive). A rising trend indicates improving brand perception across AI engines.</div>
                <div className="text-white/70 italic">Each point is the mean score of all per-response evaluations for that brand in that audit.</div>
              </div>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={timeSeries}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis domain={[-1, 1]} />
              <Tooltip />
              <Legend />
              {brands.map((brand, i) => (
                <Line
                  key={brand}
                  type="monotone"
                  dataKey={brand}
                  stroke={`hsl(${(i * 137) % 360}, 65%, 50%)`}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* Per-LLM bias */}
      <Card className="p-6" hover={false}>
        <div className="flex items-center mb-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Per-LLM sentiment bias (avg score across all brands)
          </h3>
          <div className="group relative inline-block ml-2">
            <Info className="w-4 h-4 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 cursor-help transition-colors" />
            <div className="absolute top-full left-0 mt-2 w-80 p-3 bg-gray-900 text-white text-xs rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 pointer-events-none z-10">
              <div className="font-semibold mb-1">Per-LLM Sentiment Bias</div>
              <div className="mb-2">Average sentiment score across all brands, broken down by AI engine. Reveals whether a specific LLM tends to evaluate brands more positively or negatively compared to others.</div>
              <div className="text-white/70 italic">Values near 0 indicate balanced evaluation; large positive or negative values suggest systematic bias in that engine.</div>
            </div>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={perLlmBias}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="llm" />
            <YAxis domain={[-1, 1]} />
            <Tooltip />
            <Bar dataKey="avg" fill="#3b82f6" />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* Share of voice heatmap */}
      <Card className="p-6" hover={false}>
        <div className="flex items-center mb-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Share of positive voice (brand × LLM)
          </h3>
          <div className="group relative inline-block ml-2">
            <Info className="w-4 h-4 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 cursor-help transition-colors" />
            <div className="absolute top-full left-0 mt-2 w-80 p-3 bg-gray-900 text-white text-xs rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 pointer-events-none z-10">
              <div className="font-semibold mb-1">Share of Positive Voice (SPV)</div>
              <div className="mb-2">Formula: (Positive mentions − Negative mentions) / Total mentions. Ranges from -1.0 to +1.0:</div>
              <ul className="list-disc list-inside space-y-0.5 mb-2">
                <li>&gt; +0.2 (green) — Net positive perception</li>
                <li>-0.2 to +0.2 (gray) — Balanced / neutral</li>
                <li>&lt; -0.2 (red) — Net negative perception</li>
              </ul>
              <div className="text-white/70 italic">"Mentions" count only responses where the brand was detected. Neutral and mention-only responses count toward the total but not toward positive or negative.</div>
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr>
                <th className="text-left p-2 text-gray-600 dark:text-gray-400">Brand</th>
                {llms.map((llm) => (
                  <th key={llm} className="text-center p-2 text-gray-600 dark:text-gray-400">
                    {llm}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {brands.map((brand) => (
                <tr key={brand}>
                  <td className="p-2 font-medium text-gray-900 dark:text-gray-100">{brand}</td>
                  {llms.map((llm) => {
                    const c = sovMatrix[brand]?.[llm];
                    if (!c || c.tot === 0) {
                      return (
                        <td key={llm} className="p-2 text-center text-gray-400">
                          —
                        </td>
                      );
                    }
                    const sov = (c.pos - c.neg) / c.tot;
                    const bg =
                      sov > 0.2 ? 'bg-green-100 dark:bg-green-900/30'
                      : sov < -0.2 ? 'bg-red-100 dark:bg-red-900/30'
                      : 'bg-gray-100 dark:bg-gray-700/30';
                    return (
                      <td key={llm} className={`p-2 text-center rounded ${bg}`}>
                        {sov.toFixed(2)}
                        <div className="text-xs text-gray-500">{c.tot} mentions</div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};
