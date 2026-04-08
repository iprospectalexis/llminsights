import React, { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import {
  BarChart, Bar, PieChart, Pie, Cell,
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { format, subDays } from 'date-fns';
import { DollarSign, TrendingDown, TrendingUp, Activity, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { Card, CardContent, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { LoadingSpinner } from '../../components/ui/LoadingSpinner';

// ─── Types ──────────────────────────────────────────────────────────────

interface SummaryRow {
  total_cost_usd: number;
  openai_cost_usd: number;
  brightdata_cost_usd: number;
  onesearch_cost_usd: number;
  competitors_cost_usd: number;
  sentiment_cost_usd: number;
  scrape_cost_usd: number;
  total_calls: number;
  audits_count: number;
  prev_total_cost_usd: number;
}

interface DailyRow {
  day: string;
  openai_cost_usd: number;
  brightdata_cost_usd: number;
  onesearch_cost_usd: number;
  competitors_cost_usd: number;
  sentiment_cost_usd: number;
  scrape_cost_usd: number;
  total_cost_usd: number;
}

interface ProjectRow {
  project_id: string;
  project_name: string;
  prompts_count: number;
  audits_count: number;
  total_cost_usd: number;
  openai_cost_usd: number;
  brightdata_cost_usd: number;
  onesearch_cost_usd: number;
  competitors_cost_usd: number;
  sentiment_cost_usd: number;
  scrape_cost_usd: number;
}

interface UserRow {
  user_id: string;
  user_email: string | null;
  user_full_name: string | null;
  audits_count: number;
  total_cost_usd: number;
  openai_cost_usd: number;
  brightdata_cost_usd: number;
  onesearch_cost_usd: number;
  competitors_cost_usd: number;
  sentiment_cost_usd: number;
  scrape_cost_usd: number;
}

interface OperationRow {
  operation: string;
  calls: number;
  total_units: number;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  total_cost_usd: number;
}

interface AuditRow {
  audit_id: string;
  project_id: string | null;
  project_name: string | null;
  user_id: string | null;
  user_email: string | null;
  started_at: string | null;
  status: string | null;
  prompts_count: number;
  total_cost_usd: number;
  openai_cost_usd: number;
  scrape_cost_usd: number;
  competitors_cost_usd: number;
  sentiment_cost_usd: number;
}

interface AuditEvent {
  id: string;
  occurred_at: string;
  provider: string;
  model: string | null;
  operation: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  units: number | null;
  cost_usd: number;
  metadata: any;
}

// ─── Helpers ────────────────────────────────────────────────────────────

const fmtUsd = (n: number | null | undefined) =>
  `$${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;

const fmtUsdShort = (n: number) =>
  `$${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtInt = (n: number | null | undefined) =>
  (Number(n) || 0).toLocaleString();

const OPERATION_LABELS: Record<string, string> = {
  scrape: 'Scrape (Brightdata/OneSearch)',
  competitors_extract: 'Competitor extraction',
  sentiment_analyze: 'Sentiment analysis',
};

const OPERATION_COLORS: Record<string, string> = {
  scrape: '#0ea5e9',
  competitors_extract: '#a855f7',
  sentiment_analyze: '#f59e0b',
};

const PRESETS: { label: string; days: number }[] = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
];

// ─── Page ───────────────────────────────────────────────────────────────

type Tab = 'project' | 'user' | 'operation' | 'audit';

export const CostsPage: React.FC = () => {
  const [profileLoading, setProfileLoading] = useState(true);
  const [allowed, setAllowed] = useState<boolean | null>(null);

  const [days, setDays] = useState(30);
  const [from, to] = useMemo(() => {
    const t = new Date();
    const f = subDays(t, days);
    return [f.toISOString(), t.toISOString()];
  }, [days]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<SummaryRow | null>(null);
  const [daily, setDaily] = useState<DailyRow[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [operations, setOperations] = useState<OperationRow[]>([]);
  const [audits, setAudits] = useState<AuditRow[]>([]);

  const [tab, setTab] = useState<Tab>('project');
  const [drillAudit, setDrillAudit] = useState<AuditRow | null>(null);
  const [drillEvents, setDrillEvents] = useState<AuditEvent[] | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);

  // Role check
  useEffect(() => {
    (async () => {
      try {
        const { data: userData } = await supabase.auth.getUser();
        const uid = userData.user?.id;
        if (!uid) {
          setAllowed(false);
          return;
        }
        const { data, error } = await supabase
          .from('users')
          .select('role')
          .eq('id', uid)
          .maybeSingle();
        if (error) throw error;
        setAllowed(data?.role === 'admin' || data?.role === 'manager');
      } catch (e) {
        console.error('CostsPage: profile check failed', e);
        setAllowed(false);
      } finally {
        setProfileLoading(false);
      }
    })();
  }, []);

  // Fetch all data when range changes
  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [s, d, p, u, o, a] = await Promise.all([
          supabase.rpc('get_costs_summary', { p_from: from, p_to: to }),
          supabase.rpc('get_costs_daily', { p_from: from, p_to: to }),
          supabase.rpc('get_costs_by_project', { p_from: from, p_to: to }),
          supabase.rpc('get_costs_by_user', { p_from: from, p_to: to }),
          supabase.rpc('get_costs_by_operation', { p_from: from, p_to: to }),
          supabase.rpc('get_costs_by_audit', { p_from: from, p_to: to, p_limit: 100 }),
        ]);
        if (cancelled) return;
        if (s.error) throw s.error;
        if (d.error) throw d.error;
        if (p.error) throw p.error;
        if (u.error) throw u.error;
        if (o.error) throw o.error;
        if (a.error) throw a.error;
        setSummary((s.data as SummaryRow[])?.[0] ?? null);
        setDaily((d.data as DailyRow[]) ?? []);
        setProjects((p.data as ProjectRow[]) ?? []);
        setUsers((u.data as UserRow[]) ?? []);
        setOperations((o.data as OperationRow[]) ?? []);
        setAudits((a.data as AuditRow[]) ?? []);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load cost data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [allowed, from, to]);

  const openDrill = async (row: AuditRow) => {
    setDrillAudit(row);
    setDrillEvents(null);
    setDrillLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_audit_cost_events', { p_audit_id: row.audit_id });
      if (error) throw error;
      setDrillEvents((data as AuditEvent[]) ?? []);
    } catch (e) {
      console.error('drill events failed', e);
      setDrillEvents([]);
    } finally {
      setDrillLoading(false);
    }
  };

  if (profileLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <LoadingSpinner />
      </div>
    );
  }
  if (!allowed) return <Navigate to="/" replace />;

  const delta = summary
    ? summary.total_cost_usd - summary.prev_total_cost_usd
    : 0;
  const deltaPct = summary && summary.prev_total_cost_usd > 0
    ? (delta / summary.prev_total_cost_usd) * 100
    : null;

  // Donut data: by operation
  const donutData = operations
    .filter((o) => o.total_cost_usd > 0)
    .map((o) => ({
      name: OPERATION_LABELS[o.operation] || o.operation,
      value: Number(o.total_cost_usd),
      key: o.operation,
    }));

  // Daily chart data (formatted day label)
  const dailyData = daily.map((d) => ({
    day: format(new Date(d.day), 'MMM d'),
    scrape: Number(d.scrape_cost_usd),
    competitors_extract: Number(d.competitors_cost_usd),
    sentiment_analyze: Number(d.sentiment_cost_usd),
    total: Number(d.total_cost_usd),
  }));

  // Cumulative
  let acc = 0;
  const cumulativeData = daily.map((d) => {
    acc += Number(d.total_cost_usd);
    return { day: format(new Date(d.day), 'MMM d'), cumulative: acc };
  });

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <DollarSign className="w-7 h-7 text-green-600" />
            API Costs
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Real measured spend on OpenAI &amp; scraping providers (Brightdata / OneSearch).
          </p>
        </div>
        <div className="flex items-center gap-2">
          {PRESETS.map((p) => (
            <Button
              key={p.label}
              variant={days === p.days ? 'primary' : 'secondary'}
              onClick={() => setDays(p.days)}
              className="px-3 py-1.5 text-xs"
            >
              Last {p.label}
            </Button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-96">
          <LoadingSpinner />
        </div>
      ) : (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <Card>
              <CardContent className="pt-6">
                <div className="text-xs text-gray-500 uppercase tracking-wide">Total ({days}d)</div>
                <div className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">
                  {fmtUsdShort(summary?.total_cost_usd ?? 0)}
                </div>
                {deltaPct !== null && (
                  <div className={`mt-1 text-xs flex items-center gap-1 ${delta >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {delta >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                    {Math.abs(deltaPct).toFixed(1)}% vs previous {days}d
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-xs text-gray-500 uppercase tracking-wide">OpenAI</div>
                <div className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">
                  {fmtUsdShort(summary?.openai_cost_usd ?? 0)}
                </div>
                <div className="mt-1 text-xs text-gray-500">
                  Extract {fmtUsdShort(summary?.competitors_cost_usd ?? 0)} · Sentiment {fmtUsdShort(summary?.sentiment_cost_usd ?? 0)}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-xs text-gray-500 uppercase tracking-wide">Scraping</div>
                <div className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">
                  {fmtUsdShort((summary?.brightdata_cost_usd ?? 0) + (summary?.onesearch_cost_usd ?? 0))}
                </div>
                <div className="mt-1 text-xs text-gray-500">
                  Brightdata {fmtUsdShort(summary?.brightdata_cost_usd ?? 0)} · OneSearch {fmtUsdShort(summary?.onesearch_cost_usd ?? 0)}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-xs text-gray-500 uppercase tracking-wide">Audits</div>
                <div className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">
                  {fmtInt(summary?.audits_count ?? 0)}
                </div>
                <div className="mt-1 text-xs text-gray-500 flex items-center gap-1">
                  <Activity className="w-3 h-3" />
                  {fmtInt(summary?.total_calls ?? 0)} API calls
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Charts: stacked daily + donut */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
            <Card className="lg:col-span-2">
              <CardHeader>
                <h3 className="font-semibold text-gray-900 dark:text-white">Daily cost by operation</h3>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={dailyData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={(v) => `$${v.toFixed(2)}`} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v: number) => fmtUsd(v)} />
                    <Legend />
                    <Bar stackId="ops" dataKey="scrape" name="Scrape" fill={OPERATION_COLORS.scrape} />
                    <Bar stackId="ops" dataKey="competitors_extract" name="Competitors" fill={OPERATION_COLORS.competitors_extract} />
                    <Bar stackId="ops" dataKey="sentiment_analyze" name="Sentiment" fill={OPERATION_COLORS.sentiment_analyze} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <h3 className="font-semibold text-gray-900 dark:text-white">Cost by operation</h3>
              </CardHeader>
              <CardContent>
                {donutData.length === 0 ? (
                  <div className="text-center text-sm text-gray-500 py-12">No data yet</div>
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                      <Pie
                        data={donutData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={50}
                        outerRadius={90}
                        paddingAngle={2}
                      >
                        {donutData.map((entry) => (
                          <Cell key={entry.key} fill={OPERATION_COLORS[entry.key] || '#94a3b8'} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: number) => fmtUsd(v)} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Cumulative */}
          <Card className="mb-6">
            <CardHeader>
              <h3 className="font-semibold text-gray-900 dark:text-white">Cumulative cost</h3>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={cumulativeData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={(v) => `$${v.toFixed(2)}`} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number) => fmtUsd(v)} />
                  <Line type="monotone" dataKey="cumulative" stroke="#10b981" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Tabs */}
          <Card>
            <div className="border-b border-gray-200 dark:border-gray-700 px-4 pt-4">
              <div className="flex gap-1">
                {(['project', 'user', 'operation', 'audit'] as Tab[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                      tab === t
                        ? 'bg-white dark:bg-gray-800 text-purple-700 border-b-2 border-purple-600 -mb-px'
                        : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                    }`}
                  >
                    {t === 'project' && 'By project'}
                    {t === 'user' && 'By user'}
                    {t === 'operation' && 'By operation'}
                    {t === 'audit' && 'By audit'}
                  </button>
                ))}
              </div>
            </div>
            <CardContent className="pt-4">
              {tab === 'project' && <ProjectTable rows={projects} total={summary?.total_cost_usd ?? 0} />}
              {tab === 'user' && <UserTable rows={users} total={summary?.total_cost_usd ?? 0} />}
              {tab === 'operation' && <OperationTable rows={operations} total={summary?.total_cost_usd ?? 0} />}
              {tab === 'audit' && <AuditTable rows={audits} onDrill={openDrill} />}
            </CardContent>
          </Card>
        </>
      )}

      {/* Drill-down drawer */}
      {drillAudit && (
        <DrillDrawer
          audit={drillAudit}
          events={drillEvents}
          loading={drillLoading}
          onClose={() => {
            setDrillAudit(null);
            setDrillEvents(null);
          }}
        />
      )}
    </div>
  );
};

// ─── Tables ─────────────────────────────────────────────────────────────

const Th: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <th className={`px-3 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide ${className}`}>
    {children}
  </th>
);

