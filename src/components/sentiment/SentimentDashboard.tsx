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
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
          Own brands vs. competitors
        </h3>
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
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
            Sentiment over time
          </h3>
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
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
          Per-LLM sentiment bias (avg score across all brands)
        </h3>
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
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
          Share of positive voice (brand × LLM)
        </h3>
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
