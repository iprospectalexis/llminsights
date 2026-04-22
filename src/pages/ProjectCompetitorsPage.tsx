import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowLeft, Download, Brain, ChevronDown, Check,
  Swords, TrendingUp, TrendingDown, Target, Trophy, Award, Users,
} from 'lucide-react';
import {
  ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip,
  ReferenceLine, ReferenceArea, ResponsiveContainer, LabelList, Cell,
} from 'recharts';
import { supabase } from '../lib/supabase';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { Button } from '../components/ui/Button';
import { getBrandColor, OWN_BRAND_COLOR } from '../utils/brandColors';
import {
  aggregateCompetitors, aggregateTags,
  BrandRow, ResponseRow, SentimentRow, PromptMeta, AuditMeta, CompetitorStats,
} from '../utils/competitors';
import * as XLSX from 'xlsx';

const LLM_ICONS: Record<string, string> = {
  searchgpt: 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/SearchGPT.PNG',
  perplexity: 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/Perplexity.png',
  gemini: 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/Gemini.png',
  'google-ai-overview': 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/Google.png',
  'google-ai-mode': 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/Google.png',
  'bing-copilot': 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/bing_copilot.png',
  'grok': 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/Grok-icon.png',
};

const LLM_DISPLAY_NAME: Record<string, string> = {
  'searchgpt': 'SearchGPT',
  'perplexity': 'Perplexity',
  'gemini': 'Gemini',
  'google-ai-overview': 'Google AI',
  'google-ai-mode': 'Google AI Mode',
  'bing-copilot': 'Bing Copilot',
  'grok': 'Grok',
};
const getLlmDisplayName = (llm: string) => LLM_DISPLAY_NAME[llm] || llm;

type DateRange = '7d' | '30d' | '90d' | 'all';

const getStartDateForRange = (range: DateRange): string | null => {
  if (range === 'all') return null;
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
};

