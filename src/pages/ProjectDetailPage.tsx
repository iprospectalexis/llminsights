import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { RunAuditModal } from '../components/audit/RunAuditModal';
import { Modal } from '../components/ui/Modal';
import { Input } from '../components/ui/Input';
import { Progress } from '../components/ui/Progress';
import { supabase } from '../lib/supabase';
import { DOMAIN_CATEGORIES, categoryChipClass } from '../lib/domainCategories';

// Fixed color per domain category — shared by the Overview donut and the
// Domains Insights charts, so a category never changes hue between views.
const CATEGORY_CHART_COLORS: Record<string, string> = {
  'Own Brand': 'rgb(var(--brand-primary))',
  Competitor: '#f43f5e',
  Corporate: '#3b82f6',
  'News/Media': '#a855f7',
  'Review/Comparison': '#f59e0b',
  'Marketplace/Retail': '#f97316',
  'Social Media': '#ec4899',
  'Community/Forum': '#14b8a6',
  Video: '#ef4444',
  'Encyclopedia/Reference': '#6366f1',
  Education: '#06b6d4',
  'Government/NGO': '#10b981',
  'Blogs/Personal': '#84cc16',
  Other: '#9ca3af',
  Unknown: '#d1d5db',
};
import { normalizeBrandKey, buildBrandDomainMapFromCitations } from '../lib/brandDomains';
import { buildMatchers, buildPageBrandIndex, findBrandsInText } from '../lib/pageBrands';
import { TrendChip, Sparkline, trendDelta, TrendData, TrendPoint } from '../components/ui/TrendChip';
import { LLM_ICONS as MATRIX_LLM_ICONS } from '../lib/llm-display';
import { CitationSankey } from '../components/CitationSankey';

const LLM_NAME_LABELS: Record<string, string> = {
  searchgpt: 'ChatGPT',
  'google-ai-mode': 'Google AI Mode',
  'google-ai-overview': 'Google AI Overviews',
  gemini: 'Google Gemini',
  grok: 'Grok',
  'bing-copilot': 'Microsoft Copilot',
  perplexity: 'Perplexity',
};
import { BrandFavicon } from '../components/ui/BrandFavicon';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { queryCache } from '../lib/queryCache';
import { Calendar, FileText, ChartBar as BarChart3, Globe, Users, Play, ArrowLeft, Brain, Download, Settings as SettingsIcon, PencilLine, X, MessageSquare, Crown, TrendingUp, TrendingDown, Lightbulb, Trash2, Info, Settings, CalendarCheck, ArrowUpDown, ArrowUp, ArrowDown, BadgeCheck, MessageCircle, List, ChevronDown, Smile, ShoppingBag, Map as MapIcon, Megaphone, Workflow } from 'lucide-react';
import { SentimentDashboard } from '../components/sentiment/SentimentDashboard';
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, LineChart, Line, Legend } from 'recharts';
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis } from 'recharts';
import { AuditProgressToast } from '../components/audit/AuditProgressToast';
import { ProjectScheduledAuditsSettings } from '../components/projects/ProjectScheduledAuditsSettings';
import { utils as xlsxUtils, writeFile as xlsxWriteFile } from 'xlsx';
import { getCountryByCode } from '../utils/countries';
import { useProject } from '../contexts/ProjectContext';
import { useDashboardFilters } from '../contexts/DashboardFiltersContext';
import { resolveDateWindow } from '../lib/dashboard-filter-utils';
import { DashboardFilterBar } from '../components/filters/DashboardFilterBar';
import { fetchPackedWindow, unpackCitations, unpackResponses } from '../lib/windowPacked';
import { TabContentSkeleton } from '../components/ui/TabContentSkeleton';
import { TabErrorBoundary } from '../components/ui/TabErrorBoundary';
import { perfEnd, perfReport, perfStart } from '../lib/perfMarks';

// Explicit filter type. Catches keyboard slips like `promptGroup` vs
// `promptGroups` — the latter is the real state key (a string[] of
// active prompt-group names), the former previously slipped into
// resetFilters() and silently broke the reset button.
type Filters = {
  dateRange:
    | 'lastAudit'
    | 'all'
    | 'last7days'
    | 'last14days'
    | 'last30days'
    | 'last90days'
    | 'custom';
  llms: string;
  promptGroups: string[];
  sentiment: 'all' | 'positive' | 'neutral' | 'negative';
};

const LLM_ICONS = {
  searchgpt: 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/SearchGPT.PNG',
  perplexity: 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/Perplexity.png',
  gemini: 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/Gemini.png',
  'google-ai-overview': 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/Google.png',
  'google-ai-mode': 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/Google.png',
  'bing-copilot': 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/bing_copilot.png',
  'grok': 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/Grok-icon.png',
};

const LLM_DISPLAY_NAMES: Record<string, string> = {
  searchgpt: 'SearchGPT',
  perplexity: 'Perplexity',
  gemini: 'Gemini',
  'google-ai-overview': 'Google AI Overview',
  'google-ai-mode': 'Google AI Mode',
  'bing-copilot': 'Bing Copilot',
  grok: 'Grok',
};

const SENTIMENT_COLORS = {
  positive: '#10B981',
  neutral: '#6B7280',
  negative: '#EF4444',
};

const LLM_COLORS = {
  searchgpt: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  perplexity: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
  gemini: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  'google-ai-overview': 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
  'google-ai-mode': 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  'bing-copilot': 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300',
  'grok': 'bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300',
};

// Unified brand color scheme for all charts
const BRAND_COLOR_SCHEME = [
  '#f72585', // rose
  '#b5179e', // fandango
  '#7209b7', // grape
  '#a163e8', // amethyst
  '#1ed0d9', // robin-egg-blue
  '#3a0ca3', // zaffre
  '#d0bd3c', // old-gold
  '#4361ee', // neon-blue
  '#e8672b', // persimmon
  '#4df07e'  // spring-green
];

// Helper function to get consistent color for a brand across all charts
const getBrandColor = (brandName: string, allBrands: string[]): string => {
  const sortedBrands = [...allBrands].sort();
  const index = sortedBrands.indexOf(brandName);
  return index !== -1 ? BRAND_COLOR_SCHEME[index % BRAND_COLOR_SCHEME.length] : BRAND_COLOR_SCHEME[0];
};

interface ProjectDetailPageProps {
  activeTabOverride?: string;
  hideTabNavigation?: boolean;
}

// In-memory cache of loaded data windows, keyed `${projectId}|${windowKey}`.
// Makes period toggles and back-navigation instant. Entries are skipped
// when they were captured while an audit was running, invalidated by
// mutation flows (fetchProjectData(true)), and expire by TTL.
const WINDOW_CACHE = new Map<string, {
  ts: number;
  allAudits: any[];
  windowAudits: any[];
  availableLlms: string[];
  llmResponses: any[];
  citations: any[];
  dataTruncated: { audits: number } | null;
}>();
const WINDOW_CACHE_TTL = 180_000;
const WINDOW_CACHE_MAX = 4;

// Normalize URLs before dedup-comparing citations from two sources
// (the `citations` table and the `llm_responses.citations` JSONB).
// Without this, "https://Example.com/foo/" and "http://www.example.com/foo"
// were treated as different and the same URL got counted twice in the
// Citations tab vs Overview widget. Trailing slash, www., scheme, host
// case, and hash are all stripped; query string is preserved because
// it can legitimately differentiate articles (e.g. ?id=123).
//
// Module-level with a memo cache: the same ~50k URLs of a window are
// normalized by several passes (merge, trend index, page stats,
// domain insights) — `new URL()` is far too expensive to repeat.
const extractDomainFromUrl = (url: string): string => {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

// Session-wide domain→category results from the domain_categories table
// ('' = queried, not present). Refetching the same ~4k domains on every
// filter change was ~27 serialized round-trips.
const DOMAIN_CATEGORY_FETCHED = new Map<string, string>();

const EMPTY_ROWS: any[] = [];

// v2 packed windows ship `answered` + `mentionedKeys` instead of the
// bulk answer_text (15MB on dense projects). These helpers read the
// flags and fall back to the raw text for legacy/REST rows.
const isAnswered = (r: any): boolean =>
  r?.answered !== undefined ? !!r.answered : !!(r?.answer_text && r.answer_text !== '');

const rowMentionsAnyName = (r: any, names: Array<string | null | undefined>): boolean => {
  if (r?.mentionedKeys) {
    for (const n of names) {
      if (n && r.mentionedKeys.has(normalizeBrandKey(n))) return true;
    }
    return false;
  }
  const t = r?.answer_text ? String(r.answer_text).toLowerCase() : '';
  if (!t) return false;
  return names.some(n => n && t.includes(String(n).toLowerCase()));
};

const URL_NORM_CACHE = new Map<string, string>();
const normalizeUrl = (url: string): string => {
  if (!url) return '';
  const hit = URL_NORM_CACHE.get(url);
  if (hit !== undefined) return hit;
  let out: string;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const path = u.pathname.replace(/\/+$/, '') || '/';
    out = `${host}${path}${u.search}`;
  } catch {
    out = url.toLowerCase().replace(/\/+$/, '');
  }
  if (URL_NORM_CACHE.size > 200_000) URL_NORM_CACHE.clear();
  URL_NORM_CACHE.set(url, out);
  return out;
};