const Td: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <td className={`px-3 py-2 text-sm text-gray-700 dark:text-gray-300 ${className}`}>
    {children}
  </td>
);

const PercentBar: React.FC<{ pct: number }> = ({ pct }) => (
  <div className="flex items-center gap-2">
    <div className="w-20 bg-gray-100 dark:bg-gray-700 rounded-full h-1.5 overflow-hidden">
      <div className="h-full bg-purple-500" style={{ width: `${Math.min(pct, 100)}%` }} />
    </div>
    <span className="text-xs text-gray-500 w-10">{pct.toFixed(1)}%</span>
  </div>
);

const ProjectTable: React.FC<{ rows: ProjectRow[]; total: number }> = ({ rows, total }) => {
  if (rows.length === 0) return <Empty />;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full">
        <thead className="border-b border-gray-200 dark:border-gray-700">
          <tr>
            <Th>Project</Th>
            <Th>Prompts</Th>
            <Th>Audits</Th>
            <Th>OpenAI</Th>
            <Th>Scrape</Th>
            <Th>Total</Th>
            <Th>Share</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
          {rows.map((r) => (
            <tr key={r.project_id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
              <Td className="font-medium text-gray-900 dark:text-white">{r.project_name || '—'}</Td>
              <Td>{fmtInt(r.prompts_count)}</Td>
              <Td>{fmtInt(r.audits_count)}</Td>
              <Td>{fmtUsd(r.openai_cost_usd)}</Td>
              <Td>{fmtUsd(Number(r.brightdata_cost_usd) + Number(r.onesearch_cost_usd))}</Td>
              <Td className="font-semibold">{fmtUsd(r.total_cost_usd)}</Td>
              <Td><PercentBar pct={total ? (Number(r.total_cost_usd) / total) * 100 : 0} /></Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const UserTable: React.FC<{ rows: UserRow[]; total: number }> = ({ rows, total }) => {
  if (rows.length === 0) return <Empty />;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full">
        <thead className="border-b border-gray-200 dark:border-gray-700">
          <tr>
            <Th>User</Th>
            <Th>Audits</Th>
            <Th>OpenAI</Th>
            <Th>Scrape</Th>
            <Th>Total</Th>
            <Th>Share</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
          {rows.map((r) => (
            <tr key={r.user_id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
              <Td className="font-medium text-gray-900 dark:text-white">
                {r.user_full_name || r.user_email || '—'}
                {r.user_full_name && r.user_email && (
                  <div className="text-xs text-gray-500">{r.user_email}</div>
                )}
              </Td>
              <Td>{fmtInt(r.audits_count)}</Td>
              <Td>{fmtUsd(r.openai_cost_usd)}</Td>
              <Td>{fmtUsd(Number(r.brightdata_cost_usd) + Number(r.onesearch_cost_usd))}</Td>
              <Td className="font-semibold">{fmtUsd(r.total_cost_usd)}</Td>
              <Td><PercentBar pct={total ? (Number(r.total_cost_usd) / total) * 100 : 0} /></Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const OperationTable: React.FC<{ rows: OperationRow[]; total: number }> = ({ rows, total }) => {
  if (rows.length === 0) return <Empty />;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full">
        <thead className="border-b border-gray-200 dark:border-gray-700">
          <tr>
            <Th>Operation</Th>
            <Th>Calls</Th>
            <Th>Tokens (in / out)</Th>
            <Th>Units</Th>
            <Th>Total</Th>
            <Th>Share</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
          {rows.map((r) => (
            <tr key={r.operation} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
              <Td className="font-medium text-gray-900 dark:text-white">
                <span className="inline-block w-2 h-2 rounded-full mr-2" style={{ background: OPERATION_COLORS[r.operation] || '#94a3b8' }} />
                {OPERATION_LABELS[r.operation] || r.operation}
              </Td>
              <Td>{fmtInt(r.calls)}</Td>
              <Td>{fmtInt(r.total_prompt_tokens)} / {fmtInt(r.total_completion_tokens)}</Td>
              <Td>{fmtInt(r.total_units)}</Td>
              <Td className="font-semibold">{fmtUsd(r.total_cost_usd)}</Td>
              <Td><PercentBar pct={total ? (Number(r.total_cost_usd) / total) * 100 : 0} /></Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const AuditTable: React.FC<{ rows: AuditRow[]; onDrill: (r: AuditRow) => void }> = ({ rows, onDrill }) => {
  if (rows.length === 0) return <Empty />;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full">
        <thead className="border-b border-gray-200 dark:border-gray-700">
          <tr>
            <Th>Date</Th>
            <Th>Project</Th>
            <Th>User</Th>
            <Th>Status</Th>
            <Th>Prompts</Th>
            <Th>Scrape</Th>
            <Th>Extract</Th>
            <Th>Sentiment</Th>
            <Th>Total</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
          {rows.map((r) => (
            <tr
              key={r.audit_id}
              className="hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer"
              onClick={() => onDrill(r)}
            >
              <Td>{r.started_at ? format(new Date(r.started_at), 'MMM d, HH:mm') : '—'}</Td>
              <Td className="font-medium text-gray-900 dark:text-white">{r.project_name || '—'}</Td>
              <Td>{r.user_email || '—'}</Td>
              <Td>
                <span className={`inline-block px-2 py-0.5 rounded text-xs ${
                  r.status === 'completed' ? 'bg-green-100 text-green-700' :
                  r.status === 'failed' ? 'bg-red-100 text-red-700' :
                  'bg-gray-100 text-gray-700'
                }`}>
                  {r.status || '—'}
                </span>
              </Td>
              <Td>{fmtInt(r.prompts_count)}</Td>
              <Td>{fmtUsd(r.scrape_cost_usd)}</Td>
              <Td>{fmtUsd(r.competitors_cost_usd)}</Td>
              <Td>{fmtUsd(r.sentiment_cost_usd)}</Td>
              <Td className="font-semibold">{fmtUsd(r.total_cost_usd)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const Empty: React.FC = () => (
  <div className="text-center py-12 text-sm text-gray-500">
    No cost data for the selected period.
  </div>
);

// ─── Drill drawer ───────────────────────────────────────────────────────

const DrillDrawer: React.FC<{
  audit: AuditRow;
  events: AuditEvent[] | null;
  loading: boolean;
  onClose: () => void;
}> = ({ audit, events, loading, onClose }) => {
  // Group events by operation
  const grouped = useMemo(() => {
    const m: Record<string, { events: AuditEvent[]; total: number }> = {};
    (events || []).forEach((e) => {
      if (!m[e.operation]) m[e.operation] = { events: [], total: 0 };
      m[e.operation].events.push(e);
      m[e.operation].total += Number(e.cost_usd) || 0;
    });
    return m;
  }, [events]);

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="ml-auto relative w-full max-w-2xl h-full bg-white dark:bg-gray-900 shadow-2xl overflow-y-auto">
        <div className="sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 p-4 flex items-center justify-between">
          <div>
            <div className="text-xs text-gray-500">Audit cost detail</div>
            <div className="font-semibold text-gray-900 dark:text-white">{audit.project_name || audit.audit_id}</div>
            <div className="text-xs text-gray-500 mt-0.5">
              {audit.started_at ? format(new Date(audit.started_at), 'PPp') : ''} · {audit.user_email || '—'}
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
              <div className="text-xs text-gray-500">Total</div>
              <div className="text-lg font-bold">{fmtUsd(audit.total_cost_usd)}</div>
            </div>
            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
              <div className="text-xs text-gray-500">OpenAI / Scrape</div>
              <div className="text-sm font-semibold">
                {fmtUsd(audit.openai_cost_usd)} <span className="text-gray-400">/</span> {fmtUsd(audit.scrape_cost_usd)}
              </div>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <LoadingSpinner />
            </div>
          ) : !events || events.length === 0 ? (
            <div className="text-center text-sm text-gray-500 py-12">No tracked events for this audit.</div>
          ) : (
            Object.entries(grouped).map(([op, { events: evs, total }]) => (
              <div key={op}>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-semibold text-gray-900 dark:text-white">
                    <span
                      className="inline-block w-2 h-2 rounded-full mr-2"
                      style={{ background: OPERATION_COLORS[op] || '#94a3b8' }}
                    />
                    {OPERATION_LABELS[op] || op}
                    <span className="ml-2 text-xs text-gray-500 font-normal">({evs.length} calls)</span>
                  </h4>
                  <div className="text-sm font-semibold">{fmtUsd(total)}</div>
                </div>
                <div className="bg-gray-50 dark:bg-gray-800 rounded-lg overflow-hidden">
                  <table className="min-w-full text-xs">
                    <thead className="bg-gray-100 dark:bg-gray-700">
                      <tr>
                        <th className="px-2 py-1.5 text-left">When</th>
                        <th className="px-2 py-1.5 text-left">Provider / Model</th>
                        <th className="px-2 py-1.5 text-right">Tokens / Units</th>
                        <th className="px-2 py-1.5 text-right">Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {evs.map((e) => (
                        <tr key={e.id} className="border-t border-gray-200 dark:border-gray-700">
                          <td className="px-2 py-1.5">{format(new Date(e.occurred_at), 'HH:mm:ss')}</td>
                          <td className="px-2 py-1.5">{e.provider}{e.model ? ` · ${e.model}` : ''}</td>
                          <td className="px-2 py-1.5 text-right">
                            {e.units != null
                              ? `${fmtInt(e.units)} prompts`
                              : `${fmtInt(e.prompt_tokens)} / ${fmtInt(e.completion_tokens)}`}
                          </td>
                          <td className="px-2 py-1.5 text-right font-semibold">{fmtUsd(e.cost_usd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default CostsPage;