export const ProjectCompetitorsPage: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<any>(null);
  const [brands, setBrands] = useState<BrandRow[]>([]);
  const [audits, setAudits] = useState<AuditMeta[]>([]);
  const [responses, setResponses] = useState<ResponseRow[]>([]);
  const [sentimentRows, setSentimentRows] = useState<SentimentRow[]>([]);
  const [prompts, setPrompts] = useState<PromptMeta[]>([]);

  const [dateRange, setDateRange] = useState<DateRange>('30d');

  // LLM multi-select filter — same pattern as ProjectPromptsPage
  const [selectedLlms, setSelectedLlms] = useState<Set<string> | null>(null);
  const [showLlmDropdown, setShowLlmDropdown] = useState(false);
  const [llmDropdownPos, setLlmDropdownPos] = useState<{ top: number; left: number; minWidth: number } | null>(null);
  const llmButtonRef = useRef<HTMLButtonElement | null>(null);

  // Click-a-chip-to-filter state for the strengths/weaknesses explorer
  const [highlightTag, setHighlightTag] = useState<{ kind: 'strengths' | 'weaknesses'; text: string } | null>(null);

  useEffect(() => {
    if (id) loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, dateRange]);

  const loadData = async () => {
    setLoading(true);
    try {
      const { data: projectData } = await supabase
        .from('projects')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      setProject(projectData);

      const { data: brandsData } = await supabase
        .from('brands')
        .select('id, brand_name, is_competitor, aliases')
        .eq('project_id', id);
      setBrands((brandsData as BrandRow[]) || []);

      const startDate = getStartDateForRange(dateRange);
      let auditsQuery = supabase
        .from('audits')
        .select('id, created_at')
        .eq('project_id', id)
        .eq('status', 'completed')
        .order('created_at', { ascending: true });
      if (startDate) auditsQuery = auditsQuery.gte('created_at', startDate);
      const { data: auditsData } = await auditsQuery;

      const auditsList = (auditsData as AuditMeta[] | null) ?? [];
      setAudits(auditsList);

      if (auditsList.length === 0) {
        setResponses([]);
        setSentimentRows([]);
        setPrompts([]);
        setLoading(false);
        return;
      }
      const auditIds = auditsList.map(a => a.id);

      const { data: promptsData } = await supabase
        .from('prompts')
        .select('id, prompt_group')
        .eq('project_id', id);
      setPrompts((promptsData as PromptMeta[]) || []);

      const { data: respData } = await supabase
        .from('llm_responses')
        .select('id, audit_id, prompt_id, llm, answer_competitors, created_at')
        .in('audit_id', auditIds);
      setResponses((respData as ResponseRow[]) || []);

      const { data: sentData } = await supabase
        .from('response_brand_sentiment')
        .select('response_id, audit_id, brand, brand_kind, label, score, is_fallback')
        .in('audit_id', auditIds);
      setSentimentRows((sentData as SentimentRow[]) || []);
    } catch (err) {
      console.error('Error loading competitors data:', err);
    } finally {
      setLoading(false);
    }
  };

  // Available LLMs — union of every response.llm we received
  const availableLlms = useMemo(() => {
    return Array.from(new Set(responses.map(r => r.llm))).sort();
  }, [responses]);

  const isLlmVisible = (llm: string): boolean => {
    if (selectedLlms === null) return true;
    return selectedLlms.has(llm);
  };
  const toggleLlm = (llm: string) => {
    setSelectedLlms(prev => {
      const base = prev ?? new Set(availableLlms);
      const next = new Set(base);
      if (next.has(llm)) next.delete(llm);
      else next.add(llm);
      if (availableLlms.every(l => next.has(l))) return null;
      return next;
    });
  };
  const clearLlmFilter = () => {
    setSelectedLlms(null);
    setShowLlmDropdown(false);
  };

  // Re-aggregate whenever raw data or filters change.
  const stats: CompetitorStats[] = useMemo(() => {
    const filteredResponses = responses.filter(r => isLlmVisible(r.llm));
    const visibleResponseIds = new Set(filteredResponses.map(r => r.id));
    const filteredSentiment = sentimentRows.filter(s => visibleResponseIds.has(s.response_id));
    return aggregateCompetitors({
      responses: filteredResponses,
      sentimentRows: filteredSentiment,
      brands,
      prompts,
      audits,
    });
  }, [responses, sentimentRows, brands, prompts, audits, selectedLlms]);

  const competitors = useMemo(() => stats.filter(s => !s.isOwn), [stats]);

  // Strengths / weaknesses aggregated across competitors only.
  const aggregatedStrengths = useMemo(() => aggregateTags(competitors, 'strengths').slice(0, 30), [competitors]);
  const aggregatedWeaknesses = useMemo(() => aggregateTags(competitors, 'weaknesses').slice(0, 30), [competitors]);

  // Leaderboard can be further filtered by chip highlight
  const leaderboardRows = useMemo(() => {
    if (!highlightTag) return stats;
    const tagKey = highlightTag.text;
    return stats.filter(s => {
      const list = highlightTag.kind === 'strengths' ? s.topStrengths : s.topWeaknesses;
      return list.some(t => t.text === tagKey);
    });
  }, [stats, highlightTag]);

  // Heatmap: top 10 competitors × prompt groups
  const heatmapData = useMemo(() => {
    const top = competitors.slice(0, 10);
    const groupSet = new Set<string>();
    top.forEach(c => Object.keys(c.mentionsByPromptGroup).forEach(g => groupSet.add(g)));
    const groups = Array.from(groupSet).sort();
    const maxCount = Math.max(1, ...top.flatMap(c => groups.map(g => c.mentionsByPromptGroup[g] || 0)));
    return { top, groups, maxCount };
  }, [competitors]);

  // ────── filter UI ──────────────────────────────────────────────────
  const renderLlmFilter = () => {
    const selectedCount = selectedLlms === null ? availableLlms.length : selectedLlms.size;
    const totalCount = availableLlms.length;
    const label =
      selectedLlms === null || selectedCount === totalCount
        ? 'All LLMs'
        : selectedCount === 0
          ? 'No LLM'
          : selectedCount === 1
            ? getLlmDisplayName(Array.from(selectedLlms!)[0])
            : `${selectedCount} LLMs`;
    return (
      <div className="relative flex items-center space-x-2">
        <Brain className="w-4 h-4 text-gray-500" />
        <div className="relative">
          <button
            ref={llmButtonRef}
            type="button"
            onClick={() => {
              if (!showLlmDropdown) {
                const rect = llmButtonRef.current?.getBoundingClientRect();
                if (rect) {
                  setLlmDropdownPos({
                    top: rect.bottom + 4,
                    left: rect.left,
                    minWidth: Math.max(rect.width, 220),
                  });
                }
              }
              setShowLlmDropdown(!showLlmDropdown);
            }}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm flex items-center space-x-2"
          >
            <span>{label}</span>
            <ChevronDown className="w-4 h-4" />
          </button>
          {showLlmDropdown && createPortal(
            <>
              <div className="fixed inset-0 z-[9998]" onClick={() => setShowLlmDropdown(false)} />
              <div
                className="fixed bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-xl shadow-lg z-[9999] max-h-[400px] overflow-y-auto py-1"
                style={llmDropdownPos || {}}
              >
                <button
                  onClick={clearLlmFilter}
                  className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200"
                >
                  <span className="font-medium">All LLMs</span>
                  {selectedLlms === null && <Check className="w-4 h-4 text-[rgb(126,34,206)] dark:text-purple-400" />}
                </button>
                <div className="border-t border-gray-200 dark:border-gray-600 my-1" />
                {availableLlms.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
                    No LLMs in the current data.
                  </div>
                ) : (
                  availableLlms.map(llm => {
                    const checked = isLlmVisible(llm);
                    return (
                      <button
                        key={llm}
                        onClick={() => toggleLlm(llm)}
                        className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200"
                      >
                        <span className="flex items-center space-x-2">
                          {LLM_ICONS[llm] && (
                            <img src={LLM_ICONS[llm]} alt="" className="w-4 h-4 rounded" />
                          )}
                          <span>{getLlmDisplayName(llm)}</span>
                        </span>
                        {checked && <Check className="w-4 h-4 text-[rgb(126,34,206)] dark:text-purple-400" />}
                      </button>
                    );
                  })
                )}
              </div>
            </>,
            document.body
          )}
        </div>
      </div>
    );
  };

  // ────── summary cards content ──────────────────────────────────────
  const topCompetitor = competitors[0] || null;
  const biggestThreat = useMemo(() => {
    return [...competitors]
      .map(c => ({ c, score: c.sov * Math.max(0, c.sentimentAvg) }))
      .sort((a, b) => b.score - a.score)[0]?.c || null;
  }, [competitors]);
  const fastestGrowing = useMemo(() => {
    if (audits.length < 2) return null;
    const prevAuditId = audits[audits.length - 2].id;
    const lastAuditId = audits[audits.length - 1].id;
    let best: { c: CompetitorStats; delta: number } | null = null;
    for (const c of competitors) {
      const prev = c.trendByAudit.find(t => t.auditId === prevAuditId)?.mentions || 0;
      const curr = c.trendByAudit.find(t => t.auditId === lastAuditId)?.mentions || 0;
      const delta = curr - prev;
      if (!best || delta > best.delta) best = { c, delta };
    }
    return best && best.delta > 0 ? best : null;
  }, [competitors, audits]);

  // ────── positioning matrix data ────────────────────────────────────
  const matrixData = useMemo(() => {
    return stats
      .filter(s => s.mentions > 0)
      .map(s => ({
        name: s.name,
        isOwn: s.isOwn,
        sov: +(s.sov * 100).toFixed(1),
        sentiment: +s.sentimentAvg.toFixed(2),
        mentions: s.mentions,
        key: s.key,
      }));
  }, [stats]);
  const allBrandNames = useMemo(() => stats.map(s => s.name), [stats]);

  // ────── excel export ────────────────────────────────────────────────
  const exportToExcel = () => {
    // Summary tab — one row per competitor with headline metrics
    const summaryRows = stats.map((s, i) => ({
      Rank: i + 1,
      Brand: s.name,
      Kind: s.isOwn ? 'Own' : 'Competitor',
      Mentions: s.mentions,
      'Share of Voice (%)': +(s.sov * 100).toFixed(2),
      'Sentiment Avg': +s.sentimentAvg.toFixed(3),
      Positive: s.sentimentCounts.positive,
      Neutral: s.sentimentCounts.neutral,
      Negative: s.sentimentCounts.negative,
      MentionOnly: s.sentimentCounts.mention_only,
      Recommended: s.mentionTypeCounts.recommended,
      Compared: s.mentionTypeCounts.compared,
      Mentioned: s.mentionTypeCounts.mentioned,
      'Avg Rank': s.avgRank ?? '',
      'Top Strength': s.topStrengths[0]?.text || '',
      'Top Weakness': s.topWeaknesses[0]?.text || '',
    }));

    // Tags tab — long format of strengths/weaknesses
    const tagRows: any[] = [];
    for (const s of stats) {
      for (const t of s.topStrengths) {
        tagRows.push({ Brand: s.name, Kind: 'strength', Text: t.text, Count: t.count });
      }
      for (const t of s.topWeaknesses) {
        tagRows.push({ Brand: s.name, Kind: 'weakness', Text: t.text, Count: t.count });
      }
    }

    // Trend tab — per audit mentions / sentiment
    const trendRows: any[] = [];
    for (const s of stats) {
      for (const pt of s.trendByAudit) {
        trendRows.push({
          Brand: s.name,
          Kind: s.isOwn ? 'Own' : 'Competitor',
          'Audit Date': pt.createdAt.split('T')[0],
          Mentions: pt.mentions,
          'Sentiment Avg': +pt.sentimentAvg.toFixed(3),
        });
      }
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), 'Summary');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(tagRows), 'Strengths & Weaknesses');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(trendRows), 'Trend');
    const rangeLabel = dateRange === 'all' ? 'all_time' : dateRange;
    XLSX.writeFile(wb, `${project?.name || 'project'}_competitors_${rangeLabel}.xlsx`);
  };

  // ────── helpers for UI ──────────────────────────────────────────────
  const bubbleColour = (row: { isOwn: boolean; name: string }) =>
    row.isOwn ? OWN_BRAND_COLOR : getBrandColor(row.name, allBrandNames);

  const tagHeatClass = (count: number, max: number): string => {
    if (count === 0) return 'bg-gray-50 dark:bg-gray-800 text-gray-400 dark:text-gray-600';
    const ratio = count / max;
    if (ratio > 0.75) return 'bg-purple-600 text-white';
    if (ratio > 0.5) return 'bg-purple-400 text-white';
    if (ratio > 0.25) return 'bg-purple-200 text-purple-900 dark:bg-purple-800 dark:text-purple-100';
    return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200';
  };

  // ────── render ──────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <button
            onClick={() => navigate(`/projects/${id}/overview`)}
            className="flex items-center text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white mb-4"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Project
          </button>
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-3">
                <Swords className="w-7 h-7 text-[rgb(126,34,206)] dark:text-purple-400" />
                <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Competitors</h1>
              </div>
              <p className="mt-2 text-gray-600 dark:text-gray-400">
                {project?.name ? `${project.name} · ` : ''}competitive landscape across LLM answers
              </p>
            </div>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-600 dark:text-gray-400">Timeframe:</label>
              <select
                value={dateRange}
                onChange={(e) => setDateRange(e.target.value as DateRange)}
                className="text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
                <option value="90d">Last 90 days</option>
                <option value="all">All time</option>
              </select>
            </div>
            {renderLlmFilter()}
            {!loading && audits.length > 0 && (
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {audits.length} audit{audits.length === 1 ? '' : 's'} · {competitors.length} competitor{competitors.length === 1 ? '' : 's'} tracked
              </span>
            )}
          </div>
          <Button onClick={exportToExcel} variant="outline" disabled={loading || stats.length === 0}>
            <Download className="w-4 h-4 mr-2" /> Export to Excel
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-64">
            <LoadingSpinner size="lg" />
          </div>
        ) : audits.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-12 text-center text-gray-500 dark:text-gray-400">
            No completed audits in the selected timeframe.
          </div>
        ) : stats.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-12 text-center text-gray-500 dark:text-gray-400">
            No brand mentions found in any response yet.
          </div>
        ) : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              <SummaryCard
                delay={0}
                gradient="from-[#7209b7] to-[#b5179e]"
                icon={<Users />}
                label="Competitors tracked"
                primary={`${competitors.length}`}
                secondary={`across ${audits.length} audit${audits.length === 1 ? '' : 's'}`}
              />
              <SummaryCard
                delay={0.08}
                gradient="from-[#f72585] to-[#b5179e]"
                icon={<Trophy />}
                label="Top competitor"
                primary={topCompetitor ? topCompetitor.name : '—'}
                secondary={topCompetitor ? `${(topCompetitor.sov * 100).toFixed(1)}% SOV` : ''}
              />
              <SummaryCard
                delay={0.16}
                gradient="from-[#4361ee] to-[#1ed0d9]"
                icon={<Target />}
                label="Biggest threat"
                primary={biggestThreat ? biggestThreat.name : '—'}
                secondary={biggestThreat
                  ? `${(biggestThreat.sov * 100).toFixed(1)}% SOV · ${biggestThreat.sentimentAvg >= 0 ? '+' : ''}${biggestThreat.sentimentAvg.toFixed(2)} sentiment`
                  : 'Needs positive sentiment'}
              />
              <SummaryCard
                delay={0.24}
                gradient={fastestGrowing ? 'from-[#4df07e] to-[#1ed0d9]' : 'from-gray-400 to-gray-500'}
                icon={fastestGrowing ? <TrendingUp /> : <TrendingDown />}
                label="Growing fastest"
                primary={fastestGrowing ? fastestGrowing.c.name : '—'}
                secondary={fastestGrowing
                  ? `+${fastestGrowing.delta} mentions vs. previous audit`
                  : audits.length < 2 ? 'Need ≥2 audits' : 'No growth this period'}
              />
            </div>

            {/* Positioning matrix */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm p-6 mb-8">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                    <Award className="w-5 h-5 text-[rgb(126,34,206)] dark:text-purple-400" />
                    Positioning matrix
                  </h2>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    X: Share of Voice · Y: avg sentiment · bubble size: total mentions. Top-right = dominant + positively framed.
                  </p>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-3 h-3 rounded-full" style={{ background: OWN_BRAND_COLOR }} /> Own brand
                  </span>
                  <span className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
                    <span className="inline-block w-3 h-3 rounded-full bg-gray-400" /> Competitor
                  </span>
                </div>
              </div>
              <div className="h-[420px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 24, right: 48, bottom: 36, left: 24 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" className="dark:stroke-gray-700" />
                    <XAxis
                      type="number"
                      dataKey="sov"
                      name="Share of Voice"
                      unit="%"
                      domain={[0, 'dataMax']}
                      label={{ value: 'Share of Voice (%)', position: 'insideBottom', offset: -20 }}
                      tick={{ fill: '#6b7280', fontSize: 12 }}
                    />
                    <YAxis
                      type="number"
                      dataKey="sentiment"
                      name="Sentiment"
                      domain={[-1, 1]}
                      label={{ value: 'Avg sentiment', angle: -90, position: 'insideLeft' }}
                      tick={{ fill: '#6b7280', fontSize: 12 }}
                    />
                    <ZAxis type="number" dataKey="mentions" range={[100, 1200]} name="Mentions" />
                    {/* Quadrant guides */}
                    <ReferenceLine y={0} stroke="#9ca3af" strokeDasharray="4 4" />
                    <ReferenceArea y1={0} y2={1} x1={0} x2={100} fill="#22c55e" fillOpacity={0.04} />
                    <ReferenceArea y1={-1} y2={0} x1={0} x2={100} fill="#ef4444" fillOpacity={0.04} />
                    <Tooltip
                      cursor={{ strokeDasharray: '3 3' }}
                      content={({ active, payload }) => {
                        if (!active || !payload || payload.length === 0) return null;
                        const d: any = payload[0].payload;
                        return (
                          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3 text-sm">
                            <div className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                              {d.isOwn && <span className="text-xs bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-300 px-1.5 py-0.5 rounded">Own</span>}
                              {d.name}
                            </div>
                            <div className="text-xs text-gray-600 dark:text-gray-300 mt-1">
                              SOV: <strong>{d.sov}%</strong>
                            </div>
                            <div className="text-xs text-gray-600 dark:text-gray-300">
                              Sentiment: <strong>{d.sentiment >= 0 ? '+' : ''}{d.sentiment}</strong>
                            </div>
                            <div className="text-xs text-gray-600 dark:text-gray-300">
                              Mentions: <strong>{d.mentions}</strong>
                            </div>
                          </div>
                        );
                      }}
                    />
                    <Scatter name="Brands" data={matrixData} shape="circle" isAnimationActive animationDuration={800}>
                      {matrixData.map((d) => (
                        <Cell
                          key={d.key}
                          fill={bubbleColour(d)}
                          stroke={d.isOwn ? '#92400e' : '#ffffff'}
                          strokeWidth={d.isOwn ? 2 : 1}
                          fillOpacity={0.82}
                        />
                      ))}
                      <LabelList
                        dataKey="name"
                        position="top"
                        style={{ fontSize: 11, fill: '#374151' }}
                      />
                    </Scatter>
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Leaderboard */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden mb-8">
              <div className="p-6 pb-3 flex items-start justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Competitor leaderboard</h2>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Ranked by share of voice. Click a strength/weakness chip below to filter.
                  </p>
                </div>
                {highlightTag && (
                  <button
                    onClick={() => setHighlightTag(null)}
                    className="text-xs px-2 py-1 rounded bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200 hover:bg-purple-200 dark:hover:bg-purple-900"
                  >
                    Clear "{highlightTag.text}" filter
                  </button>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-y border-gray-100 dark:border-gray-700 text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/40">
                      <th className="px-4 py-3 w-12">#</th>
                      <th className="px-4 py-3">Brand</th>
                      <th className="px-4 py-3 w-56">Share of Voice</th>
                      <th className="px-4 py-3 w-44">Sentiment</th>
                      <th className="px-4 py-3 w-44">Mention type</th>
                      <th className="px-4 py-3 w-20">Avg rank</th>
                      <th className="px-4 py-3">Top strength</th>
                      <th className="px-4 py-3">Top weakness</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboardRows.map((s, i) => (
                      <motion.tr
                        key={s.key}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.03, duration: 0.25 }}
                        className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/40"
                      >
                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400 font-mono">{i + 1}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: bubbleColour(s) }} />
                            <span className={`font-medium ${s.isOwn ? 'text-yellow-700 dark:text-yellow-400' : 'text-gray-900 dark:text-gray-100'}`}>
                              {s.name}
                            </span>
                            {s.isOwn && (
                              <span className="text-[10px] bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300 px-1.5 py-0.5 rounded">
                                Own
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                              <motion.div
                                className="h-full rounded-full"
                                style={{ background: bubbleColour(s) }}
                                initial={{ width: 0 }}
                                animate={{ width: `${(s.sov * 100).toFixed(1)}%` }}
                                transition={{ duration: 0.7, delay: i * 0.02 }}
                              />
                            </div>
                            <span className="text-xs text-gray-600 dark:text-gray-400 w-12 text-right">
                              {(s.sov * 100).toFixed(1)}%
                            </span>
                          </div>
                          <div className="text-[10px] text-gray-400 mt-0.5">{s.mentions} mentions</div>
                        </td>
                        <td className="px-4 py-3">
                          <SentimentStackedBar counts={s.sentimentCounts} />
                          <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">
                            avg {s.sentimentAvg >= 0 ? '+' : ''}{s.sentimentAvg.toFixed(2)}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <MentionTypeBar counts={s.mentionTypeCounts} />
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                          {s.avgRank !== null ? s.avgRank.toFixed(1) : <span className="text-gray-400">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          {s.topStrengths[0] ? (
                            <span className="inline-block text-xs px-2 py-1 rounded-full bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-700/40">
                              {s.topStrengths[0].text}
                              {s.topStrengths[0].count > 1 && (
                                <span className="ml-1 text-green-500">×{s.topStrengths[0].count}</span>
                              )}
                            </span>
                          ) : (
                            <span className="text-gray-400 text-xs">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {s.topWeaknesses[0] ? (
                            <span className="inline-block text-xs px-2 py-1 rounded-full bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-700/40">
                              {s.topWeaknesses[0].text}
                              {s.topWeaknesses[0].count > 1 && (
                                <span className="ml-1 text-red-500">×{s.topWeaknesses[0].count}</span>
                              )}
                            </span>
                          ) : (
                            <span className="text-gray-400 text-xs">—</span>
                          )}
                        </td>
                      </motion.tr>
                    ))}
                    {leaderboardRows.length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-4 py-10 text-center text-sm text-gray-500">
                          No brands match the current filter.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Strengths & weaknesses explorer */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              <TagExplorerPanel
                kind="strengths"
                tags={aggregatedStrengths}
                selected={highlightTag?.kind === 'strengths' ? highlightTag.text : null}
                onSelect={(text) => setHighlightTag(prev =>
                  prev?.kind === 'strengths' && prev.text === text ? null : { kind: 'strengths', text }
                )}
              />
              <TagExplorerPanel
                kind="weaknesses"
                tags={aggregatedWeaknesses}
                selected={highlightTag?.kind === 'weaknesses' ? highlightTag.text : null}
                onSelect={(text) => setHighlightTag(prev =>
                  prev?.kind === 'weaknesses' && prev.text === text ? null : { kind: 'weaknesses', text }
                )}
              />
            </div>

            {/* Competition-by-prompt-group heatmap */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm p-6 mb-8">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">Competition by prompt group</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                Top 10 competitors × prompt groups. Darker cell = more mentions in that topic.
              </p>
              {heatmapData.top.length === 0 || heatmapData.groups.length === 0 ? (
                <div className="text-sm text-gray-500 dark:text-gray-400 py-8 text-center">
                  Not enough data yet.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr>
                        <th className="px-3 py-2 text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/40">
                          Brand
                        </th>
                        {heatmapData.groups.map(g => (
                          <th key={g} className="px-3 py-2 text-center text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/40">
                            {g}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {heatmapData.top.map(c => (
                        <tr key={c.key}>
                          <td className="px-3 py-2 text-sm font-medium text-gray-900 dark:text-gray-100">
                            <span className="inline-block w-2 h-2 rounded-full mr-2" style={{ background: bubbleColour(c) }} />
                            {c.name}
                          </td>
                          {heatmapData.groups.map(g => {
                            const count = c.mentionsByPromptGroup[g] || 0;
                            return (
                              <td key={g} className="px-1.5 py-1.5 text-center">
                                <div className={`rounded-md py-1.5 text-xs font-medium ${tagHeatClass(count, heatmapData.maxCount)}`}>
                                  {count || '·'}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// ────── subcomponents ────────────────────────────────────────────────

const SummaryCard: React.FC<{
  gradient: string;
  icon: React.ReactNode;
  label: string;
  primary: string;
  secondary?: string;
  delay?: number;
}> = ({ gradient, icon, label, primary, secondary, delay = 0 }) => (
  <motion.div
    initial={{ opacity: 0, y: 10 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay, duration: 0.35 }}
    whileHover={{ y: -2 }}
    className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${gradient} text-white p-5 shadow-lg`}
  >
    <div className="absolute top-3 right-3 opacity-20 [&>svg]:w-10 [&>svg]:h-10">
      {icon}
    </div>
    <div className="text-xs uppercase tracking-wider opacity-80 mb-1">{label}</div>
    <div className="text-2xl font-bold truncate" title={primary}>{primary}</div>
    {secondary && <div className="text-xs opacity-80 mt-1">{secondary}</div>}
  </motion.div>
);

const SentimentStackedBar: React.FC<{
  counts: { positive: number; neutral: number; negative: number; mention_only: number };
}> = ({ counts }) => {
  const total = counts.positive + counts.neutral + counts.negative + counts.mention_only;
  if (total === 0) {
    return <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full" title="no sentiment data" />;
  }
  const pct = (n: number) => (n / total) * 100;
  return (
    <div className="flex h-2 w-full rounded-full overflow-hidden bg-gray-100 dark:bg-gray-700">
      {counts.positive > 0 && <div style={{ width: `${pct(counts.positive)}%` }} className="bg-green-500" title={`${counts.positive} positive`} />}
      {counts.neutral > 0 && <div style={{ width: `${pct(counts.neutral)}%` }} className="bg-gray-400" title={`${counts.neutral} neutral`} />}
      {counts.mention_only > 0 && <div style={{ width: `${pct(counts.mention_only)}%` }} className="bg-purple-400" title={`${counts.mention_only} mention only`} />}
      {counts.negative > 0 && <div style={{ width: `${pct(counts.negative)}%` }} className="bg-red-500" title={`${counts.negative} negative`} />}
    </div>
  );
};

const MentionTypeBar: React.FC<{
  counts: { recommended: number; compared: number; mentioned: number };
}> = ({ counts }) => {
  const total = counts.recommended + counts.compared + counts.mentioned;
  if (total === 0) {
    return <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full" />;
  }
  const pct = (n: number) => (n / total) * 100;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex h-2 w-full rounded-full overflow-hidden bg-gray-100 dark:bg-gray-700">
        {counts.recommended > 0 && <div style={{ width: `${pct(counts.recommended)}%` }} className="bg-emerald-500" title={`${counts.recommended} recommended`} />}
        {counts.compared > 0 && <div style={{ width: `${pct(counts.compared)}%` }} className="bg-amber-400" title={`${counts.compared} compared`} />}
        {counts.mentioned > 0 && <div style={{ width: `${pct(counts.mentioned)}%` }} className="bg-sky-400" title={`${counts.mentioned} just mentioned`} />}
      </div>
      <div className="flex items-center gap-2 text-[10px] text-gray-500 dark:text-gray-400">
        {counts.recommended > 0 && <span>rec {counts.recommended}</span>}
        {counts.compared > 0 && <span>cmp {counts.compared}</span>}
        {counts.mentioned > 0 && <span>ment {counts.mentioned}</span>}
      </div>
    </div>
  );
};

const TagExplorerPanel: React.FC<{
  kind: 'strengths' | 'weaknesses';
  tags: { text: string; count: number; brands: string[] }[];
  selected: string | null;
  onSelect: (text: string) => void;
}> = ({ kind, tags, selected, onSelect }) => {
  const isStrengths = kind === 'strengths';
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm p-6">
      <h3 className={`text-base font-semibold mb-1 ${isStrengths ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'}`}>
        {isStrengths ? 'Competitor strengths' : 'Competitor weaknesses'}
      </h3>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
        Top {tags.length} extracted from LLM answers. Click a chip to filter the leaderboard.
      </p>
      {tags.length === 0 ? (
        <div className="text-sm text-gray-500 dark:text-gray-400 py-4">
          No {kind} extracted in this timeframe.
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {tags.map(t => {
            const active = selected === t.text;
            const base = isStrengths
              ? 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 border-green-200 dark:border-green-700/50 hover:bg-green-100'
              : 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 border-red-200 dark:border-red-700/50 hover:bg-red-100';
            const activeCls = isStrengths
              ? 'bg-green-500 text-white border-green-500 hover:bg-green-600'
              : 'bg-red-500 text-white border-red-500 hover:bg-red-600';
            return (
              <button
                key={t.text}
                onClick={() => onSelect(t.text)}
                title={t.brands.join(', ')}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${active ? activeCls : base}`}
              >
                {t.text}
                <span className={`ml-1 ${active ? 'text-white/80' : 'opacity-60'}`}>×{t.count}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};