export const ProjectDetailPage: React.FC<ProjectDetailPageProps> = ({
  activeTabOverride,
  hideTabNavigation = false
}) => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { setSelectedProject } = useProject();
  // Global filter state — replaces what used to be local `filters` /
  // `customDateRange` useState here. The bar in AppLayout writes to
  // this context; this page reads from it. URL + localStorage
  // persistence lives in the context, not here.
  const {
    filters: globalFilters,
    setFilter: setGlobalFilter,
    registerProjectMeta,
    setLastAuditDate: setLastAuditDateInCtx,
    reset: resetGlobalFilters,
    activeFilterCount: activeGlobalFilterCount,
  } = useDashboardFilters();
  const [project, setProject] = useState<any>(null);

  // Get tab from URL search params, override, or default to 'overview'
  const searchParams = new URLSearchParams(location.search);
  const tabFromUrl = activeTabOverride || searchParams.get('tab') || 'overview';
  const [activeTab, setActiveTab] = useState(tabFromUrl);
  const [citations, setCitations] = useState<any[]>([]);
  const [prompts, setPrompts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLlm, setSelectedLlm] = useState('all');
  const [dateRange, setDateRange] = useState('all');
  const [showCompetitors, setShowCompetitors] = useState(false);
  const [selectedCompetitorDomains, setSelectedCompetitorDomains] = useState<string[]>([]);
  const [hideMentionsWithoutBrands, setHideMentionsWithoutBrands] = useState(true);
  const [showCompetitorsInBrandChart, setShowCompetitorsInBrandChart] = useState(false);
  const [selectedCompetitorBrands, setSelectedCompetitorBrands] = useState<string[]>([]);
  const [showRunAuditModal, setShowRunAuditModal] = useState(false);
  const [exporting, setExporting] = useState(false);
  // Helper function to check if a date is within the selected range
  const isWithinDateRange = (dateString: string, range: string): boolean => {
    if (range === 'all') return true;
    
    const date = new Date(dateString);
    const now = new Date();
    const diffInDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    
    switch (range) {
      case '7d':
        return diffInDays <= 7;
      case '30d':
        return diffInDays <= 30;
      case '90d':
        return diffInDays <= 90;
      default:
        return true;
    }
  };

  const [showEditModal, setShowEditModal] = useState(false);
  const [runningAudits, setRunningAudits] = useState<string[]>([]);
  const [runningAuditInfo, setRunningAuditInfo] = useState<{status: string, currentStep: string} | null>(null);
  // Backwards-compat view of the global multi-select `llms` filter
  // as a single-string value. Used by the many in-page comparison
  // sites written for the old shape. The actual data filtering uses
  // the full array (see the `isLlmVisible` helper just below).
  //   - 0 selected (no filter) → 'all'
  //   - 1 selected → that LLM
  //   - 2+ selected → 'all' AND the filtering still constrains the
  //     visible set via the array; the per-LLM branches just treat
  //     the multi case as "show everything" which is the safer default.
  const filters = useMemo<Filters>(() => ({
    dateRange: globalFilters.dateRange,
    llms:
      globalFilters.llms.length === 1
        ? (globalFilters.llms[0] as Filters['llms'])
        : 'all',
    promptGroups: globalFilters.promptGroups,
    sentiment: globalFilters.sentiment,
  }), [globalFilters]);
  const customDateRange = globalFilters.customDateRange;
  // Set the LLM filter through the context, accepting the old
  // single-string shape so the rest of the page can stay as it was.
  const setFilters = useCallback((updater: (prev: Filters) => Filters) => {
    // The page only uses this updater shape; if we ever switch back
    // to direct sets, add a non-fn branch here.
    const prev: Filters = {
      dateRange: globalFilters.dateRange,
      llms:
        globalFilters.llms.length === 1
          ? (globalFilters.llms[0] as Filters['llms'])
          : 'all',
      promptGroups: globalFilters.promptGroups,
      sentiment: globalFilters.sentiment,
    };
    const next = updater(prev);
    if (next.dateRange !== prev.dateRange) {
      setGlobalFilter('dateRange', next.dateRange);
    }
    if (next.llms !== prev.llms) {
      setGlobalFilter('llms', next.llms === 'all' ? [] : [next.llms]);
    }
    if (next.promptGroups !== prev.promptGroups) {
      setGlobalFilter('promptGroups', next.promptGroups);
    }
    if (next.sentiment !== prev.sentiment) {
      setGlobalFilter('sentiment', next.sentiment);
    }
  }, [globalFilters, setGlobalFilter]);
  const setCustomDateRange = useCallback((next: { startDate: string; endDate: string }) => {
    setGlobalFilter('customDateRange', next);
  }, [setGlobalFilter]);
  // Day-granular key of the selected period. Drives every fetch that
  // must reload when the user picks another window. Sliced to dates so
  // the rolling presets (which resolve from `new Date()`) don't produce
  // a new key on every render.
  const windowKey = useMemo(() => {
    const win = resolveDateWindow(globalFilters, null);
    if (!win) return 'all';
    return `${win.start.toISOString().slice(0, 10)}|${win.end.toISOString().slice(0, 10)}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalFilters.dateRange, globalFilters.customDateRange.startDate, globalFilters.customDateRange.endDate]);
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  // Identity-stable setter for string-array state: skip the update when
  // the value is unchanged, so downstream deps don't see a fresh array
  // on every recomputation (each one used to cost a full page render).
  const setIfChangedArray = (setter: React.Dispatch<React.SetStateAction<string[]>>, next: string[]) => {
    setter(prev => (prev.length === next.length && prev.every((v, i) => v === next[i]) ? prev : next));
  };

  const [editFormData, setEditFormData] = useState({
    name: '',
    domain: '',
    country: '',
    domainMode: 'exact' as 'exact' | 'subdomains',
    groupIds: [] as string[],
    myBrands: '',
    competitors: '',
    prompts: '',
  });
  const [groups, setGroups] = useState<any[]>([]);
  const [promptGroups, setPromptGroups] = useState<string[]>([]);
  const [brands, setBrands] = useState<any[]>([]);
  const [competitors, setCompetitors] = useState<any[]>([]);
  const [brandsList, setBrandsList] = useState<string[]>([]);
  const [competitorsList, setCompetitorsList] = useState<string[]>([]);
  const [brandLeadershipData, setBrandLeadershipData] = useState<any[]>([]);
  const [splitBrandLeadershipByLlm, setSplitBrandLeadershipByLlm] = useState(false);

  // Add state for audit dates and citations by audit
  const [auditDates, setAuditDates] = useState<string[]>([]);
  const [citationsByAudit, setCitationsByAudit] = useState<{[key: string]: any[]}>({});
  const [llmResponses, setLlmResponses] = useState<any[]>([]);
  const [lastAuditDate, setLastAuditDate] = useState<string>('');
  const [auditsData, setAuditsData] = useState<any[]>([]);
  // Lightweight meta for EVERY audit of the project (id/date/status) —
  // independent of the selected period. Feeds the custom-range picker
  // and the "which audits fall inside the window" resolution.
  const [allAuditsMeta, setAllAuditsMeta] = useState<any[]>([]);
  // True while the window data (responses/citations) reloads after a
  // period change — the page keeps showing the previous window instead
  // of flashing the full-page loader.
  const [windowLoading, setWindowLoading] = useState(false);
  // Set when a safety cap cut the fetch short (extremely dense window).
  const [dataTruncated, setDataTruncated] = useState<{ audits: number } | null>(null);

  // processedCitations = table rows + JSON-extracted rows missing from the
  // table. Was an effect + state (extra render hop); now a memo.
  const processedCitations = useMemo(() => {
    const extractedCitations: any[] = [];

    // First, add citations from the database (these come from the citations table)
    citations.forEach(citation => {
      // Extract domain from URL if not present
      const domain = citation.domain || (citation.page_url ? extractDomainFromUrl(citation.page_url) : '');

      extractedCitations.push({
        id: citation.id,
        audit_id: citation.audit_id,
        prompt_id: citation.prompt_id,
        llm: citation.llm,
        page_url: citation.page_url,
        domain: domain,
        citation_text: citation.citation_text,
        position: citation.position,
        cited: citation.cited,
        sentiment_score: citation.sentiment_score,
        sentiment_label: citation.sentiment_label,
        checked_at: citation.checked_at,
        prompts: citation.prompts,
        audits: citation.audits
      });
    });

    // Then, extract citations from llm_responses.citations field (preferred
    // for SearchGPT), skipping entries already present in the table.
    //
    // O(1) presence index. The old per-entry `citations.some(...)` scan was
    // O(rows × entries) — 11-14s of main-thread block on the 90-day windows
    // of dense projects (measured on real prod payloads; the indexed version
    // produces the identical result in ~0.2s).
    const inDb = new Set<string>();
    citations.forEach(c => {
      inDb.add(`${c.audit_id}|${c.prompt_id}|${c.llm}|${normalizeUrl(c.page_url)}`);
    });

    llmResponses.forEach(response => {
      if (!response.citations || !Array.isArray(response.citations)) return;
      const keyBase = `${response.audit_id}|${response.prompt_id}|${response.llm}|`;
      response.citations.forEach((citation: any, index: number) => {
        if (!citation.url) return;
        if (inDb.has(keyBase + normalizeUrl(citation.url))) return;
        const domain = extractDomainFromUrl(citation.url);
        extractedCitations.push({
          id: `${response.id}-${index}`,
          audit_id: response.audit_id,
          prompt_id: response.prompt_id,
          llm: response.llm,
          page_url: citation.url,
          domain: domain,
          citation_text: citation.title || citation.description || '',
          position: index + 1,
          cited: citation.cited !== undefined ? citation.cited : null, // Convert undefined to null for Perplexity
          sentiment_score: null,
          sentiment_label: null,
          checked_at: response.created_at,
          prompts: response.prompts,
          audits: response.audits
        });
      });
    });

    return extractedCitations;
  }, [llmResponses, citations]);

  // Filtered views of the window. Was an effect writing two states (each
  // run produced fresh identities and another render); now one memo.
  const { filteredCitations, filteredLlmResponses } = useMemo(() => {
    let filtered = [...processedCitations];
    let filteredResponses = [...llmResponses];

    // Apply date range filter
    if (filters.dateRange !== 'all') {

      if (filters.dateRange === 'lastAudit') {
        if (lastAuditDate) {
          // Filter to show only citations from the last audit date
          filtered = filtered.filter(citation =>
            citation.audits?.created_at && citation.audits.created_at.split('T')[0] === lastAuditDate
          );
          // Also filter LLM responses by audit date (not response creation date)
          filteredResponses = filteredResponses.filter(response =>
            response.audits?.created_at && response.audits.created_at.split('T')[0] === lastAuditDate
          );
        }
        // If lastAuditDate is not set yet, don't filter (show all data)
      } else if (filters.dateRange === 'custom') {
        if (customDateRange.startDate && customDateRange.endDate) {
          const startDate = new Date(customDateRange.startDate);
          const endDate = new Date(customDateRange.endDate);
          endDate.setHours(23, 59, 59, 999); // Include the entire end date

          filtered = filtered.filter(citation => {
            const citationDate = citation.audits?.created_at ? new Date(citation.audits.created_at) : new Date(citation.checked_at);
            return citationDate >= startDate && citationDate <= endDate;
          });

          filteredResponses = filteredResponses.filter(response => {
            const responseDate = response.audits?.created_at ? new Date(response.audits.created_at) : new Date(response.created_at);
            return responseDate >= startDate && responseDate <= endDate;
          });
        }
      } else {
        // Apply predefined date ranges
        const now = new Date();
        now.setHours(23, 59, 59, 999); // Include today's data
        const cutoffDate = new Date();

        switch (filters.dateRange) {
          case 'last7days':
            cutoffDate.setDate(now.getDate() - 6); // Include today + 6 previous days = 7 days total
            break;
          case 'last14days':
            cutoffDate.setDate(now.getDate() - 13); // Include today + 13 previous days = 14 days total
            break;
          case 'last30days':
            cutoffDate.setDate(now.getDate() - 29); // Include today + 29 previous days = 30 days total
            break;
          case 'last90days':
            cutoffDate.setDate(now.getDate() - 89); // Include today + 89 previous days = 90 days total
            break;
        }

        cutoffDate.setHours(0, 0, 0, 0); // Start from beginning of the cutoff day

        filtered = filtered.filter(citation => {
          const citationDate = citation.audits?.created_at ? new Date(citation.audits.created_at) : new Date(citation.checked_at);
          return citationDate >= cutoffDate && citationDate <= now;
        });

        filteredResponses = filteredResponses.filter(response => {
          const responseDate = response.audits?.created_at ? new Date(response.audits.created_at) : new Date(response.created_at);
          return responseDate >= cutoffDate && responseDate <= now;
        });
      }
    }

    // Apply LLM filter
    if (filters.llms !== 'all') {
      filtered = filtered.filter(citation => citation.llm === filters.llms);
      filteredResponses = filteredResponses.filter(response => response.llm === filters.llms);
    }

    // Apply prompt group filter
    if (filters.promptGroups.length > 0) {
      filtered = filtered.filter(citation =>
        citation.prompts?.prompt_group && filters.promptGroups.includes(citation.prompts.prompt_group)
      );
      filteredResponses = filteredResponses.filter(response =>
        response.prompts?.prompt_group && filters.promptGroups.includes(response.prompts.prompt_group)
      );
    }

    // Apply sentiment filter
    if (filters.sentiment !== 'all') {
      filtered = filtered.filter(citation => 
        citation.sentiment_label === filters.sentiment
      );
      filteredResponses = filteredResponses.filter(response => 
        response.sentiment_label === filters.sentiment
      );
    }

    return { filteredCitations: filtered, filteredLlmResponses: filteredResponses };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processedCitations, llmResponses, filters, customDateRange, lastAuditDate]);
  const [showCompetitorsInTrend, setShowCompetitorsInTrend] = useState(false);
  const [selectedTrendCompetitors, setSelectedTrendCompetitors] = useState<string[]>([]);
  const [showCompetitorsInCitationsTrend, setShowCompetitorsInCitationsTrend] = useState(false);
  const [selectedCitationsTrendCompetitors, setSelectedCitationsTrendCompetitors] = useState<string[]>([]);

  // Insights state
  const [selectedReportType, setSelectedReportType] = useState<string | null>(null);
  const [insightConfig, setInsightConfig] = useState({
    targetBrand: '',
    targetLlm: 'searchgpt' as string,
    reportLanguage: 'en',
    groupIds: [] as string[],
    customCompetitors: '' as string,
  });
  const [completedReports, setCompletedReports] = useState<any[]>([]);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [customBrandInput, setCustomBrandInput] = useState(false);
  const [availableLlms, setAvailableLlms] = useState<string[]>([]);
  const [reportToDelete, setReportToDelete] = useState<string | null>(null);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);

  // State for tracking changes and recalculation confirmation
  const [originalEditValues, setOriginalEditValues] = useState({
    domain: '',
    domainMode: 'exact' as 'exact' | 'subdomains',
    myBrands: '',
  });
  const [showRecalculateConfirm, setShowRecalculateConfirm] = useState(false);
  const [pendingProjectUpdate, setPendingProjectUpdate] = useState<any>(null);
  const [isRecalculating, setIsRecalculating] = useState(false);

  // Sorting state for tables
  const [pageSortConfig, setPageSortConfig] = useState<{ column: string; direction: 'asc' | 'desc' }>({
    column: 'mentions',
    direction: 'desc'
  });
  const [domainSortConfig, setDomainSortConfig] = useState<{ column: string; direction: 'asc' | 'desc' }>({
    column: 'mentions',
    direction: 'desc'
  });

  // Global domain → category map (from domain_categories) + filter for the
  // Domains tab. Own Brand / Competitor are computed per project on top.
  const [domainCategoryMap, setDomainCategoryMap] = useState<Record<string, string>>({});
  const [domainCategoryFilter, setDomainCategoryFilter] = useState<string>('all');
  const [domainsView, setDomainsView] = useState<'performance' | 'insights'>('performance');
  const [mentionsMetric, setMentionsMetric] = useState<'rate' | 'count'>('rate');
  // Citation Funnel (experimental): lazy-loaded searchgpt source panels for
  // the latest completed audit that has searchgpt answers.
  const [cfData, setCfData] = useState<{
    auditId: string; auditDate: string; rows: any[];
  } | null>(null);
  const [cfLoading, setCfLoading] = useState(false);
  const [cfError, setCfError] = useState<string | null>(null);

  // Ads dashboard (lazy-loaded on tab open). Ads are collected since the
  // rich-results deploy — older audits have ads=null because the field
  // wasn't captured, not because no ad was shown.
  const ADS_COLLECTED_SINCE = '2026-08-19';
  const [adsDash, setAdsDash] = useState<{
    loading: boolean; loaded: boolean;
    audits: any[]; searchgptStats: Record<string, { answered: number }>;
    adRows: any[]; shoppingRows: any[]; advCategories: Record<string, string>;
  }>({ loading: false, loaded: false, audits: [], searchgptStats: {}, adRows: [], shoppingRows: [], advCategories: {} });

  useEffect(() => {
    if (activeTab !== 'ads' || !id || adsDash.loaded || adsDash.loading) return;
    let cancelled = false;
    (async () => {
      setAdsDash(prev => ({ ...prev, loading: true }));
      try {
        const { data: allAudits } = await supabase
          .from('audits')
          .select('id, created_at')
          .eq('project_id', id)
          .eq('status', 'completed')
          .gte('created_at', ADS_COLLECTED_SINCE)
          .order('created_at', { ascending: true });
        const auditIds = (allAudits || []).map(a => a.id);

        const searchgptStats: Record<string, { answered: number }> = {};
        const adRows: any[] = [];
        const shoppingRows: any[] = [];
        for (let i = 0; i < auditIds.length; i += 50) {
          const chunk = auditIds.slice(i, i + 50);
          const { data: stats } = await supabase.rpc('audit_llm_response_stats', { p_audit_ids: chunk });
          (stats || []).forEach((s: any) => {
            if (s.llm === 'searchgpt') {
              searchgptStats[s.audit_id] = { answered: Number(s.answered) };
            }
          });
          const { data: rows } = await supabase
            .from('llm_responses')
            .select(`id, audit_id, created_at, ad_name:ads->>name, ad_url:ads->>url, ad_cards:ads->carousel_cards, prompts(prompt_text)`)
            .in('audit_id', chunk)
            .not('ads', 'is', null)
            .order('created_at', { ascending: false });
          (rows || []).forEach(r => { if ((r as any).ad_name) adRows.push(r); });
          const { data: shopRows } = await supabase
            .from('llm_responses')
            .select('id, audit_id, created_at, shopping')
            .in('audit_id', chunk)
            .eq('shopping_visible', true);
          (shopRows || []).forEach(r => { if (Array.isArray((r as any).shopping) && (r as any).shopping.length) shoppingRows.push(r); });
        }

        // Advertiser-domain categories (global domain_categories table).
        const advDomains = Array.from(new Set(
          adRows.map(r => r.ad_url ? extractDomain(r.ad_url) : '').filter(Boolean)));
        const advCategories: Record<string, string> = {};
        if (advDomains.length > 0) {
          const { data: cats } = await supabase
            .from('domain_categories')
            .select('domain, category')
            .in('domain', advDomains);
          (cats || []).forEach((c: any) => { advCategories[c.domain] = c.category; });
        }
        if (!cancelled) {
          setAdsDash({ loading: false, loaded: true, audits: allAudits || [], searchgptStats, adRows, shoppingRows, advCategories });
        }
      } catch (e) {
        console.error('Error loading ads dashboard:', e);
        if (!cancelled) setAdsDash(prev => ({ ...prev, loading: false, loaded: true }));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, id]);

  // Period trends for the Overview charts: server-side aggregates
  // (project_citations_over_time / project_mentions_over_time RPCs)
  // over the selected window — cheaper and more complete than walking
  // the client-side rows.
  const [trends, setTrends] = useState<{
    loading: boolean; citations: any[] | null; mentions: any[] | null;
  }>({ loading: false, citations: null, mentions: null });

  const promptGroupsKey = filters.promptGroups.join('|');

  // A period change invalidates the funnel snapshot (it is built from
  // the newest completed audit INSIDE the window).
  useEffect(() => {
    setCfData(null);
    setCfError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowKey]);

  useEffect(() => {
    if (activeTab !== 'citation-funnel' || !id || cfData || cfLoading) return;
    let cancelled = false;
    (async () => {
      setCfLoading(true);
      setCfError(null);
      try {
        const cfWin = resolveDateWindow(globalFilters, null);
        let candQuery = supabase
          .from('audits')
          .select('id, created_at')
          .eq('project_id', id)
          .eq('status', 'completed')
          .order('created_at', { ascending: false })
          .limit(10);
        if (cfWin) {
          candQuery = candQuery
            .gte('created_at', cfWin.start.toISOString())
            .lte('created_at', cfWin.end.toISOString());
        }
        const { data: auds, error: e1 } = await candQuery;
        if (e1) throw e1;
        const ids = (auds || []).map(a2 => a2.id);
        if (ids.length === 0) throw new Error('No completed audits in the selected period');
        // Pick the newest audit that HAS searchgpt answers first (cheap HEAD
        // counts), THEN page through that single audit's rows. Fetching all
        // 10 audits in one query silently hit PostgREST's 1000-row cap: on a
        // 135-prompt project only 8 rows of the newest audit survived the
        // cut and the funnel showed "All Prompts (8)".
        let chosen: any = null;
        for (const a2 of auds || []) {
          const { count, error: eh } = await supabase
            .from('llm_responses')
            .select('id', { count: 'exact', head: true })
            .eq('audit_id', a2.id)
            .eq('llm', 'searchgpt')
            .not('answer_text', 'is', null)
            .neq('answer_text', '');
          if (eh) throw eh;
          if ((count || 0) > 0) { chosen = a2; break; }
        }
        if (cancelled) return;
        if (!chosen) {
          setCfError('No completed audit contains SearchGPT answers for this project');
        } else {
          const rows: any[] = [];
          const PAGE = 1000;
          for (let from = 0; ; from += PAGE) {
            const { data: page, error: e2 } = await supabase
              .from('llm_responses')
              .select('id, audit_id, prompt_id, links_attached, citations, search_sources, search_sources_more, web_search_query')
              .eq('audit_id', chosen.id)
              .eq('llm', 'searchgpt')
              .not('answer_text', 'is', null)
              .neq('answer_text', '')
              .order('id', { ascending: true })
              .range(from, from + PAGE - 1);
            if (e2) throw e2;
            rows.push(...(page || []));
            if (!page || page.length < PAGE) break;
          }
          if (cancelled) return;
          setCfData({ auditId: chosen.id, auditDate: chosen.created_at, rows });
        }
      } catch (e: any) {
        if (!cancelled) setCfError(e.message || String(e));
      } finally {
        if (!cancelled) setCfLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, id, windowKey, cfData]);
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      setTrends(prev => ({ ...prev, loading: true }));
      // The Over-Time charts cover exactly the selected period (default
      // 3 months) — every preset resolves to a [from, to] window now.
      const win = resolveDateWindow(globalFilters, null);
      const common = {
        p_project_id: id,
        p_llm: filters.llms !== 'all' ? filters.llms : null,
        p_groups: filters.promptGroups.length > 0 ? filters.promptGroups : null,
        p_from: win ? win.start.toISOString() : null,
        p_to: win ? win.end.toISOString() : null,
      };
      try {
        const [cit, men] = await Promise.all([
          supabase.rpc('project_citations_over_time', {
            ...common,
            p_project_domain: project?.domain
              ? String(project.domain).toLowerCase().replace(/^www\./, '')
              : null,
            p_domain_mode: project?.domain_mode || 'exact',
          }),
          supabase.rpc('project_mentions_over_time', {
            ...common,
            p_sentiment: filters.sentiment !== 'all' ? filters.sentiment : null,
          }),
        ]);
        if (cancelled) return;
        if (cit.error) console.error('citations trend RPC:', cit.error);
        if (men.error) console.error('mentions trend RPC:', men.error);
        setTrends({
          loading: false,
          // null (not []) means "unavailable" → the charts fall back to the
          // client-side computation over the loaded audits.
          citations: cit.error ? null : (cit.data || []),
          mentions: men.error ? null : (men.data || []),
        });
      } catch (e) {
        console.error('Error loading trends:', e);
        if (!cancelled) setTrends({ loading: false, citations: null, mentions: null });
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, project?.domain, project?.domain_mode, filters.llms, promptGroupsKey,
      filters.sentiment, filters.dateRange, customDateRange.startDate, customDateRange.endDate]);

  // Brand → official-site domain, for brand favicons. Tier 0: most-cited
  // matching domain from this project's citations (free, computed here).
  // Fallback: global brand_domains table (gpt-5-nano fills it per audit).
  const [brandDbDomains, setBrandDbDomains] = useState<Record<string, string>>({});
  const citationBrandDomains = useMemo(
    () => buildBrandDomainMapFromCitations(processedCitations),
    [processedCitations]
  );
  const getBrandDomain = (brandName: string): string | null => {
    const key = normalizeBrandKey(brandName);
    if (!key) return null;
    return citationBrandDomains[key] || brandDbDomains[key] || null;
  };

  // LLMs that actually have data in this project (audit configs + collected
  // responses) — drives the Insights Target LLM selector. All known LLMs
  // when the project has no data yet.
  const insightLlmOptions = useMemo(() => {
    const seen = new Set<string>(availableLlms);
    llmResponses.forEach((r: any) => { if (r.llm) seen.add(r.llm); });
    const known = Object.keys(LLM_ICONS);
    const opts = known.filter(l => seen.has(l));
    return opts.length > 0 ? opts : known;
  }, [availableLlms, llmResponses]);

  useEffect(() => {
    const names = [...brands, ...competitors].map(b => b.brand_name).filter(Boolean);
    const norms = Array.from(new Set(names.map(normalizeBrandKey).filter(k => k)));
    if (norms.length === 0) {
      setBrandDbDomains({});
      return;
    }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('brand_domains')
        .select('brand_norm, domain')
        .in('brand_norm', norms);
      if (error) {
        console.error('Error fetching brand domains:', error);
        return;
      }
      if (!cancelled) {
        const map: Record<string, string> = {};
        (data || []).forEach((r: any) => { map[r.brand_norm] = r.domain; });
        setBrandDbDomains(map);
      }
    })();
    return () => { cancelled = true; };
  }, [brands, competitors]);

  useEffect(() => {
    // processedCitations is what the Domains tab actually renders: citation
    // table rows PLUS citations extracted client-side from llm_responses
    // JSON (all_sources / links_attached). Keying the fetch on `citations`
    // alone left every JSON-derived domain Unknown.
    const domainSet = new Set<string>();
    processedCitations.forEach(c => {
      if (!c.domain) return;
      domainSet.add(c.domain);
      // domain_categories keys are backend-normalized (lowercase, no www),
      // so query the normalized variant of client-extracted domains too.
      domainSet.add(String(c.domain).toLowerCase().replace(/^www\./, ''));
    });
    const domains = Array.from(domainSet);
    if (domains.length === 0) {
      setDomainCategoryMap({});
      return;
    }
    let cancelled = false;
    (async () => {
      // Only query domains this session hasn't looked up yet; the rest
      // come from DOMAIN_CATEGORY_FETCHED. Chunks run in parallel (was a
      // ~27-round-trip serialized loop on dense windows).
      const missing = domains.filter(d => !DOMAIN_CATEGORY_FETCHED.has(d));
      if (missing.length > 0) {
        const chunks: string[][] = [];
        for (let i = 0; i < missing.length; i += 150) {
          chunks.push(missing.slice(i, i + 150));
        }
        const CONC = 6;
        let next = 0;
        const worker = async () => {
          while (next < chunks.length) {
            const chunk = chunks[next++];
            const { data, error } = await supabase
              .from('domain_categories')
              .select('domain, category')
              .in('domain', chunk);
            if (error) {
              console.error('Error fetching domain categories:', error);
              continue;
            }
            const found = new Map((data || []).map((r: any) => [r.domain, r.category]));
            chunk.forEach(d => {
              DOMAIN_CATEGORY_FETCHED.set(d, found.get(d) || '');
            });
          }
        };
        await Promise.all(Array.from({ length: Math.min(CONC, chunks.length) }, () => worker()));
      }
      if (cancelled) return;
      const map: Record<string, string> = {};
      domains.forEach(d => {
        const cat = DOMAIN_CATEGORY_FETCHED.get(d);
        if (cat) map[d] = cat;
      });
      setDomainCategoryMap(map);
    })();
    return () => { cancelled = true; };
  }, [processedCitations]);


  useEffect(() => {
    if (id) {
      // Re-runs when the selected period changes: the whole data window
      // (audits in period + their responses/citations) is re-fetched.
      fetchProjectData();
      fetchGroups();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, windowKey]);

  // Sync activeTab with URL or override
  useEffect(() => {
    if (activeTabOverride) {
      setActiveTab(activeTabOverride);
    } else {
      const newSearchParams = new URLSearchParams(location.search);
      const currentTab = newSearchParams.get('tab') || 'overview';
      if (currentTab !== activeTab) {
        setActiveTab(currentTab);
      }
    }
  }, [location.search, activeTabOverride]);

  // Update URL when activeTab changes (only if not using override)
  useEffect(() => {
    if (!activeTabOverride) {
      const newSearchParams = new URLSearchParams(location.search);
      const currentTab = newSearchParams.get('tab') || 'overview';
      if (currentTab !== activeTab) {
        newSearchParams.set('tab', activeTab);
        navigate(`?${newSearchParams.toString()}`, { replace: true });
      }
    }
  }, [activeTab, activeTabOverride]);

  useEffect(() => {
    if (!id) return;

    let intervalId: NodeJS.Timeout;

    if (runningAuditInfo) {
      // Use 15 second polling interval to reduce database load (was 5s)
      // This reduces query frequency by 66% while still providing timely updates
      intervalId = setInterval(() => {
        fetchRunningAuditStatus();
      }, 15000);
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [id, runningAuditInfo]);

  // processedCitations and the filtered views are useMemo now (see below) —
  // the old effect->state hops each cost a full extra render of the page.

  useEffect(() => {
    calculateBrandLeadership();
  }, [filteredLlmResponses, splitBrandLeadershipByLlm]);

  // Initialize selected trend competitors with top 2
  useEffect(() => {
    if (llmResponses.length > 0 && selectedTrendCompetitors.length === 0) {
      const { allCompetitors } = getMentionRateByAuditDate();
      const top2 = allCompetitors.slice(0, 2).map(c => c.brand);
      setSelectedTrendCompetitors(top2);
    }
  }, [llmResponses, filters]);

  useEffect(() => {
    // Get audit dates from actual audits (includes audits with no citations)
    const auditDatesFromAudits = new Set<string>();
    auditsData.forEach(audit => {
      if (audit.created_at) {
        auditDatesFromAudits.add(audit.created_at.split('T')[0]);
      }
    });

    // Dates where at least one citation or one LLM response with an answer
    // exists. Used for the default "Last Audit" filter so we don't point at
    // a force-completed / crashed empty audit and render a blank page.
    const datesWithData = new Set<string>();
    processedCitations.forEach(citation => {
      const d = citation.audits?.created_at?.split('T')[0];
      if (d) datesWithData.add(d);
    });
    llmResponses.forEach(response => {
      if (isAnswered(response) && response.audits?.created_at) {
        datesWithData.add(response.audits.created_at.split('T')[0]);
      }
    });

    // availableDates drives the Custom Date Range picker. Sourced from the
    // UNION of (a) all audits for this project and (b) any date where at
    // least one citation or llm_response with answer_text exists. This
    // guarantees the picker is populated on projects that have audits but
    // zero citations (brand-mention-only dashboards), which used to leave
    // the picker empty because it was previously gated on processedCitations.
    const allAvailable = new Set<string>();
    auditDatesFromAudits.forEach(d => allAvailable.add(d));
    datesWithData.forEach(d => allAvailable.add(d));
    processedCitations.forEach(c => {
      if (c.checked_at) allAvailable.add(c.checked_at.split('T')[0]);
    });
    // The custom-range calendar must offer the WHOLE project history,
    // not just the audits inside the currently-selected window.
    allAuditsMeta.forEach(a => {
      if (a.created_at) allAvailable.add(a.created_at.split('T')[0]);
    });
    setIfChangedArray(setAvailableDates, Array.from(allAvailable).sort());

    if (processedCitations.length > 0) {

      // Get audit dates and group citations by audit date
      const auditDatesSet = new Set<string>(auditDatesFromAudits);
      const citationsByAuditDate: {[key: string]: any[]} = {};

      // Initialize empty arrays for all audit dates
      auditDatesFromAudits.forEach(date => {
        citationsByAuditDate[date] = [];
      });

      processedCitations.forEach(citation => {
        if (citation.audits?.created_at) {
          const auditDate = citation.audits.created_at.split('T')[0];
          auditDatesSet.add(auditDate);

          if (!citationsByAuditDate[auditDate]) {
            citationsByAuditDate[auditDate] = [];
          }
          citationsByAuditDate[auditDate].push(citation);
        }
      });

      const sortedAuditDates = Array.from(auditDatesSet).sort();
      setIfChangedArray(setAuditDates, sortedAuditDates);
      setCitationsByAudit(citationsByAuditDate);

      // Set last audit date — prefer the most recent date that actually
      // has data. Fall back to the most recent audit date overall so the
      // dropdown label still renders something when no audit has any data
      // yet (freshly created project, everything still running, etc.).
      const sortedDatesWithData = Array.from(datesWithData).sort();
      let computedLastAuditDate: string | null = null;
      if (sortedDatesWithData.length > 0) {
        computedLastAuditDate = sortedDatesWithData[sortedDatesWithData.length - 1];
        setLastAuditDate(computedLastAuditDate);
      } else if (sortedAuditDates.length > 0) {
        computedLastAuditDate = sortedAuditDates[sortedAuditDates.length - 1];
        setLastAuditDate(computedLastAuditDate);
      }
      // Mirror to the global filter context so the DateRangePicker
      // in AppLayout can resolve the "Last audit" preset to a real
      // date window.
      setLastAuditDateInCtx(computedLastAuditDate);
    } else if (auditDatesFromAudits.size > 0) {
      // Even if no citations, show audit dates
      const sortedAuditDates = Array.from(auditDatesFromAudits).sort();
      setIfChangedArray(setAuditDates, sortedAuditDates);
      setCitationsByAudit({});

      // Same preference as above — a date with llm_response answers beats
      // an empty force-completed audit at the top of the list.
      const sortedDatesWithData = Array.from(datesWithData).sort();
      let computedLastAuditDate: string | null = null;
      if (sortedDatesWithData.length > 0) {
        computedLastAuditDate = sortedDatesWithData[sortedDatesWithData.length - 1];
        setLastAuditDate(computedLastAuditDate);
      } else if (sortedAuditDates.length > 0) {
        computedLastAuditDate = sortedAuditDates[sortedAuditDates.length - 1];
        setLastAuditDate(computedLastAuditDate);
      }
      setLastAuditDateInCtx(computedLastAuditDate);
    }

    // Register project meta with the global filter context so the
    // DashboardFilterBar dropdowns know which LLMs / prompt groups /
    // audit dates this project actually has.
    const availableLlms = Array.from(
      new Set(llmResponses.map(r => r.llm).filter(Boolean)),
    ).sort();
    const availableGroups = Array.from(
      new Set(promptGroups.filter(Boolean)),
    ).sort();
    registerProjectMeta({
      availableLlms,
      availablePromptGroups: availableGroups,
      availableDates: Array.from(allAvailable).sort(),
      hasAudits: auditDatesFromAudits.size > 0,
    });
  }, [processedCitations, auditsData, allAuditsMeta, llmResponses, promptGroups, registerProjectMeta, setLastAuditDateInCtx]);

  const calculateBrandLeadership = () => {
    try {
      // Use filteredLlmResponses instead of making a new query
      const responses = filteredLlmResponses.filter(r => r.answer_competitors);

      // Get our brand names (not competitors)
      const ourBrandNames = brands
        .filter(b => !b.is_competitor)
        .map(b => b.brand_name.toLowerCase());

      // Check if a brand is our brand (case-insensitive exact match or contains)
      const isOurBrand = (brandName: string) => {
        const lowerBrandName = brandName.toLowerCase();
        return ourBrandNames.some(ourBrand =>
          lowerBrandName === ourBrand ||
          lowerBrandName.includes(ourBrand) ||
          ourBrand.includes(lowerBrandName)
        );
      };

      if (splitBrandLeadershipByLlm) {
        // Split by LLM: count mentions per LLM
        const brandCountsByLlm = new Map<string, Map<string, number>>();
        const totalResponsesByLlm = new Map<string, number>();

        responses.forEach(response => {
          const llm = response.llm || 'unknown';
          totalResponsesByLlm.set(llm, (totalResponsesByLlm.get(llm) || 0) + 1);

          if (response.answer_competitors?.brands && Array.isArray(response.answer_competitors.brands)) {
            response.answer_competitors.brands.forEach((brand: any) => {
              if (brand.name) {
                if (!brandCountsByLlm.has(brand.name)) {
                  brandCountsByLlm.set(brand.name, new Map());
                }
                const llmCounts = brandCountsByLlm.get(brand.name)!;
                llmCounts.set(llm, (llmCounts.get(llm) || 0) + 1);
              }
            });
          }
        });

        // Calculate mention rates per LLM and create chart data
        const allBrands = Array.from(brandCountsByLlm.entries())
          .map(([brandName, llmCounts]) => {
            const llmData: any = {
              name: brandName,
              isOwnBrand: isOurBrand(brandName)
            };
            let totalMentions = 0;

            llmCounts.forEach((count, llm) => {
              const totalForLlm = totalResponsesByLlm.get(llm) || 1;
              llmData[llm] = count;
              llmData[`${llm}Rate`] = totalForLlm > 0 ? Math.round((count / totalForLlm) * 100) : 0;
              totalMentions += count;
            });

            llmData.totalMentions = totalMentions;
            return llmData;
          });

        // Sort all brands by total mentions, keeping own brands marked
        const ownBrands = allBrands.filter(b => b.isOwnBrand);
        const competitors = allBrands.filter(b => !b.isOwnBrand).slice(0, 20);

        // Combine and sort by total mentions
        const brandData = [...ownBrands, ...competitors]
          .sort((a, b) => b.totalMentions - a.totalMentions);

        setBrandLeadershipData(brandData);
      } else {
        // Aggregate across all LLMs
        const brandCounts = new Map<string, number>();
        const totalResponses = responses.length;

        responses.forEach(response => {
          if (response.answer_competitors?.brands && Array.isArray(response.answer_competitors.brands)) {
            response.answer_competitors.brands.forEach((brand: any) => {
              if (brand.name) {
                brandCounts.set(brand.name, (brandCounts.get(brand.name) || 0) + 1);
              }
            });
          }
        });

        // Calculate mention rates and create chart data
        const allBrands = Array.from(brandCounts.entries())
          .map(([brandName, mentions]) => ({
            name: brandName,
            mentions: mentions,
            mentionRate: totalResponses > 0 ? Math.round((mentions / totalResponses) * 100) : 0,
            isOwnBrand: isOurBrand(brandName)
          }));

        // Sort all brands by mention rate, keeping own brands marked
        const ownBrands = allBrands.filter(b => b.isOwnBrand);
        const competitors = allBrands.filter(b => !b.isOwnBrand).slice(0, 20);

        // Combine and sort by mention rate
        const brandData = [...ownBrands, ...competitors]
          .sort((a, b) => b.mentionRate - a.mentionRate);

        setBrandLeadershipData(brandData);
      }
    } catch (error) {
      console.error('Error calculating brand leadership:', error);
    }
  };

  const fmtTrendDate = (d: string) =>
    new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  // Chart builders over the full-history RPC rows. Row shapes:
  //   citations: {audit_date, domain|null, citations, total}
  //   mentions:  {audit_date, brand|null, mentions, total_responses}
  // The NULL-series row per date carries that date's total, so dates whose
  // series all fell outside the server-side top-N still produce a point.
  const buildCitationsTrend = (rows: any[]) => {
    const byDate = new Map<string, { total: number; domains: Map<string, number> }>();
    rows.forEach(r => {
      const d = String(r.audit_date);
      let e = byDate.get(d);
      if (!e) { e = { total: Number(r.total) || 0, domains: new Map() }; byDate.set(d, e); }
      if (r.domain) e.domains.set(r.domain, Number(r.citations) || 0);
    });

    const projectDomain = project?.domain?.toLowerCase().replace(/^www\./, '') || '';
    const domainMode = project?.domain_mode || 'exact';

    const globalCounts = new Map<string, number>();
    byDate.forEach(e => e.domains.forEach((n, dom) =>
      globalCounts.set(dom, (globalCounts.get(dom) || 0) + n)));
    const topDomains = Array.from(globalCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([domain, count]) => ({ domain, count }));

    const chartData = Array.from(byDate.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, e]) => {
        const dp: any = { date: fmtTrendDate(date), fullDate: date, total: e.total };
        if (projectDomain) {
          let n = 0;
          e.domains.forEach((v, dom) => {
            if (dom === projectDomain || (domainMode === 'subdomains' && dom.endsWith(`.${projectDomain}`))) n += v;
          });
          dp[projectDomain] = n;
        }
        topDomains.forEach(({ domain }) => {
          let n = 0;
          e.domains.forEach((v, dom) => { if (dom === domain || dom.endsWith(`.${domain}`)) n += v; });
          dp[domain] = n;
        });
        return dp;
      });

    return { chartData, projectDomain, topDomains };
  };

  const buildMentionsTrend = (rows: any[]) => {
    const byDate = new Map<string, { total: number; brands: Map<string, number> }>();
    rows.forEach(r => {
      const d = String(r.audit_date);
      let e = byDate.get(d);
      if (!e) { e = { total: Number(r.total_responses) || 0, brands: new Map() }; byDate.set(d, e); }
      if (r.brand) e.brands.set(r.brand, Number(r.mentions) || 0);
    });

    const myBrands = brands.map(b => b.brand_name).filter(Boolean);
    const isOwn = (name: string) => myBrands.some(mb => mb.toLowerCase() === name.toLowerCase());

    const globalCounts = new Map<string, number>();
    byDate.forEach(e => e.brands.forEach((n, b) => {
      if (!isOwn(b)) globalCounts.set(b, (globalCounts.get(b) || 0) + n);
    }));
    const allCompetitors = Array.from(globalCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([brand, count]) => ({ brand, count }));

    const chartData = Array.from(byDate.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, e]) => {
        const dp: any = { date: fmtTrendDate(date), fullDate: date };
        const rate = (name: string) => {
          let n = 0;
          e.brands.forEach((v, b) => { if (b.toLowerCase() === name.toLowerCase()) n += v; });
          return e.total > 0 ? Math.round((n / e.total) * 100) : 0;
        };
        myBrands.forEach(b => { dp[b] = rate(b); });
        allCompetitors.forEach(({ brand }) => { dp[brand] = rate(brand); });
        return dp;
      });

    return { chartData, myBrands, allCompetitors };
  };

  const getMentionRateByAuditDate = () => {
    // Full history when the aggregate is available; the legacy client-side
    // path (last 5 audits only) stays as the fallback.
    if (trends.mentions && trends.mentions.length > 0) {
      try {
        return buildMentionsTrend(trends.mentions);
      } catch (e) {
        console.error('mentions trend build failed, falling back:', e);
      }
    }
    try {
      // Get all responses grouped by audit date
      // Apply non-date filters (LLM, prompt groups, sentiment) but show all dates by default
      // Only apply date filter when custom date range is selected
      const responsesByAuditDate = new Map<string, any[]>();

      llmResponses.forEach(response => {
        if (response.audits?.created_at) {
          const auditDate = response.audits.created_at.split('T')[0];

          // Apply non-date filters manually
          let matchesFilters = true;

          // Apply LLM filter
          if (filters.llms !== 'all' && response.llm !== filters.llms) {
            matchesFilters = false;
          }

          // Apply prompt group filter
          if (filters.promptGroups.length > 0 &&
              (!response.prompts?.prompt_group || !filters.promptGroups.includes(response.prompts.prompt_group))) {
            matchesFilters = false;
          }

          // Apply sentiment filter
          if (filters.sentiment !== 'all' && response.sentiment_label !== filters.sentiment) {
            matchesFilters = false;
          }

          // Apply custom date range filter ONLY if custom date range is selected
          if (filters.dateRange === 'custom' && customDateRange.startDate && customDateRange.endDate) {
            const startDate = new Date(customDateRange.startDate);
            const endDate = new Date(customDateRange.endDate);
            endDate.setHours(23, 59, 59, 999);
            const responseDate = new Date(response.audits.created_at);

            if (responseDate < startDate || responseDate > endDate) {
              matchesFilters = false;
            }
          }

          if (matchesFilters) {
            if (!responsesByAuditDate.has(auditDate)) {
              responsesByAuditDate.set(auditDate, []);
            }
            responsesByAuditDate.get(auditDate)?.push(response);
          }
        }
      });

      // Get project brands from brands state (non-competitor brands)
      const myBrands = brands.map(b => b.brand_name).filter(Boolean);

      // Calculate mention rates for each audit date
      const chartData = Array.from(responsesByAuditDate.entries())
        .map(([date, responses]) => {
          const totalResponses = responses.length;
          const dataPoint: any = {
            date: new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            fullDate: date
          };

          // Calculate mention rate for each project brand
          myBrands.forEach((brand: string) => {
            const mentions = responses.filter(r =>
              r.answer_competitors?.brands?.some((b: any) =>
                b.name?.toLowerCase() === brand.toLowerCase()
              )
            ).length;
            dataPoint[brand] = totalResponses > 0 ? Math.round((mentions / totalResponses) * 100) : 0;
          });

          // Find top competitors across all responses for this date
          const brandCounts = new Map<string, number>();
          responses.forEach(response => {
            if (response.answer_competitors?.brands && Array.isArray(response.answer_competitors.brands)) {
              response.answer_competitors.brands.forEach((brand: any) => {
                if (brand.name && !myBrands.some((mb: string) => mb.toLowerCase() === brand.name.toLowerCase())) {
                  brandCounts.set(brand.name, (brandCounts.get(brand.name) || 0) + 1);
                }
              });
            }
          });

          return { dataPoint, brandCounts };
        })
        .sort((a, b) => a.dataPoint.fullDate.localeCompare(b.dataPoint.fullDate));

      // Get all competitors across all audit dates
      const globalCompetitorCounts = new Map<string, number>();
      chartData.forEach(({ brandCounts }) => {
        brandCounts.forEach((count, brand) => {
          globalCompetitorCounts.set(brand, (globalCompetitorCounts.get(brand) || 0) + count);
        });
      });

      const allCompetitors = Array.from(globalCompetitorCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([brand, count]) => ({ brand, count }));

      // Add all competitors to each data point
      const finalChartData = chartData.map(({ dataPoint, brandCounts }) => {
        const responses = Array.from(responsesByAuditDate.get(dataPoint.fullDate) || []);
        const totalResponses = responses.length;

        allCompetitors.forEach(({ brand: competitor }) => {
          const mentions = responses.filter(r =>
            r.answer_competitors?.brands?.some((b: any) =>
              b.name?.toLowerCase() === competitor.toLowerCase()
            )
          ).length;
          dataPoint[competitor] = totalResponses > 0 ? Math.round((mentions / totalResponses) * 100) : 0;
        });

        return dataPoint;
      });

      return { chartData: finalChartData, myBrands, allCompetitors };
    } catch (error) {
      console.error('Error calculating mention rate by audit date:', error);
      return { chartData: [], myBrands: [], allCompetitors: [] };
    }
  };

  const getCitationsOverTime = () => {
    if (trends.citations && trends.citations.length > 0) {
      try {
        return buildCitationsTrend(trends.citations);
      } catch (e) {
        console.error('citations trend build failed, falling back:', e);
      }
    }
    try {
      // Group citations by audit date
      const citationsByAuditDate = new Map<string, any[]>();
      const allFilteredCitations: any[] = [];

      processedCitations.forEach(citation => {
        if (citation.audits?.created_at) {
          const auditDate = citation.audits.created_at.split('T')[0];

          // Apply non-date filters manually
          let matchesFilters = true;

          // Apply LLM filter
          if (filters.llms !== 'all' && citation.llm !== filters.llms) {
            matchesFilters = false;
          }

          // Apply prompt group filter
          if (filters.promptGroups.length > 0 &&
              (!citation.prompts?.prompt_group || !filters.promptGroups.includes(citation.prompts.prompt_group))) {
            matchesFilters = false;
          }

          // Apply sentiment filter
          if (filters.sentiment !== 'all' && citation.sentiment_label !== filters.sentiment) {
            matchesFilters = false;
          }

          // Apply custom date range filter ONLY if custom date range is selected
          if (filters.dateRange === 'custom' && customDateRange.startDate && customDateRange.endDate) {
            const startDate = new Date(customDateRange.startDate);
            const endDate = new Date(customDateRange.endDate);
            endDate.setHours(23, 59, 59, 999);
            const citationDate = new Date(citation.audits.created_at);

            if (citationDate < startDate || citationDate > endDate) {
              matchesFilters = false;
            }
          }

          if (matchesFilters) {
            if (!citationsByAuditDate.has(auditDate)) {
              citationsByAuditDate.set(auditDate, []);
            }
            citationsByAuditDate.get(auditDate)?.push(citation);
            allFilteredCitations.push(citation);
          }
        }
      });

      // Get project domain
      const projectDomain = project?.domain?.toLowerCase().replace(/^www\./, '') || '';
      const domainMode = project?.domain_mode || 'exact';

      // Count citations by domain across all filtered citations
      const domainCounts = new Map<string, number>();

      allFilteredCitations.forEach(citation => {
        const citationDomain = citation.domain?.toLowerCase().replace(/^www\./, '') || '';
        if (citationDomain) {
          domainCounts.set(citationDomain, (domainCounts.get(citationDomain) || 0) + 1);
        }
      });

      // Sort domains by citation count and get top 15
      const topDomains = Array.from(domainCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([domain, count]) => ({ domain, count }));

      // Calculate citation counts for each audit date
      const chartData = Array.from(citationsByAuditDate.entries())
        .map(([date, citations]) => {
          const dataPoint: any = {
            date: new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            fullDate: date,
            total: citations.length
          };

          // Calculate citations for project domain
          if (projectDomain) {
            const projectCitations = citations.filter(citation => {
              const citationDomain = citation.domain?.toLowerCase().replace(/^www\./, '') || '';
              if (domainMode === 'subdomains') {
                return citationDomain === projectDomain || citationDomain.endsWith(`.${projectDomain}`);
              } else {
                return citationDomain === projectDomain;
              }
            }).length;
            dataPoint[projectDomain] = projectCitations;
          }

          // Calculate citations for each top domain
          topDomains.forEach(({ domain }) => {
            const domainCitations = citations.filter(citation => {
              const citationDomain = citation.domain?.toLowerCase().replace(/^www\./, '') || '';
              return citationDomain === domain || citationDomain.endsWith(`.${domain}`);
            }).length;
            dataPoint[domain] = domainCitations;
          });

          return dataPoint;
        })
        .sort((a, b) => a.fullDate.localeCompare(b.fullDate));

      return { chartData, projectDomain, topDomains };
    } catch (error) {
      console.error('Error calculating citations over time:', error);
      return { chartData: [], projectDomain: '', topDomains: [] };
    }
  };

  const getDateRangeStart = (range: string): Date => {
    const now = new Date();
    switch (range) {
      case 'last7days':
        return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      case 'last14days':
        return new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
      case 'last30days':
        return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      case 'last90days':
        return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      default:
        return new Date(0);
    }
  };


  // Page ↔ brand attribution index (Pages tab "Brands" column): exact
  // evidence only — brand in the answer chunk citing the page ([N] markers,
  // searchgpt/chatgpt) or in the citation's own title (all LLMs); response
  // co-mentions go to tooltips. See src/lib/pageBrands.ts.
  // Tab gating for the heavy derived indexes: when the consuming tab is
  // closed, the memos run over stable EMPTY inputs (near-zero cost, same
  // result shape). Opening the tab swaps the real arrays in and the memo
  // recomputes once.
  const pagesDataActive = activeTab === 'pages';
  const pagesOrDomainsActive = activeTab === 'pages' || activeTab === 'domains';
  const pageBrandResponses = pagesDataActive ? filteredLlmResponses : EMPTY_ROWS;
  const pageBrandCitations = pagesDataActive ? filteredCitations : EMPTY_ROWS;
  const trendResponses = pagesOrDomainsActive ? filteredLlmResponses : EMPTY_ROWS;
  const trendCitations = pagesOrDomainsActive ? filteredCitations : EMPTY_ROWS;
  const matrixResponses = activeTab === 'mentions' ? filteredLlmResponses : EMPTY_ROWS;

  // Grid indexes for the Prompts / Visibility tabs — replace the per-cell
  // full-window filters (222 rows × 7 LLMs × 6.6k responses each).
  const gridIndexes = useMemo(() => {
    const byPromptLlmAll = new Map<string, any[]>();
    const byPromptFiltered = new Map<string, any[]>();
    const active = activeTab === 'prompts' || activeTab === 'visibility';
    if (active) {
      llmResponses.forEach((r: any) => {
        const k = `${r.prompt_id}|${r.llm}`;
        let arr = byPromptLlmAll.get(k);
        if (!arr) byPromptLlmAll.set(k, arr = []);
        arr.push(r);
      });
      filteredLlmResponses.forEach((r: any) => {
        let arr = byPromptFiltered.get(r.prompt_id);
        if (!arr) byPromptFiltered.set(r.prompt_id, arr = []);
        arr.push(r);
      });
    }
    const uniqueLlms = active
      ? Array.from(new Set(llmResponses.map((r: any) => r.llm))).sort()
      : [];
    return { byPromptLlmAll, byPromptFiltered, uniqueLlms };
  }, [activeTab, llmResponses, filteredLlmResponses]);

  // Render caps for the two unbounded tables (Pages can reach ~18k rows).
  const [pagesRowLimit, setPagesRowLimit] = useState(50);
  const [domainsRowLimit, setDomainsRowLimit] = useState(50);
  useEffect(() => {
    setPagesRowLimit(50);
    setDomainsRowLimit(50);
  }, [windowKey, activeTab]);

  // Pages route: lazily restore searchgpt answer texts (dropped from the
  // bulk v2 transport) so buildPageBrandIndex keeps its exact chunk-level
  // (level-1) brand attribution. Fetched once per window, only while the
  // Pages dashboard is open; positions are sequential 1..n in the data
  // (verified on 18k rows), so the parser's index fallback is exact.
  const [pagesSgTexts, setPagesSgTexts] = useState<Map<string, string> | null>(null);
  useEffect(() => { setPagesSgTexts(null); }, [windowKey, id]);
  useEffect(() => {
    if (activeTab !== 'pages' || pagesSgTexts !== null) return;
    const auditIds = auditsData.map((a: any) => a.id);
    if (auditIds.length === 0 || llmResponses.length === 0) return;
    // REST-fallback rows already carry texts — nothing to fetch.
    if (llmResponses.some((r: any) => r.llm === 'searchgpt' && r.answer_text)) {
      setPagesSgTexts(new Map());
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const out = new Map<string, string>();
        const chunks: string[][] = [];
        for (let i = 0; i < auditIds.length; i += 60) chunks.push(auditIds.slice(i, i + 60));
        let next = 0;
        const worker = async () => {
          while (next < chunks.length && !cancelled) {
            const chunk = chunks[next++];
            for (let from = 0; ; from += 1000) {
              const { data: page, error } = await supabase
                .from('llm_responses')
                .select('id, answer_text')
                .in('audit_id', chunk)
                .eq('llm', 'searchgpt')
                .not('answer_text', 'is', null)
                .order('id', { ascending: true })
                .range(from, from + 999);
              if (error) throw error;
              (page || []).forEach((r: any) => { if (r.answer_text) out.set(r.id, r.answer_text); });
              if (!page || page.length < 1000) break;
            }
          }
        };
        await Promise.all(Array.from({ length: Math.min(3, chunks.length) }, () => worker()));
        if (!cancelled) setPagesSgTexts(out);
      } catch (e) {
        console.error('Pages: searchgpt texts fetch failed', e);
        if (!cancelled) setPagesSgTexts(new Map());
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, pagesSgTexts, auditsData, llmResponses]);

  const pageBrandResponsesWithText = useMemo(() => {
    if (!pagesSgTexts || pagesSgTexts.size === 0) return pageBrandResponses;
    return pageBrandResponses.map((r: any) =>
      r.answer_text == null && pagesSgTexts.has(r.id)
        ? { ...r, answer_text: pagesSgTexts.get(r.id) }
        : r);
  }, [pageBrandResponses, pagesSgTexts]);

  const pageBrandIndex = useMemo(
    () => buildPageBrandIndex({
      responses: pageBrandResponsesWithText,
      citations: pageBrandCitations,
      projectBrands: [...brands, ...competitors],
      normalizeUrl,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pageBrandResponsesWithText, pageBrandCitations, brands, competitors]
  );

  // Trend vs the previous audit (Domains / Pages tabs). Compares the last
  // two COMPLETED audits that have answered responses under the active
  // filters, on the SHARE of answered responses citing each domain / page --
  // robust to partial collections and the x1 -> x3 Avalanche switch, unlike
  // raw citation counts. Absolute numbers go to the chip tooltip.
  const auditTrendIndex = useMemo(() => {
    const empty = {
      ready: false as const,
      domainTrend: (_d: string) => null as TrendData | null,
      pageTrend: (_u: string) => null as TrendData | null,
      domainSeries: (_d: string) => null as TrendPoint[] | null,
      pageSeries: (_u: string) => null as TrendPoint[] | null,
      audits: [] as { id: string; date: string; total: number }[],
    };
    if (!auditsData || auditsData.length < 2) return empty;

    const answeredByAudit = new Map<string, number>();
    trendResponses.forEach(r => {
      if (!r.audit_id || !isAnswered(r)) return;
      answeredByAudit.set(r.audit_id, (answeredByAudit.get(r.audit_id) || 0) + 1);
    });

    const candidates = (auditsData || [])
      .filter(a => a.status === 'completed' && (answeredByAudit.get(a.id) || 0) > 0)
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    if (candidates.length < 2) return empty;
    const last = candidates[candidates.length - 1];
    const prev = candidates[candidates.length - 2];
    const windowIds = new Set(candidates.map(a => a.id));

    // Same cited-tier rules as the tables themselves.
    const isCited = (c: any) => {
      if (filters.llms === 'searchgpt') return c.cited === true;
      if (filters.llms === 'all') {
        return c.llm === 'searchgpt' ? c.cited === true : (c.cited === true || c.cited == null);
      }
      return c.cited === true || c.cited == null;
    };

    // Count RESPONSES citing the item (unique audit-prompt-llm), not raw
    // citation rows -- several links to one page in one answer are one vote.
    // Per key: auditId -> Set(responseKey), across the whole audit window,
    // feeding both the sparkline series and the last-vs-prev chip.
    type PerAudit = Map<string, Set<string>>;
    const domainSets = new Map<string, PerAudit>();
    const pageSets = new Map<string, PerAudit>();
    const bump = (map: Map<string, PerAudit>, key: string, auditId: string, rk: string) => {
      let e = map.get(key);
      if (!e) { e = new Map(); map.set(key, e); }
      let set = e.get(auditId);
      if (!set) { set = new Set(); e.set(auditId, set); }
      set.add(rk);
    };
    trendCitations.forEach(c => {
      if (!c.audit_id || !windowIds.has(c.audit_id) || !isCited(c)) return;
      const rk = c.audit_id + '-' + c.prompt_id + '-' + c.llm;
      if (c.domain) bump(domainSets, c.domain, c.audit_id, rk);
      if (c.page_url) bump(pageSets, normalizeUrl(c.page_url), c.audit_id, rk);
    });

    const countIn = (e: PerAudit | undefined, auditId: string) => {
      const set = e ? e.get(auditId) : undefined;
      return set ? set.size : 0;
    };
    const toTrend = (e?: PerAudit): TrendData => ({
      lastCount: countIn(e, last.id),
      lastTotal: answeredByAudit.get(last.id) || 0,
      prevCount: countIn(e, prev.id),
      prevTotal: answeredByAudit.get(prev.id) || 0,
      lastDate: last.created_at,
      prevDate: prev.created_at,
    });
    const toSeries = (e?: PerAudit): TrendPoint[] => candidates.map(a2 => {
      const total = answeredByAudit.get(a2.id) || 0;
      const count = countIn(e, a2.id);
      return { date: a2.created_at, count, total, share: total > 0 ? (count / total) * 100 : 0 };
    });

    return {
      ready: true as const,
      domainTrend: (d: string) => toTrend(domainSets.get(d)),
      pageTrend: (u: string) => toTrend(pageSets.get(u)),
      domainSeries: (d: string) => toSeries(domainSets.get(d)),
      pageSeries: (u: string) => toSeries(pageSets.get(u)),
      audits: candidates.map(a2 => ({
        id: a2.id, date: a2.created_at, total: answeredByAudit.get(a2.id) || 0,
      })),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trendCitations, trendResponses, auditsData, filters.llms]);

  const extractDomain = (url: string): string => {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  };

  // handleFilterChange / resetFilters / getActiveFiltersCount used to
  // live here and were wired to the inline Filter Card UI that has now
  // been replaced by the global DashboardFilterBar (in AppLayout). The
  // bar reads/writes filter state via the DashboardFiltersContext, so
  // every page just consumes `filters` from there and no longer owns
  // its own handlers / reset / counter.

  const fetchGroups = async () => {
    const { data } = await supabase
      .from('groups')
      .select('*')
      .order('name');
    // Deduplicate by name: keep first, but track all IDs so lookups work
    const groupMap = new Map<string, any>();
    for (const g of (data || [])) {
      const key = g.name.toLowerCase().trim();
      if (groupMap.has(key)) {
        const existing = groupMap.get(key);
        if (!existing._allIds) existing._allIds = [existing.id];
        existing._allIds.push(g.id);
      } else {
        groupMap.set(key, { ...g });
      }
    }
    setGroups(Array.from(groupMap.values()));
  };

  const fetchPromptGroups = async () => {
    if (!id) return;

    const { data } = await supabase
      .from('prompts')
      .select('prompt_group')
      .eq('project_id', id);

    if (data) {
      // Get unique prompt groups
      const uniqueGroups = Array.from(new Set(data.map(p => p.prompt_group))).sort();
      setPromptGroups(uniqueGroups);
    }
  };

  const fetchRunningAuditStatus = async () => {
    if (!id) return;

    try {
      const { data: runningAudit } = await supabase
        .from('audits')
        .select('id, status, current_step')
        .eq('project_id', id)
        .eq('status', 'running')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (runningAudit) {
        setRunningAuditInfo({
          status: runningAudit.status,
          currentStep: runningAudit.current_step || 'Processing...'
        });
        if (!runningAudits.includes(runningAudit.id)) {
          setRunningAudits(prev => [...prev, runningAudit.id]);
        }
      } else {
        setRunningAuditInfo(null);
        setRunningAudits([]);
      }
    } catch (error) {
      console.error('Error fetching running audit status:', error);
    }
  };

  const fetchProjectData = async (force = false) => {
    if (!id) return;

    const cacheKey = `${id}|${windowKey}`;
    if (force) {
      // A mutation just changed this project's data — every cached
      // window of it is stale.
      Array.from(WINDOW_CACHE.keys())
        .filter(k => k.startsWith(`${id}|`))
        .forEach(k => WINDOW_CACHE.delete(k));
    }

    // Full-page loader only on the first load of a project; a period
    // change keeps the previous window on screen behind a small
    // "reloading" indicator in the filter bar.
    if (!project || project.id !== id) {
      setLoading(true);
    } else {
      setWindowLoading(true);
    }
    const abortController = new AbortController();
    // Wide windows on dense projects legitimately take a while — the
    // old 15s guard aborted mid-pagination.
    const timeoutId = setTimeout(() => abortController.abort(), 60_000);
    perfStart('total');
    try {
      // Fetch project details (with cache for navigation back/forth)
      const cacheKey = `project:${id}:detail`;
      let projectData = queryCache.get<any>(cacheKey);
      if (!projectData) {
        const { data } = await supabase
          .from('projects')
          .select(`
            *,
            groups (name, color),
            project_groups (
              group_id,
              groups (id, name, color)
            ),
            brands (*),
            prompts (*)
          `)
          .eq('id', id)
          .single();
        projectData = data;
        if (projectData) {
          queryCache.set(cacheKey, projectData, 30000); // Cache 30s
        }
      }

      if (projectData) {
        setProject(projectData);
        setSelectedProject({ id: projectData.id, name: projectData.name });
        console.log('Fetched brands:', projectData.brands);
        console.log('Own brands:', projectData.brands?.filter(b => !b.is_competitor));
        console.log('Competitor brands:', projectData.brands?.filter(b => b.is_competitor));
        setPrompts(projectData.prompts || []);
        setBrands(projectData.brands?.filter(b => !b.is_competitor) || []);
        setCompetitors(projectData.brands?.filter(b => b.is_competitor) || []);
        
        const myBrandsList = projectData.brands?.filter(b => !b.is_competitor).map(b => b.brand_name) || [];
        const competitorsList = projectData.brands?.filter(b => b.is_competitor).map(b => b.brand_name) || [];
        
        setBrandsList(myBrandsList);
        setCompetitorsList(competitorsList);
        
        // Extract group IDs from junction table, fallback to legacy group_id
        const projectGroupIds = (projectData.project_groups || [])
          .map((pg: any) => pg.group_id)
          .filter(Boolean);
        const resolvedGroupIds = projectGroupIds.length > 0
          ? projectGroupIds
          : (projectData.group_id ? [projectData.group_id] : []);

        setEditFormData({
          name: projectData.name,
          domain: projectData.domain,
          country: projectData.country,
          domainMode: projectData.domain_mode,
          groupIds: resolvedGroupIds,
          myBrands: myBrandsList.join(', '),
          competitors: competitorsList.join(', '),
          prompts: projectData.prompts?.map(p =>
            p.prompt_group === 'General' ? p.prompt_text : `${p.prompt_group};${p.prompt_text}`
          ).join('\n') || '',
        });
      }

      // Serve the window from the in-memory cache when fresh. Entries
      // captured while an audit was running are never reused.
      if (!force) {
        const hit = WINDOW_CACHE.get(cacheKey);
        if (hit && Date.now() - hit.ts < WINDOW_CACHE_TTL &&
            !hit.allAudits.some((a: any) => a.status === 'running')) {
          setAllAuditsMeta(hit.allAudits);
          setAuditsData(hit.windowAudits);
          setRunningAuditInfo(null);
          setAvailableLlms(hit.availableLlms);
          setLlmResponses(hit.llmResponses);
          setCitations(hit.citations);
          setDataTruncated(hit.dataTruncated);
          return;
        }
      }

      perfStart('audits-meta');
      // Unified template: load EVERY audit inside the selected period,
      // not a fixed "last N". Audit meta for the whole project is cheap
      // (light columns) and also feeds the custom-range picker with all
      // dates that actually exist.
      const { data: allAudits, error: auditsError } = await supabase
        .from('audits')
        .select('id, created_at, status, current_step, llms')
        .eq('project_id', id)
        .order('created_at', { ascending: false });

      if (auditsError) {
        console.error('Error fetching audits:', auditsError);
        setLlmResponses([]);
        setCitations([]);
        setLoading(false);
        setWindowLoading(false);
        return;
      }

      perfEnd('audits-meta');
      setAllAuditsMeta(allAudits || []);

      // Keep only the audits inside the active period.
      const win = resolveDateWindow(globalFilters, null);
      const windowAudits = (allAudits || []).filter(a => {
        if (!win) return true;
        const t = new Date(a.created_at).getTime();
        return t >= win.start.getTime() && t <= win.end.getTime();
      });
      const recentAuditIds = windowAudits.map(a => a.id);

      // Store audits data for later use
      setAuditsData(windowAudits);

      // Check for running audits across the WHOLE project — a running
      // audit is running regardless of the period being viewed.
      const runningAudit = (allAudits || []).find(audit => audit.status === 'running');
      if (runningAudit) {
        setRunningAuditInfo({
          status: runningAudit.status,
          currentStep: runningAudit.current_step || 'Processing...'
        });
        if (!runningAudits.includes(runningAudit.id)) {
          setRunningAudits(prev => [...prev, runningAudit.id]);
        }
      } else {
        setRunningAuditInfo(null);
      }

      // Extract available LLMs from completed audits (whole project, so
      // the LLM filter offers stable options across period switches).
      const llmsSet = new Set<string>();
      (allAudits || []).forEach(audit => {
        if (audit.status === 'completed' && audit.llms) {
          audit.llms.forEach((llm: string) => llmsSet.add(llm));
        }
      });
      const llmsList = Array.from(llmsSet);
      setAvailableLlms(llmsList);

      // Set default LLM if not set and LLMs are available
      if (llmsList.length > 0 && !llmsList.includes(insightConfig.targetLlm)) {
        setInsightConfig(prev => ({
          ...prev,
          targetLlm: llmsList[0] as any,
        }));
      }

      // The page shell (header, tabs, filter bar) can render now — the
      // heavy window fetch below shows as widget skeletons instead of
      // the full-page loader, and never as "no data" empty states.
      setLoading(false);
      setWindowLoading(true);

      if (recentAuditIds.length === 0) {
        setLlmResponses([]);
        setCitations([]);
        setAuditDates([]);
        setDataTruncated(null);
      } else {
        // Fetch responses + citations for EVERY audit in the window,
        // paging past PostgREST's silent 1000-row cap. Audit ids go in
        // chunks of 60 so the in.() URL stays well under gateway
        // limits; chunks are walked newest-first so the safety cap
        // (dense-window runaway guard) keeps the most recent audits.
        //
        // Cost reduction: we drop only the heavy `raw_response_data`
        // (the big egress win). `all_sources` and `links_attached` MUST
        // stay — they are where several providers keep their citations:
        //   • Bing Copilot / Google AI / Grok → all_sources
        //   • SearchGPT / Gemini             → links_attached
        // Perplexity/SearchGPT also use the `citations` column + table.
        // Dropping all_sources/links_attached zeroed out Citation Rate,
        // Pages and Domains for Bing/Google/Grok.
        const RESPONSES_CAP = 10000;
        const CITATIONS_CAP = 60000;
        const PAGE = 1000;

        const fetchAllRows = async (
          buildQuery: (chunk: string[]) => any,
          cap: number,
          conc: number,
        ): Promise<{ rows: any[]; truncated: boolean }> => {
          // Chunk size: never more than 60 ids per in.() (URL length),
          // but split small windows into `conc` chunks so every worker
          // gets something to do (a single-chunk window would serialize
          // all page requests).
          const chunkSize = Math.min(60, Math.max(1, Math.ceil(recentAuditIds.length / conc)));
          const idChunks: string[][] = [];
          for (let i = 0; i < recentAuditIds.length; i += chunkSize) {
            idChunks.push(recentAuditIds.slice(i, i + chunkSize));
          }
          const rows: any[] = [];
          let truncated = false;
          let nextChunk = 0;
          const worker = async () => {
            while (nextChunk < idChunks.length) {
              if (rows.length >= cap) { truncated = true; return; }
              const chunk = idChunks[nextChunk++];
              for (let from = 0; ; from += PAGE) {
                const { data: page, error } = await buildQuery(chunk)
                  .order('id', { ascending: true })
                  .range(from, from + PAGE - 1)
                  .abortSignal(abortController.signal);
                if (error) throw error;
                rows.push(...(page || []));
                if (!page || page.length < PAGE) break;
                if (rows.length >= cap) { truncated = true; return; }
              }
            }
          };
          await Promise.all(
            Array.from({ length: Math.min(conc, idChunks.length) }, () => worker()),
          );
          return { rows, truncated };
        };

        // Re-attach the embed-shaped objects consumers expect
        // ({prompt_text, prompt_group} / {created_at, llms}) from data
        // already in memory instead of shipping them per row.
        const promptById = new Map<string, any>(
          ((projectData?.prompts || prompts || []) as any[]).map((p: any) =>
            [p.id, { prompt_text: p.prompt_text, prompt_group: p.prompt_group }]));
        const auditById = new Map<string, any>(
          (allAudits || []).map((a: any) =>
            [a.id, { created_at: a.created_at, llms: a.llms }]));
        const decorate = (rows: any[]) => {
          rows.forEach((row: any) => {
            row.prompts = promptById.get(row.prompt_id) || null;
            row.audits = auditById.get(row.audit_id) || null;
          });
          return rows;
        };
        // REST-fallback (or legacy v1 packed) response rows carry raw
        // answer_text but no flags — compute them once here so every
        // consumer downstream reads answered/mentionedKeys uniformly.
        const allBrandRows: any[] = (projectData?.brands as any[]) || [...brands, ...competitors];
        const brandMatchers = buildMatchers(allBrandRows);
        const enrichResponses = (rows: any[]) => {
          rows.forEach((row: any) => {
            if (row.answered === undefined) {
              row.answered = !!(row.answer_text && row.answer_text !== '');
            }
            if (!row.mentionedKeys) {
              row.mentionedKeys = row.answered && row.answer_text
                ? new Set(findBrandsInText(row.answer_text, allBrandRows, brandMatchers)
                    .map((b: any) => normalizeBrandKey(b.brand_name || '')))
                : new Set();
            }
          });
          return rows;
        };

        let anyTruncated = false;
        let respRows: any[] | null = null;
        let citRows: any[] | null = null;

        // Primary path: packed columnar RPCs — the whole window in 2
        // requests (dictionary-encoded tuples, unpacked into the exact
        // REST row shapes; equivalence verified field-by-field on prod).
        // A statement-timeout on a very dense slice makes
        // fetchPackedWindow split the audit set in half and recurse.
        perfStart('window-fetch');
        try {
          const fromIso = (win ? win.start : new Date(0)).toISOString();
          const toIso = (win ? win.end : new Date()).toISOString();
          const [respParts, citParts] = await Promise.all([
            fetchPackedWindow('project_responses_window_packed', id, fromIso, toIso,
              recentAuditIds, abortController.signal),
            fetchPackedWindow('project_citations_window_packed', id, fromIso, toIso,
              recentAuditIds, abortController.signal),
          ]);
          perfEnd('window-fetch');
          perfStart('unpack');
          respRows = respParts.flatMap(part => unpackResponses(part));
          citRows = citParts.flatMap((part, pi) => unpackCitations(part, `${pi}-`));
          perfEnd('unpack');
        } catch (packedErr) {
          console.warn('Packed window fetch failed — falling back to paged REST:', packedErr);
          respRows = null;
          citRows = null;
        }

        // Fallback: the chunked/paged REST path (also the safety net
        // right after a deploy while PostgREST's schema cache warms).
        if (!respRows || !citRows) {
          const [respResult, citResult] = await Promise.allSettled([
            fetchAllRows(chunk => supabase
              .from('llm_responses')
              .select(`
                id,
                audit_id,
                prompt_id,
                llm,
                answer_text,
                citations:citations_slim,
                all_sources,
                links_attached,
                web_search_query,
                sentiment_score,
                sentiment_label,
                answer_competitors,
                shopping_visible,
                is_map,
                ad_name:ads->>name,
                created_at
              `)
              .in('audit_id', chunk), RESPONSES_CAP, 3),
            fetchAllRows(chunk => supabase
              .from('citations')
              .select(`
                id,
                audit_id,
                prompt_id,
                llm,
                page_url,
                domain,
                citation_text,
                position,
                cited,
                sentiment_score,
                sentiment_label,
                checked_at
              `)
              .in('audit_id', chunk), CITATIONS_CAP, 6),
          ]);
          if (respResult.status === 'fulfilled') {
            respRows = respResult.value.rows;
            anyTruncated = anyTruncated || respResult.value.truncated;
          } else {
            console.error('Error fetching LLM responses:', respResult.reason);
            respRows = null;
          }
          if (citResult.status === 'fulfilled') {
            citRows = citResult.value.rows;
            anyTruncated = anyTruncated || citResult.value.truncated;
          } else {
            console.error('Error fetching citations:', citResult.reason);
            citRows = null;
          }
        }

        // Common post-processing for both paths: decorate, restore the
        // pre-pagination contract (newest first), publish.
        if (respRows) {
          respRows = enrichResponses(decorate(respRows)).sort((a, b) =>
            String(b.created_at || '').localeCompare(String(a.created_at || '')));
          setLlmResponses(respRows);
        } else {
          setLlmResponses([]);
        }
        if (citRows) {
          citRows = decorate(citRows).sort((a, b) =>
            String(b.checked_at || '').localeCompare(String(a.checked_at || '')));
          setCitations(citRows);
        } else {
          setCitations([]);
        }
        const truncatedInfo = anyTruncated ? { audits: windowAudits.length } : null;
        setDataTruncated(truncatedInfo);

        // Cache the completed window (only when BOTH fetches succeeded,
        // so a transient failure is retried on the next visit).
        if (respRows && citRows) {
          WINDOW_CACHE.set(cacheKey, {
            ts: Date.now(),
            allAudits: allAudits || [],
            windowAudits,
            availableLlms: llmsList,
            llmResponses: respRows,
            citations: citRows,
            dataTruncated: truncatedInfo,
          });
          while (WINDOW_CACHE.size > WINDOW_CACHE_MAX) {
            let oldestKey = '';
            let oldestTs = Infinity;
            WINDOW_CACHE.forEach((v, k) => {
              if (v.ts < oldestTs) { oldestTs = v.ts; oldestKey = k; }
            });
            WINDOW_CACHE.delete(oldestKey);
          }
        }
      }
      
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        console.warn('Data fetch timed out — database may be under heavy load');
      } else {
        console.error('Error fetching project data:', error);
      }
    } finally {
      clearTimeout(timeoutId);
      perfEnd('total');
      perfReport(`project window loaded (${id})`);
      setLoading(false);
      setWindowLoading(false);
    }
  };



  const handleRunAudit = (_projectId: string) => {
    // Local LLM dropdown was removed when the filter UI moved into
    // the global DashboardFilterBar — no need to close it from here.
    setShowRunAuditModal(true);
  };

  const handleAuditStarted = () => {
    // Modal will be closed by the audit started callback
  };

  const handleAuditStartedWithId = (auditId: string) => {
    console.log('Audit started with ID:', auditId);
    setRunningAudits(prev => [...prev, auditId]);
    setShowRunAuditModal(false);
  };

  const handleAuditCompleted = (auditId: string) => {
    console.log('ProjectDetail: Audit completed with ID:', auditId);
    setRunningAudits(prev => prev.filter(id => id !== auditId));
    setRunningAuditInfo(null);
    // Refresh project data to show updated results
    queryCache.invalidatePattern(`project:${id}`);
    queryCache.invalidate('projects:list');
    fetchProjectData(true);
  };

  // Insights functions
  const fetchCompletedReports = async () => {
    if (!id) return;

    const { data, error } = await supabase
      .from('insight_reports')
      .select('*')
      .eq('project_id', id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching reports:', error);
      return;
    }

    setCompletedReports(data || []);
  };

  useEffect(() => {
    if (activeTab === 'insights') {
      fetchCompletedReports();
    }
  }, [activeTab, id]);

  // Prompt groups feed the global filter bar's "Groups" dropdown, which is
  // visible on every dashboard tab. Load them on mount — previously this
  // only ran on the Insights tab, so the group filter never appeared on the
  // Overview (or any other tab) for projects that do have groups.
  useEffect(() => {
    fetchPromptGroups();
  }, [id]);

  useEffect(() => {
    if (project && brands.length > 0) {
      setInsightConfig(prev => ({
        ...prev,
        targetBrand: brands[0]?.brand_name || '',
      }));
    }
  }, [project, brands]);

  const handleGenerateReport = async () => {
    if (!selectedReportType || !insightConfig.targetBrand) {
      alert('Please select a report type and target brand');
      return;
    }

    setIsGeneratingReport(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Parse custom competitors
      const competitorsArray = insightConfig.customCompetitors
        ? insightConfig.customCompetitors.split(',').map(c => c.trim()).filter(c => c.length > 0)
        : null;

      // Create report record
      const { data: report, error: insertError } = await supabase
        .from('insight_reports')
        .insert({
          project_id: id,
          report_type: selectedReportType,
          target_brand: insightConfig.targetBrand,
          target_llm: insightConfig.targetLlm,
          report_language: insightConfig.reportLanguage,
          // Text column; joined for display in the reports list.
          group_id: insightConfig.groupIds.length > 0 ? insightConfig.groupIds.join(', ') : null,
          custom_competitors: competitorsArray,
          status: 'pending',
          created_by: user.id,
        })
        .select()
        .single();

      if (insertError) throw insertError;

      // Call edge function to generate report
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-insight-report`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            reportId: report.id,
            projectId: id,
            reportType: selectedReportType,
            targetBrand: insightConfig.targetBrand,
            targetLlm: insightConfig.targetLlm,
            reportLanguage: insightConfig.reportLanguage,
            groupIds: insightConfig.groupIds.length > 0 ? insightConfig.groupIds : null,
            customCompetitors: competitorsArray,
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        console.error('Report generation error:', errorData);
        throw new Error(errorData.error || 'Failed to generate report');
      }

      await fetchCompletedReports();
      setSelectedReportType(null);
    } catch (error: any) {
      console.error('Error generating report:', error);
      alert(`Failed to generate report: ${error.message || 'Please try again.'}`);
    } finally {
      setIsGeneratingReport(false);
    }
  };

  const handleRecalculateMetrics = async (projectId: string) => {
    setIsRecalculating(true);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/recalculate-metrics`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({ projectId }),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to recalculate metrics');
      }

      const result = await response.json();
      console.log('Metrics recalculated:', result);

      // Wait a moment for the materialized view to refresh
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Reload all project data to reflect the updated metrics
      queryCache.invalidatePattern(`project:${id}`);
      await fetchProjectData(true);

      alert('Metrics recalculated successfully! All charts have been updated.');
    } catch (error) {
      console.error('Error recalculating metrics:', error);
      alert('Failed to recalculate metrics. Please try again.');
    } finally {
      setIsRecalculating(false);
    }
  };

  const handleEditProject = () => {
    // Capture original values when opening the modal
    setOriginalEditValues({
      domain: editFormData.domain,
      domainMode: editFormData.domainMode,
      myBrands: editFormData.myBrands,
    });
    setShowEditModal(true);
  };

  const validateDomain = (domain: string): boolean => {
    const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9]?\.([a-zA-Z]{2,}|[a-zA-Z]{2,}\.[a-zA-Z]{2,})$/;
    return domainRegex.test(domain);
  };

  const handleBrandsChange = (value: string) => {
    setEditFormData({ ...editFormData, myBrands: value });
    const brands = value.split(',').map(b => b.trim()).filter(Boolean);
    setBrandsList(brands);
  };

  const handleCompetitorsChange = (value: string) => {
    setEditFormData({ ...editFormData, competitors: value });
    const competitors = value.split(',').map(c => c.trim()).filter(Boolean);
    setCompetitorsList(competitors);
  };

  const removeBrand = (index: number) => {
    const newBrands = brandsList.filter((_, i) => i !== index);
    setBrandsList(newBrands);
    setEditFormData({ ...editFormData, myBrands: newBrands.join(', ') });
  };

  const removeCompetitor = (index: number) => {
    const newCompetitors = competitorsList.filter((_, i) => i !== index);
    setCompetitorsList(newCompetitors);
    setEditFormData({ ...editFormData, competitors: newCompetitors.join(', ') });
  };

  const performProjectUpdate = async (shouldRecalculate: boolean = false) => {
    if (!id) return;

    try {
      // Update project (keep group_id for backward compat with first group)
      const { error: projectError } = await supabase
        .from('projects')
        .update({
          name: editFormData.name,
          domain: editFormData.domain,
          country: editFormData.country,
          domain_mode: editFormData.domainMode,
          group_id: editFormData.groupIds.length > 0 ? editFormData.groupIds[0] : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);

      if (projectError) throw projectError;

      // Update junction table: delete old + insert new
      const { error: deleteGroupsError } = await supabase
        .from('project_groups')
        .delete()
        .eq('project_id', id);

      if (deleteGroupsError) {
        console.error('Error deleting project groups:', deleteGroupsError);
      }

      if (editFormData.groupIds.length > 0) {
        const rows = editFormData.groupIds.map(gid => ({
          project_id: id,
          group_id: gid,
        }));
        const { error: insertGroupsError } = await supabase
          .from('project_groups')
          .insert(rows);
        if (insertGroupsError) {
          console.error('Error inserting project groups:', insertGroupsError);
        }
      }

      // Delete existing brands and competitors
      const { error: deleteBrandsError } = await supabase
        .from('brands')
        .delete()
        .eq('project_id', id);

      if (deleteBrandsError) throw deleteBrandsError;

      // Prepare new brands and competitors
      const brandsToInsert = [];

      // Add new brands
      if (editFormData.myBrands.trim()) {
        const brands = editFormData.myBrands.split(',').map(b => b.trim()).filter(Boolean);
        brandsToInsert.push(...brands.map(brand => ({
          project_id: id,
          brand_name: brand,
          is_competitor: false,
        })));
      }

      // Add new competitors
      if (editFormData.competitors.trim()) {
        const competitors = editFormData.competitors.split(',').map(c => c.trim()).filter(Boolean);
        brandsToInsert.push(...competitors.map(competitor => ({
          project_id: id,
          brand_name: competitor,
          is_competitor: true,
        })));
      }

      // Insert all brands at once
      if (brandsToInsert.length > 0) {
        const { error: insertBrandsError } = await supabase
          .from('brands')
          .insert(brandsToInsert);

        if (insertBrandsError) throw insertBrandsError;
      }

      // Diff-update prompts. NEVER delete-and-reinsert everything: the
      // llm_responses/citations FKs are ON DELETE SET NULL, so recreating a
      // prompt under a new id orphans ALL historical answers and citations
      // (by-prompt-group widgets go empty). Keep rows whose text is
      // unchanged, update their group if needed, insert only new texts and
      // delete only removed ones.
      const parsedPrompts = editFormData.prompts.trim()
        ? editFormData.prompts
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean)
            .map(line => {
              const [maybeGroup, ...rest] = line.split(';');
              if (rest.length > 0) {
                const text = rest.join(';').trim();
                return { group: maybeGroup.trim() || 'General', text };
              }
              return { group: 'General', text: line };
            })
        : [];

      const { data: existingPrompts, error: existingPromptsError } = await supabase
        .from('prompts')
        .select('id, prompt_text, prompt_group')
        .eq('project_id', id);

      if (existingPromptsError) throw existingPromptsError;

      const byText = new Map<string, any[]>();
      (existingPrompts || []).forEach(p => {
        const key = (p.prompt_text || '').trim();
        if (!byText.has(key)) byText.set(key, []);
        byText.get(key)!.push(p);
      });

      const keptIds = new Set<string>();
      const promptsToInsert: any[] = [];
      for (const prompt of parsedPrompts) {
        const candidates = (byText.get(prompt.text) || []).filter(p => !keptIds.has(p.id));
        if (candidates.length > 0) {
          const existing = candidates[0];
          keptIds.add(existing.id);
          if (existing.prompt_group !== prompt.group) {
            const { error: updateGroupError } = await supabase
              .from('prompts')
              .update({ prompt_group: prompt.group })
              .eq('id', existing.id);
            if (updateGroupError) throw updateGroupError;
          }
        } else {
          promptsToInsert.push({
            project_id: id,
            prompt_text: prompt.text,
            prompt_group: prompt.group,
          });
        }
      }

      const promptIdsToDelete = (existingPrompts || [])
        .filter(p => !keptIds.has(p.id))
        .map(p => p.id);

      if (promptIdsToDelete.length > 0) {
        const { error: deletePromptsError } = await supabase
          .from('prompts')
          .delete()
          .in('id', promptIdsToDelete);
        if (deletePromptsError) throw deletePromptsError;
      }

      if (promptsToInsert.length > 0) {
        const { error: insertPromptsError } = await supabase
          .from('prompts')
          .insert(promptsToInsert);
        if (insertPromptsError) throw insertPromptsError;
      }

      // Close modals
      setShowEditModal(false);
      setShowRecalculateConfirm(false);

      // Recalculate metrics if requested (this will also refresh project data)
      if (shouldRecalculate) {
        await handleRecalculateMetrics(id);
      } else {
        // Refresh project data only if we didn't recalculate (since recalculate already does it)
        queryCache.invalidatePattern(`project:${id}`);
        queryCache.invalidate('projects:list');
        await fetchProjectData(true);
      }
    } catch (error) {
      console.error('Error updating project:', error);
      alert('Failed to update project. Please try again.');
    }
  };

  const handleSaveProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;

    // Validate domain
    if (!validateDomain(editFormData.domain)) {
      alert('Please enter a valid domain format (e.g., example.com)');
      return;
    }

    // Check if domain, domain mode, or brands have changed
    const domainChanged = editFormData.domain !== originalEditValues.domain;
    const domainModeChanged = editFormData.domainMode !== originalEditValues.domainMode;
    const brandsChanged = editFormData.myBrands !== originalEditValues.myBrands;

    // If any of these changed, ask user about recalculation
    if (domainChanged || domainModeChanged || brandsChanged) {
      setShowRecalculateConfirm(true);
    } else {
      // No relevant changes, proceed with update
      await performProjectUpdate(false);
    }
  };

  const handleRecalculateConfirmYes = async () => {
    await performProjectUpdate(true);
  };

  const handleRecalculateConfirmNo = async () => {
    await performProjectUpdate(false);
  };

  const handleDeleteReport = async () => {
    if (!reportToDelete) return;

    try {
      const { error } = await supabase
        .from('insight_reports')
        .delete()
        .eq('id', reportToDelete);

      if (error) throw error;

      setCompletedReports(prevReports =>
        prevReports.filter(report => report.id !== reportToDelete)
      );

      setShowDeleteConfirmation(false);
      setReportToDelete(null);
    } catch (error) {
      console.error('Error deleting report:', error);
      alert('Failed to delete report. Please try again.');
    }
  };


  const getTopCompetitorDomains = () => {
    if (!filteredCitations.length) return [];
    

    // Get project domain for exclusion
    const projectDomain = project?.domain?.toLowerCase().replace(/^www\./, '');

    // Count citations by domain (excluding project domain)
    const domainCounts = filteredCitations.reduce((acc, citation) => {
      const domain = citation.domain?.toLowerCase().replace(/^www\./, '');
      if (domain && domain !== projectDomain) {
        acc[domain] = (acc[domain] || 0) + 1;
      }
      return acc;
    }, {} as Record<string, number>);
    
    // Sort by count and return top 10
    return Object.entries(domainCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 15)
      .map(([domain, count]) => ({ domain, count }));
  };

  const getCitationRateByPromptGroup = () => {
    if (!project?.domain) return [];

    // Get unique prompt groups
    const promptGroups = [...new Set(prompts.map(p => p.prompt_group))];

    return promptGroups.map(group => {
      // Get all prompts in this group
      const groupPromptIds = prompts
        .filter(p => p.prompt_group === group)
        .map(p => p.id);

      // Get LLM responses for this group
      const groupResponses = filteredLlmResponses.filter(response =>
        groupPromptIds.includes(response.prompt_id)
      );

      // Get citations for this group (excluding cited=false)
      const groupCitations = filteredCitations.filter(citation =>
        groupPromptIds.includes(citation.prompt_id) && citation.cited !== false
      );

      // Track which responses cited the project domain
      const citedResponseIds = new Set<string>();
      const projectDomain = project.domain.toLowerCase().replace(/^www\./, '');
      const domainMode = project.domain_mode || 'exact';

      // Check citations from citations table
      groupCitations
        .filter(citation => {
          if (!citation.domain) return false;
          const citationDomain = citation.domain.toLowerCase().replace(/^www\./, '');

          if (domainMode === 'subdomains') {
            return citationDomain === projectDomain || citationDomain.endsWith(`.${projectDomain}`);
          } else {
            return citationDomain === projectDomain;
          }
        })
        .forEach(citation => {
          citedResponseIds.add(`${citation.audit_id}-${citation.prompt_id}-${citation.llm}`);
        });

      // Check links_attached field for SearchGPT
      groupResponses
        .filter(r => r.llm === 'searchgpt' && r.links_attached && Array.isArray(r.links_attached))
        .forEach(response => {
          try {
            const hasProjectDomain = response.links_attached.some((link: any) => {
              if (!link.url) return false;

              try {
                const urlObj = new URL(link.url);
                const linkDomain = urlObj.hostname.toLowerCase().replace(/^www\./, '');

                if (domainMode === 'subdomains') {
                  return linkDomain === projectDomain || linkDomain.endsWith(`.${projectDomain}`);
                } else {
                  return linkDomain === projectDomain;
                }
              } catch {
                return false;
              }
            });

            if (hasProjectDomain) {
              citedResponseIds.add(`${response.audit_id}-${response.prompt_id}-${response.llm}`);
            }
          } catch (error) {
            console.error('Error parsing links_attached:', error);
          }
        });

      // Check all_sources field for responses
      groupResponses
        .filter(r => r.all_sources)
        .forEach(response => {
          try {
            const sources = Array.isArray(response.all_sources) ? response.all_sources : JSON.parse(response.all_sources);

            const hasProjectDomain = sources.some((source: any) => {
              if (!source.domain && !source.url) return false;

              let sourceDomain = '';
              if (source.domain) {
                sourceDomain = source.domain.toLowerCase().replace(/^www\./, '');
              } else if (source.url) {
                try {
                  const urlObj = new URL(source.url);
                  sourceDomain = urlObj.hostname.toLowerCase().replace(/^www\./, '');
                } catch {
                  return false;
                }
              }

              if (domainMode === 'subdomains') {
                return sourceDomain === projectDomain || sourceDomain.endsWith(`.${projectDomain}`);
              } else {
                return sourceDomain === projectDomain;
              }
            });

            if (hasProjectDomain) {
              citedResponseIds.add(`${response.audit_id}-${response.prompt_id}-${response.llm}`);
            }
          } catch (error) {
            console.error('Error parsing all_sources:', error);
          }
        });

      // Calculate citation rate based on responses, not raw citations
      const totalResponses = groupResponses.length;
      const citationRate = totalResponses > 0 ?
        Math.round((citedResponseIds.size / totalResponses) * 100) : 0;

      const result: any = {
        group: group === 'General' ? 'General' : group,
        citationRate,
        totalCitations: totalResponses,
        domainCitations: citedResponseIds.size
      };

      // Add citation rates for selected competitor domains
      selectedCompetitorDomains.forEach((competitorDomain) => {
        const competitorCitedIds = new Set<string>();

        // Check citations table
        groupCitations
          .filter(citation => {
            const domain = citation.domain?.toLowerCase().replace(/^www\./, '');
            const competitor = competitorDomain.toLowerCase().replace(/^www\./, '');
            return domain === competitor || domain?.endsWith(`.${competitor}`);
          })
          .forEach(citation => {
            competitorCitedIds.add(`${citation.audit_id}-${citation.prompt_id}-${citation.llm}`);
          });

        // Check all_sources
        groupResponses
          .filter(r => r.all_sources)
          .forEach(response => {
            try {
              const sources = Array.isArray(response.all_sources) ? response.all_sources : JSON.parse(response.all_sources);
              const competitor = competitorDomain.toLowerCase().replace(/^www\./, '');

              const hasCompetitorDomain = sources.some((source: any) => {
                if (!source.domain && !source.url) return false;

                let sourceDomain = '';
                if (source.domain) {
                  sourceDomain = source.domain.toLowerCase().replace(/^www\./, '');
                } else if (source.url) {
                  try {
                    const urlObj = new URL(source.url);
                    sourceDomain = urlObj.hostname.toLowerCase().replace(/^www\./, '');
                  } catch {
                    return false;
                  }
                }

                return sourceDomain === competitor || sourceDomain.endsWith(`.${competitor}`);
              });

              if (hasCompetitorDomain) {
                competitorCitedIds.add(`${response.audit_id}-${response.prompt_id}-${response.llm}`);
              }
            } catch (error) {
              console.error('Error parsing all_sources:', error);
            }
          });

        const competitorRate = totalResponses > 0 ?
          Math.round((competitorCitedIds.size / totalResponses) * 100) : 0;

        result[competitorDomain] = competitorRate;
      });

      return result;
    }).filter(item => item.totalCitations > 0); // Only show groups with responses
  };

  const exportPromptsToExcel = () => {
    const exportData: any[] = [];
    const myBrands = brands;
    const projectBrands = myBrands.map(b => b.brand_name);

    prompts
      .filter(prompt =>
        filters.promptGroups.length === 0 || filters.promptGroups.includes(prompt.prompt_group)
      )
      .forEach(prompt => {
        const llmResponsesForPrompt = filteredLlmResponses.filter(response =>
          response.prompt_id === prompt.id
        );

        // Check if project brand is mentioned
        const isProjectBrandMentioned = llmResponsesForPrompt.some(response =>
            rowMentionsAnyName(response, projectBrands));

        // Get citations data by LLM
        const citationsByLlm: Record<string, number> = {};
        ['searchgpt', 'perplexity', 'gemini'].forEach(llm => {
          const llmCitations = filteredCitations.filter(citation =>
            citation.prompt_id === prompt.id &&
            citation.llm === llm &&
            citation.cited === true
          );
          citationsByLlm[llm] = llmCitations.length;
        });

        const webSearchQueries = llmResponsesForPrompt
          .filter(response => response.web_search_query)
          .flatMap(response => {
            let queries = response.web_search_query;

            // Clean up the query format
            if (typeof queries === 'string') {
              queries = queries.replace(/^\[['"]?|['"]?\]$/g, '').replace(/^['"]|['"]$/g, '');
              return [{
                query: queries,
                llm: response.llm
              }];
            } else if (Array.isArray(queries)) {
              // If it's an array, create separate entries for each query
              return queries.map(q => ({
                query: q,
                llm: response.llm
              }));
            }

            return [];
          });

        const uniqueQueries = Array.from(
          new Map(webSearchQueries.map(item => [item.query + item.llm, item])).values()
        );

        if (uniqueQueries.length === 0) {
          // If no web queries, add one row with empty query
          exportData.push({
            Prompt: prompt.prompt_text,
            Group: prompt.prompt_group,
            'Brand Mentioned': isProjectBrandMentioned ? 'Yes' : 'No',
            'SearchGPT Citations': citationsByLlm.searchgpt || 0,
            'Perplexity Citations': citationsByLlm.perplexity || 0,
            'Gemini Citations': citationsByLlm.gemini || 0,
            'Total Citations': (citationsByLlm.searchgpt || 0) + (citationsByLlm.perplexity || 0) + (citationsByLlm.gemini || 0),
            LLM: '',
            'Web queries': ''
          });
        } else {
          // Create a row for each web query
          uniqueQueries.forEach(item => {
            exportData.push({
              Prompt: prompt.prompt_text,
              Group: prompt.prompt_group,
              'Brand Mentioned': isProjectBrandMentioned ? 'Yes' : 'No',
              'SearchGPT Citations': citationsByLlm.searchgpt || 0,
              'Perplexity Citations': citationsByLlm.perplexity || 0,
              'Gemini Citations': citationsByLlm.gemini || 0,
              'Total Citations': (citationsByLlm.searchgpt || 0) + (citationsByLlm.perplexity || 0) + (citationsByLlm.gemini || 0),
              LLM: item.llm,
              'Web queries': item.query
            });
          });
        }
      });

    // Create workbook and worksheet
    const ws = xlsxUtils.json_to_sheet(exportData);
    const wb = xlsxUtils.book_new();
    xlsxUtils.book_append_sheet(wb, ws, 'Prompts Report');

    // Generate filename with project name and date
    const filename = `${project?.name || 'project'}_prompts_${new Date().toISOString().split('T')[0]}.xlsx`;

    // Download file
    xlsxWriteFile(wb, filename);
  };

  const exportPagesToExcel = () => {
    const exportData = getFilteredPageStats().map(page => ({
      'Title': page.title || '',
      'Page URL': page.page_url,
      'Domain': page.domain,
      'Category': page.category || 'Unknown',
      'Brands': (page.pageBrands || []).map((b: any) => b.brand_name).join(', '),
      'Citations (Cited)': page.mentions,
      'Trend vs prev audit (pt)': page.trend ? Number(page.trendDelta.toFixed(1)) : '',
      'Last audit (cited / answers)': page.trend ? page.trend.lastCount + '/' + page.trend.lastTotal : '',
      'Previous audit (cited / answers)': page.trend ? page.trend.prevCount + '/' + page.trend.prevTotal : '',
      'Citations (More)': page.more_count || 0,
      'Total Citations': page.mentions + (page.more_count || 0),
      'All Sources': page.all_sources_count || 0
    }));

    // Create workbook and worksheet
    const ws = xlsxUtils.json_to_sheet(exportData);
    const wb = xlsxUtils.book_new();
    xlsxUtils.book_append_sheet(wb, ws, 'Pages');

    // Generate filename with project name and date
    const filename = `${project?.name || 'project'}_pages_${new Date().toISOString().split('T')[0]}.xlsx`;

    // Download file
    xlsxWriteFile(wb, filename);
  };

  const exportDomainsToExcel = () => {
    const exportData = getFilteredDomainStats().map((domain: any) => ({
      'Domain': domain.domain,
      'Category': domain.category || 'Unknown',
      'Citations (Cited)': domain.mentions,
      'Trend vs prev audit (pt)': domain.trend ? Number(domain.trendDelta.toFixed(1)) : '',
      'Last audit (cited / answers)': domain.trend ? domain.trend.lastCount + '/' + domain.trend.lastTotal : '',
      'Previous audit (cited / answers)': domain.trend ? domain.trend.prevCount + '/' + domain.trend.prevTotal : '',
      'Cited Prompts': domain.citedPrompts || 0,
      '% of Cited Prompts': `${domain.citedPromptsPercentage}%`,
      'Cited Pages': domain.citedPages || 0,
      'Citations (More)': domain.citationsMore || 0,
      'Total Citations': domain.totalCitations || 0,
      'Audits': domain.audits || 0
    }));

    // Create workbook and worksheet
    const ws = xlsxUtils.json_to_sheet(exportData);
    const wb = xlsxUtils.book_new();
    xlsxUtils.book_append_sheet(wb, ws, 'Domains');

    // Generate filename with project name and date
    const filename = `${project?.name || 'project'}_domains_${new Date().toISOString().split('T')[0]}.xlsx`;

    // Download file
    xlsxWriteFile(wb, filename);
  };

  // Global Excel export (button next to "Run Audit").
  //
  // Exports EVERY prompt of EVERY audit within the currently-selected
  // filter period — not just the last audit. Because the page only keeps
  // the most recent audits in memory, this does its own complete fetch
  // for the period (paginated). Honors the active LLM / prompt-group /
  // sentiment filters. One sheet per LLM; one row per (audit × prompt).
  const exportAuditDataByLLM = async () => {
    if (!id || exporting) return;
    setExporting(true);
    try {
      // 1. Resolve the date window from the global filters. null = all time.
      const win = resolveDateWindow(globalFilters, lastAuditDate || null);

      // 2. Audits in the window (id + when it ran).
      let auditsQuery = supabase
        .from('audits')
        .select('id, created_at')
        .eq('project_id', id)
        .eq('status', 'completed')
        .order('created_at', { ascending: false });
      if (win) {
        auditsQuery = auditsQuery
          .gte('created_at', win.start.toISOString())
          .lte('created_at', win.end.toISOString());
      }
      const { data: auditsList } = await auditsQuery;
      if (!auditsList || auditsList.length === 0) {
        alert('No completed audits in the selected period.');
        return;
      }
      const auditIds = auditsList.map(a => a.id);
      const auditDateById = new Map<string, string>(
        auditsList.map(a => [a.id, a.created_at]),
      );

      // 3. All llm_responses for those audits (paginated past PostgREST's
      //    1000-row cap).
      const PAGE = 1000;
      const responses: any[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data: page, error } = await supabase
          .from('llm_responses')
          .select(`
            id, audit_id, prompt_id, llm, answer_text, web_search_query,
            answer_competitors, citations, all_sources, links_attached,
            sentiment_label,
            prompts (prompt_text, prompt_group)
          `)
          .in('audit_id', auditIds)
          .order('audit_id', { ascending: false })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        if (!page || page.length === 0) break;
        responses.push(...page);
        if (page.length < PAGE) break;
      }

      // 4. Apply the active LLM / prompt-group / sentiment filters.
      const llmSet = globalFilters.llms.length > 0 ? new Set(globalFilters.llms) : null;
      const pgSet = globalFilters.promptGroups.length > 0 ? new Set(globalFilters.promptGroups) : null;
      const filtered = responses.filter(r => {
        if (llmSet && !llmSet.has(r.llm)) return false;
        if (pgSet) {
          const g = r.prompts?.prompt_group;
          if (!g || !pgSet.has(g)) return false;
        }
        if (globalFilters.sentiment !== 'all' && r.sentiment_label !== globalFilters.sentiment) return false;
        return true;
      });

      // helpers ────────────────────────────────────────────────────────
      const fanOut = (r: any): string => {
        const set = new Set<string>();
        const raw = r.web_search_query;
        if (Array.isArray(raw)) raw.forEach((q: any) => q && set.add(String(q)));
        else if (typeof raw === 'string' && raw.trim()) {
          const t = raw.trim();
          if (t.startsWith('[')) {
            try { JSON.parse(t).forEach((q: any) => q && set.add(String(q))); }
            catch { set.add(t); }
          } else set.add(t);
        }
        return Array.from(set).join('; ');
      };
      const asArray = (v: any) => {
        if (!v) return [];
        if (Array.isArray(v)) return v;
        try { return JSON.parse(v); } catch { return []; }
      };
      const sourcesText = (r: any): string => {
        const set = new Set<string>();
        asArray(r.all_sources).forEach((s: any) => {
          const u = typeof s === 'string' ? s : s?.url;
          if (u) set.add(u);
        });
        return Array.from(set).join('; ');
      };
      const brandsText = (r: any): string => {
        const brands = r.answer_competitors?.brands;
        if (!Array.isArray(brands)) return '';
        return brands.map((b: any) => b?.name).filter(Boolean).join('; ');
      };
      const citationCols = (r: any) => {
        const cites = asArray(r.citations);
        const url = (c: any) => c?.url || c?.page_url;
        const cited = new Set<string>();
        const more = new Set<string>();
        if (r.llm === 'searchgpt') {
          cites.filter((c: any) => c?.cited === true).forEach((c: any) => url(c) && cited.add(url(c)));
          asArray(r.links_attached).forEach((l: any) => l?.url && cited.add(l.url));
        } else {
          cites.filter((c: any) => c?.cited === true || c?.cited == null).forEach((c: any) => url(c) && cited.add(url(c)));
        }
        cites.filter((c: any) => c?.cited === false).forEach((c: any) => url(c) && more.add(url(c)));
        let citedText = Array.from(cited).join('; ');
        const allSrc = sourcesText(r);
        if (!citedText && r.llm !== 'searchgpt' && allSrc) citedText = allSrc; // fallback
        return { citedText, moreText: Array.from(more).join('; '), allSrc };
      };

      // 5. Build one sheet per LLM, one row per (audit × prompt).
      const byLlm = filtered.reduce((acc: Record<string, any[]>, r: any) => {
        const llm = r.llm || 'unknown';
        (acc[llm] = acc[llm] || []).push(r);
        return acc;
      }, {});

      const wb = xlsxUtils.book_new();
      let totalRows = 0;
      Object.entries(byLlm).forEach(([llm, rows]) => {
        const data = (rows as any[])
          .map(r => {
            const created = auditDateById.get(r.audit_id) || '';
            const { citedText, moreText, allSrc } = citationCols(r);
            return {
              'audit_id': r.audit_id,
              'datetime': created ? new Date(created).toLocaleString() : '',
              'prompt': r.prompts?.prompt_text || '',
              'group': r.prompts?.prompt_group || '',
              'fan-out': fanOut(r),
              'brands': brandsText(r),
              'citations': citedText,
              'citations (more)': moreText,
              'all sources': allSrc,
              'answer': r.answer_text || '',
            };
          })
          .filter(row => row.prompt.trim() !== '')
          // newest audit first, then by prompt
          .sort((a, b) => (a.datetime < b.datetime ? 1 : a.datetime > b.datetime ? -1 : a.prompt.localeCompare(b.prompt)));
        totalRows += data.length;
        // Sheet names are capped at 31 chars by Excel.
        const ws = xlsxUtils.json_to_sheet(data);
        xlsxUtils.book_append_sheet(wb, ws, llm.slice(0, 31));
      });

      if (totalRows === 0) {
        alert('No rows match the current filters in the selected period.');
        return;
      }

      const periodLabel = win
        ? `${win.start.toISOString().slice(0, 10)}_to_${win.end.toISOString().slice(0, 10)}`
        : 'all';
      const filename = `${project?.name || 'project'}_audits_${periodLabel}.xlsx`;
      xlsxWriteFile(wb, filename);
    } catch (e: any) {
      console.error('Export failed:', e);
      alert(`Export failed: ${e?.message || e}`);
    } finally {
      setExporting(false);
    }
  };

  const getFilteredPromptCitationsByAudit = (promptId: string, auditDate: string) => {
    const auditCitations = citationsByAudit[auditDate] || [];
    const filteredAuditCitations = auditCitations.filter(c => c.prompt_id === promptId);
    
    // Apply current filters to audit citations
    let filtered = [...filteredAuditCitations];
    
    // Apply LLM filter
    if (filters.llms !== 'all') {
      filtered = filtered.filter(citation => citation.llm === filters.llms);
    }
    
    // Apply prompt group filter
    if (filters.promptGroups.length > 0) {
      filtered = filtered.filter(citation =>
        citation.prompts?.prompt_group && filters.promptGroups.includes(citation.prompts.prompt_group)
      );
    }
    
    // Apply sentiment filter
    if (filters.sentiment !== 'all') {
      filtered = filtered.filter(citation => 
        citation.sentiment_label === filters.sentiment
      );
    }
    
    return filtered;
  };

  const hasFilteredProjectDomainCitation = (citations: any[], llm: string) => {
    if (!project?.domain) return false;

    const projectDomain = project.domain.toLowerCase().replace(/^www\./, '');
    const domainMode = project.domain_mode || 'exact';

    return citations.some(citation => {
      if (!citation.llm || citation.llm !== llm || !citation.domain) return false;

      // For SearchGPT: only show icon if cited=true
      // For other LLMs: show icon if cited=true or cited=null
      if (llm === 'searchgpt' && citation.cited !== true) {
        return false;
      }

      const citationDomain = citation.domain.toLowerCase().replace(/^www\./, '');

      if (domainMode === 'subdomains') {
        return citationDomain === projectDomain || citationDomain.endsWith(`.${projectDomain}`);
      } else {
        return citationDomain === projectDomain;
      }
    });
  };

  // Sort handler functions
  const handlePageSort = (column: string) => {
    setPageSortConfig(prev => ({
      column,
      direction: prev.column === column && prev.direction === 'desc' ? 'asc' : 'desc'
    }));
  };

  const handleDomainSort = (column: string) => {
    setDomainSortConfig(prev => ({
      column,
      direction: prev.column === column && prev.direction === 'desc' ? 'asc' : 'desc'
    }));
  };

  const renderSortIcon = (column: string, sortConfig: { column: string; direction: 'asc' | 'desc' }) => {
    if (sortConfig.column !== column) {
      return <ArrowUpDown className="w-4 h-4 opacity-30" />;
    }
    return sortConfig.direction === 'asc' ?
      <ArrowUp className="w-4 h-4" /> :
      <ArrowDown className="w-4 h-4" />;
  };

  // (normalizeUrl is defined once near the citation dedupe code above —
  // the duplicate that used to live here was removed; both consumers
  // now share the single normalizer for consistent URL grouping.)

  const getFilteredPageStats = () => {
    const pageStats = filteredCitations.reduce((acc, citation) => {
      if (!citation.page_url || !citation.domain) return acc;

      // Use normalized URL as key for grouping
      const normalizedUrl = normalizeUrl(citation.page_url);

      if (!acc[normalizedUrl]) {
        acc[normalizedUrl] = {
          page_url: citation.page_url, // Keep one original URL for display
          domain: citation.domain,
          title: null,
          mentions: 0,
          more_count: 0,
          all_sources_count: 0,
          sentimentSum: 0,
          sentimentCount: 0,
          firstSeen: citation.checked_at,
          lastSeen: citation.checked_at,
        };
      }

      // citation_text usually carries the cited page's title — keep the
      // first real one (skip placeholders and raw URLs) for display.
      if (!acc[normalizedUrl].title) {
        const text = citation.citation_text;
        if (text && text !== 'No description available' && text !== 'No description'
            && !/^https?:\/\//i.test(text)) {
          acc[normalizedUrl].title = text;
        }
      }

      // Apply counting logic based on current filter
      // When filter is SearchGPT: only count cited=true
      // When filter is other LLMs or All: count cited=true or null/undefined
      let shouldCountAsCited = false;
      if (filters.llms === 'searchgpt') {
        // SearchGPT filter: only count cited=true
        shouldCountAsCited = citation.cited === true;
      } else if (filters.llms === 'all') {
        // All LLMs: apply per-LLM rules for proper summation
        shouldCountAsCited = citation.llm === 'searchgpt'
          ? citation.cited === true
          : (citation.cited === true || citation.cited == null); // Use == to catch both null and undefined
      } else {
        // Perplexity or Gemini: count cited=true or null/undefined
        shouldCountAsCited = (citation.cited === true || citation.cited == null); // Use == to catch both null and undefined
      }

      if (shouldCountAsCited) {
        acc[normalizedUrl].mentions++;
      }

      // Count "more" (cited=false) based on LLM filter
      let shouldCountAsMore = false;
      if (filters.llms === 'searchgpt') {
        // SearchGPT filter: only count SearchGPT citations with cited=false
        shouldCountAsMore = citation.llm === 'searchgpt' && (citation.cited === false || citation.cited === 'false');
      } else if (filters.llms === 'all') {
        // All LLMs: count all citations with cited=false (mainly SearchGPT)
        shouldCountAsMore = (citation.cited === false || citation.cited === 'false');
      } else {
        // Other LLMs (Perplexity, Gemini): count their citations with cited=false
        shouldCountAsMore = (citation.cited === false || citation.cited === 'false');
      }

      if (shouldCountAsMore) {
        acc[normalizedUrl].more_count++;
      }

      if (citation.sentiment_score !== null) {
        acc[normalizedUrl].sentimentSum += citation.sentiment_score;
        acc[normalizedUrl].sentimentCount++;
      }

      if (new Date(citation.checked_at) < new Date(acc[normalizedUrl].firstSeen)) {
        acc[normalizedUrl].firstSeen = citation.checked_at;
      }
      if (new Date(citation.checked_at) > new Date(acc[normalizedUrl].lastSeen)) {
        acc[normalizedUrl].lastSeen = citation.checked_at;
      }

      return acc;
    }, {} as any);

    // Count all_sources occurrences for each page
    filteredLlmResponses.forEach(response => {
      if (response.all_sources && Array.isArray(response.all_sources)) {
        response.all_sources.forEach((source: any) => {
          const sourceUrl = typeof source === 'string' ? source : source?.url;
          if (sourceUrl) {
            const normalizedSourceUrl = normalizeUrl(sourceUrl);
            if (pageStats[normalizedSourceUrl]) {
              pageStats[normalizedSourceUrl].all_sources_count++;
            }
          }
        });
      }
    });

    const pages = Object.values(pageStats).map((p: any) => {
      const pb = pageBrandIndex.get(normalizeUrl(p.page_url));
      return {
        ...p,
        category: getDomainDisplayCategory(p.domain),
        pageBrands: pb?.exact || [],
        pageBrandsComention: pb?.comention || [],
        brandsCount: pb?.exact.length || 0,
        trend: auditTrendIndex.ready ? auditTrendIndex.pageTrend(normalizeUrl(p.page_url)) : null,
        sparkSeries: auditTrendIndex.ready ? auditTrendIndex.pageSeries(normalizeUrl(p.page_url)) : null,
      };
    }).map((p: any) => ({ ...p, trendDelta: p.trend ? trendDelta(p.trend) : 0 }));

    // Apply sorting
    return pages.sort((a: any, b: any) => {
      let aValue = a[pageSortConfig.column];
      let bValue = b[pageSortConfig.column];

      // Handle string comparisons (for URLs and domains)
      if (typeof aValue === 'string' && typeof bValue === 'string') {
        aValue = aValue.toLowerCase();
        bValue = bValue.toLowerCase();
      }

      if (aValue < bValue) return pageSortConfig.direction === 'asc' ? -1 : 1;
      if (aValue > bValue) return pageSortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  };


  // Project-relative overlay on top of the global category: the project's own
  // domain (and domains matching own-brand names) show as "Own Brand", domains
  // matching competitor brand names as "Competitor". Falls back to the stored
  // global category, then "Unknown".
  // Result cache for getDomainDisplayCategory — the same few thousand
  // domains are classified by several widgets (sources pie walks all
  // ~50k citations), and every classification does NFD normalization
  // against the brand lists. Invalidated when any input changes.
  const domainCategoryCache = useMemo(
    () => new Map<string, string>(),
    [project?.domain, brands, competitors, domainCategoryMap],
  );

  const getDomainDisplayCategory = (rawDomain: string): string => {
    const cached = domainCategoryCache.get(rawDomain);
    if (cached !== undefined) return cached;

    const compute = (): string => {
      const domain = (rawDomain || '').toLowerCase().replace(/^www\./, '');
      if (!domain) return 'Unknown';

      if (project?.domain) {
        const projectDomain = project.domain.toLowerCase().replace(/^www\./, '');
        if (domain === projectDomain || domain.endsWith(`.${projectDomain}`)) {
          return 'Own Brand';
        }
      }

      // Match the registrable label ("credit-agricole" in credit-agricole.fr)
      // against normalized brand names ("Crédit Agricole" → "creditagricole").
      const normalize = normalizeBrandKey;
      const labels = domain.split('.');
      const secondLevel = normalize(labels.length >= 2 ? labels[labels.length - 2] : labels[0]);
      if (secondLevel.length >= 3) {
        if (brands.some(b => normalize(b.brand_name || '') === secondLevel)) return 'Own Brand';
        if (competitors.some(b => normalize(b.brand_name || '') === secondLevel)) return 'Competitor';
      }

      return domainCategoryMap[rawDomain] || domainCategoryMap[domain] || 'Unknown';
    };

    const out = compute();
    domainCategoryCache.set(rawDomain, out);
    return out;
  };

  // Data for the Domains Insights view — one memoized pass over
  // filteredCitations (movers/shakers, category pie, category dynamics),
  // instead of the Performance table's per-domain rescans.
  const domainsInsights = useMemo(() => {
    if (!auditTrendIndex.ready) return null;
    const audits = auditTrendIndex.audits;
    const windowIds = new Set(audits.map(a => a.id));

    const isCited = (c: any) => {
      if (filters.llms === 'searchgpt') return c.cited === true;
      if (filters.llms === 'all') {
        return c.llm === 'searchgpt' ? c.cited === true : (c.cited === true || c.cited == null);
      }
      return c.cited === true || c.cited == null;
    };

    const catOf = new Map<string, string>();
    const domains = new Set<string>();
    const pageMeta = new Map<string, { domain: string; sampleUrl: string; title: string | null }>();
    const catCounts = new Map<string, number>();
    const catResp = new Map<string, Map<string, Set<string>>>();

    trendCitations.forEach((c: any) => {
      if (!c.domain || !isCited(c)) return;
      let cat = catOf.get(c.domain);
      if (!cat) { cat = getDomainDisplayCategory(c.domain); catOf.set(c.domain, cat); }
      catCounts.set(cat, (catCounts.get(cat) || 0) + 1);
      domains.add(c.domain);
      if (c.audit_id && windowIds.has(c.audit_id)) {
        let per = catResp.get(cat);
        if (!per) { per = new Map(); catResp.set(cat, per); }
        let set = per.get(c.audit_id);
        if (!set) { set = new Set(); per.set(c.audit_id, set); }
        set.add(c.audit_id + '-' + c.prompt_id + '-' + c.llm);
      }
      if (c.page_url) {
        const u = normalizeUrl(c.page_url);
        let m = pageMeta.get(u);
        if (!m) { m = { domain: c.domain, sampleUrl: c.page_url, title: null }; pageMeta.set(u, m); }
        if (!m.title) {
          const t = c.citation_text;
          if (t && t !== 'No description available' && t !== 'No description' && !/^https?:\/\//i.test(t)) {
            m.title = t;
          }
        }
      }
    });

    // Movers / Shakers: best and worst citing-share dynamics at the last
    // audit. A domain qualifies with 2+ citing answers in at least one of
    // the two compared audits — a 0-to-1 flicker is noise, not a move.
    type MoverRow = { domain: string; category: string; trend: TrendData; series: TrendPoint[] | null; delta: number };
    const ranked: MoverRow[] = [];
    domains.forEach(d => {
      const trend = auditTrendIndex.domainTrend(d);
      if (!trend || Math.max(trend.lastCount, trend.prevCount) < 2) return;
      ranked.push({
        domain: d,
        category: catOf.get(d) || 'Unknown',
        trend,
        series: auditTrendIndex.domainSeries(d),
        delta: trendDelta(trend),
      });
    });
    const movers = ranked.filter(r => r.delta > 0.5).sort((a, b) => b.delta - a.delta).slice(0, 8);
    const shakers = ranked.filter(r => r.delta < -0.5).sort((a, b) => a.delta - b.delta).slice(0, 8);

    // Pages Movers/Shakers, same rules keyed by normalized URL.
    const pageRanked: any[] = [];
    pageMeta.forEach((meta, u) => {
      const trend = auditTrendIndex.pageTrend(u);
      if (!trend || Math.max(trend.lastCount, trend.prevCount) < 2) return;
      pageRanked.push({
        url: u,
        sampleUrl: meta.sampleUrl,
        title: meta.title,
        domain: meta.domain,
        category: catOf.get(meta.domain) || getDomainDisplayCategory(meta.domain),
        trend,
        series: auditTrendIndex.pageSeries(u),
        delta: trendDelta(trend),
      });
    });
    const pageMovers = pageRanked.filter(r => r.delta > 0.5).sort((x, y) => y.delta - x.delta).slice(0, 8);
    const pageShakers = pageRanked.filter(r => r.delta < -0.5).sort((x, y) => x.delta - y.delta).slice(0, 8);

    const totalCited = Array.from(catCounts.values()).reduce((x, y) => x + y, 0);
    const pie = Array.from(catCounts.entries())
      .map(([name, value]) => ({
        name, value,
        percentage: totalCited > 0 ? Math.round((value / totalCited) * 100) : 0,
      }))
      .sort((x, y) => y.value - x.value);

    // Category dynamics: share of answered responses citing each category,
    // per audit in the window. Top 6 categories keep the chart legible.
    const topCats = Array.from(catResp.entries())
      .map(([cat, per]) => ({ cat, vol: Array.from(per.values()).reduce((x, st) => x + st.size, 0) }))
      .sort((x, y) => y.vol - x.vol)
      .slice(0, 6)
      .map(x => x.cat);
    const dynamics = audits.map(a => {
      const point: any = {
        date: new Date(a.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      };
      topCats.forEach(cat => {
        const set = catResp.get(cat)?.get(a.id);
        point[cat] = a.total > 0 ? Number((((set?.size || 0) / a.total) * 100).toFixed(1)) : 0;
      });
      return point;
    });

    return { movers, shakers, pageMovers, pageShakers, pie, totalCited, topCats, dynamics };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trendCitations, auditTrendIndex, domainCategoryMap, brands, competitors, project?.domain, filters.llms]);

  // Movers/Shakers horizon. 'last' compares against the previous audit from
  // client-side data; the day modes need a baseline far outside the loaded
  // 5-audit window, so they fetch two compared audits per domain from the
  // project_domain_movers RPC (cached per period+filters).
  const [moversPeriod, setMoversPeriod] = useState<'last' | '7' | '14' | '30' | '90'>('last');
  const [moversRemote, setMoversRemote] = useState<{ key: string; rows: any[] } | null>(null);
  const [moversLoading, setMoversLoading] = useState(false);

  const moversKey = `${moversPeriod}|${filters.llms}|${promptGroupsKey}`;
  useEffect(() => {
    if (moversPeriod === 'last' || !id) return;
    if (activeTab !== 'domains' || domainsView !== 'insights') return;
    if (moversRemote?.key === moversKey) return;
    let cancelled = false;
    (async () => {
      setMoversLoading(true);
      const { data, error } = await supabase.rpc('project_domain_movers', {
        p_project_id: id,
        p_llm: filters.llms !== 'all' ? filters.llms : null,
        p_groups: filters.promptGroups.length > 0 ? filters.promptGroups : null,
        p_days: Number(moversPeriod),
      });
      if (cancelled) return;
      if (error) {
        console.error('project_domain_movers RPC:', error);
        setMoversRemote({ key: moversKey, rows: [] });
      } else {
        setMoversRemote({ key: moversKey, rows: data || [] });
      }
      setMoversLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moversPeriod, id, activeTab, domainsView, moversKey]);

  // The rows both cards render for the active period. Null = still loading.
  const activeMovers = useMemo(() => {
    if (moversPeriod === 'last') {
      return domainsInsights
        ? { movers: domainsInsights.movers, shakers: domainsInsights.shakers }
        : { movers: [], shakers: [] };
    }
    if (!moversRemote || moversRemote.key !== moversKey || moversLoading) return null;
    const ranked: any[] = [];
    moversRemote.rows.forEach((r: any) => {
      const trend: TrendData = {
        lastCount: Number(r.last_count) || 0,
        lastTotal: Number(r.last_total) || 0,
        prevCount: Number(r.prev_count) || 0,
        prevTotal: Number(r.prev_total) || 0,
        lastDate: r.last_date,
        prevDate: r.prev_date,
      };
      // Same noise gate as the 'last' mode.
      if (Math.max(trend.lastCount, trend.prevCount) < 2) return;
      ranked.push({
        domain: r.domain,
        category: getDomainDisplayCategory(r.domain),
        trend,
        series: auditTrendIndex.ready ? auditTrendIndex.domainSeries(r.domain) : null,
        delta: trendDelta(trend),
      });
    });
    return {
      movers: ranked.filter(r => r.delta > 0.5).sort((x, y) => y.delta - x.delta).slice(0, 8),
      shakers: ranked.filter(r => r.delta < -0.5).sort((x, y) => x.delta - y.delta).slice(0, 8),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moversPeriod, moversKey, moversRemote, moversLoading, domainsInsights,
      auditTrendIndex, domainCategoryMap, brands, competitors, project?.domain]);

  // Pages tab: Performance / Insights sub-view, and the Movers/Shakers
  // horizon for pages (same mechanics as domains, RPC project_page_movers).
  const [pagesView, setPagesView] = useState<'performance' | 'insights'>('performance');
  const [pagesMoversPeriod, setPagesMoversPeriod] = useState<'last' | '7' | '14' | '30' | '90'>('last');
  const [pagesMoversRemote, setPagesMoversRemote] = useState<{ key: string; rows: any[] } | null>(null);
  const [pagesMoversLoading, setPagesMoversLoading] = useState(false);

  const pagesMoversKey = `${pagesMoversPeriod}|${filters.llms}|${promptGroupsKey}`;
  useEffect(() => {
    if (pagesMoversPeriod === 'last' || !id) return;
    if (activeTab !== 'pages' || pagesView !== 'insights') return;
    if (pagesMoversRemote?.key === pagesMoversKey) return;
    let cancelled = false;
    (async () => {
      setPagesMoversLoading(true);
      const { data, error } = await supabase.rpc('project_page_movers', {
        p_project_id: id,
        p_llm: filters.llms !== 'all' ? filters.llms : null,
        p_groups: filters.promptGroups.length > 0 ? filters.promptGroups : null,
        p_days: Number(pagesMoversPeriod),
      });
      if (cancelled) return;
      if (error) {
        console.error('project_page_movers RPC:', error);
        setPagesMoversRemote({ key: pagesMoversKey, rows: [] });
      } else {
        setPagesMoversRemote({ key: pagesMoversKey, rows: data || [] });
      }
      setPagesMoversLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagesMoversPeriod, id, activeTab, pagesView, pagesMoversKey]);

  const activePageMovers = useMemo(() => {
    if (pagesMoversPeriod === 'last') {
      return domainsInsights
        ? { movers: domainsInsights.pageMovers, shakers: domainsInsights.pageShakers }
        : { movers: [], shakers: [] };
    }
    if (!pagesMoversRemote || pagesMoversRemote.key !== pagesMoversKey || pagesMoversLoading) return null;
    const ranked: any[] = [];
    pagesMoversRemote.rows.forEach((r: any) => {
      const trend: TrendData = {
        lastCount: Number(r.last_count) || 0,
        lastTotal: Number(r.last_total) || 0,
        prevCount: Number(r.prev_count) || 0,
        prevTotal: Number(r.prev_total) || 0,
        lastDate: r.last_date,
        prevDate: r.prev_date,
      };
      if (Math.max(trend.lastCount, trend.prevCount) < 2) return;
      ranked.push({
        url: r.page_url,
        sampleUrl: r.sample_url || `https://${r.page_url}`,
        title: r.title || null,
        domain: r.domain,
        category: getDomainDisplayCategory(r.domain),
        trend,
        series: auditTrendIndex.ready ? auditTrendIndex.pageSeries(r.page_url) : null,
        delta: trendDelta(trend),
      });
    });
    return {
      movers: ranked.filter(r => r.delta > 0.5).sort((x, y) => y.delta - x.delta).slice(0, 8),
      shakers: ranked.filter(r => r.delta < -0.5).sort((x, y) => x.delta - y.delta).slice(0, 8),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagesMoversPeriod, pagesMoversKey, pagesMoversRemote, pagesMoversLoading, domainsInsights,
      auditTrendIndex, domainCategoryMap, brands, competitors, project?.domain]);

  const getFilteredDomainStats = () => {
    const domainStats = filteredCitations.reduce((acc, citation) => {
      if (!citation.domain) return acc;

      if (!acc[citation.domain]) {
        acc[citation.domain] = {
          domain: citation.domain,
          mentions: 0,
          sentimentSum: 0,
          sentimentCount: 0,
          firstSeen: citation.checked_at,
          lastSeen: citation.checked_at,
        };
      }

      // Apply counting logic based on current filter
      // When filter is SearchGPT: only count cited=true
      // When filter is other LLMs or All: count cited=true or null/undefined
      let shouldCountAsCited = false;
      if (filters.llms === 'searchgpt') {
        // SearchGPT filter: only count cited=true
        shouldCountAsCited = citation.cited === true;
      } else if (filters.llms === 'all') {
        // All LLMs: apply per-LLM rules for proper summation
        shouldCountAsCited = citation.llm === 'searchgpt'
          ? citation.cited === true
          : (citation.cited === true || citation.cited == null); // Use == to catch both null and undefined
      } else {
        // Perplexity or Gemini: count cited=true or null/undefined
        shouldCountAsCited = (citation.cited === true || citation.cited == null); // Use == to catch both null and undefined
      }

      if (shouldCountAsCited) {
        acc[citation.domain].mentions++;
        if (citation.sentiment_score !== null) {
          acc[citation.domain].sentimentSum += citation.sentiment_score;
          acc[citation.domain].sentimentCount++;
        }
      }

      if (new Date(citation.checked_at) < new Date(acc[citation.domain].firstSeen)) {
        acc[citation.domain].firstSeen = citation.checked_at;
      }
      if (new Date(citation.checked_at) > new Date(acc[citation.domain].lastSeen)) {
        acc[citation.domain].lastSeen = citation.checked_at;
      }

      return acc;
    }, {} as any);

    return Object.values(domainStats).map((domain: any) => {
      // Get unique LLM responses that contain citations for this domain
      // Apply counting logic based on current filter
      const citedLlmResponseIds = new Set(
        filteredCitations
          .filter(c => {
            if (c.domain !== domain.domain || !c.audit_id || !c.prompt_id) return false;

            let shouldCountAsCited = false;
            if (filters.llms === 'searchgpt') {
              shouldCountAsCited = c.cited === true;
            } else if (filters.llms === 'all') {
              shouldCountAsCited = c.llm === 'searchgpt'
                ? c.cited === true
                : (c.cited === true || c.cited == null); // Use == to catch both null and undefined
            } else {
              shouldCountAsCited = (c.cited === true || c.cited == null); // Use == to catch both null and undefined
            }

            return shouldCountAsCited;
          })
          .map(c => `${c.audit_id}-${c.prompt_id}-${c.llm}`)
      );

      // Count how many LLM responses mentioned this domain
      const citedPrompts = citedLlmResponseIds.size;

      // Calculate percentage of cited prompts
      const totalLlmResponses = filteredLlmResponses.filter(r => r.audit_id && r.prompt_id).length;
      const citedPromptsPercentage = totalLlmResponses > 0 ?
        Math.round((citedPrompts / totalLlmResponses) * 100) : 0;

      // Count unique URLs (cited pages) for this domain
      // Apply counting logic based on current filter
      const citedPages = new Set(
        filteredCitations
          .filter(c => {
            if (c.domain !== domain.domain || !c.page_url) return false;

            let shouldCountAsCited = false;
            if (filters.llms === 'searchgpt') {
              shouldCountAsCited = c.cited === true;
            } else if (filters.llms === 'all') {
              shouldCountAsCited = c.llm === 'searchgpt'
                ? c.cited === true
                : (c.cited === true || c.cited == null); // Use == to catch both null and undefined
            } else {
              shouldCountAsCited = (c.cited === true || c.cited == null); // Use == to catch both null and undefined
            }

            return shouldCountAsCited;
          })
          .map(c => c.page_url)
      ).size;

      // Count unique audits for this domain
      const audits = new Set(
        filteredCitations
          .filter(c => c.domain === domain.domain && c.audit_id)
          .map(c => c.audit_id)
      ).size;

      // Count citations at position 4+ (Citations More)
      // These are citations where cited = false
      const citationsMore = filteredCitations.filter(c =>
        c.domain === domain.domain &&
        c.cited === false
      ).length;

      return {
        ...domain,
        category: getDomainDisplayCategory(domain.domain),
        citedPrompts,
        citedPromptsPercentage,
        citedPages,
        audits,
        citationsMore,
        totalCitations: domain.mentions + citationsMore,
        avgSentiment: domain.sentimentCount > 0
          ? (domain.sentimentSum / domain.sentimentCount).toFixed(2)
          : 'N/A',
        trend: auditTrendIndex.ready ? auditTrendIndex.domainTrend(domain.domain) : null,
        sparkSeries: auditTrendIndex.ready ? auditTrendIndex.domainSeries(domain.domain) : null,
      };
    })
    .map((d: any) => ({ ...d, trendDelta: d.trend ? trendDelta(d.trend) : 0 }))
    .filter((d: any) => domainCategoryFilter === 'all' || d.category === domainCategoryFilter)
    .sort((a: any, b: any) => {
      let aValue = a[domainSortConfig.column];
      let bValue = b[domainSortConfig.column];

      // Handle string comparisons (for domains)
      if (typeof aValue === 'string' && typeof bValue === 'string') {
        aValue = aValue.toLowerCase();
        bValue = bValue.toLowerCase();
      }

      if (aValue < bValue) return domainSortConfig.direction === 'asc' ? -1 : 1;
      if (aValue > bValue) return domainSortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  };

  // Sorted page rows for the Pages performance table — computed once per
  // data/sort change (was recomputed inside JSX on every render) and only
  // while the Pages tab is open.
  const pageStatsRows = useMemo(
    () => (activeTab === 'pages' ? getFilteredPageStats() : EMPTY_ROWS),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeTab, filteredCitations, filteredLlmResponses, pageSortConfig, domainCategoryMap, pageBrandIndex, project?.domain],
  );

  // Same treatment for the Domains performance table.
  const domainStatsRows = useMemo(
    () => (activeTab === 'domains' ? getFilteredDomainStats() : EMPTY_ROWS),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeTab, filteredCitations, filteredLlmResponses, domainSortConfig, domainCategoryMap, project?.domain],
  );

  const getFilteredAuditDates = () => {
    // Filter audit dates based on current date range filter
    if (filters.dateRange === 'all') return auditDates;

    // For lastAudit filter, show only the most recent audit date
    if (filters.dateRange === 'lastAudit') {
      if (lastAuditDate) {
        return [lastAuditDate];
      }
      // If no last audit date yet, return all (fallback)
      return auditDates;
    }

    if (filters.dateRange === 'custom') {
      if (customDateRange.startDate && customDateRange.endDate) {
        return auditDates.filter(date =>
          date >= customDateRange.startDate && date <= customDateRange.endDate
        );
      }
      return auditDates;
    }

    const now = new Date();
    const cutoffDate = new Date();

    switch (filters.dateRange) {
      case 'last7days':
        cutoffDate.setDate(now.getDate() - 6);
        break;
      case 'last14days':
        cutoffDate.setDate(now.getDate() - 13);
        break;
      case 'last30days':
        cutoffDate.setDate(now.getDate() - 29);
        break;
      case 'last90days':
        cutoffDate.setDate(now.getDate() - 89);
        break;
    }

    const cutoffDateStr = cutoffDate.toISOString().split('T')[0];
    return auditDates.filter(date => date >= cutoffDateStr);
  };

  // Memoized: the Prompts grid used to call getFilteredAuditDates() once
  // per row (222 rows x a sort each).
  const filteredAuditDates = useMemo(
    () => getFilteredAuditDates(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [auditDates, filters.dateRange, customDateRange, lastAuditDate],
  );

  // Memoized: this used to be a plain function invoked 3x per render
  // from the Overview cards, re-walking the full window each time.
  const citationRateStats = useMemo(() => {
    if (!project?.domain) return { rate: 0, cited: 0, total: 0 };

    // Normalize project domain (remove www and lowercase) to match
    // recalculate-metrics logic.
    const projectDomain = project.domain.toLowerCase().replace(/^www\./, '');
    const domainMode = project.domain_mode || 'exact';

    // Single source of truth: the `citations` table. Server-side the
    // audit pipeline extracts citations for every LLM (SearchGPT,
    // Perplexity, Gemini, Bing, Google AI, Grok…) and writes them
    // into this table — Domain Detail / Heatmap pages already trust
    // it as canonical.
    //
    // We used to also scan `r.links_attached` (SearchGPT) and
    // `r.all_sources` (Bing/Google/Grok) here as a "belt and braces"
    // fallback. That fallback is being dropped because (a) it
    // double-counts URLs the citations table already contains and
    // (b) those columns are no longer in the page's SELECT (see the
    // egress-reduction PR), so reading them returns undefined.
    const citedLlmResponseIds = new Set<string>();

    filteredCitations
      .filter(c => {
        if (!c.domain || !c.audit_id || !c.prompt_id) return false;

        // Filter out citations with cited=false (SearchGPT "More" section).
        if (c.cited === false) return false;

        const citationDomain = c.domain.toLowerCase().replace(/^www\./, '');

        if (domainMode === 'subdomains') {
          return (
            citationDomain === projectDomain ||
            citationDomain.endsWith(`.${projectDomain}`)
          );
        }
        return citationDomain === projectDomain;
      })
      .forEach(c =>
        citedLlmResponseIds.add(`${c.audit_id}-${c.prompt_id}-${c.llm}`)
      );

    // Denominator: ANSWERED responses only — a failed or empty scrape is not
    // "an AI answer that ignored us". Same definition as the card metrics
    // (recalculate_project_metrics SQL function), so both surfaces agree.
    const answered = filteredLlmResponses.filter(
      r => r.audit_id && r.prompt_id && isAnswered(r)
    );
    const totalLlmResponses = answered.length;

    if (totalLlmResponses === 0) return { rate: 0, cited: 0, total: 0 };

    const citedAnswers = answered.filter(
      r => citedLlmResponseIds.has(`${r.audit_id}-${r.prompt_id}-${r.llm}`)
    ).length;

    const rate = Math.round((citedAnswers / totalLlmResponses) * 100);
    return { rate, cited: citedAnswers, total: totalLlmResponses };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredCitations, filteredLlmResponses, project?.domain, project?.domain_mode]);

  // Memoized for the same reason; brand matchers are compiled ONCE per
  // brand-list change instead of once per response (findBrandsInText
  // without the matchers arg rebuilds the regex set on every call).
  const mentionRateStats = useMemo(() => {
    const ownBrands = brands.filter(brand => !brand.is_competitor).map(brand => brand.brand_name);

    if (ownBrands.length === 0) return { rate: 0, mentioned: 0, total: 0 };

    // Response-level calculation — matches the tooltip formula:
    //   "Responses mentioning your brand / Total responses × 100"
    // Every llm_responses row counts independently: a prompt that runs on
    // N LLMs contributes N rows to the denominator, not 1. Previous versions
    // de-duplicated by (audit_id, prompt_id) which silently collapsed
    // multi-LLM runs and reported the wrong total (e.g. 240 instead of 480
    // for a 2-LLM / 240-prompt project).
    // ANSWERED responses only (see getCitationRate) — same denominator as
    // the card metrics.
    const relevantResponses = filteredLlmResponses.filter(
      r => r.audit_id && r.prompt_id && isAnswered(r)
    );

    const total = relevantResponses.length;
    if (total === 0) return { rate: 0, mentioned: 0, total: 0 };

    // Word-boundary, accent-insensitive, alias-aware matching. The old
    // `includes()` test counted the 3-letter brand "eni" inside ordinary
    // French words (venir, devenir, obtenir…) and inflated one project's
    // mention rate from 21% to 35%.
    const ownBrandRows = brands.filter(b => !b.is_competitor);
    const matchers = buildMatchers(ownBrandRows);
    const ownKeys = ownBrandRows.map(b => normalizeBrandKey(b.brand_name || '')).filter(Boolean);
    const mentioned = relevantResponses.filter(response =>
      response.mentionedKeys
        ? ownKeys.some(k => response.mentionedKeys.has(k))
        : findBrandsInText(response.answer_text, ownBrandRows, matchers).length > 0
    ).length;

    const rate = Math.round((mentioned / total) * 100);
    return { rate, mentioned, total };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredLlmResponses, brands]);

  // Calculate brand mentions data based on filtered responses
  // Citation Funnel stages for the project's own domain, per prompt of one
  // searchgpt audit. Source tiers come straight from the ChatGPT interface:
  // links_attached = links in the answer text; search_sources = the "used"
  // sources panel; search_sources_more = the supplemental "More" list.
  // BrightData's web_search_triggered flag is unreliable (observed False on
  // rows whose links all carry utm_source=chatgpt.com), so search detection
  // uses the utm marker / panel presence instead.
  const citationFunnel = useMemo(() => {
    if (!cfData || !project?.domain) return null;
    const projectDomain = project.domain.toLowerCase().replace(/^www\./, '');
    const domainMode = project.domain_mode || 'exact';
    const isOwn = (u: string) => {
      try {
        const host = new URL(u).hostname.toLowerCase().replace(/^www\./, '');
        return host === projectDomain ||
          (domainMode === 'subdomains' && host.endsWith(`.${projectDomain}`));
      } catch { return false; }
    };
    const itemsOf = (v: any): any[] => {
      let arr = v;
      if (typeof arr === 'string') { try { arr = JSON.parse(arr); } catch { return []; } }
      return Array.isArray(arr) ? arr : [];
    };
    const urlsOf = (v: any): string[] =>
      itemsOf(v).map((x: any) => (typeof x === 'string' ? x : x?.url)).filter(Boolean);

    let webSearch = 0, noSearch = 0, present = 0, absent = 0;
    let cited = 0, moreOnly = 0, mainCit = 0, supporting = 0;

    cfData.rows.forEach(r => {
      const la = urlsOf(r.links_attached);
      const ss = urlsOf(r.search_sources);
      const ssmPanel = urlsOf(r.search_sources_more);
      // The citations column carries a cited flag per entry: cited=false is
      // the "More" tier embedded in the snapshot (present even when the
      // expanded panels were not captured).
      const citItems = itemsOf(r.citations);
      const citUsed = citItems.filter((x: any) => x?.cited !== false).map((x: any) => x?.url).filter(Boolean);
      const citMore = citItems.filter((x: any) => x?.cited === false).map((x: any) => x?.url).filter(Boolean);
      const cit = citUsed.concat(citMore);
      const ssm = ssmPanel.length > 0 ? ssmPanel : citMore;
      // BrightData snapshots come in variants: some carry the full source
      // panels, others only links_attached, others only the citations panel
      // (verified on raw files: citations = the in-text links deduped by
      // domain, so it is a legitimate "used in answer" signal).
      const searched =
        la.some(u => u.includes('utm_source=chatgpt.com')) ||
        cit.some(u => u.includes('utm_source=chatgpt.com')) ||
        ss.length > 0 || ssm.length > 0 || cit.length > 0 || !!r.web_search_query;
      if (!searched) { noSearch++; return; }
      webSearch++;
      const mainSet = la.length > 0 ? la : citUsed;  // in-text links (or their deduped panel)
      const usedSet = ss.length > 0 ? ss : mainSet;  // used-sources panel when captured
      const inMain = mainSet.some(isOwn);
      const inUsedPanel = usedSet.some(isOwn);
      const inMore = ssm.some(isOwn);
      if (!inMain && !inUsedPanel && !inMore) { absent++; return; }
      present++;
      if (inMain || inUsedPanel) {
        cited++;
        if (inMain) mainCit++; else supporting++;
      } else {
        moreOnly++;
      }
    });

    const total = cfData.rows.length;
    return { total, webSearch, noSearch, present, absent, cited, moreOnly, mainCit, supporting };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfData, project?.domain, project?.domain_mode]);

  // Matrix View data: brand x LLM mention counts/rates from the extracted
  // answer_competitors (not substring matching), across the loaded window
  // under the active filters. One pass over responses.
  const MATRIX_LLM_ORDER = ['searchgpt', 'google-ai-mode', 'google-ai-overview', 'gemini', 'grok', 'bing-copilot', 'perplexity'];
  const mentionsMatrix = useMemo(() => {
    const answered = matrixResponses.filter(r => isAnswered(r));
    const llms = MATRIX_LLM_ORDER.filter(l => answered.some(r => r.llm === l));
    const denom: Record<string, number> = {};
    llms.forEach(l => { denom[l] = answered.filter(r => r.llm === l).length; });

    const keyOf = (x: string) => normalizeBrandKey(x || '');
    const defs = [
      ...brands.map(b => ({ ...b, is_competitor: false })),
      ...competitors.map(b => ({ ...b, is_competitor: true })),
    ]
      .filter(b => b.brand_name)
      .map(b => ({
        brand: b.brand_name,
        is_competitor: !!b.is_competitor,
        keys: Array.from(new Set([keyOf(b.brand_name), ...(((b as any).aliases || []) as string[]).map(keyOf)])).filter(Boolean),
      }));

    const counts: Record<string, Record<string, number>> = {};
    defs.forEach(d => { counts[d.brand] = {}; llms.forEach(l => { counts[d.brand][l] = 0; }); });

    answered.forEach(resp => {
      if (!llms.includes(resp.llm)) return;
      const bl = resp.answer_competitors?.brands;
      if (!Array.isArray(bl)) return;
      const present = new Set(
        bl.map((x: any) => keyOf(typeof x === 'string' ? x : x?.name)).filter(Boolean)
      );
      if (present.size === 0) return;
      defs.forEach(d => {
        for (const k of d.keys) {
          if (present.has(k)) { counts[d.brand][resp.llm]++; break; }
        }
      });
    });

    const rows = defs.map(d => {
      const cells: Record<string, { count: number; rate: number }> = {};
      let total = 0;
      llms.forEach(l => {
        const c = counts[d.brand][l] || 0;
        total += c;
        cells[l] = { count: c, rate: denom[l] > 0 ? (c / denom[l]) * 100 : 0 };
      });
      return { brand: d.brand, is_competitor: d.is_competitor, cells, total };
    })
    .filter(r => !r.is_competitor || r.total > 0)
    .sort((x, y) => {
      if (x.is_competitor !== y.is_competitor) return x.is_competitor ? 1 : -1;
      return y.total - x.total;
    });

    let maxCount = 0, maxRate = 0;
    rows.forEach(r => llms.forEach(l => {
      maxCount = Math.max(maxCount, r.cells[l].count);
      maxRate = Math.max(maxRate, r.cells[l].rate);
    }));

    return { llms, denom, rows, maxCount, maxRate };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matrixResponses, brands, competitors]);

  const exportMentionsMatrix = () => {
    const { llms, rows } = mentionsMatrix;
    const data = rows.map(r => {
      const row: Record<string, any> = {
        Brand: r.brand,
        Type: r.is_competitor ? 'Competitor' : 'Own brand',
      };
      llms.forEach(l => {
        row[LLM_NAME_LABELS[l] || l] = mentionsMetric === 'rate'
          ? Number(r.cells[l].rate.toFixed(1))
          : r.cells[l].count;
      });
      return row;
    });
    const ws = xlsxUtils.json_to_sheet(data);
    const wb = xlsxUtils.book_new();
    xlsxUtils.book_append_sheet(wb, ws, 'Mentions matrix');
    xlsxWriteFile(wb, `${project?.name || 'project'}_mentions_matrix_${new Date().toISOString().split('T')[0]}.xlsx`);
  };



  const tabs = [
    { id: 'overview', label: 'Overview', icon: List },
    { id: 'visibility', label: 'Visibility Overview', icon: BarChart3 },
    { id: 'prompts', label: 'Prompts', icon: MessageCircle },
    { id: 'pages', label: 'Pages', icon: FileText },
    { id: 'domains', label: 'Domains', icon: Globe },
    { id: 'ads', label: 'Ads', icon: Megaphone },
    { id: 'citation-funnel', label: 'Citation Funnel', icon: Workflow },
    { id: 'mentions', label: 'Mentions', icon: BadgeCheck },
    { id: 'insights', label: 'Insights', icon: Lightbulb },
    { id: 'sentiment', label: 'Sentiment', icon: Smile },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  // Per-prompt-group citation radar: memoized — this walked the whole
  // window (~10^7 include-steps) on every Overview render.
  const promptGroupRadarData = useMemo(
    () => (activeTab === 'overview' ? getCitationRateByPromptGroup() : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeTab, filteredCitations, filteredLlmResponses, prompts, promptGroups],
  );

  // Overview visibility-heatmap metrics: one indexed pass instead of the
  // old inline JSX computation, which walked filteredCitations once per
  // response (~3×10^8 iterations) on EVERY render of the Overview tab.
  const heatmapMetrics = useMemo(() => {
    const empty = { uniqueLlms: [] as string[], metricsByLlm: {} as Record<string, any> };
    if (activeTab !== 'overview') return empty;
    const uniqueLlms = [...new Set(filteredLlmResponses.map(r => r.llm))].sort();
    const metricsByLlm: Record<string, any> = {};
    if (uniqueLlms.length === 0) return { uniqueLlms, metricsByLlm };

    const projectDomain = project?.domain?.toLowerCase().replace(/^www\./, '');
    const domainMode = project?.domain_mode || 'exact';
    const ownBrands = brands
      .filter(b => !b.is_competitor)
      .map(b => String(b.brand_name || '').toLowerCase())
      .filter(Boolean);

    const matchesProject = (rawDomain: string | null | undefined): boolean => {
      if (!rawDomain || !projectDomain) return false;
      const d = String(rawDomain).toLowerCase().replace(/^www\./, '');
      return domainMode === 'subdomains'
        ? d === projectDomain || d.endsWith(`.${projectDomain}`)
        : d === projectDomain;
    };
    const hostOf = (url: string): string => {
      try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); }
      catch { return ''; }
    };

    // (audit, prompt, llm) triples that have a project-domain citation
    // (cited !== false) in the citations table.
    const citedByKey = new Set<string>();
    filteredCitations.forEach((c: any) => {
      if (c.cited === false) return;
      if (!matchesProject(c.domain)) return;
      citedByKey.add(`${c.audit_id}|${c.prompt_id}|${c.llm}`);
    });

    filteredLlmResponses.forEach((response: any) => {
      const llm = response.llm;
      let m = metricsByLlm[llm];
      if (!m) m = metricsByLlm[llm] = { totalResponses: 0, citedCount: 0, mentionedCount: 0 };
      m.totalResponses++;

      let cited = citedByKey.has(`${response.audit_id}|${response.prompt_id}|${llm}`);
      if (!cited && llm === 'searchgpt' && Array.isArray(response.links_attached)) {
        cited = response.links_attached.some((link: any) =>
          link?.url && matchesProject(hostOf(link.url)));
      }
      if (!cited && response.all_sources) {
        try {
          const sources = Array.isArray(response.all_sources)
            ? response.all_sources : JSON.parse(response.all_sources);
          cited = sources.some((source: any) => {
            if (source?.domain) return matchesProject(source.domain);
            if (source?.url) return matchesProject(hostOf(source.url));
            return false;
          });
        } catch { /* malformed all_sources — treated as not cited, as before */ }
      }
      if (cited) m.citedCount++;

      if (rowMentionsAnyName(response, ownBrands)) m.mentionedCount++;
    });

    uniqueLlms.forEach(llm => {
      const m = metricsByLlm[llm];
      m.citationRate = m.totalResponses > 0 ? Math.round((m.citedCount / m.totalResponses) * 100) : 0;
      m.mentionRate = m.totalResponses > 0 ? Math.round((m.mentionedCount / m.totalResponses) * 100) : 0;
    });
    return { uniqueLlms, metricsByLlm };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, filteredLlmResponses, filteredCitations, project?.domain, project?.domain_mode, brands]);

  // Widget skeletons instead of "no data" empty states while the
  // window is (re)loading and nothing is on screen yet. Settings and
  // Insights don't render window data — they stay interactive.
  const showTabSkeleton = windowLoading
    && llmResponses.length === 0
    && citations.length === 0
    && activeTab !== 'settings'
    && activeTab !== 'insights';

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-brand-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-600 dark:text-gray-400">Loading project...</p>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
          Project not found
        </h2>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4"
      >
        <div className="flex-1">
          <div className="flex items-center space-x-3 mb-3">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
              {project.name}
            </h1>
            <Button variant="ghost" size="sm" className="p-2">
              <PencilLine className="w-4 h-4" onClick={handleEditProject} />
            </Button>
            {runningAuditInfo && (
              <div className="relative group">
                <div className="flex items-center space-x-2 px-3 py-1.5 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                  <img
                    src="/icons8-spinner.gif"
                    alt="Running"
                    className="w-5 h-5"
                  />
                  <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
                    Running
                  </span>
                </div>
                <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 px-3 py-2 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 whitespace-nowrap z-50 pointer-events-none">
                  <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-gray-900 dark:bg-gray-700 rotate-45"></div>
                  Current Status: {runningAuditInfo.currentStep}
                </div>
              </div>
            )}
            {project?.scheduled_audits_enabled && project?.next_scheduled_audit_at && (
              <div className="relative group">
                <div className="p-2">
                  <CalendarCheck className="w-4 h-4" />
                </div>
                <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 px-3 py-2 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 whitespace-nowrap z-50 pointer-events-none">
                  <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-gray-900 dark:bg-gray-700 rotate-45"></div>
                  Next Scheduled Audit:<br />
                  {new Date(project.next_scheduled_audit_at).toLocaleString()} ({project.schedule_timezone || 'UTC'})
                </div>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
              <Globe className="w-3.5 h-3.5 mr-1.5" />
              {project.domain}
            </span>
            {project.brands && project.brands.filter((b: any) => !b.is_competitor).length > 0 && (
              project.brands.filter((b: any) => !b.is_competitor).map((brand: any) => (
                <span
                  key={brand.id}
                  className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300"
                >
                  <Crown className="w-3.5 h-3.5 mr-1.5" />
                  {brand.brand_name}
                </span>
              ))
            )}
            {(() => {
              // Group chips — junction table first, legacy group_id fallback.
              const groupList = (project.project_groups || [])
                .map((pg: any) => pg.groups)
                .filter(Boolean);
              const shownGroups = groupList.length > 0
                ? groupList
                : (project.groups ? [project.groups] : []);
              return shownGroups.map((g: any, i: number) => (
                <span
                  key={g.id || `${g.name}-${i}`}
                  className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300"
                >
                  <Users className="w-3.5 h-3.5 mr-1.5" />
                  {g.name}
                </span>
              ));
            })()}
            {project.country && (() => {
              const country = getCountryByCode(project.country);
              return country ? (
                <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
                  <img src={country.flag} alt={country.name} className="w-4 h-4 mr-1.5 object-contain" />
                  {country.name}
                </span>
              ) : (
                <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
                  {project.country}
                </span>
              );
            })()}
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <Button
            variant="secondary"
            onClick={exportAuditDataByLLM}
            disabled={exporting}
          >
            <Download className="w-4 h-4 mr-2" />
            {exporting ? 'Exporting…' : 'Export'}
          </Button>
          <Button
            variant="gradient"
            onClick={() => handleRunAudit(project.id)}
          >
            <Play className="w-4 h-4 mr-2" />
            Run Audit
          </Button>
        </div>
      </motion.div>

      {/* Unified template: the filter row sits between the project
          header and the dashboards. The period buttons select which
          audits feed EVERY tab below. */}
      <DashboardFilterBar
        bleed
        windowLoading={windowLoading}
        truncatedNote={dataTruncated
          ? `Dense window: only the most recent audits of the ${dataTruncated.audits} in this period are loaded`
          : null}
      />

      {/* The project has audits, just none inside the selected period —
          say so instead of letting every widget claim "no data". */}
      {!windowLoading && auditsData.length === 0 && allAuditsMeta.length > 0 && (
        <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 px-4 py-2.5 text-sm text-blue-800 dark:text-blue-200">
          No audits in the selected period — pick a wider range above.
        </div>
      )}

      {/* Tabs */}
      <Card>
        {!hideTabNavigation && (
          <CardHeader className="pb-0">
            <div className="border-b border-gray-200 dark:border-gray-700">
              <nav className="flex space-x-4 sm:space-x-8 overflow-x-auto">
                {tabs.map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`
                      flex items-center py-2 px-1 border-b-2 font-medium text-sm transition-colors
                      ${activeTab === tab.id
                        ? 'border-brand-primary text-brand-primary'
                        : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
                      }
                    `}
                  >
                    <tab.icon className="w-4 h-4 mr-2" />
                    {tab.label}
                  </button>
                ))}
              </nav>
            </div>
          </CardHeader>
        )}

        <CardContent className="p-6">
          {showTabSkeleton ? (
            <TabContentSkeleton />
          ) : (
          <TabErrorBoundary key={activeTab}>
          {activeTab === 'overview' && (
            <div className="space-y-6 pt-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
                <div className="bg-gradient-to-br from-[#f72585] to-[#b5179e] rounded-2xl p-6 border border-[#f72585]/30 shadow-lg relative">
                  <div className="absolute top-4 right-4 group">
                    <Info className="w-4 h-4 text-white/70 hover:text-white cursor-help transition-colors" />
                    <div className="absolute top-full right-0 mt-2 w-64 p-3 bg-gray-900 text-white text-xs rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 pointer-events-none z-10">
                      <div className="font-semibold mb-1">Active Prompts</div>
                      <div className="mb-2">Total number of prompts configured for monitoring across all LLMs.</div>
                      <div className="text-white/70 italic">Formula: Count of all prompts in project</div>
                    </div>
                  </div>
                  <div className="text-3xl font-bold text-white mb-2">
                    {prompts.length}
                  </div>
                  <div className="text-sm text-white/90 font-medium">
                    Active Prompts
                  </div>
                  <div className="text-xs text-white/70 mt-1">
                    Configured for monitoring
                  </div>
                </div>

                <div className="bg-gradient-to-br from-[#7209b7] to-[#560bad] rounded-2xl p-6 border border-[#7209b7]/30 shadow-lg relative">
                  <div className="absolute top-4 right-4 group">
                    <Info className="w-4 h-4 text-white/70 hover:text-white cursor-help transition-colors" />
                    <div className="absolute top-full right-0 mt-2 w-72 p-3 bg-gray-900 text-white text-xs rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 pointer-events-none z-10">
                      <div className="font-semibold mb-1">Citation Rate</div>
                      <div className="mb-2">Percentage of LLM responses that include a citation from your domain.</div>
                      <div className="text-white/70 italic">Formula: (Responses with your domain citation / Total responses) × 100</div>
                    </div>
                  </div>
                  <div className="text-3xl font-bold text-white mb-2">
                    {citationRateStats.rate}%
                  </div>
                  <div className="text-sm text-white/90 font-medium">
                    Citation Rate
                  </div>
                  <div className="text-xs text-white/70 mt-1">
                    {citationRateStats.cited} of {citationRateStats.total} responses cite your domain
                  </div>
                </div>

                <div className="bg-gradient-to-br from-[#3f37c9] to-[#4361ee] rounded-2xl p-6 border border-[#3f37c9]/30 shadow-lg relative">
                  <div className="absolute top-4 right-4 group">
                    <Info className="w-4 h-4 text-white/70 hover:text-white cursor-help transition-colors" />
                    <div className="absolute top-full right-0 mt-2 w-72 p-3 bg-gray-900 text-white text-xs rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 pointer-events-none z-10">
                      <div className="font-semibold mb-1">Mention Rate</div>
                      <div className="mb-2">Percentage of LLM responses that mention your brand name anywhere in the answer text.</div>
                      <div className="text-white/70 italic">Formula: (Responses mentioning your brand / Total responses) × 100</div>
                    </div>
                  </div>
                  <div className="text-3xl font-bold text-white mb-2">
                    {mentionRateStats.rate}%
                  </div>
                  <div className="text-sm text-white/90 font-medium">
                    Mention Rate
                  </div>
                  <div className="text-xs text-white/70 mt-1">
                    {mentionRateStats.mentioned} of {mentionRateStats.total} responses mention your brand
                  </div>
                </div>

                <div className="bg-gradient-to-br from-[#4895ef] to-[#4cc9f0] rounded-2xl p-6 border border-[#4895ef]/30 shadow-lg relative">
                  <div className="absolute top-4 right-4 group">
                    <Info className="w-4 h-4 text-white/70 hover:text-white cursor-help transition-colors" />
                    <div className="absolute top-full right-0 mt-2 w-64 p-3 bg-gray-900 text-white text-xs rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 pointer-events-none z-10">
                      <div className="font-semibold mb-1">Total Responses</div>
                      <div className="mb-2">Total number of LLM responses collected in the selected time period.</div>
                      <div className="text-white/70 italic">Formula: Count of all filtered LLM responses</div>
                    </div>
                  </div>
                  <div className="text-3xl font-bold text-white mb-2">
                    {filteredLlmResponses.length}
                  </div>
                  <div className="text-sm text-white/90 font-medium">
                    Total Responses
                  </div>
                  <div className="text-xs text-white/70 mt-1">
                    LLM responses in period
                  </div>
                </div>
              </div>

              {/* Empty-filter hint — explains the 0/0/0 case so users
                  don't read it as a bug. Only shown when the filter
                  combo really matched no data and the user has at
                  least one non-default filter active. */}
              {filteredLlmResponses.length === 0 && activeGlobalFilterCount > 0 && (
                <div className="rounded-2xl border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-sm text-amber-800 dark:text-amber-200 flex items-start gap-3">
                  <Info className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <div className="font-medium mb-1">
                      No responses match the current filters
                    </div>
                    <div className="text-amber-700 dark:text-amber-300">
                      Try a wider date range, clear the prompt-group or
                      sentiment filter, or pick "All LLMs". You have{' '}
                      {activeGlobalFilterCount} active filter
                      {activeGlobalFilterCount === 1 ? '' : 's'}.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={resetGlobalFilters}
                    className="text-amber-700 dark:text-amber-300 underline hover:no-underline whitespace-nowrap"
                  >
                    Reset all
                  </button>
                </div>
              )}

              {/* Visibility Heatmap */}
              <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    Your visibility across AI engines
                  </h3>
                  <div className="group relative">
                    <Info className="w-4 h-4 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 cursor-help transition-colors" />
                    <div className="absolute top-full right-0 mt-2 w-80 p-3 bg-gray-900 text-white text-xs rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 pointer-events-none z-10">
                      <div className="font-semibold mb-1">Visibility Heatmap</div>
                      <div className="mb-2">Shows your Citation Rate and Mention Rate performance across different AI engines. Darker colors indicate better performance.</div>
                    </div>
                  </div>
                </div>

                {(() => {
                  // Metrics come precomputed from the heatmapMetrics memo
                  // (indexed single pass over the window).
                  const { uniqueLlms, metricsByLlm } = heatmapMetrics;

                  if (uniqueLlms.length === 0) {
                    return (
                      <div className="flex items-center justify-center h-48 text-gray-500 dark:text-gray-400">
                        <div className="text-center">
                          <Globe className="w-12 h-12 mx-auto mb-2 opacity-50" />
                          <p className="text-sm">No data available</p>
                          <p className="text-xs">Run an audit to see your visibility across AI engines</p>
                        </div>
                      </div>
                    );
                  }

                  // Helper function to get color based on rate
                  const getHeatmapColor = (rate: number, isDark: boolean) => {
                    if (rate >= 75) return isDark ? 'bg-emerald-500/80' : 'bg-emerald-500';
                    if (rate >= 50) return isDark ? 'bg-green-500/70' : 'bg-green-400';
                    if (rate >= 25) return isDark ? 'bg-yellow-500/60' : 'bg-yellow-300';
                    if (rate > 0) return isDark ? 'bg-orange-500/50' : 'bg-orange-300';
                    return isDark ? 'bg-gray-700/40' : 'bg-gray-200';
                  };

                  const getLlmDisplayName = (llm: string) => {
                    const nameMap: Record<string, string> = {
                      'searchgpt': 'SearchGPT',
                      'perplexity': 'Perplexity',
                      'gemini': 'Gemini',
                      'google-ai-overview': 'Google AI',
                      'google-ai-mode': 'Google AI Mode',
                      'bing-copilot': 'Bing Copilot',
                      'grok': 'Grok',
                    };
                    return nameMap[llm] || llm;
                  };

                  return (
                    <div className="overflow-x-auto">
                      <div className="inline-block min-w-full">
                        <table className="w-full border-collapse">
                          <thead>
                            <tr>
                              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider border-b-2 border-gray-200 dark:border-gray-700">
                                Metric
                              </th>
                              {uniqueLlms.map(llm => (
                                <th key={llm} className="px-4 py-3 text-center text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider border-b-2 border-gray-200 dark:border-gray-700 border-l border-gray-200 dark:border-gray-700">
                                  <div className="flex flex-col items-center gap-2">
                                    {LLM_ICONS[llm as keyof typeof LLM_ICONS] && (
                                      <img
                                        src={LLM_ICONS[llm as keyof typeof LLM_ICONS]}
                                        alt={getLlmDisplayName(llm)}
                                        className="w-6 h-6 rounded"
                                      />
                                    )}
                                    <span>{getLlmDisplayName(llm)}</span>
                                  </div>
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            <tr className="border-b border-gray-200 dark:border-gray-700">
                              <td className="px-4 py-4 text-sm font-medium text-gray-900 dark:text-gray-100">
                                Citation Rate
                              </td>
                              {uniqueLlms.map(llm => {
                                const metrics = metricsByLlm[llm];
                                const isDark = document.documentElement.classList.contains('dark');
                                return (
                                  <td
                                    key={llm}
                                    className={`px-4 py-4 text-center border-l border-gray-200 dark:border-gray-700 ${getHeatmapColor(metrics.citationRate, isDark)} transition-colors duration-300`}
                                  >
                                    <div className="flex flex-col items-center gap-1">
                                      <span className="text-lg font-bold text-gray-900 dark:text-white">
                                        {metrics.citationRate}%
                                      </span>
                                      <span className="text-xs text-gray-600 dark:text-gray-300">
                                        {metrics.citedCount}/{metrics.totalResponses} responses
                                      </span>
                                    </div>
                                  </td>
                                );
                              })}
                            </tr>
                            <tr className="border-b border-gray-200 dark:border-gray-700">
                              <td className="px-4 py-4 text-sm font-medium text-gray-900 dark:text-gray-100">
                                Mention Rate
                              </td>
                              {uniqueLlms.map(llm => {
                                const metrics = metricsByLlm[llm];
                                const isDark = document.documentElement.classList.contains('dark');
                                return (
                                  <td
                                    key={llm}
                                    className={`px-4 py-4 text-center border-l border-gray-200 dark:border-gray-700 ${getHeatmapColor(metrics.mentionRate, isDark)} transition-colors duration-300`}
                                  >
                                    <div className="flex flex-col items-center gap-1">
                                      <span className="text-lg font-bold text-gray-900 dark:text-white">
                                        {metrics.mentionRate}%
                                      </span>
                                      <span className="text-xs text-gray-600 dark:text-gray-300">
                                        {metrics.mentionedCount}/{metrics.totalResponses} responses
                                      </span>
                                    </div>
                                  </td>
                                );
                              })}
                            </tr>
                          </tbody>
                        </table>
                      </div>

                      {/* Legend */}
                      <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
                        <div className="flex items-center gap-4 md:gap-6 flex-wrap justify-center">
                          <span className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                            Performance Scale:
                          </span>
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-4 bg-emerald-500 dark:bg-emerald-500/80 rounded"></div>
                            <span className="text-xs text-gray-600 dark:text-gray-400">75-100%</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-4 bg-green-400 dark:bg-green-500/70 rounded"></div>
                            <span className="text-xs text-gray-600 dark:text-gray-400">50-74%</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-4 bg-yellow-300 dark:bg-yellow-500/60 rounded"></div>
                            <span className="text-xs text-gray-600 dark:text-gray-400">25-49%</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-4 bg-orange-300 dark:bg-orange-500/50 rounded"></div>
                            <span className="text-xs text-gray-600 dark:text-gray-400">1-24%</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-4 bg-gray-200 dark:bg-gray-700/40 rounded"></div>
                            <span className="text-xs text-gray-600 dark:text-gray-400">0%</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
                <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                      Citation Rate by Prompt Group
                    </h3>
                    <div className="group relative">
                      <Info className="w-4 h-4 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 cursor-help transition-colors" />
                      <div className="absolute top-full right-0 mt-2 w-80 p-3 bg-gray-900 text-white text-xs rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 pointer-events-none z-10">
                        <div className="font-semibold mb-1">Citation Rate by Prompt Group</div>
                        <div className="mb-2">Shows the percentage of responses that cite your domain (or competitors) for each prompt category.</div>
                        <div className="text-white/70 italic">Formula: (Citations in group / Total responses in group) × 100</div>
                      </div>
                    </div>
                  </div>

                  {(() => {
                    const radarData = promptGroupRadarData;
                    const topCompetitorDomains = getTopCompetitorDomains();
                    const projectDomainName = project?.domain || "Your Domain";

                    // Get consistent color for each domain
                    const allDomains = [projectDomainName, ...topCompetitorDomains.map(d => d.domain)];
                    const getDomainColor = (domainName: string) => {
                      return getBrandColor(domainName, allDomains);
                    };

                    // Determine domains to display
                    let domainsToDisplay: Array<{ name: string; count?: number; isOwnDomain?: boolean }>;

                    if (selectedCompetitorDomains.length > 0) {
                      domainsToDisplay = [
                        { name: projectDomainName, isOwnDomain: true },
                        ...selectedCompetitorDomains.map(d => ({ name: d, isOwnDomain: false }))
                      ];
                    } else if (showCompetitors) {
                      domainsToDisplay = [
                        { name: projectDomainName, isOwnDomain: true },
                        ...topCompetitorDomains.slice(0, 3).map(d => ({ name: d.domain, count: d.count, isOwnDomain: false }))
                      ];
                    } else {
                      domainsToDisplay = [{ name: projectDomainName, isOwnDomain: true }];
                    }

                    if (radarData.length === 0) {
                      return (
                        <div>
                          <div className="mb-4">
                            <label className="flex items-center space-x-2">
                              <input
                                type="checkbox"
                                checked={showCompetitors}
                                onChange={(e) => setShowCompetitors(e.target.checked)}
                                className="w-4 h-4 text-brand-primary border-gray-300 rounded focus:ring-brand-primary"
                              />
                              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                Show Competitors
                              </span>
                            </label>
                          </div>
                          <div className="flex items-center justify-center h-64 text-gray-500 dark:text-gray-400">
                            <div className="text-center">
                              <BarChart3 className="w-12 h-12 mx-auto mb-2 opacity-50" />
                              <p className="text-sm">No citation data available</p>
                              <p className="text-xs">Run an audit to see citation rates</p>
                            </div>
                          </div>
                        </div>
                      );
                    }

                    // Calculate max value across all domains
                    let maxValue = 0;
                    radarData.forEach(item => {
                      maxValue = Math.max(maxValue, item.citationRate || 0);
                      selectedCompetitorDomains.forEach(domain => {
                        maxValue = Math.max(maxValue, item[domain] || 0);
                      });
                    });

                    // Dynamic scale: round up to nearest 5 or 10 depending on magnitude
                    let maxDomain;
                    if (maxValue <= 10) {
                      maxDomain = Math.max(10, Math.ceil(maxValue));
                    } else if (maxValue <= 20) {
                      maxDomain = Math.ceil(maxValue / 5) * 5;
                    } else {
                      maxDomain = Math.ceil(maxValue / 10) * 10;
                    }

                    return (
                      <div className="space-y-4">
                        {/* Competitors Toggle */}
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <label className="flex items-center space-x-2">
                              <input
                                type="checkbox"
                                checked={showCompetitors}
                                onChange={(e) => setShowCompetitors(e.target.checked)}
                                className="w-4 h-4 text-brand-primary border-gray-300 rounded focus:ring-brand-primary"
                              />
                              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                Show Competitors
                              </span>
                            </label>
                          </div>

                          {showCompetitors && topCompetitorDomains.length > 0 && (
                            <div className="space-y-3">
                              {/* Your Domain */}
                              <div className="space-y-2">
                                <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                  Your Domain:
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  <label
                                    className="flex items-center space-x-1 px-3 py-1.5 rounded-full text-xs cursor-default border bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/30"
                                  >
                                    <span className="font-semibold">{projectDomainName}</span>
                                  </label>
                                </div>
                              </div>

                              {/* Competitor Domains */}
                              <div className="space-y-2">
                                <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                  Top Competitor Domains:
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  {topCompetitorDomains.slice(0, 15).map(({ domain, count }) => {
                                    const isSelected = selectedCompetitorDomains.includes(domain);
                                    const domainColor = getDomainColor(domain);
                                    return (
                                      <label
                                        key={domain}
                                        className={`flex items-center space-x-1 px-3 py-1 rounded-full text-xs cursor-pointer transition-colors ${
                                          isSelected
                                            ? 'text-white'
                                            : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                                        }`}
                                        style={isSelected ? { backgroundColor: domainColor } : {}}
                                      >
                                        <input
                                          type="checkbox"
                                          checked={isSelected}
                                          onChange={(e) => {
                                            if (e.target.checked) {
                                              setSelectedCompetitorDomains([...selectedCompetitorDomains, domain]);
                                            } else {
                                              setSelectedCompetitorDomains(selectedCompetitorDomains.filter(d => d !== domain));
                                            }
                                          }}
                                          className="sr-only"
                                        />
                                        <span>{domain}</span>
                                        <span className={isSelected ? 'text-white/70' : 'text-gray-500'}>({count})</span>
                                      </label>
                                    );
                                  })}
                                </div>
                              </div>

                              {selectedCompetitorDomains.length > 0 && (
                                <button
                                  onClick={() => setSelectedCompetitorDomains([])}
                                  className="text-xs text-brand-primary hover:text-brand-secondary transition-colors"
                                >
                                  Clear selection
                                </button>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="h-80">
                          <ResponsiveContainer width="100%" height="100%">
                            <RadarChart data={radarData}>
                              <PolarGrid />
                              <PolarAngleAxis
                                dataKey="group"
                                tick={{ fontSize: 12, fill: 'currentColor' }}
                                className="text-gray-600 dark:text-gray-400"
                              />
                              <PolarRadiusAxis
                                angle={90}
                                domain={[0, maxDomain]}
                                tick={{ fontSize: 10, fill: 'currentColor' }}
                                className="text-gray-500 dark:text-gray-500"
                              />
                              <Radar
                                name={projectDomainName}
                                dataKey="citationRate"
                                stroke={getDomainColor(projectDomainName)}
                                fill={getDomainColor(projectDomainName)}
                                fillOpacity={0.1}
                                strokeWidth={2}
                              />
                              {selectedCompetitorDomains.map((domain) => {
                                const domainColor = getDomainColor(domain);
                                return (
                                  <Radar
                                    key={domain}
                                    name={domain}
                                    dataKey={domain}
                                    stroke={domainColor}
                                    fill={domainColor}
                                    fillOpacity={0.1}
                                    strokeWidth={2}
                                  />
                                );
                              })}
                              <Tooltip
                                contentStyle={{
                                  backgroundColor: 'rgb(var(--bg-surface))',
                                  border: '1px solid rgb(var(--border))',
                                  borderRadius: '12px',
                                  boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                                  fontFamily: 'Plus Jakarta Sans'
                                }}
                                formatter={(value: any, name: string) => [`${value}%`, name]}
                              />
                            </RadarChart>
                          </ResponsiveContainer>
                        </div>

                        <div className="flex flex-wrap gap-4 justify-center">
                          {domainsToDisplay.map((domain) => {
                            const domainColor = getDomainColor(domain.name);
                            return (
                              <div key={domain.name} className="flex items-center space-x-2">
                                <div
                                  className="w-3 h-3 rounded-full"
                                  style={{ backgroundColor: domainColor }}
                                />
                                <span className="text-sm text-gray-600 dark:text-gray-400">
                                  {domain.name}
                                  {domain.count !== undefined && ` (${domain.count} citations)`}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                </div>

                <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                      Mention Rate by Prompt Group
                    </h3>
                    <div className="group relative">
                      <Info className="w-4 h-4 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 cursor-help transition-colors" />
                      <div className="absolute top-full right-0 mt-2 w-80 p-3 bg-gray-900 text-white text-xs rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 pointer-events-none z-10">
                        <div className="font-semibold mb-1">Mention Rate by Prompt Group</div>
                        <div className="mb-2">Shows how often your brand (or competitors) is mentioned in responses for each prompt category.</div>
                        <div className="text-white/70 italic">Formula: (Responses mentioning brand in group / Total responses in group) × 100</div>
                      </div>
                    </div>
                  </div>

                  {(() => {
                    // Extract all brand mentions from answer_competitors using filteredLlmResponses
                    const brandMentions = new Map<string, { total: number; byGroup: Map<string, number> }>();

                    filteredLlmResponses.forEach(response => {
                      if (response.answer_competitors?.brands && Array.isArray(response.answer_competitors.brands)) {
                        const promptGroup = response.prompts?.prompt_group || 'General';

                        response.answer_competitors.brands.forEach((brand: any) => {
                          const brandName = brand.name;
                          if (!brandMentions.has(brandName)) {
                            brandMentions.set(brandName, { total: 0, byGroup: new Map() });
                          }

                          const brandData = brandMentions.get(brandName)!;
                          brandData.total += 1;
                          brandData.byGroup.set(promptGroup, (brandData.byGroup.get(promptGroup) || 0) + 1);
                        });
                      }
                    });

                    // Get our brand names (not competitors)
                    const ourBrandNames = brands
                      .filter(b => !b.is_competitor)
                      .map(b => b.brand_name.toLowerCase());

                    // Check if a brand is our brand (case-insensitive exact match or contains)
                    const isOurBrand = (brandName: string) => {
                      const lowerBrandName = brandName.toLowerCase();
                      return ourBrandNames.some(ourBrand =>
                        lowerBrandName === ourBrand ||
                        lowerBrandName.includes(ourBrand) ||
                        ourBrand.includes(lowerBrandName)
                      );
                    };

                    // Separate own brands and competitors
                    const ownBrands = Array.from(brandMentions.entries())
                      .filter(([name]) => isOurBrand(name))
                      .sort(([,a], [,b]) => b.total - a.total)
                      .map(([name, data]) => ({ name, count: data.total, isOwnBrand: true }));

                    const competitorBrands = Array.from(brandMentions.entries())
                      .filter(([name]) => !isOurBrand(name))
                      .sort(([,a], [,b]) => b.total - a.total)
                      .slice(0, 20)
                      .map(([name, data]) => ({ name, count: data.total, isOwnBrand: false }));

                    // Determine brands to display
                    let brandsToDisplay: Array<{ name: string; count: number; isOwnBrand?: boolean }>;

                    if (selectedCompetitorBrands.length > 0) {
                      // Show selected brands (could be own or competitors)
                      const allBrands = [...ownBrands, ...competitorBrands];
                      brandsToDisplay = allBrands.filter(brand =>
                        selectedCompetitorBrands.includes(brand.name)
                      );
                    } else if (showCompetitorsInBrandChart) {
                      // Show own brands + top 3 competitors
                      brandsToDisplay = [...ownBrands, ...competitorBrands.slice(0, 3)];
                    } else {
                      // Show only own brands
                      brandsToDisplay = ownBrands;
                    }

                    // Get all brands for the selector
                    const allBrandsWithMentions = [...ownBrands, ...competitorBrands];

                    // Calculate mention rates by prompt group for each brand
                    const promptGroups = [...new Set(prompts.map(p => p.prompt_group))];

                    // Empty state — mirrors the Citation Rate card so the user
                    // gets a clear "no data" message instead of an unanchored
                    // chart with no grid (recharts won't render PolarGrid /
                    // PolarRadiusAxis when there is no <Radar> series).
                    if (brandsToDisplay.length === 0) {
                      return (
                        <div>
                          <div className="mb-4">
                            <label className="flex items-center space-x-2">
                              <input
                                type="checkbox"
                                checked={showCompetitorsInBrandChart}
                                onChange={(e) => {
                                  setShowCompetitorsInBrandChart(e.target.checked);
                                  setSelectedCompetitorBrands([]);
                                }}
                                className="w-4 h-4 text-brand-primary border-gray-300 rounded focus:ring-brand-primary"
                              />
                              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                Show Competitors
                              </span>
                            </label>
                          </div>
                          <div className="flex items-center justify-center h-64 text-gray-500 dark:text-gray-400">
                            <div className="text-center">
                              <BarChart3 className="w-12 h-12 mx-auto mb-2 opacity-50" />
                              <p className="text-sm">No brand mention data available</p>
                              <p className="text-xs">
                                {ownBrands.length === 0 && competitorBrands.length > 0
                                  ? 'Toggle "Show Competitors" to see competitor mentions'
                                  : 'Run an audit to see mention rates'}
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    }

                    // Calculate actual mention rates
                    const radarData: any[] = promptGroups.map(group => {
                        // Get all prompts in this group
                        const groupPromptIds = prompts
                          .filter(p => p.prompt_group === group)
                          .map(p => p.id);

                        // Get responses for this group from filteredLlmResponses
                        const groupResponses = filteredLlmResponses.filter(response =>
                          groupPromptIds.includes(response.prompt_id)
                        );

                        const dataPoint: any = { group };

                        brandsToDisplay.forEach(brand => {
                          const mentionCount = groupResponses.filter(response =>
                            response.answer_competitors?.brands?.some((b: any) => b.name === brand.name)
                          ).length;

                          const mentionRate = groupResponses.length > 0 ? (mentionCount / groupResponses.length) * 100 : 0;
                          dataPoint[brand.name] = Math.round(mentionRate);
                        });

                        return dataPoint;
                      }).filter(item => {
                        // Only show groups that have at least one response
                        const groupPromptIds = prompts
                          .filter(p => p.prompt_group === item.group)
                          .map(p => p.id);
                        const groupResponses = filteredLlmResponses.filter(response =>
                          groupPromptIds.includes(response.prompt_id)
                        );
                        return groupResponses.length > 0;
                      });

                    // Get all brands for consistent color assignment
                    const allRadarBrands = Array.from(brandMentions.keys());

                    // Helper function to get consistent color for each brand (using global function)
                    const getRadarBrandColor = (brandName: string) => {
                      return getBrandColor(brandName, allRadarBrands);
                    };

                    // Calculate max value across all brands for dynamic scale
                    let maxValue = 0;
                    radarData.forEach(item => {
                      brandsToDisplay.forEach(brand => {
                        maxValue = Math.max(maxValue, item[brand.name] || 0);
                      });
                    });

                    // Dynamic scale: round up to nearest 5 or 10 depending on magnitude
                    let maxDomain;
                    if (maxValue <= 10) {
                      maxDomain = Math.max(10, Math.ceil(maxValue));
                    } else if (maxValue <= 20) {
                      maxDomain = Math.ceil(maxValue / 5) * 5;
                    } else {
                      maxDomain = Math.ceil(maxValue / 10) * 10;
                    }

                    return (
                      <div className="space-y-4">
                        {/* Competitors Toggle */}
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <label className="flex items-center space-x-2">
                              <input
                                type="checkbox"
                                checked={showCompetitorsInBrandChart}
                                onChange={(e) => {
                                  setShowCompetitorsInBrandChart(e.target.checked);
                                  setSelectedCompetitorBrands([]);
                                }}
                                className="w-4 h-4 text-brand-primary border-gray-300 rounded focus:ring-brand-primary"
                              />
                              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                Show Competitors
                              </span>
                            </label>
                          </div>

                          {showCompetitorsInBrandChart && allBrandsWithMentions.length > 0 && (
                            <div className="space-y-3">
                              {ownBrands.length > 0 && (
                                <div className="space-y-2">
                                  <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                    Your Brands:
                                  </div>
                                  <div className="flex flex-wrap gap-2">
                                    {ownBrands.map(({ name, count }) => {
                                      const isSelected = selectedCompetitorBrands.includes(name);
                                      const brandColor = getRadarBrandColor(name);
                                      return (
                                        <label
                                          key={name}
                                          className={`flex items-center space-x-1 px-3 py-1.5 rounded-full text-xs cursor-pointer transition-colors border ${
                                            isSelected
                                              ? 'text-white border-transparent'
                                              : 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/30 hover:bg-emerald-100 dark:hover:bg-emerald-900/30'
                                          }`}
                                          style={isSelected ? { backgroundColor: brandColor } : {}}
                                        >
                                          <input
                                            type="checkbox"
                                            checked={isSelected}
                                            onChange={(e) => {
                                              if (e.target.checked) {
                                                setSelectedCompetitorBrands([...selectedCompetitorBrands, name]);
                                              } else {
                                                setSelectedCompetitorBrands(selectedCompetitorBrands.filter(b => b !== name));
                                              }
                                            }}
                                            className="sr-only"
                                          />
                                          <span className="font-semibold">{name}</span>
                                          <span className={isSelected ? 'text-white/70' : 'text-emerald-600/70 dark:text-emerald-500/70'}>({count})</span>
                                        </label>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}

                              {competitorBrands.length > 0 && (
                                <div className="space-y-2">
                                  <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                    Top Competitor Brands:
                                  </div>
                                  <div className="flex flex-wrap gap-2">
                                    {competitorBrands.map(({ name, count }) => {
                                      const isSelected = selectedCompetitorBrands.includes(name);
                                      const brandColor = getRadarBrandColor(name);
                                      return (
                                        <label
                                          key={name}
                                          className={`flex items-center space-x-1 px-3 py-1 rounded-full text-xs cursor-pointer transition-colors ${
                                            isSelected
                                              ? 'text-white'
                                              : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                                          }`}
                                          style={isSelected ? { backgroundColor: brandColor } : {}}
                                        >
                                          <input
                                            type="checkbox"
                                            checked={isSelected}
                                            onChange={(e) => {
                                              if (e.target.checked) {
                                                setSelectedCompetitorBrands([...selectedCompetitorBrands, name]);
                                              } else {
                                                setSelectedCompetitorBrands(selectedCompetitorBrands.filter(b => b !== name));
                                              }
                                            }}
                                            className="sr-only"
                                          />
                                          <span>{name}</span>
                                          <span className={isSelected ? 'text-white/70' : 'text-gray-500'}>({count})</span>
                                        </label>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}

                              {selectedCompetitorBrands.length > 0 && (
                                <button
                                  onClick={() => setSelectedCompetitorBrands([])}
                                  className="text-xs text-brand-primary hover:text-brand-secondary transition-colors"
                                >
                                  Clear selection
                                </button>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="h-80">
                          <ResponsiveContainer width="100%" height="100%">
                            <RadarChart data={radarData}>
                              <PolarGrid />
                              <PolarAngleAxis
                                dataKey="group"
                                tick={{ fontSize: 12, fill: 'currentColor' }}
                                className="text-gray-600 dark:text-gray-400"
                              />
                              <PolarRadiusAxis
                                angle={90}
                                domain={[0, maxDomain]}
                                tick={{ fontSize: 10, fill: 'currentColor' }}
                                className="text-gray-500 dark:text-gray-500"
                              />
                              {brandsToDisplay.map((brand) => {
                                const brandColor = getRadarBrandColor(brand.name);
                                return (
                                  <Radar
                                    key={brand.name}
                                    name={brand.name}
                                    dataKey={brand.name}
                                    stroke={brandColor}
                                    fill={brandColor}
                                    fillOpacity={0.1}
                                    strokeWidth={2}
                                  />
                                );
                              })}
                              <Tooltip
                                contentStyle={{
                                  backgroundColor: 'rgb(var(--bg-surface))',
                                  border: '1px solid rgb(var(--border))',
                                  borderRadius: '12px',
                                  boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                                  fontFamily: 'Plus Jakarta Sans'
                                }}
                                formatter={(value: any, name: string) => [`${value}%`, name]}
                              />
                            </RadarChart>
                          </ResponsiveContainer>
                        </div>

                        <div className="flex flex-wrap gap-4 justify-center">
                          {brandsToDisplay.map((brand) => {
                            const brandColor = getRadarBrandColor(brand.name);
                            return (
                              <div key={brand.name} className="flex items-center space-x-2">
                                <div
                                  className="w-3 h-3 rounded-full"
                                  style={{ backgroundColor: brandColor }}
                                />
                                <span className="text-sm text-gray-600 dark:text-gray-400">
                                  {brand.name} ({brand.count} mentions)
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

                </div>
              </div>

              {/* Over Time Charts - 2 Column Layout */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
                {/* Citations Over Time Chart - Column 1 */}
                <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6">
                  <div className="mb-6">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                        Citations Over Time
                      </h3>
                      <div className="group relative">
                        <Info className="w-4 h-4 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 cursor-help transition-colors" />
                        <div className="absolute top-full right-0 mt-2 w-80 p-3 bg-gray-900 text-white text-xs rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 pointer-events-none z-10">
                          <div className="font-semibold mb-1">Citations Over Time</div>
                          <div className="mb-2">Tracks how citation counts evolve over time across all available audit dates. Shows total citations and citations per domain.</div>
                          <div className="text-white/70 italic">Shows absolute citation counts, not percentages</div>
                        </div>
                      </div>
                    </div>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Citation counts across audit dates
                    </p>
                  </div>

                  {(() => {
                    const { chartData, projectDomain, topDomains } = getCitationsOverTime();

                    if (chartData.length === 0) {
                      return (
                        <div className="flex items-center justify-center h-64 text-gray-500 dark:text-gray-400">
                          <div className="text-center">
                            <TrendingUp className="w-12 h-12 mx-auto mb-2 opacity-50" />
                            <p className="text-sm">No citation data available</p>
                            <p className="text-xs">Run multiple audits to see citation trends</p>
                          </div>
                        </div>
                      );
                    }

                    // Initialize default selected domains (top 3 excluding project domain)
                    if (selectedCitationsTrendCompetitors.length === 0 && topDomains.length > 0) {
                      const defaultDomains = topDomains
                        .filter(d => d.domain !== projectDomain)
                        .slice(0, 3)
                        .map(d => d.domain);
                      setSelectedCitationsTrendCompetitors(defaultDomains);
                    }

                    // Get all domains for consistent color assignment
                    const allDomainNames = [
                      ...(projectDomain ? [projectDomain] : []),
                      ...topDomains.map(d => d.domain)
                    ];

                    // Helper function to get color for any domain
                    const getCitationTrendColor = (domain: string) => {
                      return getBrandColor(domain, allDomainNames);
                    };

                    return (
                      <>
                        <div className="mb-4 space-y-3">
                          {topDomains.length > 0 && (
                            <>
                              <div className="flex items-center justify-between">
                                <label className="flex items-center space-x-2">
                                  <input
                                    type="checkbox"
                                    checked={showCompetitorsInCitationsTrend}
                                    onChange={(e) => setShowCompetitorsInCitationsTrend(e.target.checked)}
                                    className="w-4 h-4 text-brand-primary border-gray-300 rounded focus:ring-brand-primary"
                                  />
                                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                    Show Competitor Domains
                                  </span>
                                </label>
                              </div>

                              {showCompetitorsInCitationsTrend && (
                                <div className="space-y-2">
                                  <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                    Top 15 Cited Domains:
                                  </div>
                                  <div className="flex flex-wrap gap-2">
                                    {topDomains.map(({ domain, count }) => {
                                      const isSelected = selectedCitationsTrendCompetitors.includes(domain);
                                      const domainColor = isSelected ? getCitationTrendColor(domain) : undefined;

                                      return (
                                        <label
                                          key={domain}
                                          className={`flex items-center space-x-1 px-3 py-1 rounded-full text-xs cursor-pointer transition-colors ${
                                            isSelected
                                              ? 'text-white'
                                              : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                                          }`}
                                          style={isSelected ? { backgroundColor: domainColor } : {}}
                                        >
                                          <input
                                            type="checkbox"
                                            checked={isSelected}
                                            onChange={(e) => {
                                              if (e.target.checked) {
                                                setSelectedCitationsTrendCompetitors([...selectedCitationsTrendCompetitors, domain]);
                                              } else {
                                                setSelectedCitationsTrendCompetitors(selectedCitationsTrendCompetitors.filter(d => d !== domain));
                                              }
                                            }}
                                            className="sr-only"
                                          />
                                          <span>{domain}</span>
                                          <span className={isSelected ? 'text-white/70' : 'text-gray-500'}>({count})</span>
                                        </label>
                                      );
                                    })}
                                  </div>
                                  {selectedCitationsTrendCompetitors.length > 0 && (
                                    <button
                                      onClick={() => setSelectedCitationsTrendCompetitors([])}
                                      className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                                    >
                                      Clear all
                                    </button>
                                  )}
                                </div>
                              )}
                            </>
                          )}
                        </div>

                        <div className="h-80">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={chartData}>
                              <CartesianGrid
                                strokeDasharray="3 3"
                                stroke="rgb(var(--border))"
                                opacity={0.3}
                              />
                              <XAxis
                                dataKey="date"
                                stroke="rgb(var(--text-muted))"
                                tick={{
                                  fontSize: 12,
                                  fill: 'rgb(var(--text-muted))',
                                  fontFamily: 'Plus Jakarta Sans'
                                }}
                              />
                              <YAxis
                                stroke="rgb(var(--text-muted))"
                                tick={{
                                  fontSize: 12,
                                  fill: 'rgb(var(--text-muted))',
                                  fontFamily: 'Plus Jakarta Sans'
                                }}
                                label={{
                                  value: 'Citations',
                                  angle: -90,
                                  position: 'insideLeft',
                                  style: {
                                    fontSize: 12,
                                    fill: 'rgb(var(--text-muted))',
                                    fontFamily: 'Plus Jakarta Sans'
                                  }
                                }}
                              />
                              <Tooltip
                                contentStyle={{
                                  backgroundColor: 'rgb(var(--bg-surface))',
                                  border: '1px solid rgb(var(--border))',
                                  borderRadius: '12px',
                                  boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                                  fontFamily: 'Plus Jakarta Sans'
                                }}
                                labelStyle={{
                                  color: 'rgb(var(--text-primary))',
                                  fontWeight: 600,
                                  marginBottom: '8px'
                                }}
                              />
                              <Legend
                                wrapperStyle={{
                                  fontFamily: 'Plus Jakarta Sans',
                                  fontSize: '14px'
                                }}
                              />

                              {/* Project domain line */}
                              {projectDomain && (
                                <Line
                                  type="monotone"
                                  dataKey={projectDomain}
                                  name={projectDomain}
                                  stroke={getCitationTrendColor(projectDomain)}
                                  strokeWidth={3}
                                  dot={{
                                    fill: getCitationTrendColor(projectDomain),
                                    strokeWidth: 2,
                                    r: 5
                                  }}
                                  activeDot={{ r: 7 }}
                                />
                              )}

                              {/* Selected domain lines */}
                              {showCompetitorsInCitationsTrend && selectedCitationsTrendCompetitors.map((domain: string) => {
                                const domainColor = getCitationTrendColor(domain);
                                const isProjectDomain = domain === projectDomain;
                                return (
                                  <Line
                                    key={domain}
                                    type="monotone"
                                    dataKey={domain}
                                    name={domain}
                                    stroke={domainColor}
                                    strokeWidth={isProjectDomain ? 3 : 2}
                                    strokeDasharray={isProjectDomain ? undefined : "5 5"}
                                    dot={{
                                      fill: domainColor,
                                      strokeWidth: 2,
                                      r: isProjectDomain ? 5 : 4
                                    }}
                                    activeDot={{ r: isProjectDomain ? 7 : 6 }}
                                  />
                                );
                              })}
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </>
                    );
                  })()}
                </div>

                {/* Brand Mentions Over Time Chart - Column 2 */}
                <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6">
                  <div className="mb-6">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                        Brand Mentions Over Time
                      </h3>
                      <div className="group relative">
                        <Info className="w-4 h-4 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 cursor-help transition-colors" />
                        <div className="absolute top-full right-0 mt-2 w-80 p-3 bg-gray-900 text-white text-xs rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 pointer-events-none z-10">
                          <div className="font-semibold mb-1">Brand Mentions Over Time</div>
                          <div className="mb-2">Tracks how brand mention rates change over time across all available audit dates. Adapts to custom date range when selected.</div>
                          <div className="text-white/70 italic">Formula: (Responses mentioning brand on date / Total responses on date) × 100</div>
                        </div>
                      </div>
                    </div>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Brand mention rates across audit dates
                    </p>
                  </div>

                  {(() => {
                    const { chartData, myBrands, allCompetitors } = getMentionRateByAuditDate();

                    if (chartData.length === 0) {
                      return (
                        <div className="flex items-center justify-center h-64 text-gray-500 dark:text-gray-400">
                          <div className="text-center">
                            <TrendingUp className="w-12 h-12 mx-auto mb-2 opacity-50" />
                            <p className="text-sm">No trend data available</p>
                            <p className="text-xs">Run multiple audits to see mention rate trends</p>
                          </div>
                        </div>
                      );
                    }

                    // Get all brands (myBrands + allCompetitors) for consistent color assignment
                    const allBrandNames = [
                      ...myBrands,
                      ...allCompetitors.map(c => c.brand)
                    ];

                    // Helper function to get color for any brand
                    const getTrendBrandColor = (brand: string) => {
                      return getBrandColor(brand, allBrandNames);
                    };

                    return (
                      <>
                        <div className="mb-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <label className="flex items-center space-x-2">
                              <input
                                type="checkbox"
                                checked={showCompetitorsInTrend}
                                onChange={(e) => setShowCompetitorsInTrend(e.target.checked)}
                                className="w-4 h-4 text-brand-primary border-gray-300 rounded focus:ring-brand-primary"
                              />
                              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                Show Competitors
                              </span>
                            </label>
                          </div>

                          {showCompetitorsInTrend && (
                            <div className="space-y-2">
                              <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                Top Competitors:
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {allCompetitors.slice(0, 15).map(({ brand, count }) => {
                                  const isSelected = selectedTrendCompetitors.includes(brand);
                                  const badgeColor = isSelected ? getTrendBrandColor(brand) : undefined;

                                  return (
                                    <label
                                      key={brand}
                                      className={`flex items-center space-x-1 px-3 py-1 rounded-full text-xs cursor-pointer transition-colors ${
                                        isSelected
                                          ? 'text-white'
                                          : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                                      }`}
                                      style={isSelected ? { backgroundColor: badgeColor } : {}}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={isSelected}
                                        onChange={(e) => {
                                          if (e.target.checked) {
                                            setSelectedTrendCompetitors([...selectedTrendCompetitors, brand]);
                                          } else {
                                            setSelectedTrendCompetitors(selectedTrendCompetitors.filter(b => b !== brand));
                                          }
                                        }}
                                        className="sr-only"
                                      />
                                      <span>{brand}</span>
                                      <span className={isSelected ? 'text-white/70' : 'text-gray-500'}>({count})</span>
                                    </label>
                                  );
                                })}
                              </div>
                              {selectedTrendCompetitors.length > 0 && (
                                <button
                                  onClick={() => setSelectedTrendCompetitors([])}
                                  className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                                >
                                  Clear all
                                </button>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="h-80">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={chartData}>
                              <CartesianGrid
                                strokeDasharray="3 3"
                                stroke="rgb(var(--border))"
                                opacity={0.3}
                              />
                              <XAxis
                                dataKey="date"
                                stroke="rgb(var(--text-muted))"
                                tick={{
                                  fontSize: 12,
                                  fill: 'rgb(var(--text-muted))',
                                  fontFamily: 'Plus Jakarta Sans'
                                }}
                              />
                              <YAxis
                                stroke="rgb(var(--text-muted))"
                                tick={{
                                  fontSize: 12,
                                  fill: 'rgb(var(--text-muted))',
                                  fontFamily: 'Plus Jakarta Sans'
                                }}
                                tickFormatter={(value) => `${value}%`}
                                domain={[0, 100]}
                                label={{
                                  value: 'Mention Rate',
                                  angle: -90,
                                  position: 'insideLeft',
                                  style: {
                                    fontSize: 12,
                                    fill: 'rgb(var(--text-muted))',
                                    fontFamily: 'Plus Jakarta Sans'
                                  }
                                }}
                              />
                              <Tooltip
                                contentStyle={{
                                  backgroundColor: 'rgb(var(--bg-surface))',
                                  border: '1px solid rgb(var(--border))',
                                  borderRadius: '12px',
                                  boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                                  fontFamily: 'Plus Jakarta Sans'
                                }}
                                formatter={(value: any, name: string) => [`${value}%`, name]}
                                labelStyle={{
                                  color: 'rgb(var(--text-primary))',
                                  fontWeight: 600,
                                  marginBottom: '8px'
                                }}
                                itemSorter={(item: any) => -item.value}
                              />
                              <Legend
                                wrapperStyle={{
                                  fontFamily: 'Plus Jakarta Sans',
                                  fontSize: '14px'
                                }}
                              />

                              {/* Always show project brands */}
                              {myBrands.map((brand: string) => {
                                const brandColor = getTrendBrandColor(brand);
                                return (
                                  <Line
                                    key={brand}
                                    type="monotone"
                                    dataKey={brand}
                                    name={brand}
                                    stroke={brandColor}
                                    strokeWidth={3}
                                    dot={{
                                      fill: brandColor,
                                      strokeWidth: 2,
                                      r: 5
                                    }}
                                    activeDot={{ r: 7 }}
                                  />
                                );
                              })}

                              {/* Show competitor brands when toggled */}
                              {showCompetitorsInTrend && selectedTrendCompetitors.map((competitor: string) => {
                                const brandColor = getTrendBrandColor(competitor);
                                return (
                                  <Line
                                    key={competitor}
                                    type="monotone"
                                    dataKey={competitor}
                                    name={competitor}
                                    stroke={brandColor}
                                    strokeWidth={2}
                                    strokeDasharray="5 5"
                                    dot={{
                                      fill: brandColor,
                                      strokeWidth: 2,
                                      r: 4
                                    }}
                                    activeDot={{ r: 6 }}
                                  />
                                );
                              })}
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>

              {/* Brand Leadership Chart */}
              <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                        Brand Leadership
                      </h3>
                      <div className="group relative">
                        <Info className="w-4 h-4 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 cursor-help transition-colors" />
                        <div className="absolute top-full left-0 mt-2 w-80 p-3 bg-gray-900 text-white text-xs rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 pointer-events-none z-10">
                          <div className="font-semibold mb-1">Brand Leadership</div>
                          <div className="mb-2">Ranks all brands (yours and competitors) by how frequently they are mentioned across all LLM responses.</div>
                          <div className="text-white/70 italic">Formula: (Total brand mentions / Total responses) × 100</div>
                        </div>
                      </div>
                    </div>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Competitors ranked by mention rate across all responses
                    </p>
                  </div>
                  <label className="flex items-center space-x-3 cursor-pointer">
                    <span className="text-sm text-gray-700 dark:text-gray-300">Split by LLM</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={splitBrandLeadershipByLlm}
                      onClick={() => setSplitBrandLeadershipByLlm(!splitBrandLeadershipByLlm)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-brand-primary focus:ring-offset-2 ${
                        splitBrandLeadershipByLlm ? 'bg-brand-primary' : 'bg-gray-300 dark:bg-gray-600'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          splitBrandLeadershipByLlm ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </label>
                </div>

                {brandLeadershipData.length > 0 ? (
                  <div className="space-y-6">
                    {/* Horizontal Bar Chart */}
                    <div className="space-y-3">
                      {brandLeadershipData.map((brand, index) => (
                        <div key={brand.name} className={splitBrandLeadershipByLlm ? 'pb-3 border-b border-gray-200 dark:border-gray-700 last:border-b-0 last:pb-0' : ''}>
                          {splitBrandLeadershipByLlm ? (
                            <div className="flex items-start gap-3">
                              <div className="flex items-center space-x-2 w-[200px] flex-shrink-0 pt-1">
                                <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
                                  #{index + 1}
                                </span>
                                {index === 0 && (
                                  <Crown className="w-4 h-4 text-yellow-500" />
                                )}
                                {brand.isOwnBrand && (
                                  <div className="w-2 h-2 rounded-full bg-emerald-500 dark:bg-emerald-400 flex-shrink-0" title="Your Brand" />
                                )}
                                <BrandFavicon name={brand.name} domain={getBrandDomain(brand.name)} size={16} />
                                <span className={`text-sm font-medium truncate ${
                                  brand.isOwnBrand
                                    ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
                                    : 'text-gray-900 dark:text-gray-100'
                                }`}>
                                  {brand.name}
                                </span>
                              </div>
                              <div className="flex-1 space-y-2">
                                {['searchgpt', 'perplexity', 'gemini'].map((llm) => {
                                  if (brand[llm]) {
                                    const llmColors: {[key: string]: string} = {
                                      searchgpt: 'bg-blue-500',
                                      perplexity: 'bg-purple-500',
                                      gemini: 'bg-green-500',
                                    };
                                    return (
                                      <div key={llm} className="flex items-center gap-2">
                                        <img
                                          src={LLM_ICONS[llm as keyof typeof LLM_ICONS]}
                                          alt={llm}
                                          className="w-4 h-4 rounded flex-shrink-0"
                                        />
                                        <div className="relative flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-6 flex items-center">
                                          <div
                                            className={`h-6 rounded-full ${llmColors[llm]} transition-all duration-500 flex items-center justify-end px-2`}
                                            style={{ width: `${brand[`${llm}Rate`]}%` }}
                                          >
                                            <span className="text-[10px] font-semibold text-white whitespace-nowrap">
                                              {brand[llm]} ({brand[`${llm}Rate`]}%)
                                            </span>
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  }
                                  return null;
                                })}
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center gap-3">
                              <div className="flex items-center space-x-2 w-[200px] flex-shrink-0">
                                <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
                                  #{index + 1}
                                </span>
                                {index === 0 && (
                                  <Crown className="w-4 h-4 text-yellow-500 flex-shrink-0" />
                                )}
                                {brand.isOwnBrand && (
                                  <div className="w-2 h-2 rounded-full bg-emerald-500 dark:bg-emerald-400 flex-shrink-0" title="Your Brand" />
                                )}
                                <BrandFavicon name={brand.name} domain={getBrandDomain(brand.name)} size={16} />
                                <span className={`text-sm font-medium truncate ${
                                  brand.isOwnBrand
                                    ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
                                    : 'text-gray-900 dark:text-gray-100'
                                }`}>
                                  {brand.name}
                                </span>
                              </div>
                              <div className="relative flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-6 flex items-center">
                                <div
                                  className="h-6 rounded-full bg-gradient-to-r from-brand-primary to-brand-secondary transition-all duration-500 flex items-center justify-end px-2"
                                  style={{ width: `${brand.mentionRate}%` }}
                                >
                                  <span className="text-[10px] font-semibold text-white whitespace-nowrap">
                                    {brand.mentions} ({brand.mentionRate}%)
                                  </span>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                  </div>
                ) : (
                  <div className="text-center py-12">
                    <BarChart3 className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                    <h4 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
                      No Brand Leadership Data
                    </h4>
                    <p className="text-gray-600 dark:text-gray-400 mb-4">
                      Run an audit to see competitor mention rates and brand leadership insights
                    </p>
                    <Button
                      variant="gradient"
                      onClick={() => setShowRunAuditModal(true)}
                    >
                      <Play className="w-4 h-4 mr-2" />
                      Run Audit
                    </Button>
                  </div>
                )}
              </div>

              {/* Bottom row: web-search / AI result types / cited source categories */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* With or without web-search? */}
              <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6">
                <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">With or without web-search ?</h3>
                {(() => {
                  // Use ALL filtered responses (not just unique ones)
                  const totalResponses = filteredLlmResponses.length;
                  // With Citations: citations is an array (not null), even if empty
                  // Without Citations: citations is null
                  const responsesWithCitations = filteredLlmResponses.filter(
                    response => response.citations !== null && Array.isArray(response.citations)
                  ).length;
                  const responsesWithoutCitations = totalResponses - responsesWithCitations;

                  const pieData = [
                    {
                      name: 'Web-search enabled',
                      value: responsesWithCitations,
                      percentage: totalResponses > 0 ? Math.round((responsesWithCitations / totalResponses) * 100) : 0
                    },
                    {
                      name: 'Web-search disabled',
                      value: responsesWithoutCitations,
                      percentage: totalResponses > 0 ? Math.round((responsesWithoutCitations / totalResponses) * 100) : 0
                    }
                  ];

                  const COLORS = ['rgb(var(--brand-primary))', '#e5e7eb'];
                  const webSearchPercentage = totalResponses > 0 ? Math.round((responsesWithCitations / totalResponses) * 100) : 0;

                  return totalResponses > 0 ? (
                    <div>
                      <div className="h-64 relative">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={pieData}
                              cx="50%"
                              cy="50%"
                              labelLine={false}
                              innerRadius={60}
                              outerRadius={90}
                              fill="#8884d8"
                              dataKey="value"
                              paddingAngle={5}
                              cornerRadius={10}
                            >
                              {pieData.map((entry, index) => (
                                <Cell
                                  key={`cell-${index}`}
                                  fill={COLORS[index % COLORS.length]}
                                  stroke="rgb(var(--bg-surface))"
                                  strokeWidth={2}
                                />
                              ))}
                            </Pie>
                            <Tooltip
                              contentStyle={{
                                backgroundColor: 'rgb(var(--bg-surface))',
                                border: '1px solid rgb(var(--border))',
                                borderRadius: '12px',
                                boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                                fontFamily: 'Plus Jakarta Sans'
                              }}
                              formatter={(value: any, name: string, props: any) => [
                                `${value} (${props.payload.percentage}%)`,
                                name
                              ]}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                          <div className="text-center">
                            <div className="text-4xl font-bold text-gray-900 dark:text-gray-100">
                              {webSearchPercentage}%
                            </div>
                            <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                              web-search
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-4">
                        <div className="text-center">
                          <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                            {responsesWithCitations}
                          </div>
                          <div className="text-sm text-gray-600 dark:text-gray-400">
                            Web-search enabled
                          </div>
                        </div>
                        <div className="text-center">
                          <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                            {responsesWithoutCitations}
                          </div>
                          <div className="text-sm text-gray-600 dark:text-gray-400">
                            Web-search disabled
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-64 text-gray-500 dark:text-gray-400">
                      <div className="text-center">
                        <BarChart3 className="w-12 h-12 mx-auto mb-2 opacity-50" />
                        <p className="text-sm">No response data available</p>
                        <p className="text-xs">Run an audit to see citation coverage</p>
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Types of AI search results */}
              <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6">
                <div className="flex items-center gap-2 mb-4">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Types of AI search results</h3>
                  <div className="group relative">
                    <Info className="w-4 h-4 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 cursor-help transition-colors" />
                    <div className="absolute top-full left-0 mt-2 w-72 p-3 bg-gray-900 text-white text-xs rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 pointer-events-none z-10">
                      <div className="font-semibold mb-1">Types of AI search results</div>
                      <div>Share of responses containing each result block: answer text, shopping product cards, map/place results and sponsored ads (collected for ChatGPT/SearchGPT).</div>
                    </div>
                  </div>
                </div>
                {(() => {
                  const total = filteredLlmResponses.length;
                  const rows = [
                    {
                      key: 'Text answer',
                      icon: <FileText className="w-4 h-4 text-gray-500 flex-shrink-0" />,
                      count: filteredLlmResponses.filter(r => isAnswered(r)).length,
                      bar: 'bg-gradient-to-r from-brand-primary to-brand-secondary',
                    },
                    {
                      key: 'Shopping',
                      icon: <ShoppingBag className="w-4 h-4 text-emerald-500 flex-shrink-0" />,
                      count: filteredLlmResponses.filter(r => r.shopping_visible === true).length,
                      bar: 'bg-emerald-500',
                    },
                    {
                      key: 'Maps / places',
                      icon: <MapIcon className="w-4 h-4 text-blue-500 flex-shrink-0" />,
                      count: filteredLlmResponses.filter(r => r.is_map === true).length,
                      bar: 'bg-blue-500',
                    },
                    {
                      key: 'Sponsored ads',
                      icon: <Megaphone className="w-4 h-4 text-amber-500 flex-shrink-0" />,
                      count: filteredLlmResponses.filter(r => !!r.ad_name).length,
                      bar: 'bg-amber-500',
                    },
                  ];
                  if (total === 0) {
                    return (
                      <div className="flex items-center justify-center h-64 text-gray-500 dark:text-gray-400">
                        <div className="text-center">
                          <BarChart3 className="w-12 h-12 mx-auto mb-2 opacity-50" />
                          <p className="text-sm">No response data available</p>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div className="space-y-4 pt-2">
                      {rows.map(row => {
                        const pct = total > 0 ? Math.round((row.count / total) * 100) : 0;
                        return (
                          <div key={row.key} className="flex items-center gap-3">
                            {row.icon}
                            <span className="text-sm font-medium text-gray-900 dark:text-gray-100 w-28 flex-shrink-0">
                              {row.key}
                            </span>
                            <div className="relative flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-6 flex items-center">
                              <div
                                className={`h-6 rounded-full ${row.bar} transition-all duration-500 flex items-center justify-end px-2`}
                                style={{ width: `${Math.max(pct, row.count > 0 ? 6 : 0)}%` }}
                              >
                                {row.count > 0 && (
                                  <span className="text-[10px] font-semibold text-white whitespace-nowrap">
                                    {row.count} ({pct}%)
                                  </span>
                                )}
                              </div>
                              {row.count === 0 && (
                                <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500 px-2">0</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                      <p className="text-xs text-gray-500 dark:text-gray-400 pt-2">
                        Based on {total} responses in the selected filters. Shopping / maps / ads are detected for ChatGPT & SearchGPT.
                      </p>
                    </div>
                  );
                })()}
              </div>

              {/* Types of cited sources */}
              <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6">
                <div className="flex items-center gap-2 mb-4">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Types of cited sources</h3>
                  <div className="group relative">
                    <Info className="w-4 h-4 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 cursor-help transition-colors" />
                    <div className="absolute top-full right-0 mt-2 w-72 p-3 bg-gray-900 text-white text-xs rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 pointer-events-none z-10">
                      <div className="font-semibold mb-1">Types of cited sources</div>
                      <div>Distribution of cited domains by category (global categories plus your brand / competitor domains) across the citations in the selected filters.</div>
                    </div>
                  </div>
                </div>
                {(() => {
                  const counts = new Map<string, number>();
                  filteredCitations.forEach(c => {
                    if (!c.domain || c.cited === false) return;
                    const cat = getDomainDisplayCategory(c.domain);
                    counts.set(cat, (counts.get(cat) || 0) + 1);
                  });
                  const totalCited = Array.from(counts.values()).reduce((a, b) => a + b, 0);
                  const pieData = Array.from(counts.entries())
                    .map(([name, value]) => ({
                      name,
                      value,
                      percentage: totalCited > 0 ? Math.round((value / totalCited) * 100) : 0,
                    }))
                    .sort((a, b) => b.value - a.value);
                  if (totalCited === 0) {
                    return (
                      <div className="flex items-center justify-center h-64 text-gray-500 dark:text-gray-400">
                        <div className="text-center">
                          <Globe className="w-12 h-12 mx-auto mb-2 opacity-50" />
                          <p className="text-sm">No citation data available</p>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div>
                      <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={pieData}
                              cx="50%"
                              cy="50%"
                              labelLine={false}
                              innerRadius={55}
                              outerRadius={90}
                              dataKey="value"
                              paddingAngle={2}
                              cornerRadius={6}
                            >
                              {pieData.map((entry) => (
                                <Cell
                                  key={entry.name}
                                  fill={CATEGORY_CHART_COLORS[entry.name] || '#9ca3af'}
                                  stroke="rgb(var(--bg-surface))"
                                  strokeWidth={2}
                                />
                              ))}
                            </Pie>
                            <Tooltip
                              contentStyle={{
                                backgroundColor: 'rgb(var(--bg-surface))',
                                border: '1px solid rgb(var(--border))',
                                borderRadius: '12px',
                                boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                                fontFamily: 'Plus Jakarta Sans'
                              }}
                              formatter={(value: any, name: string, props: any) => [
                                `${value} (${props.payload.percentage}%)`,
                                name
                              ]}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5">
                        {pieData.slice(0, 8).map(entry => (
                          <span key={entry.name} className="inline-flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-300">
                            <span
                              className="w-2.5 h-2.5 rounded-full inline-block flex-shrink-0"
                              style={{ backgroundColor: CATEGORY_CHART_COLORS[entry.name] || '#9ca3af' }}
                            />
                            {entry.name} · {entry.percentage}%
                          </span>
                        ))}
                        {pieData.length > 8 && (
                          <span className="text-xs text-gray-400 dark:text-gray-500">+{pieData.length - 8} more</span>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </div>
              </div>
            </div>
          )}

          {activeTab === 'visibility' && (
            <div className="space-y-6">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b-2 border-gray-200 dark:border-gray-700">
                      <th className="sticky left-0 bg-white dark:bg-gray-800 px-4 py-3 text-left text-sm font-semibold text-gray-700 dark:text-gray-300 border-r border-gray-200 dark:border-gray-700 z-10">
                        Prompt
                      </th>
                      {(() => {
                        // Get unique LLMs from llmResponses
                        const uniqueLlms = Array.from(new Set(llmResponses.map(r => r.llm))).sort();

                        return uniqueLlms.map(llm => (
                          <React.Fragment key={llm}>
                            <th className="px-4 py-3 text-center border-r border-gray-200 dark:border-gray-700" colSpan={2}>
                              <div className="flex items-center justify-center gap-2">
                                {LLM_ICONS[llm as keyof typeof LLM_ICONS] && (
                                  <img
                                    src={LLM_ICONS[llm as keyof typeof LLM_ICONS]}
                                    alt={llm}
                                    className="w-5 h-5 object-contain"
                                  />
                                )}
                                <span className="text-sm font-semibold text-gray-700 dark:text-gray-300 capitalize">
                                  {llm.replace(/-/g, ' ')}
                                </span>
                              </div>
                              <div className="flex items-center justify-center gap-4 mt-2">
                                <span className="text-xs text-gray-500 dark:text-gray-400">Mentioned</span>
                                <span className="text-xs text-gray-500 dark:text-gray-400">Cited</span>
                              </div>
                            </th>
                          </React.Fragment>
                        ));
                      })()}
                    </tr>
                  </thead>
                  <tbody>
                    {prompts.map((prompt) => {
                      const uniqueLlms = gridIndexes.uniqueLlms;

                      return (
                        <tr key={prompt.id} className="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                          <td className="sticky left-0 bg-white dark:bg-gray-800 px-4 py-3 text-sm text-gray-900 dark:text-gray-100 border-r border-gray-200 dark:border-gray-700 max-w-xs truncate z-10">
                            <div className="truncate" title={prompt.prompt_text}>
                              {prompt.prompt_text}
                            </div>
                          </td>
                          {uniqueLlms.map(llm => {
                            // Get responses for this prompt and LLM
                            const responsesForPromptLlm =
                              gridIndexes.byPromptLlmAll.get(`${prompt.id}|${llm}`) || EMPTY_ROWS;

                            // Check if brand is mentioned (brand_mentioned field)
                            const isMentioned = responsesForPromptLlm.some(r => r.brand_mentioned === true);

                            // Check if domain is cited
                            const projectDomain = project?.domain;
                            const isCited = responsesForPromptLlm.some(r => {
                              if (!r.citations || !Array.isArray(r.citations)) return false;
                              return r.citations.some((citation: any) => {
                                if (!citation.url) return false;
                                try {
                                  const citationDomain = new URL(citation.url).hostname.replace('www.', '');
                                  // For SearchGPT: only cited=true counts
                                  // For other LLMs: cited=true or cited=null/undefined counts
                                  const shouldCount = llm === 'searchgpt'
                                    ? citation.cited === true
                                    : (citation.cited === true || citation.cited == null);
                                  return citationDomain === projectDomain && shouldCount;
                                } catch {
                                  return false;
                                }
                              });
                            });

                            const hasData = responsesForPromptLlm.length > 0;

                            return (
                              <React.Fragment key={llm}>
                                <td className="px-4 py-3 text-center border-r border-gray-100 dark:border-gray-800">
                                  {!hasData ? (
                                    <span className="text-gray-400 dark:text-gray-600">-</span>
                                  ) : (
                                    <div className="flex justify-center">
                                      <BadgeCheck className={`w-5 h-5 ${isMentioned ? 'text-green-500' : 'text-red-500'}`} />
                                    </div>
                                  )}
                                </td>
                                <td className="px-4 py-3 text-center border-r border-gray-200 dark:border-gray-700">
                                  {!hasData ? (
                                    <span className="text-gray-400 dark:text-gray-600">-</span>
                                  ) : (
                                    <div className="flex justify-center">
                                      <BadgeCheck className={`w-5 h-5 ${isCited ? 'text-green-500' : 'text-red-500'}`} />
                                    </div>
                                  )}
                                </td>
                              </React.Fragment>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {prompts.length === 0 && (
                  <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                    No prompts found for this project.
                  </div>
                )}
              </div>

              <div className="flex items-start gap-2 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                <Info className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-blue-900 dark:text-blue-100">
                  <p className="font-semibold mb-1">Legend:</p>
                  <ul className="space-y-1">
                    <li className="flex items-center gap-2">
                      <BadgeCheck className="w-4 h-4 text-green-500" />
                      <span><strong>Green:</strong> Brand mentioned or domain cited</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <BadgeCheck className="w-4 h-4 text-red-500" />
                      <span><strong>Red:</strong> Brand not mentioned or domain not cited</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-gray-400">-</span>
                      <span><strong>Dash:</strong> No audit data available for this LLM</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'prompts' && (
            <div className="space-y-6">
              <div className="mt-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    Prompts Report
                  </div>
                  <button
                    onClick={exportPromptsToExcel}
                    className="inline-flex items-center gap-2 px-3 py-2 bg-brand-primary hover:bg-brand-primary/90 text-white rounded-lg transition-colors text-sm"
                  >
                    <Download className="w-4 h-4" />
                    Export to Excel
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-gray-700">
                        <th className="text-left py-3 px-2 text-gray-900 dark:text-gray-100">Prompt</th>
                        <th className="text-left py-3 px-2 text-gray-900 dark:text-gray-100">Group</th>
                        <th className="text-center py-3 px-2 text-gray-900 dark:text-gray-100">Mentioned</th>
                        {filteredAuditDates.map(date => (
                          <th key={date} className="text-center py-3 px-2 text-gray-900 dark:text-gray-100 min-w-[120px]">
                            <div className="text-xs">{new Date(date).toLocaleDateString()}</div>
                            <div className="flex justify-center space-x-1 mt-1">
                              <img src={LLM_ICONS.searchgpt} alt="SearchGPT" className="w-3 h-3" />
                              <img src={LLM_ICONS.perplexity} alt="Perplexity" className="w-3 h-3" />
                              <img src={LLM_ICONS.gemini} alt="Gemini" className="w-3 h-3" />
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {prompts
                        .filter(prompt =>
                          filters.promptGroups.length === 0 || filters.promptGroups.includes(prompt.prompt_group)
                        )
                        .map(prompt => (
                          <tr key={prompt.id} className="border-b border-gray-100 dark:border-gray-800">
                            <td className="py-3 px-2 font-medium text-gray-900 dark:text-gray-100">
                              <div className="space-y-2">
                                <button
                                  onClick={() => navigate(`/projects/${id}/prompts/${prompt.id}`)}
                                  className="text-left hover:text-brand-primary transition-colors cursor-pointer"
                                >
                                  {prompt.prompt_text}
                                </button>
                                {(() => {
                                  const webSearchQueries = (gridIndexes.byPromptFiltered.get(prompt.id) || EMPTY_ROWS)
                                    .filter((response: any) => response.web_search_query)
                                    .flatMap(response => {
                                      let queries = response.web_search_query;

                                      // Clean up the query format
                                      if (typeof queries === 'string') {
                                        // Remove brackets and quotes from formats like ["query"] or ['query']
                                        queries = queries.replace(/^\[['"]?|['"]?\]$/g, '').replace(/^['"]|['"]$/g, '');
                                        return [{
                                          query: queries,
                                          llm: response.llm
                                        }];
                                      } else if (Array.isArray(queries)) {
                                        // If it's an array, create separate entries for each query
                                        return queries.map(q => ({
                                          query: q,
                                          llm: response.llm
                                        }));
                                      }

                                      return [];
                                    });

                                  const uniqueQueries = Array.from(
                                    new Map(webSearchQueries.map(item => [item.query + item.llm, item])).values()
                                  );

                                  // Group queries by LLM
                                  const groupedByLlm = uniqueQueries.reduce((acc, item) => {
                                    if (!acc[item.llm]) {
                                      acc[item.llm] = [];
                                    }
                                    acc[item.llm].push(item.query);
                                    return acc;
                                  }, {} as Record<string, string[]>);

                                  if (Object.keys(groupedByLlm).length > 0) {
                                    return (
                                      <div className="flex flex-col gap-2 mt-2">
                                        {Object.entries(groupedByLlm).map(([llm, queries]) => (
                                          <div key={llm} className="flex flex-wrap gap-1">
                                            <img
                                              src={LLM_ICONS[llm as keyof typeof LLM_ICONS]}
                                              alt={llm}
                                              className="w-3 h-3 flex-shrink-0 mt-0.5"
                                            />
                                            {queries.flatMap((query, idx) => {
                                              const splitQueries = query.split('","').map(q => q.replace(/^["']|["']$/g, '').trim()).filter(q => q.length > 0);
                                              return splitQueries.map((splitQuery, splitIdx) => (
                                                <span
                                                  key={`${idx}-${splitIdx}`}
                                                  className={`px-2 py-0.5 rounded text-xs font-medium ${LLM_COLORS[llm as keyof typeof LLM_COLORS]}`}
                                                >
                                                  {splitQuery}
                                                </span>
                                              ));
                                            })}
                                          </div>
                                        ))}
                                      </div>
                                    );
                                  }
                                  return null;
                                })()}
                              </div>
                            </td>
                            <td className="py-3 px-2">
                              <span className="px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded-lg text-xs text-gray-900 dark:text-gray-100">
                                {prompt.prompt_group}
                              </span>
                            </td>
                            <td className="py-3 px-2">
                              <div className="flex justify-center">
                                {(() => {
                                  // Check if project brand is mentioned in any LLM response for this prompt
                                  const myBrands = brands;
                                  const projectBrands = myBrands.map(b => b.brand_name);

                                  const llmResponsesForPrompt = filteredLlmResponses.filter(response =>
                                    response.prompt_id === prompt.id
                                  );

                                  const isProjectBrandMentioned = llmResponsesForPrompt.some(response =>
            rowMentionsAnyName(response, projectBrands));

                                  return isProjectBrandMentioned ? (
                                    <BadgeCheck className="w-5 h-5 text-green-500" />
                                  ) : null;
                                })()}
                              </div>
                            </td>
                            {filteredAuditDates.map(date => {
                              const auditCitations = getFilteredPromptCitationsByAudit(prompt.id, date);
                              return (
                                <td key={date} className="py-3 px-2 text-center">
                                  <div className="flex justify-center space-x-1">
                                    {(filters.llms === 'all' || filters.llms === 'searchgpt') && hasFilteredProjectDomainCitation(auditCitations, 'searchgpt') ? (
                                      <img src={LLM_ICONS.searchgpt} alt="SearchGPT" className="w-4 h-4" />
                                    ) : (filters.llms === 'all' || filters.llms === 'searchgpt') ? (
                                      <span className="w-4 h-4 flex items-center justify-center text-gray-400">-</span>
                                    ) : null}
                                    {(filters.llms === 'all' || filters.llms === 'perplexity') && hasFilteredProjectDomainCitation(auditCitations, 'perplexity') ? (
                                      <img src={LLM_ICONS.perplexity} alt="Perplexity" className="w-4 h-4" />
                                    ) : (filters.llms === 'all' || filters.llms === 'perplexity') ? (
                                      <span className="w-4 h-4 flex items-center justify-center text-gray-400">-</span>
                                    ) : null}
                                    {(filters.llms === 'all' || filters.llms === 'gemini') && hasFilteredProjectDomainCitation(auditCitations, 'gemini') ? (
                                      <img src={LLM_ICONS.gemini} alt="Gemini" className="w-4 h-4" />
                                    ) : (filters.llms === 'all' || filters.llms === 'gemini') ? (
                                      <span className="w-4 h-4 flex items-center justify-center text-gray-400">-</span>
                                    ) : null}
                                  </div>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
              
            </div>
          )}

          {activeTab === 'pages' && (
            <div>
              <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                <div className="inline-flex items-center rounded-xl bg-gray-100 dark:bg-gray-800 p-1">
                  {([['performance', 'Pages Performance'], ['insights', 'Pages Insights']] as const).map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => setPagesView(key)}
                      className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                        pagesView === key
                          ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                          : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {pagesView === 'performance' && (
                <button
                  onClick={exportPagesToExcel}
                  className="inline-flex items-center gap-2 px-3 py-2 bg-brand-primary hover:bg-brand-primary/90 text-white rounded-lg transition-colors text-sm"
                >
                  <Download className="w-4 h-4" />
                  Export to Excel
                </button>
                )}
              </div>
              {pagesView === 'performance' && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700">
                      <th className="text-left py-3 px-2 text-gray-900 dark:text-gray-100">
                        <button
                          onClick={() => handlePageSort('page_url')}
                          className="flex items-center gap-1 hover:text-brand-primary transition-colors"
                        >
                          Page URL
                          {renderSortIcon('page_url', pageSortConfig)}
                        </button>
                      </th>
                      <th className="text-left py-3 px-2 text-gray-900 dark:text-gray-100">
                        <button
                          onClick={() => handlePageSort('domain')}
                          className="flex items-center gap-1 hover:text-brand-primary transition-colors"
                        >
                          Domain
                          {renderSortIcon('domain', pageSortConfig)}
                        </button>
                      </th>
                      <th className="text-left py-3 px-2 text-gray-900 dark:text-gray-100">
                        <button
                          onClick={() => handlePageSort('category')}
                          className="flex items-center gap-1 hover:text-brand-primary transition-colors"
                        >
                          Category
                          {renderSortIcon('category', pageSortConfig)}
                        </button>
                      </th>
                      <th className="text-left py-3 px-2 text-gray-900 dark:text-gray-100">
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => handlePageSort('brandsCount')}
                            className="flex items-center gap-1 hover:text-brand-primary transition-colors"
                          >
                            Brands
                            {renderSortIcon('brandsCount', pageSortConfig)}
                          </button>
                          <span
                            title="Project brands provably tied to this page: found in the answer chunk that cites it (ChatGPT/SearchGPT [N] markers) or in the citation's own title. Perplexity/Gemini/AIO pages rely on titles only, so badges are rarer there."
                          >
                            <Info className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 cursor-help" />
                          </span>
                        </div>
                      </th>
                      <th className="text-center py-3 px-2 text-gray-900 dark:text-gray-100">
                        <button
                          onClick={() => handlePageSort('mentions')}
                          className="flex items-center gap-1 hover:text-brand-primary transition-colors mx-auto"
                        >
                          Citations (Cited)
                          {renderSortIcon('mentions', pageSortConfig)}
                        </button>
                      </th>
                      {auditTrendIndex.ready && (
                        <th className="text-center py-3 px-2 text-gray-900 dark:text-gray-100">
                          <button
                            onClick={() => handlePageSort('trendDelta')}
                            title="Change vs the previous audit: share of answered responses citing this page, in percentage points"
                            className="flex items-center gap-1 hover:text-brand-primary transition-colors mx-auto"
                          >
                            Trend
                            {renderSortIcon('trendDelta', pageSortConfig)}
                          </button>
                        </th>
                      )}
                      <th className="text-center py-3 px-2 text-gray-900 dark:text-gray-100">
                        <button
                          onClick={() => handlePageSort('more_count')}
                          className="flex items-center gap-1 hover:text-brand-primary transition-colors mx-auto"
                        >
                          Citations (More)
                          {renderSortIcon('more_count', pageSortConfig)}
                        </button>
                      </th>
                      <th className="text-center py-3 px-2 text-gray-900 dark:text-gray-100">
                        <button
                          onClick={() => handlePageSort('total_citations')}
                          className="flex items-center gap-1 hover:text-brand-primary transition-colors mx-auto"
                        >
                          Total Citations
                          {renderSortIcon('total_citations', pageSortConfig)}
                        </button>
                      </th>
                      <th className="text-center py-3 px-2 text-gray-900 dark:text-gray-100">
                        <button
                          onClick={() => handlePageSort('all_sources_count')}
                          className="flex items-center gap-1 hover:text-brand-primary transition-colors mx-auto"
                        >
                          All Sources
                          {renderSortIcon('all_sources_count', pageSortConfig)}
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageStatsRows.slice(0, pagesRowLimit).map((page, index) => (
                      <tr key={index} className="border-b border-gray-100 dark:border-gray-800">
                        <td className="py-3 px-2 max-w-md">
                          <div className="flex items-start">
                            <img
                              src={`https://www.google.com/s2/favicons?domain=${extractDomain(page.page_url)}&sz=32`}
                              alt={`${extractDomain(page.page_url)} favicon`}
                              loading="lazy"
                              className="w-4 h-4 mr-2 mt-0.5 flex-shrink-0"
                              onError={(e) => {
                                const target = e.target as HTMLImageElement;
                                target.style.display = 'none';
                              }}
                            />
                            <div className="min-w-0">
                              {page.title && (
                                <div
                                  className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate"
                                  title={page.title}
                                >
                                  {page.title}
                                </div>
                              )}
                              <a
                                href={page.page_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={page.page_url}
                                className={`block truncate hover:underline ${
                                  page.title
                                    ? 'text-xs text-gray-500 dark:text-gray-400 hover:text-brand-primary'
                                    : 'text-sm text-brand-primary'
                                }`}
                              >
                                {page.page_url}
                              </a>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-2 text-gray-900 dark:text-gray-100">{page.domain}</td>
                        <td className="py-3 px-2">
                          <span className={categoryChipClass(page.category)}>
                            {page.category}
                          </span>
                        </td>
                        <td className="py-3 px-2">
                          {page.pageBrands && page.pageBrands.length > 0 ? (
                            <div
                              className="flex items-center gap-1"
                              title={page.pageBrandsComention?.length > 0
                                ? `Also co-mentioned in citing answers: ${page.pageBrandsComention.join(', ')}`
                                : undefined}
                            >
                              {page.pageBrands.slice(0, 6).map((b: any) => (
                                <span
                                  key={b.brand_name}
                                  title={b.brand_name}
                                  className={b.is_competitor ? '' : 'rounded ring-1 ring-emerald-400 ring-offset-1 dark:ring-offset-gray-900'}
                                >
                                  <BrandFavicon name={b.brand_name} domain={getBrandDomain(b.brand_name)} size={16} />
                                </span>
                              ))}
                              {page.pageBrands.length > 6 && (
                                <span className="text-xs text-gray-500 dark:text-gray-400">+{page.pageBrands.length - 6}</span>
                              )}
                            </div>
                          ) : (
                            <span
                              className="text-gray-300 dark:text-gray-600"
                              title={page.pageBrandsComention?.length > 0
                                ? `No exact match; co-mentioned in citing answers: ${page.pageBrandsComention.join(', ')}`
                                : undefined}
                            >
                              —
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-2 text-center text-gray-900 dark:text-gray-100">{page.mentions}</td>
                        {auditTrendIndex.ready && (
                          <td className="py-3 px-2 text-center">
                            <span className="inline-flex items-center gap-1.5">
                              <Sparkline series={page.sparkSeries} />
                              <TrendChip trend={page.trend} />
                            </span>
                          </td>
                        )}
                        <td className="py-3 px-2 text-center text-gray-900 dark:text-gray-100">{page.more_count || 0}</td>
                        <td className="py-3 px-2 text-center text-gray-900 dark:text-gray-100 font-semibold">{page.mentions + (page.more_count || 0)}</td>
                        <td className="py-3 px-2 text-center text-gray-900 dark:text-gray-100">{page.all_sources_count || 0}</td>
                      </tr>
                    ))}
                  {pageStatsRows.length > pagesRowLimit && (
                    <tr>
                      <td colSpan={99} className="py-3 text-center">
                        <button
                          onClick={() => setPagesRowLimit(l => l + 200)}
                          className="px-4 py-1.5 rounded-lg text-sm font-medium text-brand-primary border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                        >
                          Show more ({pagesRowLimit} of {pageStatsRows.length})
                        </button>
                      </td>
                    </tr>
                  )}
                  </tbody>
                </table>
              </div>
              )}

              {pagesView === 'insights' && !auditTrendIndex.ready && (
                <div className="flex items-center justify-center h-48 text-gray-500 dark:text-gray-400 text-sm">
                  Need at least two completed audits with data to build insights
                </div>
              )}
              {pagesView === 'insights' && auditTrendIndex.ready && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {([
                    { title: 'Movers', desc: 'Biggest citing-share gains', up: true },
                    { title: 'Shakers', desc: 'Biggest citing-share losses', up: false },
                  ] as const).map(sec => {
                    const rows = activePageMovers ? (sec.up ? activePageMovers.movers : activePageMovers.shakers) : null;
                    return (
                    <div key={sec.title} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6">
                      <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
                        <div className="flex items-center gap-2">
                          {sec.up
                            ? <TrendingUp className="w-4 h-4 text-emerald-500" />
                            : <TrendingDown className="w-4 h-4 text-red-500" />}
                          <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{sec.title}</h4>
                        </div>
                        <div className="inline-flex items-center rounded-lg bg-gray-100 dark:bg-gray-900/60 p-0.5">
                          {(['last', '7', '14', '30', '90'] as const).map(pp => (
                            <button
                              key={pp}
                              onClick={() => setPagesMoversPeriod(pp)}
                              className={`px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors ${
                                pagesMoversPeriod === pp
                                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
                              }`}
                            >
                              {pp === 'last' ? 'Last' : `${pp}d`}
                            </button>
                          ))}
                        </div>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                        {sec.desc} vs {pagesMoversPeriod === 'last'
                          ? 'the previous audit'
                          : `the audit ~${pagesMoversPeriod} days before the last one`}
                      </p>
                      {rows === null ? (
                        <p className="text-sm text-gray-400 dark:text-gray-500 py-8 text-center">Loading…</p>
                      ) : rows.length === 0 ? (
                        <p className="text-sm text-gray-400 dark:text-gray-500 py-8 text-center">No significant moves</p>
                      ) : (
                        <div className="space-y-2.5">
                          {rows.map((r: any) => (
                            <div key={r.url} className="flex items-center gap-2.5 min-w-0">
                              <img
                                src={`https://www.google.com/s2/favicons?domain=${r.domain}&sz=32`}
                                alt=""
                                className="w-4 h-4 flex-shrink-0"
                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                              />
                              <div className="min-w-0 flex-1">
                                {r.title && (
                                  <div className="text-xs font-medium text-gray-900 dark:text-gray-100 truncate" title={r.title}>
                                    {r.title}
                                  </div>
                                )}
                                <a
                                  href={r.sampleUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title={r.sampleUrl}
                                  className="block text-xs text-brand-primary hover:underline truncate"
                                >
                                  {r.url}
                                </a>
                              </div>
                              <span className={`${categoryChipClass(r.category)} hidden xl:inline-flex flex-shrink-0`}>
                                {r.category}
                              </span>
                              <span className="inline-flex items-center gap-1.5 flex-shrink-0">
                                <Sparkline series={r.series} />
                                <TrendChip trend={r.trend} />
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {activeTab === 'domains' && (
            <div>
              <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                <div className="inline-flex items-center rounded-xl bg-gray-100 dark:bg-gray-800 p-1">
                  {([['performance', 'Domains Performance'], ['insights', 'Domains Insights']] as const).map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => setDomainsView(key)}
                      className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                        domainsView === key
                          ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                          : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {domainsView === 'performance' && (
                <div className="flex items-center gap-3">
                  <select
                    value={domainCategoryFilter}
                    onChange={(e) => setDomainCategoryFilter(e.target.value)}
                    className="px-3 py-2 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-brand-primary"
                  >
                    <option value="all">All categories</option>
                    <option value="Own Brand">Own Brand</option>
                    <option value="Competitor">Competitor</option>
                    {DOMAIN_CATEGORIES.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                    <option value="Unknown">Unknown</option>
                  </select>
                  <button
                    onClick={exportDomainsToExcel}
                    className="inline-flex items-center gap-2 px-3 py-2 bg-brand-primary hover:bg-brand-primary/90 text-white rounded-lg transition-colors text-sm"
                  >
                    <Download className="w-4 h-4" />
                    Export to Excel
                  </button>
                </div>
                )}
              </div>
              {domainsView === 'performance' && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700">
                      <th className="text-left py-3 px-2 text-gray-900 dark:text-gray-100">
                        <button
                          onClick={() => handleDomainSort('domain')}
                          className="flex items-center gap-1 hover:text-brand-primary transition-colors"
                        >
                          Domain
                          {renderSortIcon('domain', domainSortConfig)}
                        </button>
                      </th>
                      <th className="text-left py-3 px-2 text-gray-900 dark:text-gray-100">
                        <button
                          onClick={() => handleDomainSort('category')}
                          className="flex items-center gap-1 hover:text-brand-primary transition-colors"
                        >
                          Category
                          {renderSortIcon('category', domainSortConfig)}
                        </button>
                      </th>
                      <th className="text-center py-3 px-2 text-gray-900 dark:text-gray-100">
                        <button
                          onClick={() => handleDomainSort('mentions')}
                          className="flex items-center gap-1 hover:text-brand-primary transition-colors mx-auto"
                        >
                          Citations (Cited)
                          {renderSortIcon('mentions', domainSortConfig)}
                        </button>
                      </th>
                      {auditTrendIndex.ready && (
                        <th className="text-center py-3 px-2 text-gray-900 dark:text-gray-100">
                          <button
                            onClick={() => handleDomainSort('trendDelta')}
                            title="Change vs the previous audit: share of answered responses citing this domain, in percentage points"
                            className="flex items-center gap-1 hover:text-brand-primary transition-colors mx-auto"
                          >
                            Trend
                            {renderSortIcon('trendDelta', domainSortConfig)}
                          </button>
                        </th>
                      )}
                      <th className="text-center py-3 px-2 text-gray-900 dark:text-gray-100">
                        <button
                          onClick={() => handleDomainSort('citedPrompts')}
                          className="flex items-center gap-1 hover:text-brand-primary transition-colors mx-auto"
                        >
                          Cited Prompts
                          {renderSortIcon('citedPrompts', domainSortConfig)}
                        </button>
                      </th>
                      <th className="text-center py-3 px-2 text-gray-900 dark:text-gray-100">
                        <button
                          onClick={() => handleDomainSort('citedPromptsPercentage')}
                          className="flex items-center gap-1 hover:text-brand-primary transition-colors mx-auto"
                        >
                          % of Cited Prompts
                          {renderSortIcon('citedPromptsPercentage', domainSortConfig)}
                        </button>
                      </th>
                      <th className="text-center py-3 px-2 text-gray-900 dark:text-gray-100">
                        <button
                          onClick={() => handleDomainSort('citedPages')}
                          className="flex items-center gap-1 hover:text-brand-primary transition-colors mx-auto"
                        >
                          Cited Pages
                          {renderSortIcon('citedPages', domainSortConfig)}
                        </button>
                      </th>
                      <th className="text-center py-3 px-2 text-gray-900 dark:text-gray-100">
                        <button
                          onClick={() => handleDomainSort('citationsMore')}
                          className="flex items-center gap-1 hover:text-brand-primary transition-colors mx-auto"
                        >
                          Citations (More)
                          {renderSortIcon('citationsMore', domainSortConfig)}
                        </button>
                      </th>
                      <th className="text-center py-3 px-2 text-gray-900 dark:text-gray-100">
                        <button
                          onClick={() => handleDomainSort('totalCitations')}
                          className="flex items-center gap-1 hover:text-brand-primary transition-colors mx-auto"
                        >
                          Total Citations
                          {renderSortIcon('totalCitations', domainSortConfig)}
                        </button>
                      </th>
                      <th className="text-center py-3 px-2 text-gray-900 dark:text-gray-100">
                        <button
                          onClick={() => handleDomainSort('audits')}
                          className="flex items-center gap-1 hover:text-brand-primary transition-colors mx-auto"
                        >
                          Audits
                          {renderSortIcon('audits', domainSortConfig)}
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {domainStatsRows.slice(0, domainsRowLimit).map((domain: any, index) => (
                      <tr key={index} className="border-b border-gray-100 dark:border-gray-800">
                        <td className="py-3 px-2 font-medium text-gray-900 dark:text-gray-100">
                          <div className="flex items-center">
                            <img
                              src={`https://www.google.com/s2/favicons?domain=${domain.domain}&sz=32`}
                              alt={`${domain.domain} favicon`}
                              loading="lazy"
                              className="w-4 h-4 mr-2"
                              onError={(e) => {
                                const target = e.target as HTMLImageElement;
                                target.style.display = 'none';
                              }}
                            />
                            <button
                              onClick={() => navigate(`/projects/${project.id}/domains/${encodeURIComponent(domain.domain)}`)}
                              className="text-sm font-medium text-brand-primary hover:underline"
                            >
                              {domain.domain}
                            </button>
                          </div>
                        </td>
                        <td className="py-3 px-2">
                          <span className={categoryChipClass(domain.category)}>
                            {domain.category}
                          </span>
                        </td>
                        <td className="py-3 px-2 text-center text-gray-900 dark:text-gray-100">{domain.mentions}</td>
                        {auditTrendIndex.ready && (
                          <td className="py-3 px-2 text-center">
                            <span className="inline-flex items-center gap-1.5">
                              <Sparkline series={domain.sparkSeries} />
                              <TrendChip trend={domain.trend} />
                            </span>
                          </td>
                        )}
                        <td className="py-3 px-2 text-center text-gray-900 dark:text-gray-100">
                          {domain.citedPrompts || 0}
                        </td>
                        <td className="py-3 px-2 text-center text-gray-900 dark:text-gray-100">
                          <div className="flex items-center space-x-3">
                            <div className="flex-1">
                              <Progress
                                value={domain.citedPromptsPercentage}
                                className="h-2"
                              />
                            </div>
                            <span className="text-sm font-medium min-w-[3rem] text-right">
                              {domain.citedPromptsPercentage}%
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-2 text-center text-gray-900 dark:text-gray-100">
                          {domain.citedPages || 0}
                        </td>
                        <td className="py-3 px-2 text-center text-gray-900 dark:text-gray-100">
                          {domain.citationsMore || 0}
                        </td>
                        <td className="py-3 px-2 text-center text-gray-900 dark:text-gray-100 font-semibold">
                          {domain.totalCitations || 0}
                        </td>
                        <td className="py-3 px-2 text-center text-gray-900 dark:text-gray-100">
                          {domain.audits || 0}
                        </td>
                      </tr>
                    ))}
                  {domainStatsRows.length > domainsRowLimit && (
                    <tr>
                      <td colSpan={99} className="py-3 text-center">
                        <button
                          onClick={() => setDomainsRowLimit(l => l + 200)}
                          className="px-4 py-1.5 rounded-lg text-sm font-medium text-brand-primary border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                        >
                          Show more ({domainsRowLimit} of {domainStatsRows.length})
                        </button>
                      </td>
                    </tr>
                  )}
                  </tbody>
                </table>
              </div>
              )}

              {domainsView === 'insights' && !domainsInsights && (
                <div className="flex items-center justify-center h-48 text-gray-500 dark:text-gray-400 text-sm">
                  Need at least two completed audits with data to build insights
                </div>
              )}
              {domainsView === 'insights' && domainsInsights && (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {([
                      { title: 'Movers', desc: 'Biggest citing-share gains', up: true },
                      { title: 'Shakers', desc: 'Biggest citing-share losses', up: false },
                    ] as const).map(sec => {
                      const rows = activeMovers ? (sec.up ? activeMovers.movers : activeMovers.shakers) : null;
                      return (
                      <div key={sec.title} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6">
                        <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
                          <div className="flex items-center gap-2">
                            {sec.up
                              ? <TrendingUp className="w-4 h-4 text-emerald-500" />
                              : <TrendingDown className="w-4 h-4 text-red-500" />}
                            <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{sec.title}</h4>
                          </div>
                          <div className="inline-flex items-center rounded-lg bg-gray-100 dark:bg-gray-900/60 p-0.5">
                            {(['last', '7', '14', '30', '90'] as const).map(pp => (
                              <button
                                key={pp}
                                onClick={() => setMoversPeriod(pp)}
                                className={`px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors ${
                                  moversPeriod === pp
                                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
                                }`}
                              >
                                {pp === 'last' ? 'Last' : `${pp}d`}
                              </button>
                            ))}
                          </div>
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                          {sec.desc} vs {moversPeriod === 'last'
                            ? 'the previous audit'
                            : `the audit ~${moversPeriod} days before the last one`}
                        </p>
                        {rows === null ? (
                          <p className="text-sm text-gray-400 dark:text-gray-500 py-8 text-center">Loading…</p>
                        ) : rows.length === 0 ? (
                          <p className="text-sm text-gray-400 dark:text-gray-500 py-8 text-center">No significant moves</p>
                        ) : (
                          <div className="space-y-2.5">
                            {rows.map((r: any) => (
                              <div key={r.domain} className="flex items-center gap-2.5 min-w-0">
                                <img
                                  src={`https://www.google.com/s2/favicons?domain=${r.domain}&sz=32`}
                                  alt=""
                                  className="w-4 h-4 flex-shrink-0"
                                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                />
                                <button
                                  onClick={() => navigate(`/projects/${project.id}/domains/${encodeURIComponent(r.domain)}`)}
                                  className="text-sm font-medium text-brand-primary hover:underline truncate"
                                >
                                  {r.domain}
                                </button>
                                <span className={`${categoryChipClass(r.category)} hidden sm:inline-flex flex-shrink-0`}>
                                  {r.category}
                                </span>
                                <span className="ml-auto inline-flex items-center gap-1.5 flex-shrink-0">
                                  <Sparkline series={r.series} />
                                  <TrendChip trend={r.trend} />
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      );
                    })}
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6">
                      <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">Domain categories distribution</h4>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">Cited sources by category, current filters</p>
                      {domainsInsights.totalCited === 0 ? (
                        <p className="text-sm text-gray-400 dark:text-gray-500 py-8 text-center">No citation data</p>
                      ) : (
                        <>
                          <div className="h-64">
                            <ResponsiveContainer width="100%" height="100%">
                              <PieChart>
                                <Pie
                                  data={domainsInsights.pie}
                                  cx="50%"
                                  cy="50%"
                                  labelLine={false}
                                  innerRadius={55}
                                  outerRadius={90}
                                  dataKey="value"
                                  paddingAngle={2}
                                  cornerRadius={6}
                                >
                                  {domainsInsights.pie.map(entry => (
                                    <Cell
                                      key={entry.name}
                                      fill={CATEGORY_CHART_COLORS[entry.name] || '#9ca3af'}
                                      stroke="rgb(var(--bg-surface))"
                                      strokeWidth={2}
                                    />
                                  ))}
                                </Pie>
                                <Tooltip
                                  contentStyle={{
                                    backgroundColor: 'rgb(var(--bg-surface))',
                                    border: '1px solid rgb(var(--border))',
                                    borderRadius: '12px',
                                    boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                                    fontFamily: 'Plus Jakarta Sans'
                                  }}
                                  formatter={(value: any, name: string, props: any) => [
                                    `${value} (${props.payload.percentage}%)`,
                                    name
                                  ]}
                                />
                              </PieChart>
                            </ResponsiveContainer>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5">
                            {domainsInsights.pie.slice(0, 8).map(entry => (
                              <span key={entry.name} className="inline-flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-300">
                                <span
                                  className="w-2.5 h-2.5 rounded-full inline-block flex-shrink-0"
                                  style={{ backgroundColor: CATEGORY_CHART_COLORS[entry.name] || '#9ca3af' }}
                                />
                                {entry.name} · {entry.percentage}%
                              </span>
                            ))}
                            {domainsInsights.pie.length > 8 && (
                              <span className="text-xs text-gray-400 dark:text-gray-500">+{domainsInsights.pie.length - 8} more</span>
                            )}
                          </div>
                        </>
                      )}
                    </div>

                    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6">
                      <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">Categories dynamics</h4>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">Share of answers citing each category, per audit</p>
                      <div className="h-72">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={domainsInsights.dynamics} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" />
                            <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="rgb(var(--text-secondary))" />
                            <YAxis tick={{ fontSize: 11 }} unit="%" stroke="rgb(var(--text-secondary))" />
                            <Tooltip
                              contentStyle={{
                                backgroundColor: 'rgb(var(--bg-surface))',
                                border: '1px solid rgb(var(--border))',
                                borderRadius: '12px',
                                boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                                fontFamily: 'Plus Jakarta Sans'
                              }}
                              formatter={(value: any, name: string) => [`${value}%`, name]}
                            />
                            <Legend wrapperStyle={{ fontSize: 11 }} />
                            {domainsInsights.topCats.map(cat => (
                              <Line
                                key={cat}
                                type="monotone"
                                dataKey={cat}
                                stroke={CATEGORY_CHART_COLORS[cat] || '#9ca3af'}
                                strokeWidth={2}
                                dot={false}
                              />
                            ))}
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'ads' && (
            <div className="space-y-6">
              {(!adsDash.loaded || adsDash.loading) ? (
                <div className="flex items-center justify-center py-16">
                  <LoadingSpinner size="lg" />
                </div>
              ) : (() => {
                // Honor the selected period: the tab's dataset is loaded
                // once (since ads collection began) and windowed here.
                const adsWin = resolveDateWindow(globalFilters, null);
                const inAdsWin = (iso: string | null | undefined) => {
                  if (!adsWin) return true;
                  if (!iso) return false;
                  const t = new Date(iso).getTime();
                  return t >= adsWin.start.getTime() && t <= adsWin.end.getTime();
                };
                const winAudits = adsDash.audits.filter(a => inAdsWin(a.created_at));
                const totalAnswered = winAudits.reduce(
                  (sum, a) => sum + (adsDash.searchgptStats[a.id]?.answered || 0), 0);
                const adRows = adsDash.adRows.filter(r => inAdsWin(r.created_at));
                const adRate = totalAnswered > 0 ? Math.round((adRows.length / totalAnswered) * 100) : 0;

                const ownKeys = new Set(brands.map(b => normalizeBrandKey(b.brand_name || '')));
                const compKeys = new Set(competitors.map(b => normalizeBrandKey(b.brand_name || '')));

                // Organic presence: is the advertiser/merchant also visible
                // organically (cited domains or extracted brand mentions)?
                // Window = the page's loaded data (recent audits).
                const organicDomains = new Set<string>();
                processedCitations.forEach(c => {
                  if (c.domain) organicDomains.add(String(c.domain).toLowerCase().replace(/^www\./, ''));
                });
                const organicBrandKeys = new Set<string>();
                llmResponses.forEach(r => {
                  const bs = r.answer_competitors?.brands;
                  if (Array.isArray(bs)) bs.forEach((b: any) => {
                    if (b?.name) organicBrandKeys.add(normalizeBrandKey(b.name));
                  });
                });
                const isOrganic = (name: string, domain: string) =>
                  (domain && organicDomains.has(domain)) || organicBrandKeys.has(normalizeBrandKey(name));

                const advMap = new Map<string, any>();
                adRows.forEach(r => {
                  const key = r.ad_name;
                  let a = advMap.get(key);
                  if (!a) {
                    const nk = normalizeBrandKey(key);
                    const domain = r.ad_url ? extractDomain(r.ad_url) : '';
                    a = {
                      name: key,
                      domain,
                      count: 0,
                      lastSeen: r.created_at,
                      isOwn: ownKeys.has(nk),
                      isCompetitor: compKeys.has(nk),
                      organic: isOrganic(key, domain),
                      category: domain ? adsDash.advCategories[domain] : undefined,
                    };
                    advMap.set(key, a);
                  }
                  a.count += 1;
                  if (r.created_at > a.lastSeen) a.lastSeen = r.created_at;
                });
                const advertisers = Array.from(advMap.values()).sort((x, y) => y.count - x.count);
                const competitorAds = advertisers.filter(a => a.isCompetitor).reduce((s, a) => s + a.count, 0);
                const organicAdvertisers = advertisers.filter(a => a.organic).length;

                // Shopping merchants: who sells in the product cards.
                const merchMap = new Map<string, any>();
                adsDash.shoppingRows.filter(r => inAdsWin(r.created_at)).forEach(r => {
                  const perResponse = new Set<string>();
                  (r.shopping || []).forEach((card: any) => {
                    const name = card?.merchants || (card?.link ? extractDomain(card.link) : '');
                    if (!name || perResponse.has(name)) return; // once per answer
                    perResponse.add(name);
                    let m = merchMap.get(name);
                    if (!m) {
                      const nk = normalizeBrandKey(name);
                      m = {
                        name,
                        domain: card?.link ? extractDomain(card.link) : '',
                        count: 0,
                        isOwn: ownKeys.has(nk),
                        isCompetitor: compKeys.has(nk),
                        examples: [] as string[],
                      };
                      merchMap.set(name, m);
                    }
                    m.count += 1;
                    if (card?.title && m.examples.length < 2 && !m.examples.includes(card.title)) {
                      m.examples.push(card.title);
                    }
                  });
                });
                const merchants = Array.from(merchMap.values()).sort((a, b) => b.count - a.count);

                // Advertiser mix by domain category.
                const advCatCounts = new Map<string, number>();
                advertisers.forEach(a => {
                  const cat = a.isCompetitor ? 'Competitor' : (a.category || 'Unknown');
                  advCatCounts.set(cat, (advCatCounts.get(cat) || 0) + a.count);
                });

                const adsByAudit = new Map<string, number>();
                adRows.forEach(r => adsByAudit.set(r.audit_id, (adsByAudit.get(r.audit_id) || 0) + 1));
                const evolution = winAudits
                  .filter(a => (adsDash.searchgptStats[a.id]?.answered || 0) > 0)
                  .map(a => {
                    const answered = adsDash.searchgptStats[a.id].answered;
                    const ads = adsByAudit.get(a.id) || 0;
                    return {
                      date: new Date(a.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                      rate: Math.round((ads / answered) * 100),
                      ads,
                      answered,
                    };
                  });

                const promptCounts = new Map<string, number>();
                adRows.forEach(r => {
                  const t = r.prompts?.prompt_text;
                  if (t) promptCounts.set(t, (promptCounts.get(t) || 0) + 1);
                });
                const topPrompts = Array.from(promptCounts.entries())
                  .sort((a, b) => b[1] - a[1]).slice(0, 8);

                if (totalAnswered === 0) {
                  return (
                    <div className="text-center py-16 text-gray-500 dark:text-gray-400">
                      <Megaphone className="w-12 h-12 mx-auto mb-3 opacity-50" />
                      <p className="text-sm">No ChatGPT/SearchGPT answers collected since Aug 19, 2026 yet.</p>
                      <p className="text-xs mt-1">Sponsored-ad tracking starts with audits run after that date.</p>
                    </div>
                  );
                }

                return (
                  <>
                    {/* KPIs */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5">
                        <div className="text-xs text-gray-500 dark:text-gray-400">Ad pressure</div>
                        <div className="text-3xl font-bold text-gray-900 dark:text-gray-100 mt-1">{adRate}%</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">of answers contain a sponsored ad</div>
                      </div>
                      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5">
                        <div className="text-xs text-gray-500 dark:text-gray-400">Answers with ads</div>
                        <div className="text-3xl font-bold text-gray-900 dark:text-gray-100 mt-1">{adRows.length}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">of {totalAnswered} ChatGPT answers</div>
                      </div>
                      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5">
                        <div className="text-xs text-gray-500 dark:text-gray-400">Advertisers</div>
                        <div className="text-3xl font-bold text-gray-900 dark:text-gray-100 mt-1">{advertisers.length}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">unique brands buying placement</div>
                      </div>
                      <div className={`rounded-2xl border p-5 ${competitorAds > 0
                        ? 'bg-rose-50 dark:bg-rose-900/20 border-rose-200 dark:border-rose-800/40'
                        : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'}`}>
                        <div className="text-xs text-gray-500 dark:text-gray-400">Competitor ads</div>
                        <div className={`text-3xl font-bold mt-1 ${competitorAds > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-gray-900 dark:text-gray-100'}`}>
                          {competitorAds}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">impressions by your competitors</div>
                      </div>
                    </div>

                    {/* Evolution */}
                    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6">
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">Ad presence over time</h3>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                        Share of ChatGPT answers containing a sponsored ad, per audit. Tracking since Aug 19, 2026.
                      </p>
                      {evolution.length > 1 ? (
                        <div className="h-64">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={evolution}>
                              <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" />
                              <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                              <YAxis unit="%" tick={{ fontSize: 12 }} allowDecimals={false} />
                              <Tooltip
                                contentStyle={{
                                  backgroundColor: 'rgb(var(--bg-surface))',
                                  border: '1px solid rgb(var(--border))',
                                  borderRadius: '12px',
                                  fontFamily: 'Plus Jakarta Sans'
                                }}
                                formatter={(value: any, _n: string, props: any) => [
                                  `${value}% (${props.payload.ads}/${props.payload.answered} answers)`, 'Ad presence'
                                ]}
                              />
                              <Line type="monotone" dataKey="rate" stroke="rgb(var(--brand-primary))" strokeWidth={2} dot={{ r: 3 }} />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      ) : (
                        <div className="text-sm text-gray-500 dark:text-gray-400 py-8 text-center">
                          Need at least two audits with ChatGPT answers to draw the trend
                          {evolution.length === 1 && ` — current: ${evolution[0].rate}% (${evolution[0].ads}/${evolution[0].answered})`}.
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      {/* Top advertisers */}
                      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6">
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Top advertisers</h3>
                        {advertisers.length > 0 ? (
                          <div className="space-y-2.5">
                            {advertisers.slice(0, 10).map(a => (
                              <div key={a.name} className="flex items-center gap-2">
                                <BrandFavicon name={a.name} domain={a.domain || getBrandDomain(a.name)} size={18} />
                                <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{a.name}</span>
                                {a.isCompetitor && (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 uppercase flex-shrink-0">Competitor</span>
                                )}
                                {a.isOwn && (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 uppercase flex-shrink-0">You</span>
                                )}
                                {a.category && (
                                  <span className={`${categoryChipClass(a.category)} flex-shrink-0`}>{a.category}</span>
                                )}
                                <span
                                  title={a.organic
                                    ? 'Also visible organically in this project (cited domain or extracted brand mention)'
                                    : 'Buys placement but has no organic presence in the loaded data — pure paid play'}
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-semibold flex-shrink-0 ${a.organic
                                    ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300'
                                    : 'border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400'}`}
                                >
                                  {a.organic ? 'Paid + cited' : 'Paid only'}
                                </span>
                                <div className="ml-auto flex items-center gap-3 flex-shrink-0">
                                  <span className="text-xs text-gray-500 dark:text-gray-400">
                                    {new Date(a.lastSeen).toLocaleDateString()}
                                  </span>
                                  <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 w-14 text-right">
                                    {a.count} · {Math.round((a.count / adRows.length) * 100)}%
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-gray-500 dark:text-gray-400 py-6 text-center">No sponsored ads detected yet.</p>
                        )}
                      </div>

                      {/* Prompts triggering ads */}
                      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6">
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">Prompts triggering ads</h3>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">High commercial intent — advertisers bid on these conversations.</p>
                        {topPrompts.length > 0 ? (
                          <div className="space-y-2">
                            {topPrompts.map(([text, n]) => (
                              <div key={text} className="flex items-start gap-2 text-sm">
                                <span className="inline-flex items-center justify-center min-w-[1.5rem] h-6 rounded-md bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-xs font-semibold flex-shrink-0">{n}</span>
                                <span className="text-gray-700 dark:text-gray-300">{text}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-gray-500 dark:text-gray-400 py-6 text-center">No sponsored ads detected yet.</p>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      {/* Top shopping merchants */}
                      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6">
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">Top shopping merchants</h3>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                          Who sells in the product cards ChatGPT shows — commercial presence beyond classic citations.
                        </p>
                        {merchants.length > 0 ? (
                          <div className="space-y-2.5">
                            {merchants.slice(0, 10).map(m => (
                              <div key={m.name} className="flex items-center gap-2">
                                <BrandFavicon name={m.name} domain={m.domain || getBrandDomain(m.name)} size={18} />
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{m.name}</span>
                                    {m.isCompetitor && (
                                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 uppercase flex-shrink-0">Competitor</span>
                                    )}
                                    {m.isOwn && (
                                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 uppercase flex-shrink-0">You</span>
                                    )}
                                  </div>
                                  {m.examples.length > 0 && (
                                    <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{m.examples.join(' · ')}</div>
                                  )}
                                </div>
                                <span className="ml-auto text-sm font-semibold text-gray-900 dark:text-gray-100 flex-shrink-0">
                                  {m.count}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-gray-500 dark:text-gray-400 py-6 text-center">No shopping cards detected yet.</p>
                        )}
                      </div>

                      {/* Advertiser mix */}
                      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6">
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">Advertiser mix</h3>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                          Who buys placement (by domain category) and how many also show up organically.
                        </p>
                        {advertisers.length > 0 ? (
                          <div className="space-y-4">
                            <div className="flex flex-wrap gap-2">
                              {Array.from(advCatCounts.entries())
                                .sort((a, b) => b[1] - a[1])
                                .map(([cat, n]) => (
                                  <span key={cat} className={`${categoryChipClass(cat)}`}>
                                    {cat} · {n}
                                  </span>
                                ))}
                            </div>
                            <div className="grid grid-cols-2 gap-4 pt-2">
                              <div className="text-center bg-violet-50 dark:bg-violet-900/20 rounded-xl p-3">
                                <div className="text-2xl font-bold text-violet-700 dark:text-violet-300">{organicAdvertisers}</div>
                                <div className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">paid + organically cited</div>
                              </div>
                              <div className="text-center bg-amber-50 dark:bg-amber-900/20 rounded-xl p-3">
                                <div className="text-2xl font-bold text-amber-700 dark:text-amber-300">{advertisers.length - organicAdvertisers}</div>
                                <div className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">paid only — no organic footprint</div>
                              </div>
                            </div>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                              «Paid only» advertisers compensate a weak organic GEO position with budget — a gap you can exploit organically.
                            </p>
                          </div>
                        ) : (
                          <p className="text-sm text-gray-500 dark:text-gray-400 py-6 text-center">No sponsored ads detected yet.</p>
                        )}
                      </div>
                    </div>

                    {/* Ad examples */}
                    {adRows.length > 0 && (
                      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6">
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Latest ad examples</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                          {adRows.slice(0, 6).map(r => (
                            <div key={r.id} className="bg-amber-50/50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/40 rounded-xl p-4">
                              <div className="flex items-center gap-2 mb-2">
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 uppercase">Ad</span>
                                <BrandFavicon name={r.ad_name} domain={r.ad_url ? extractDomain(r.ad_url) : getBrandDomain(r.ad_name)} size={16} />
                                <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{r.ad_name}</span>
                                <span className="ml-auto text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">
                                  {new Date(r.created_at).toLocaleDateString()}
                                </span>
                              </div>
                              {Array.isArray(r.ad_cards) && r.ad_cards.length > 0 && (
                                <div className="space-y-2">
                                  {r.ad_cards.slice(0, 2).map((card: any, i: number) => (
                                    <a
                                      key={i}
                                      href={card.target_url || undefined}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="flex gap-2 bg-white dark:bg-gray-800 rounded-lg p-2 border border-amber-100 dark:border-amber-900/40 hover:border-amber-300 transition-colors"
                                    >
                                      {card.image_url && <img src={card.image_url} alt="" className="w-12 h-12 rounded object-cover flex-shrink-0" />}
                                      <div className="min-w-0">
                                        <div className="text-xs font-medium text-gray-900 dark:text-gray-100 line-clamp-1">{card.title}</div>
                                        <div className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2">{card.body}</div>
                                      </div>
                                    </a>
                                  ))}
                                </div>
                              )}
                              {r.prompts?.prompt_text && (
                                <div className="mt-2 text-xs text-gray-500 dark:text-gray-400 line-clamp-2">
                                  Prompt: {r.prompts.prompt_text}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          )}

          {activeTab === 'citation-funnel' && (
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <div className="flex items-start justify-between flex-wrap gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">Citation Funnel</h3>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 border border-amber-300/60 dark:border-amber-700/40">
                          Experimental
                        </span>
                      </div>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                        How your domain travels through ChatGPT's search pipeline: retrieved &rarr; sources panel &rarr; cited in the answer.
                        {cfData && (
                          <span className="ml-1 text-gray-500 dark:text-gray-500">
                            Audit of {new Date(cfData.auditDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} &middot; SearchGPT only.
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {cfLoading ? (
                    <div className="flex items-center justify-center h-64"><LoadingSpinner size="lg" /></div>
                  ) : cfError ? (
                    <p className="text-sm text-gray-500 dark:text-gray-400 py-10 text-center">{cfError}</p>
                  ) : !citationFunnel ? (
                    <p className="text-sm text-gray-500 dark:text-gray-400 py-10 text-center">No data</p>
                  ) : (
                    <div className="h-[440px]">
                      <CitationSankey f={citationFunnel} />
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">How the stages are defined</h4>
                </CardHeader>
                <CardContent>
                  <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1.5">
                    <li><b>Web Search Enabled</b> &mdash; the answer carries search-attributed links (utm marker) or a sources panel. ChatGPT's own flag is unreliable and is not used.</li>
                    <li><b>Present in Sources</b> &mdash; your domain appears anywhere in the retrieved set: answer links, the sources panel, or the &laquo;More&raquo; list.</li>
                    <li><b>Citations</b> &mdash; your domain is in the used-sources panel or the answer itself; <b>More / Supplemental</b> &mdash; retrieved but only in the &laquo;More&raquo; list.</li>
                    <li><b>Main Citations</b> &mdash; linked inside the answer text; <b>Supporting</b> &mdash; in the used-sources panel without an in-text link.</li>
                    <li>Snapshot variants: when a capture lacks the expanded panels, the funnel falls back to the answer's Citations panel &mdash; entries flagged cited are the used tier, entries flagged not-cited feed &laquo;More&raquo;; Supporting is then indistinguishable and shows 0.</li>
                    <li>Scope: the latest completed audit with SearchGPT answers, one row per prompt&nbsp;&times;&nbsp;run. Full source panels are collected since Aug&nbsp;19, 2026.</li>
                  </ul>
                </CardContent>
              </Card>
            </div>
          )}

          {activeTab === 'mentions' && (
            <div className="space-y-8">
              {/* Matrix View: brand x LLM heatmap */}
              <Card className="overflow-hidden">
                <CardHeader>
                  <div className="flex items-start justify-between flex-wrap gap-3">
                    <div>
                      <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                        Matrix View
                      </h3>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                        Analyze your brand's presence across AI platforms
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={exportMentionsMatrix}
                        title="Export to Excel"
                        className="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                      <select
                        value={mentionsMetric}
                        onChange={(e) => setMentionsMetric(e.target.value as 'rate' | 'count')}
                        className="px-3 py-2 rounded-lg text-sm font-medium bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-brand-primary"
                      >
                        <option value="rate">Mention Rate</option>
                        <option value="count">Mentions</option>
                      </select>
                      <span className="text-sm text-gray-500 dark:text-gray-400">by</span>
                      <span className="px-3 py-2 rounded-lg text-sm font-medium bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
                        Brands
                      </span>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {mentionsMatrix.rows.length === 0 || mentionsMatrix.llms.length === 0 ? (
                    <p className="text-sm text-gray-400 dark:text-gray-500 py-10 text-center">
                      No mention data for the current filters
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-gray-200 dark:border-gray-700">
                            <th className="text-left py-3.5 px-6 text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-300 min-w-[190px]">
                              Brands
                            </th>
                            {mentionsMatrix.llms.map(l => (
                              <th key={l} className="py-3.5 px-3 text-xs font-semibold text-gray-600 dark:text-gray-300 min-w-[108px]">
                                <div className="flex items-center justify-center gap-1.5">
                                  <img src={MATRIX_LLM_ICONS[l]} alt="" className="w-4 h-4 object-contain" />
                                  <span className="normal-case">{LLM_NAME_LABELS[l] || l}</span>
                                </div>
                                <div className="mt-0.5 text-[10px] font-normal text-gray-400 dark:text-gray-500">
                                  {mentionsMatrix.denom[l]} answers
                                </div>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {mentionsMatrix.rows.map(r => (
                            <tr key={r.brand} className="border-b border-gray-100 dark:border-gray-800">
                              <td className="py-2.5 px-6">
                                <div className="flex items-center gap-2.5 min-w-0">
                                  <BrandFavicon name={r.brand} domain={getBrandDomain(r.brand)} size={20} />
                                  <span className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate">
                                    {r.brand}
                                  </span>
                                  {!r.is_competitor && (
                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 flex-shrink-0">
                                      You
                                    </span>
                                  )}
                                </div>
                              </td>
                              {mentionsMatrix.llms.map(l => {
                                const cell = r.cells[l];
                                const value = mentionsMetric === 'rate' ? cell.rate : cell.count;
                                const max = mentionsMetric === 'rate' ? mentionsMatrix.maxRate : mentionsMatrix.maxCount;
                                const alpha = max > 0 ? Math.min(1, 0.04 + (value / max) * 0.92) : 0.04;
                                const darkText = alpha < 0.45;
                                const label = mentionsMetric === 'rate'
                                  ? `${cell.rate.toFixed(1)}%`
                                  : String(cell.count);
                                return (
                                  <td
                                    key={l}
                                    className="py-3 px-3 text-center text-sm font-semibold"
                                    style={{ backgroundColor: `rgba(37, 99, 235, ${value === 0 ? 0.02 : alpha})` }}
                                    title={`${r.brand} \u00b7 ${LLM_NAME_LABELS[l] || l}: mentioned in ${cell.count} of ${mentionsMatrix.denom[l]} answers (${cell.rate.toFixed(1)}%)`}
                                  >
                                    <span className={darkText ? 'text-gray-800 dark:text-gray-100' : 'text-white'}>
                                      {value === 0 ? (mentionsMetric === 'rate' ? '0%' : '0') : label}
                                    </span>
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Mentions by Prompts Table */}
              <Card>
                <CardHeader>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    Mentions by Prompts
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Analysis of brand mentions across different prompts and LLM platforms
                  </p>
                </CardHeader>
                <CardContent>
                  <div className="mb-4">
                    <label className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        checked={hideMentionsWithoutBrands}
                        onChange={(e) => setHideMentionsWithoutBrands(e.target.checked)}
                        className="w-4 h-4 text-brand-primary border-gray-300 rounded focus:ring-brand-primary"
                      />
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        Hide prompts without brand mentions
                      </span>
                    </label>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-gray-200 dark:border-gray-700">
                          <th className="text-left py-3 px-4 font-medium text-gray-900 dark:text-gray-100">
                            Prompt
                          </th>
                          <th className="text-center py-3 px-4 font-medium text-gray-900 dark:text-gray-100">
                            Mentioned
                          </th>
                          <th className="text-left py-3 px-4 font-medium text-gray-900 dark:text-gray-100">
                            Mentioned Brands
                          </th>
                          <th className="text-left py-3 px-4 font-medium text-gray-900 dark:text-gray-100">
                            Project Brand Sentiment
                          </th>
                          <th className="text-left py-3 px-4 font-medium text-gray-900 dark:text-gray-100">
                            Sentiment Score
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {(() => {
                          // Group filtered citations by prompt
                          const citationsByPrompt = filteredCitations.reduce((acc, citation) => {
                            const promptId = citation.prompt_id;
                            if (!acc[promptId]) {
                              acc[promptId] = [];
                            }
                            acc[promptId].push(citation);
                            return acc;
                          }, {} as Record<string, any[]>);

                          // Get unique prompts from filtered citations
                          const promptsWithCitations = Object.keys(citationsByPrompt).map(promptId => {
                            const prompt = prompts.find(p => p.id === promptId);
                            const promptCitations = citationsByPrompt[promptId];

                            // Find mentioned brands in answer_text grouped by LLM
                            const allBrands = [...brands, ...competitors];
                            const llmResponsesForPrompt = filteredLlmResponses.filter(response =>
                              response.prompt_id === promptId
                            );

                            const brandMentionsByLlm: Record<string, any[]> = {};

                            llmResponsesForPrompt.forEach(response => {
                              const llm = response.llm;

                              allBrands.forEach(brand => {
                                if (rowMentionsAnyName(response, [brand.brand_name])) {
                                  if (!brandMentionsByLlm[llm]) {
                                    brandMentionsByLlm[llm] = [];
                                  }
                                  // Avoid duplicate brands per LLM
                                  if (!brandMentionsByLlm[llm].some(b => b.brand_name === brand.brand_name)) {
                                    brandMentionsByLlm[llm].push(brand);
                                  }
                                }
                              });
                            });

                            // Get sentiment for project brands (non-competitors) grouped by LLM
                            const myBrands = brands;
                            const projectBrands = myBrands.map(b => b.brand_name);

                            const sentimentByLlm: Record<string, { label: string; score: number }> = {};
                            let isProjectBrandMentioned = false;

                            llmResponsesForPrompt.forEach(response => {
                              const hasBrandMention = rowMentionsAnyName(response, projectBrands);

                              if (hasBrandMention) {
                                isProjectBrandMentioned = true;
                              }

                              if (response.sentiment_label && hasBrandMention) {
                                sentimentByLlm[response.llm] = {
                                  label: response.sentiment_label,
                                  score: response.sentiment_score || 0
                                };
                              }
                            });

                            return {
                              prompt,
                              brandMentionsByLlm,
                              sentimentByLlm,
                              isProjectBrandMentioned
                            };
                          });

                          // Filter out prompts without brand mentions if the option is enabled
                          const visiblePrompts = hideMentionsWithoutBrands
                            ? promptsWithCitations.filter(({ brandMentionsByLlm }) =>
                                Object.keys(brandMentionsByLlm).length > 0
                              )
                            : promptsWithCitations;

                          return visiblePrompts.map(({ prompt, brandMentionsByLlm, sentimentByLlm, isProjectBrandMentioned }, index) => (
                            <tr key={prompt?.id || index} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">
                              <td className="py-3 px-4">
                                <div className="max-w-sm">
                                  <button
                                    onClick={() => navigate(`/projects/${id}/prompts/${prompt.id}`)}
                                    className="text-left hover:text-brand-primary transition-colors cursor-pointer whitespace-normal break-words"
                                  >
                                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                      {prompt?.prompt_text || 'Unknown prompt'}
                                    </div>
                                    {prompt?.prompt_group && prompt.prompt_group !== 'General' && (
                                      <div className="text-xs text-gray-500 dark:text-gray-400">
                                        {prompt.prompt_group}
                                      </div>
                                    )}
                                  </button>
                                </div>
                              </td>
                              <td className="py-3 px-4">
                                <div className="flex justify-center">
                                  {isProjectBrandMentioned && (
                                    <BadgeCheck className="w-5 h-5 text-green-500" />
                                  )}
                                </div>
                              </td>
                              <td className="py-3 px-4">
                                <div className="space-y-2">
                                  {Object.keys(brandMentionsByLlm).length > 0 ? (
                                    Object.entries(brandMentionsByLlm).map(([llm, brands]) => (
                                      <div key={llm} className="flex items-start gap-2">
                                        <img
                                          src={LLM_ICONS[llm.toLowerCase()]}
                                          alt={llm}
                                          className="w-4 h-4 mt-0.5 flex-shrink-0"
                                        />
                                        <div className="flex flex-wrap gap-1">
                                          {brands.map((brand, brandIndex) => (
                                            <span
                                              key={brandIndex}
                                              className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                                                brand.is_competitor
                                                  ? 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400'
                                                  : 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400'
                                              }`}
                                            >
                                              {getBrandDomain(brand.brand_name) ? (
                                                <span className="mr-1 inline-flex">
                                                  <BrandFavicon name={brand.brand_name} domain={getBrandDomain(brand.brand_name)} size={12} />
                                                </span>
                                              ) : (
                                                <div
                                                  className={`w-2 h-2 rounded-full mr-1 ${
                                                    brand.is_competitor ? 'bg-red-500' : 'bg-blue-500'
                                                  }`}
                                                />
                                              )}
                                              {brand.brand_name}
                                            </span>
                                          ))}
                                        </div>
                                      </div>
                                    ))
                                  ) : (
                                    <span className="text-sm text-gray-500 dark:text-gray-400">
                                      No brands mentioned
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="py-3 px-4">
                                <div className="space-y-2">
                                  {Object.keys(sentimentByLlm).length > 0 ? (
                                    Object.entries(sentimentByLlm).map(([llm, sentiment]) => (
                                      <div key={llm} className="flex items-center gap-2">
                                        <img
                                          src={LLM_ICONS[llm.toLowerCase()]}
                                          alt={llm}
                                          className="w-4 h-4 flex-shrink-0"
                                        />
                                        <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                                          sentiment.label === 'positive'
                                            ? 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400'
                                            : sentiment.label === 'negative'
                                            ? 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400'
                                            : 'bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-400'
                                        }`}>
                                          {sentiment.label === 'positive' ? '😊' : sentiment.label === 'negative' ? '😞' : '😐'} {sentiment.label}
                                        </span>
                                      </div>
                                    ))
                                  ) : (
                                    <span className="text-sm text-gray-500 dark:text-gray-400">
                                      No sentiment data
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="py-3 px-4">
                                <div className="space-y-2">
                                  {Object.keys(sentimentByLlm).length > 0 ? (
                                    Object.entries(sentimentByLlm).map(([llm, sentiment]) => (
                                      <div key={llm} className="flex items-center gap-2">
                                        <img
                                          src={LLM_ICONS[llm.toLowerCase()]}
                                          alt={llm}
                                          className="w-4 h-4 flex-shrink-0"
                                        />
                                        <div className="flex items-center space-x-2">
                                          <span className={`text-sm font-medium ${
                                            sentiment.score > 0
                                              ? 'text-green-600 dark:text-green-400'
                                              : sentiment.score < 0
                                              ? 'text-red-600 dark:text-red-400'
                                              : 'text-gray-600 dark:text-gray-400'
                                          }`}>
                                            {sentiment.score > 0 ? '+' : ''}{sentiment.score.toFixed(2)}
                                          </span>
                                          <div className="w-16 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                                            <div
                                              className={`h-2 rounded-full ${
                                                sentiment.score > 0
                                                  ? 'bg-green-500'
                                                  : sentiment.score < 0
                                                  ? 'bg-red-500'
                                                  : 'bg-gray-500'
                                              }`}
                                              style={{
                                                width: `${Math.abs(sentiment.score) * 100}%`
                                              }}
                                            />
                                          </div>
                                        </div>
                                      </div>
                                    ))
                                  ) : (
                                    <span className="text-sm text-gray-500 dark:text-gray-400">
                                      No score
                                    </span>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ));
                        })()}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
              
              {brands.length === 0 && competitors.length === 0 && (
                <div className="text-center py-12">
                  <MessageSquare className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
                    No brands configured
                  </h3>
                  <p className="text-gray-600 dark:text-gray-400">
                    Add brands to your project to see mention analysis
                  </p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'insights' && (
            <div className="space-y-8">
              {/* Report Type Selection */}
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
                  Select Report Type
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
                  {/* Brand Strengths & Weaknesses */}
                  <button
                    onClick={() => setSelectedReportType('brand_strengths')}
                    className={`relative overflow-hidden rounded-2xl border-2 transition-all duration-200 hover:scale-105 ${
                      selectedReportType === 'brand_strengths'
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                        : 'border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-700'
                    }`}
                  >
                    <div className="p-6">
                      <div className="w-20 h-20 mx-auto mb-4 flex items-center justify-center">
                        <img
                          src="/swot.png"
                          alt="SWOT Analysis"
                          className="w-full h-full object-contain"
                        />
                      </div>
                      <h4 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-2">
                        Brand Strengths & Weaknesses
                      </h4>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        Comprehensive analysis of your brand positioning and competitive advantages
                      </p>
                    </div>
                    {selectedReportType === 'brand_strengths' && (
                      <div className="absolute top-3 right-3 w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center">
                        <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    )}
                  </button>

                  {/* Content Audit - Temporarily Inactive */}
                  <button
                    disabled
                    className="relative overflow-hidden rounded-2xl border-2 border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800/50 cursor-not-allowed"
                  >
                    <div className="p-6">
                      <div className="w-20 h-20 mx-auto mb-4 flex items-center justify-center opacity-60">
                        <img
                          src="/content.png"
                          alt="Content Audit"
                          className="w-full h-full object-contain"
                        />
                      </div>
                      <h4 className="text-lg font-bold text-gray-500 dark:text-gray-400 mb-2">
                        Content Audit
                      </h4>
                      <p className="text-sm text-gray-400 dark:text-gray-500">
                        Coming soon
                      </p>
                    </div>
                    <div className="absolute top-3 right-3 px-2 py-1 rounded-full bg-gray-500 dark:bg-gray-600">
                      <span className="text-xs text-white dark:text-gray-200 font-medium">Inactive</span>
                    </div>
                  </button>

                  {/* Off-site Visibility - Temporarily Inactive */}
                  <button
                    disabled
                    className="relative overflow-hidden rounded-2xl border-2 border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800/50 cursor-not-allowed"
                  >
                    <div className="p-6">
                      <div className="w-20 h-20 mx-auto mb-4 flex items-center justify-center opacity-60">
                        <img
                          src="/public-relations.png"
                          alt="Off-site Visibility"
                          className="w-full h-full object-contain"
                        />
                      </div>
                      <h4 className="text-lg font-bold text-gray-500 dark:text-gray-400 mb-2">
                        Off-site Visibility
                      </h4>
                      <p className="text-sm text-gray-400 dark:text-gray-500">
                        Coming soon
                      </p>
                    </div>
                    <div className="absolute top-3 right-3 px-2 py-1 rounded-full bg-gray-500 dark:bg-gray-600">
                      <span className="text-xs text-white dark:text-gray-200 font-medium">Inactive</span>
                    </div>
                  </button>
                </div>
              </div>

              {/* Configuration Panel */}
              {selectedReportType && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-gradient-to-br from-gray-50 to-gray-100/50 dark:from-gray-800 dark:to-gray-700/50 rounded-2xl p-6 border border-gray-200 dark:border-gray-700"
                >
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
                    Report Configuration
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                    {/* Target Brand */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Target Brand
                      </label>
                      {customBrandInput ? (
                        <div className="relative h-[46px]">
                          <input
                            type="text"
                            value={insightConfig.targetBrand}
                            onChange={(e) => setInsightConfig({ ...insightConfig, targetBrand: e.target.value })}
                            placeholder="Enter brand name"
                            className="w-full h-full px-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setCustomBrandInput(false);
                              setInsightConfig({ ...insightConfig, targetBrand: brands[0]?.brand_name || '' });
                            }}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="relative h-[46px]">
                          <select
                            value={insightConfig.targetBrand}
                            onChange={(e) => setInsightConfig({ ...insightConfig, targetBrand: e.target.value })}
                            className="w-full h-full px-4 py-2.5 pr-16 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 appearance-none"
                          >
                            {brands.map(brand => (
                              <option key={brand.id} value={brand.brand_name}>
                                {brand.brand_name}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => {
                              setCustomBrandInput(true);
                              setInsightConfig({ ...insightConfig, targetBrand: '' });
                            }}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium"
                          >
                            Custom
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Target LLM */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Target LLM
                      </label>
                      <div className="flex gap-2 min-h-[46px] flex-wrap">
                        {insightLlmOptions.map((llm) => (
                          <button
                            key={llm}
                            type="button"
                            onClick={() => setInsightConfig({ ...insightConfig, targetLlm: llm })}
                            className={`flex-1 min-w-[56px] h-[46px] flex items-center justify-center rounded-xl border-2 transition-all ${
                              insightConfig.targetLlm === llm
                                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                                : 'border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-700'
                            }`}
                            title={LLM_DISPLAY_NAMES[llm] || llm}
                          >
                            <img
                              src={LLM_ICONS[llm as keyof typeof LLM_ICONS]}
                              alt={LLM_DISPLAY_NAMES[llm] || llm}
                              className="w-8 h-8 object-contain"
                              onError={(e) => {
                                e.currentTarget.style.display = 'none';
                                e.currentTarget.parentElement!.innerHTML += `<span class="text-xs font-medium">${LLM_DISPLAY_NAMES[llm] || llm}</span>`;
                              }}
                            />
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Report Language */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Report Language
                      </label>
                      <select
                        value={insightConfig.reportLanguage}
                        onChange={(e) => setInsightConfig({ ...insightConfig, reportLanguage: e.target.value })}
                        className="w-full h-[46px] px-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                      >
                        <option value="en">English</option>
                        <option value="zh">中文 (Chinese)</option>
                        <option value="hi">हिन्दी (Hindi)</option>
                        <option value="es">Español (Spanish)</option>
                        <option value="fr">Français (French)</option>
                        <option value="ar">العربية (Arabic)</option>
                        <option value="bn">বাংলা (Bengali)</option>
                        <option value="pt">Português (Portuguese)</option>
                        <option value="ru">Русский (Russian)</option>
                        <option value="ja">日本語 (Japanese)</option>
                      </select>
                    </div>
                  </div>

                  {/* Additional Configuration for Brand Strengths Report */}
                  {selectedReportType === 'brand_strengths' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                      {/* Prompts Group Filter (Optional) */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                          Prompts Group <span className="text-gray-500 text-xs">(optional, multi-select)</span>
                        </label>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => setInsightConfig({ ...insightConfig, groupIds: [] })}
                            className={`px-3 py-2 rounded-xl text-sm font-medium border transition-all ${
                              insightConfig.groupIds.length === 0
                                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                                : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:border-blue-300'
                            }`}
                          >
                            All Prompt Groups
                          </button>
                          {promptGroups.map((groupName: string) => {
                            const selected = insightConfig.groupIds.includes(groupName);
                            return (
                              <button
                                key={groupName}
                                type="button"
                                onClick={() => setInsightConfig({
                                  ...insightConfig,
                                  groupIds: selected
                                    ? insightConfig.groupIds.filter(g => g !== groupName)
                                    : [...insightConfig.groupIds, groupName],
                                })}
                                className={`px-3 py-2 rounded-xl text-sm font-medium border transition-all ${
                                  selected
                                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                                    : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:border-blue-300'
                                }`}
                              >
                                {selected ? '✓ ' : ''}{groupName}
                              </button>
                            );
                          })}
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          Select one or more prompt groups to include; none selected = all groups
                        </p>
                      </div>

                      {/* Custom Competitors (Optional) */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                          Custom Competitors <span className="text-gray-500 text-xs">(optional)</span>
                        </label>
                        <input
                          type="text"
                          value={insightConfig.customCompetitors}
                          onChange={(e) => setInsightConfig({ ...insightConfig, customCompetitors: e.target.value })}
                          placeholder="e.g., Brand A, Brand B, Brand C"
                          className="w-full h-[46px] px-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                        />
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          Add specific competitor brands (comma-separated) to include in the analysis
                        </p>
                      </div>
                    </div>
                  )}

                  <Button
                    onClick={handleGenerateReport}
                    variant="gradient"
                    disabled={isGeneratingReport || !insightConfig.targetBrand}
                    className="w-full md:w-auto"
                  >
                    {isGeneratingReport ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2" />
                        Generating Report...
                      </>
                    ) : (
                      <>
                        <Lightbulb className="w-4 h-4 mr-2" />
                        Get Insights
                      </>
                    )}
                  </Button>
                </motion.div>
              )}

              {/* Completed Reports Table */}
              {completedReports.length > 0 && (
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
                    Completed Reports
                  </h3>
                  <Card>
                    <CardContent className="p-0">
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead className="bg-gradient-to-r from-gray-50 to-gray-100/50 dark:from-gray-800 dark:to-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                            <tr>
                              <th className="text-left py-4 px-6 font-semibold text-xs uppercase tracking-wider text-gray-700 dark:text-gray-300">
                                Report Type
                              </th>
                              <th className="text-left py-4 px-6 font-semibold text-xs uppercase tracking-wider text-gray-700 dark:text-gray-300">
                                Target Brand
                              </th>
                              <th className="text-left py-4 px-6 font-semibold text-xs uppercase tracking-wider text-gray-700 dark:text-gray-300">
                                LLM
                              </th>
                              <th className="text-left py-4 px-6 font-semibold text-xs uppercase tracking-wider text-gray-700 dark:text-gray-300">
                                Status
                              </th>
                              <th className="text-left py-4 px-6 font-semibold text-xs uppercase tracking-wider text-gray-700 dark:text-gray-300">
                                Created
                              </th>
                              <th className="text-left py-4 px-6 font-semibold text-xs uppercase tracking-wider text-gray-700 dark:text-gray-300">
                                Actions
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                            {completedReports.map((report) => (
                              <tr
                                key={report.id}
                                className="group hover:bg-gradient-to-r hover:from-gray-50 hover:to-transparent dark:hover:from-gray-800/50 dark:hover:to-transparent transition-all duration-200"
                              >
                                <td className="py-4 px-6">
                                  <div className="flex items-center gap-2">
                                    <div className="w-10 h-10 flex items-center justify-center">
                                      {report.report_type === 'brand_strengths' ? (
                                        <img
                                          src="/swot.png"
                                          alt="SWOT"
                                          className="w-full h-full object-contain"
                                        />
                                      ) : report.report_type === 'content_audit' ? (
                                        <img
                                          src="/content.png"
                                          alt="Content"
                                          className="w-full h-full object-contain"
                                        />
                                      ) : (
                                        <img
                                          src="/public-relations.png"
                                          alt="Visibility"
                                          className="w-full h-full object-contain"
                                        />
                                      )}
                                    </div>
                                    <span className="font-medium text-gray-900 dark:text-gray-100">
                                      {report.report_type === 'brand_strengths'
                                        ? 'Brand Strengths & Weaknesses'
                                        : report.report_type === 'content_audit'
                                        ? 'Content Audit'
                                        : 'Off-site Visibility'}
                                    </span>
                                  </div>
                                </td>
                                <td className="py-4 px-6 text-gray-900 dark:text-gray-100">
                                  {report.target_brand}
                                </td>
                                <td className="py-4 px-6">
                                  <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                                    {report.target_llm}
                                  </span>
                                </td>
                                <td className="py-4 px-6">
                                  <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${
                                    report.status === 'completed'
                                      ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                      : report.status === 'failed'
                                      ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                      : report.status === 'running'
                                      ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                                      : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                                  }`}>
                                    {report.status}
                                  </span>
                                </td>
                                <td className="py-4 px-6 text-sm text-gray-600 dark:text-gray-400">
                                  {new Date(report.created_at).toLocaleDateString()}
                                </td>
                                <td className="py-4 px-6">
                                  <div className="flex items-center gap-2">
                                    {report.status === 'completed' && (
                                      <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={() => navigate(`/reports/${report.id}`)}
                                      >
                                        View Report
                                      </Button>
                                    )}
                                    <button
                                      onClick={() => {
                                        setReportToDelete(report.id);
                                        setShowDeleteConfirmation(true);
                                      }}
                                      className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                                      title="Delete report"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}

              {completedReports.length === 0 && !selectedReportType && (
                <div className="text-center py-12">
                  <Lightbulb className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
                  <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
                    No Reports Yet
                  </h3>
                  <p className="text-gray-600 dark:text-gray-400">
                    Select a report type above to generate your first insight report
                  </p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'sentiment' && id && (
            <SentimentDashboard projectId={id} />
          )}

          {activeTab === 'settings' && (
            <div className="space-y-6">
              <ProjectScheduledAuditsSettings
                projectId={id!}
                onUpdate={fetchProjectData}
              />
            </div>
          )}
          </TabErrorBoundary>
          )}
        </CardContent>
      </Card>

      <RunAuditModal
        isOpen={showRunAuditModal}
        onClose={() => setShowRunAuditModal(false)}
        projectId={project.id}
        onAuditStarted={handleAuditStartedWithId}
      />

      {/* Report Viewer Modal */}

      {runningAudits.map(auditId => (
        <AuditProgressToast
          key={auditId}
          auditId={auditId}
          onCompleted={() => handleAuditCompleted(auditId)}
          onClose={() => handleAuditCompleted(auditId)}
        />
      ))}

      <Modal isOpen={showEditModal} onClose={() => setShowEditModal(false)} title="Edit Project" size="xl">
        <form onSubmit={handleSaveProject} className="p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Project Name"
              value={editFormData.name}
              onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
              required
            />
            
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Project Groups
              </label>
              <div className="rounded-2xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2">
                <div className="flex flex-wrap gap-2 max-h-28 overflow-y-auto">
                  {groups.map(group => {
                    const allIds = group._allIds || [group.id];
                    const isSelected = editFormData.groupIds.some((gid: string) => allIds.includes(gid));
                    return (
                      <button
                        key={group.id}
                        type="button"
                        onClick={() => {
                          setEditFormData(prev => ({
                            ...prev,
                            groupIds: isSelected
                              ? prev.groupIds.filter((gid: string) => !allIds.includes(gid))
                              : [...prev.groupIds, group.id],
                          }));
                        }}
                        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                          isSelected
                            ? 'ring-2 ring-offset-1 ring-opacity-50'
                            : 'opacity-60 hover:opacity-100'
                        }`}
                        style={{
                          backgroundColor: isSelected ? `${group.color}20` : 'transparent',
                          borderColor: group.color,
                          color: group.color,
                        }}
                      >
                        <span
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ backgroundColor: group.color }}
                        />
                        {group.name}
                      </button>
                    );
                  })}
                  {groups.length === 0 && (
                    <span className="text-xs text-gray-400 py-1">No groups available</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Input
              label="Domain"
              value={editFormData.domain}
              onChange={(e) => setEditFormData({ ...editFormData, domain: e.target.value })}
              placeholder="example.com"
              required
            />
            
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Domain Mode
              </label>
              <select
                value={editFormData.domainMode}
                onChange={(e) => setEditFormData({ ...editFormData, domainMode: e.target.value as 'exact' | 'subdomains' })}
                className="block w-full rounded-2xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2.5 text-gray-900 dark:text-gray-100 focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 font-sans"
              >
                <option value="exact">Exact</option>
                <option value="subdomains">Include Subdomains</option>
              </select>
            </div>

            <Input
              label="Country"
              value={editFormData.country}
              onChange={(e) => setEditFormData({ ...editFormData, country: e.target.value })}
              placeholder="US"
              required
            />
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                My Brands (comma-separated)
              </label>
              {brandsList.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {brandsList.map((brand, index) => (
                    <span
                      key={index}
                      className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-brand-primary/10 text-brand-primary border border-brand-primary/20"
                    >
                      {brand}
                      <button
                        type="button"
                        onClick={() => removeBrand(index)}
                        className="ml-2 text-brand-primary/60 hover:text-brand-primary"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <Input
                value={editFormData.myBrands}
                onChange={(e) => handleBrandsChange(e.target.value)}
                placeholder="Apple, iPhone, MacBook"
                required
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Competitors (comma-separated)
              </label>
              {competitorsList.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {competitorsList.map((competitor, index) => (
                    <span
                      key={index}
                      className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-red-50 text-red-700 border border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-700"
                    >
                      {competitor}
                      <button
                        type="button"
                        onClick={() => removeCompetitor(index)}
                        className="ml-2 text-red-500 hover:text-red-700"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <Input
                value={editFormData.competitors}
                onChange={(e) => handleCompetitorsChange(e.target.value)}
                placeholder="Samsung, Google, Microsoft"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Prompts (one per line, use "group;prompt" for grouping)
            </label>
            <textarea
              value={editFormData.prompts}
              onChange={(e) => setEditFormData({ ...editFormData, prompts: e.target.value })}
              className="block w-full rounded-2xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2.5 text-gray-900 dark:text-gray-100 focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 font-sans"
              rows={6}
              placeholder="Best smartphone 2024&#10;Reviews;iPhone 15 review&#10;Comparison;iPhone vs Samsung"
              required
            />
          </div>

          <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200 dark:border-gray-700">
            <Button variant="secondary" onClick={() => setShowEditModal(false)}>
              Cancel
            </Button>
            <Button variant="gradient" type="submit">
              Save Changes
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={showDeleteConfirmation}
        onClose={() => {
          setShowDeleteConfirmation(false);
          setReportToDelete(null);
        }}
        title="Delete Report"
      >
        <div className="space-y-4">
          <p className="text-gray-700 dark:text-gray-300">
            Are you sure you want to delete this report? This action cannot be undone.
          </p>
          <div className="flex justify-end space-x-3">
            <Button
              variant="secondary"
              onClick={() => {
                setShowDeleteConfirmation(false);
                setReportToDelete(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="gradient"
              onClick={handleDeleteReport}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete
            </Button>
          </div>
        </div>
      </Modal>

      {/* Recalculate Metrics Confirmation Modal */}
      <Modal
        isOpen={showRecalculateConfirm}
        onClose={() => setShowRecalculateConfirm(false)}
        title="Recalculate Metrics"
      >
        <div className="space-y-4 p-6">
          <div className="flex items-start space-x-3">
            <div className="flex-shrink-0">
              <Info className="w-6 h-6 text-brand-primary" />
            </div>
            <div className="flex-1">
              <p className="text-gray-700 dark:text-gray-300 mb-4">
                You have changed the domain, domain mode, or brands for this project.
              </p>
              <p className="text-gray-700 dark:text-gray-300 mb-4">
                Would you like to recalculate citations and mentions metrics for all existing audits?
              </p>
              <ul className="list-disc list-inside text-sm text-gray-600 dark:text-gray-400 space-y-1 mb-4">
                <li><strong>Yes:</strong> Recalculate metrics for all existing audits (recommended)</li>
                <li><strong>No:</strong> Apply changes only to future audits</li>
              </ul>
            </div>
          </div>
          <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200 dark:border-gray-700">
            <Button
              variant="secondary"
              onClick={handleRecalculateConfirmNo}
              disabled={isRecalculating}
            >
              No, Only Future Audits
            </Button>
            <Button
              variant="gradient"
              onClick={handleRecalculateConfirmYes}
              disabled={isRecalculating}
            >
              {isRecalculating ? 'Recalculating...' : 'Yes, Recalculate All'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
