import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader } from '../components/ui/Card';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { supabase } from '../lib/supabase';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar,
} from 'recharts';
import { Megaphone, Globe2, Users, Layers, ShoppingBag, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';

// Ads are captured from the SearchGPT interface (sponsored unit) since this
// date — earlier periods have no signal by construction, not "no ads".
const ADS_SINCE = 'Aug 19, 2026';

interface Overview {
  total_responses: number;
  responses_with_ads: number;
  pct_with_ads: number;
  unique_advertisers: number;
  unique_ads: number;
  ads_per_advertiser: number;
  pct_with_shopping: number;
}

interface TimePoint {
  time_period: string;
  total_responses: number;
  responses_with_ads: number;
  pct_with_ads: number;
  unique_advertisers: number;
}

interface Advertiser {
  advertiser: string;
  sample_url: string | null;
  responses: number;
  share_pct: number;
  unique_ads: number;
  projects: number;
  countries: string;
  last_seen: string;
}

interface ExposedProject {
  project_id: string;
  project_name: string;
  country: string | null;
  total_responses: number;
  responses_with_ads: number;
  pct_with_ads: number;
  unique_advertisers: number;
}

const domainOf = (url: string | null): string => {
  if (!url) return '';
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
};

export function BarometerAdsPage() {
  const [loading, setLoading] = useState(true);
  const [country, setCountry] = useState<string>('all');
  const [countries, setCountries] = useState<string[]>([]);
  const [granularity, setGranularity] = useState<'day' | 'week' | 'month'>('day');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [series, setSeries] = useState<TimePoint[]>([]);
  const [advertisers, setAdvertisers] = useState<Advertiser[]>([]);
  const [projects, setProjects] = useState<ExposedProject[]>([]);

  // Country options come from project settings (RLS-scoped).
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('projects').select('country').not('country', 'is', null);
      const set = new Set<string>((data || []).map((r: any) => String(r.country)).filter(Boolean));
      setCountries(Array.from(set).sort());
    })();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const p_country = country === 'all' ? null : country;
      try {
        const [ov, ts, top, proj] = await Promise.all([
          supabase.rpc('barometer_ads_overview', { p_country }),
          supabase.rpc('barometer_ads_over_time', { p_country, p_granularity: granularity }),
          supabase.rpc('barometer_ads_top_advertisers', { p_country, p_limit: 20 }),
          supabase.rpc('barometer_ads_top_projects', { p_country, p_limit: 10 }),
        ]);
        if (cancelled) return;
        for (const r of [ov, ts, top, proj]) {
          if (r.error) console.error('barometer ads RPC:', r.error);
        }
        setOverview(ov.data && ov.data.length ? {
          ...ov.data[0],
          pct_with_ads: Number(ov.data[0].pct_with_ads),
          ads_per_advertiser: Number(ov.data[0].ads_per_advertiser),
          pct_with_shopping: Number(ov.data[0].pct_with_shopping),
        } : null);
        setSeries((ts.data || []).map((r: any) => ({ ...r, pct_with_ads: Number(r.pct_with_ads) })));
        setAdvertisers((top.data || []).map((r: any) => ({ ...r, share_pct: Number(r.share_pct) })));
        setProjects((proj.data || []).map((r: any) => ({ ...r, pct_with_ads: Number(r.pct_with_ads) })));
      } catch (e) {
        console.error('Error loading ads barometer:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [country, granularity]);

  const fmtDate = (d: string) =>
    new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  const tooltipStyle = {
    backgroundColor: 'rgb(var(--bg-surface))',
    border: '1px solid rgb(var(--border))',
    borderRadius: '12px',
    boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
    fontFamily: 'Plus Jakarta Sans',
  } as const;

  const scorecards = overview ? [
    {
      icon: Megaphone, tint: 'text-rose-500', bg: 'from-rose-50 to-rose-100/50 dark:from-rose-900/20 dark:to-rose-800/10',
      value: `${overview.pct_with_ads}%`,
      label: 'Responses with ads',
      sub: `${overview.responses_with_ads} of ${overview.total_responses} SearchGPT answers`,
    },
    {
      icon: Users, tint: 'text-indigo-500', bg: 'from-indigo-50 to-indigo-100/50 dark:from-indigo-900/20 dark:to-indigo-800/10',
      value: String(overview.unique_advertisers),
      label: 'Unique advertisers',
      sub: `${overview.unique_ads} distinct ads observed`,
    },
    {
      icon: Layers, tint: 'text-amber-500', bg: 'from-amber-50 to-amber-100/50 dark:from-amber-900/20 dark:to-amber-800/10',
      value: String(overview.ads_per_advertiser),
      label: 'Ads per advertiser',
      sub: 'unique creatives / advertiser',
    },
    {
      icon: ShoppingBag, tint: 'text-emerald-500', bg: 'from-emerald-50 to-emerald-100/50 dark:from-emerald-900/20 dark:to-emerald-800/10',
      value: `${overview.pct_with_shopping}%`,
      label: 'Responses with shopping',
      sub: 'product cards shown alongside answers',
    },
  ] : [];

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-blue-50 to-purple-50 dark:from-gray-900 dark:via-gray-900 dark:to-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center space-x-4">
              <div className="p-3 bg-gradient-to-br from-rose-500 to-orange-500 rounded-2xl shadow-lg">
                <Megaphone className="w-8 h-8 text-white" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Ads Barometer</h1>
                <p className="text-gray-600 dark:text-gray-400 mt-1">
                  Ad penetration in LLM answers across all projects · collected from SearchGPT since {ADS_SINCE}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Globe2 className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                <select
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  className="px-3 py-2 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-brand-primary"
                >
                  <option value="all">All countries</option>
                  {countries.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="inline-flex items-center rounded-xl bg-gray-100 dark:bg-gray-800 p-1">
                {(['day', 'week', 'month'] as const).map(g => (
                  <button
                    key={g}
                    onClick={() => setGranularity(g)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium capitalize transition-colors ${
                      granularity === g
                        ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                        : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </motion.div>

        {loading ? (
          <div className="flex items-center justify-center h-64"><LoadingSpinner size="lg" /></div>
        ) : (
          <div className="space-y-6">
            {/* Scorecards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {scorecards.map(card => (
                <div key={card.label}
                     className={`relative overflow-hidden bg-gradient-to-br ${card.bg} rounded-2xl px-5 py-4 border border-gray-200/60 dark:border-gray-700/50`}>
                  <card.icon className={`w-5 h-5 ${card.tint} mb-2`} />
                  <div className="text-3xl font-bold text-gray-900 dark:text-gray-100">{card.value}</div>
                  <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mt-0.5">{card.label}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{card.sub}</div>
                </div>
              ))}
            </div>

            {/* Evolution charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Ad penetration over time</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400">% of SearchGPT answers carrying a sponsored unit</p>
                </CardHeader>
                <CardContent>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={series} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" />
                        <XAxis dataKey="time_period" tickFormatter={fmtDate} tick={{ fontSize: 11 }} stroke="rgb(var(--text-secondary))" />
                        <YAxis unit="%" tick={{ fontSize: 11 }} stroke="rgb(var(--text-secondary))" />
                        <Tooltip
                          contentStyle={tooltipStyle}
                          labelFormatter={fmtDate}
                          formatter={(v: any, name: string, props: any) => [
                            `${v}% (${props.payload.responses_with_ads}/${props.payload.total_responses})`,
                            'With ads',
                          ]}
                        />
                        <Line type="monotone" dataKey="pct_with_ads" stroke="#f43f5e" strokeWidth={2} dot={{ r: 3 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Active advertisers over time</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400">unique advertisers observed per period</p>
                </CardHeader>
                <CardContent>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={series} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" />
                        <XAxis dataKey="time_period" tickFormatter={fmtDate} tick={{ fontSize: 11 }} stroke="rgb(var(--text-secondary))" />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="rgb(var(--text-secondary))" />
                        <Tooltip contentStyle={tooltipStyle} labelFormatter={fmtDate}
                                 formatter={(v: any) => [v, 'Advertisers']} />
                        <Bar dataKey="unique_advertisers" fill="#6366f1" radius={[4, 4, 0, 0]} maxBarSize={28} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Top advertisers */}
            <Card>
              <CardHeader>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Top advertisers</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  ranked by number of answers carrying their ad · share is of all ad-carrying answers
                </p>
              </CardHeader>
              <CardContent>
                {advertisers.length === 0 ? (
                  <p className="text-sm text-gray-400 dark:text-gray-500 py-8 text-center">
                    No ads observed for this selection
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 dark:border-gray-700 text-left text-gray-900 dark:text-gray-100">
                          <th className="py-2.5 px-2">Advertiser</th>
                          <th className="py-2.5 px-2 text-center">Ad responses</th>
                          <th className="py-2.5 px-2 text-center">Share</th>
                          <th className="py-2.5 px-2 text-center">Unique ads</th>
                          <th className="py-2.5 px-2 text-center">Projects</th>
                          <th className="py-2.5 px-2">Countries</th>
                          <th className="py-2.5 px-2">Last seen</th>
                        </tr>
                      </thead>
                      <tbody>
                        {advertisers.map(a => {
                          const dom = domainOf(a.sample_url);
                          return (
                            <tr key={a.advertiser} className="border-b border-gray-100 dark:border-gray-800">
                              <td className="py-2.5 px-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  {dom && (
                                    <img src={`https://www.google.com/s2/favicons?domain=${dom}&sz=32`} alt=""
                                         className="w-4 h-4 flex-shrink-0"
                                         onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                  )}
                                  <span className="font-medium text-gray-900 dark:text-gray-100 truncate">{a.advertiser}</span>
                                  {a.sample_url && (
                                    <a href={a.sample_url} target="_blank" rel="noopener noreferrer"
                                       title={a.sample_url}
                                       className="text-gray-400 hover:text-brand-primary flex-shrink-0">
                                      <ExternalLink className="w-3.5 h-3.5" />
                                    </a>
                                  )}
                                </div>
                              </td>
                              <td className="py-2.5 px-2 text-center text-gray-900 dark:text-gray-100">{a.responses}</td>
                              <td className="py-2.5 px-2 text-center text-gray-900 dark:text-gray-100">{a.share_pct}%</td>
                              <td className="py-2.5 px-2 text-center text-gray-900 dark:text-gray-100">{a.unique_ads}</td>
                              <td className="py-2.5 px-2 text-center text-gray-900 dark:text-gray-100">{a.projects}</td>
                              <td className="py-2.5 px-2 text-gray-600 dark:text-gray-400">{a.countries}</td>
                              <td className="py-2.5 px-2 text-gray-600 dark:text-gray-400">{fmtDate(a.last_seen)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Most exposed projects */}
            <Card>
              <CardHeader>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Most ad-exposed projects</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  where competitors' ads sit on top of the answers · min 10 answers
                </p>
              </CardHeader>
              <CardContent>
                {projects.filter(p => p.responses_with_ads > 0).length === 0 ? (
                  <p className="text-sm text-gray-400 dark:text-gray-500 py-8 text-center">
                    No ad-exposed projects for this selection
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 dark:border-gray-700 text-left text-gray-900 dark:text-gray-100">
                          <th className="py-2.5 px-2">Project</th>
                          <th className="py-2.5 px-2 text-center">Country</th>
                          <th className="py-2.5 px-2 text-center">% with ads</th>
                          <th className="py-2.5 px-2 text-center">Ad responses</th>
                          <th className="py-2.5 px-2 text-center">Advertisers</th>
                        </tr>
                      </thead>
                      <tbody>
                        {projects.filter(p => p.responses_with_ads > 0).map(p => (
                          <tr key={p.project_id} className="border-b border-gray-100 dark:border-gray-800">
                            <td className="py-2.5 px-2">
                              <Link to={`/projects/${p.project_id}/ads`}
                                    className="font-medium text-brand-primary hover:underline">
                                {p.project_name}
                              </Link>
                            </td>
                            <td className="py-2.5 px-2 text-center text-gray-600 dark:text-gray-400">{p.country || '—'}</td>
                            <td className="py-2.5 px-2 text-center font-semibold text-gray-900 dark:text-gray-100">{p.pct_with_ads}%</td>
                            <td className="py-2.5 px-2 text-center text-gray-900 dark:text-gray-100">
                              {p.responses_with_ads}/{p.total_responses}
                            </td>
                            <td className="py-2.5 px-2 text-center text-gray-900 dark:text-gray-100">{p.unique_advertisers}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
