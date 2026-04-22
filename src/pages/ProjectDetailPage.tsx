import React, { useState, useEffect, useRef } from 'react';
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
import { queryCache } from '../lib/queryCache';
import { Calendar, FileText, ChartBar as BarChart3, Globe, Users, Play, ArrowLeft, Brain, Download, Settings as SettingsIcon, PencilLine, X, MessageSquare, Crown, TrendingUp, Lightbulb, Trash2, Info, Settings, CalendarCheck, ArrowUpDown, ArrowUp, ArrowDown, BadgeCheck, MessageCircle, List, ChevronDown, Smile } from 'lucide-react';
import { SentimentDashboard } from '../components/sentiment/SentimentDashboard';
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, LineChart, Line, Legend } from 'recharts';
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis } from 'recharts';
import { AuditProgressToast } from '../components/audit/AuditProgressToast';
import { ProjectScheduledAuditsSettings } from '../components/projects/ProjectScheduledAuditsSettings';
import { utils as xlsxUtils, writeFile as xlsxWriteFile } from 'xlsx';
import { getCountryByCode } from '../utils/countries';
import { useProject } from '../contexts/ProjectContext';

const LLM_ICONS = {
  searchgpt: 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/SearchGPT.PNG',
  perplexity: 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/Perplexity.png',
  gemini: 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/Gemini.png',
  'google-ai-overview': 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/Google.png',
  'google-ai-mode': 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/Google.png',
  'bing-copilot': 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/bing_copilot.png',
  'grok': 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/Grok-icon.png',
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

export const ProjectDetailPage: React.FC<ProjectDetailPageProps> = ({
  activeTabOverride,
  hideTabNavigation = false
}) => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { setSelectedProject } = useProject();
  const [project, setProject] = useState<any>(null);

  // Get tab from URL search params, override, or default to 'overview'
  const searchParams = new URLSearchParams(location.search);
  const tabFromUrl = activeTabOverride || searchParams.get('tab') || 'overview';
  const [activeTab, setActiveTab] = useState(tabFromUrl);
  const [citations, setCitations] = useState<any[]>([]);
  const [filteredCitations, setFilteredCitations] = useState<any[]>([]);
  const [filteredMentions, setFilteredMentions] = useState<any[]>([]);
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
  const [filteredLlmResponses, setFilteredLlmResponses] = useState<any[]>([]);
  const [filters, setFilters] = useState({
    dateRange: 'lastAudit',
    llms: 'all',
    promptGroups: [] as string[],
    sentiment: 'all',
  });
  const [showPromptGroupDropdown, setShowPromptGroupDropdown] = useState(false);
  const [showLlmDropdown, setShowLlmDropdown] = useState(false);
  const [llmDropdownPos, setLlmDropdownPos] = useState<{ top: number; left: number; minWidth: number } | null>(null);
  const llmButtonRef = useRef<HTMLButtonElement>(null);
  const [showCustomDatePicker, setShowCustomDatePicker] = useState(false);
  const [customDateRange, setCustomDateRange] = useState({
    startDate: '',
    endDate: '',
  });
  const [availableDates, setAvailableDates] = useState<string[]>([]);
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
  const [citationConsistency, setCitationConsistency] = useState<number>(0);
  const [brandLeadershipData, setBrandLeadershipData] = useState<any[]>([]);
  const [splitBrandLeadershipByLlm, setSplitBrandLeadershipByLlm] = useState(false);

  // Add state for audit dates and citations by audit
  const [auditDates, setAuditDates] = useState<string[]>([]);
  const [citationsByAudit, setCitationsByAudit] = useState<{[key: string]: any[]}>({});
  const [llmResponses, setLlmResponses] = useState<any[]>([]);
  const [processedCitations, setProcessedCitations] = useState<any[]>([]);
  const [lastAuditDate, setLastAuditDate] = useState<string>('');
  const [auditsData, setAuditsData] = useState<any[]>([]);
  const [showCompetitorsInTrend, setShowCompetitorsInTrend] = useState(false);
  const [selectedTrendCompetitors, setSelectedTrendCompetitors] = useState<string[]>([]);
  const [showCompetitorsInCitationsTrend, setShowCompetitorsInCitationsTrend] = useState(false);
  const [selectedCitationsTrendCompetitors, setSelectedCitationsTrendCompetitors] = useState<string[]>([]);

  // Insights state
  const [selectedReportType, setSelectedReportType] = useState<string | null>(null);
  const [insightConfig, setInsightConfig] = useState({
    targetBrand: '',
    targetLlm: 'searchgpt' as 'searchgpt' | 'perplexity' | 'gemini',
    reportLanguage: 'en',
    groupId: '' as string,
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


  useEffect(() => {
    if (id) {
      fetchProjectData();
      fetchGroups();
    }
  }, [id]);

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

  useEffect(() => {
    processLlmResponsesIntoCitations();
  }, [llmResponses, citations]);

  useEffect(() => {
    applyFilters();
  }, [processedCitations, llmResponses, filters]);

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
      if (response.answer_text && response.audits?.created_at) {
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
    setAvailableDates(Array.from(allAvailable).sort());

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
      setAuditDates(sortedAuditDates);
      setCitationsByAudit(citationsByAuditDate);

      // Set last audit date — prefer the most recent date that actually
      // has data. Fall back to the most recent audit date overall so the
      // dropdown label still renders something when no audit has any data
      // yet (freshly created project, everything still running, etc.).
      const sortedDatesWithData = Array.from(datesWithData).sort();
      if (sortedDatesWithData.length > 0) {
        setLastAuditDate(sortedDatesWithData[sortedDatesWithData.length - 1]);
      } else if (sortedAuditDates.length > 0) {
        setLastAuditDate(sortedAuditDates[sortedAuditDates.length - 1]);
      }
    } else if (auditDatesFromAudits.size > 0) {
      // Even if no citations, show audit dates
      const sortedAuditDates = Array.from(auditDatesFromAudits).sort();
      setAuditDates(sortedAuditDates);
      setCitationsByAudit({});

      // Same preference as above — a date with llm_response answers beats
      // an empty force-completed audit at the top of the list.
      const sortedDatesWithData = Array.from(datesWithData).sort();
      if (sortedDatesWithData.length > 0) {
        setLastAuditDate(sortedDatesWithData[sortedDatesWithData.length - 1]);
      } else if (sortedAuditDates.length > 0) {
        setLastAuditDate(sortedAuditDates[sortedAuditDates.length - 1]);
      }
    }
  }, [processedCitations, auditsData, llmResponses]);

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

  const getMentionRateByAuditDate = () => {
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

  const applyFilters = () => {
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

    setFilteredCitations(filtered);
    setFilteredLlmResponses(filteredResponses);

  };

  const processLlmResponsesIntoCitations = () => {
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

    // Then, extract citations from llm_responses.citations field (preferred for SearchGPT)
    llmResponses.forEach(response => {
      // First, try to use the citations field from llm_responses (this has cited info)
      if (response.citations && Array.isArray(response.citations)) {
        response.citations.forEach((citation: any, index: number) => {
          // Check if this citation already exists in the database citations
          const existsInDb = citations.some(c =>
            c.audit_id === response.audit_id &&
            c.prompt_id === response.prompt_id &&
            c.llm === response.llm &&
            c.page_url === citation.url
          );

          if (!existsInDb && citation.url) {
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
          }
        });
        return; // Skip raw_response_data processing if we have citations field
      }

      // Fallback: extract citations from raw_response_data for backward compatibility
      if (!response.raw_response_data) return;

      let urls: any[] = [];

      // Extract URLs based on LLM type
      if (response.llm === 'perplexity' && (response.raw_response_data.sources || response.raw_response_data.citations)) {
        const sources = response.raw_response_data.sources || response.raw_response_data.citations || [];
        urls = sources.map((source: any, index: number) => ({
          url: source.url,
          text: source.title || source.description || 'No description',
          position: source.position || index + 1
        }));
      } else if (response.llm === 'searchgpt') {
        // Handle SearchGPT - use links_attached field
        const linksAttached = response.raw_response_data.links_attached || [];

        linksAttached.forEach((link: any, index: number) => {
          if (link.url) {
            urls.push({
              url: link.url,
              text: link.text || link.title || link.description,
              position: link.position || index + 1,
            });
          }
        });
      } else if (response.llm === 'gemini') {
        // Handle Gemini citations
        const linksAttached = response.raw_response_data.links_attached || [];

        linksAttached.forEach((link: any, index: number) => {
          if (link.url) {
            urls.push({
              url: link.url,
              text: link.text || link.title || link.description,
              position: link.position || index + 1,
            });
          }
        });
      } else if (response.llm === 'grok' && response.raw_response_data.citations) {
        // Handle Grok citations
        response.raw_response_data.citations.forEach((cit: any, index: number) => {
          if (cit.url) {
            urls.push({
              url: cit.url,
              text: cit.title || cit.description || 'No description',
              position: index + 1,
            });
          }
        });
      }

      // Convert URLs to citation format (only if not already in citations table)
      urls.forEach(urlData => {
        // Check if this citation already exists in the database citations
        const existsInDb = citations.some(c =>
          c.audit_id === response.audit_id &&
          c.prompt_id === response.prompt_id &&
          c.llm === response.llm &&
          c.page_url === urlData.url
        );

        if (!existsInDb) {
          const domain = extractDomainFromUrl(urlData.url);
          extractedCitations.push({
            id: `${response.id}-${urlData.position}`,
            audit_id: response.audit_id,
            prompt_id: response.prompt_id,
            llm: response.llm,
            page_url: urlData.url,
            domain: domain,
            citation_text: urlData.text,
            position: urlData.position,
            sentiment_score: null,
            sentiment_label: null,
            checked_at: response.created_at,
            prompts: response.prompts,
            audits: response.audits
          });
        }
      });
    });

    setProcessedCitations(extractedCitations);
  };

  const extractDomainFromUrl = (url: string): string => {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  };

  const extractDomain = (url: string): string => {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  };

  const handleFilterChange = (filterType: string, value: string) => {
    if (filterType === 'dateRange' && value === 'custom') {
      setShowCustomDatePicker(true);
    } else if (filterType === 'dateRange' && value !== 'custom') {
      setShowCustomDatePicker(false);
    }
    
    setFilters(prev => ({
      ...prev,
      [filterType]: value,
    }));
  };

  const resetFilters = () => {
    setFilters({
      dateRange: 'lastAudit',
      llms: 'all',
      promptGroup: 'all',
      sentiment: 'all',
    });
    setShowCustomDatePicker(false);
    setCustomDateRange({ startDate: '', endDate: '' });
  };

  const getActiveFiltersCount = () => {
    let count = 0;
    if (filters.dateRange !== 'lastAudit') count++;
    if (filters.llms !== 'all') count++;
    if (filters.promptGroups.length > 0) count++;
    if (filters.sentiment !== 'all') count++;
    if (filters.dateRange === 'custom' && (customDateRange.startDate || customDateRange.endDate)) count++;
    return count;
  };

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

  const fetchProjectData = async () => {
    if (!id) return;

    setLoading(true);
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 15_000);
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

      // First, get only the most recent 10 audits to avoid timeout
      const { data: recentAudits, error: auditsError } = await supabase
        .from('audits')
        .select('id, created_at, status, current_step')
        .eq('project_id', id)
        .order('created_at', { ascending: false })
        .limit(5);

      if (auditsError) {
        console.error('Error fetching audits:', auditsError);
        setLlmResponses([]);
        setCitations([]);
        setLoading(false);
        return;
      }

      const recentAuditIds = recentAudits?.map(a => a.id) || [];

      // Store audits data for later use
      setAuditsData(recentAudits || []);

      // Check for running audits and store their info
      const runningAudit = recentAudits?.find(audit => audit.status === 'running');
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

      // Extract available LLMs from completed audits
      const llmsSet = new Set<string>();
      recentAudits?.forEach(audit => {
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

      if (recentAuditIds.length === 0) {
        setLlmResponses([]);
        setCitations([]);
        setAuditDates([]);
      } else {
        // Then fetch LLM responses for only these recent audits
        const { data: llmResponsesData, error: responsesError } = await supabase
          .from('llm_responses')
          .select(`
            id,
            audit_id,
            prompt_id,
            llm,
            answer_text,
            raw_response_data,
            citations,
            all_sources,
            links_attached,
            web_search_query,
            sentiment_score,
            sentiment_label,
            answer_competitors,
            created_at,
            prompts (prompt_text, prompt_group),
            audits (created_at, llms)
          `)
          .in('audit_id', recentAuditIds)
          .order('created_at', { ascending: false })
          .abortSignal(abortController.signal);

        if (responsesError) {
          console.error('Error fetching LLM responses:', responsesError);
          setLlmResponses([]);
        } else {
          setLlmResponses(llmResponsesData || []);
        }

        // Fetch citations from the citations table
        const { data: citationsData, error: citationsError } = await supabase
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
            checked_at,
            prompts (prompt_text, prompt_group),
            audits (created_at, llms)
          `)
          .in('audit_id', recentAuditIds)
          .order('checked_at', { ascending: false })
          .limit(500)
          .abortSignal(abortController.signal);

        if (citationsError) {
          console.error('Error fetching citations:', citationsError);
          setCitations([]);
        } else {
          setCitations(citationsData || []);
        }
      }
      
      // Calculate citation consistency
      const consistency = calculateCitationConsistency(projectData.prompts || [], []);
      setCitationConsistency(consistency);
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        console.warn('Data fetch timed out — database may be under heavy load');
      } else {
        console.error('Error fetching project data:', error);
      }
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
    }
  };

  const calculateCitationConsistency = (prompts: any[], citations: any[]): number => {
    if (prompts.length === 0) return 0;
    
    const promptConsistencies: number[] = [];
    
    prompts.forEach(prompt => {
      // Get all citations for this prompt across all LLMs
      const promptCitations = citations.filter(citation => citation.prompt_id === prompt.id);
      
      if (promptCitations.length === 0) {
        promptConsistencies.push(0);
        return;
      }
      
      // Group citations by LLM
      const citationsByLlm: { [key: string]: any[] } = {};
      promptCitations.forEach(citation => {
        if (!citationsByLlm[citation.llm]) {
          citationsByLlm[citation.llm] = [];
        }
        citationsByLlm[citation.llm].push(citation);
      });
      
      const llms = Object.keys(citationsByLlm);
      if (llms.length < 2) {
        // Need at least 2 LLMs to calculate consistency
        promptConsistencies.push(0);
        return;
      }
      
      // Get all unique domains for this prompt
      const allDomains = new Set<string>();
      promptCitations.forEach(citation => {
        if (citation.domain) {
          allDomains.add(citation.domain);
        }
      });
      
      if (allDomains.size === 0) {
        promptConsistencies.push(0);
        return;
      }
      
      // Calculate common domains percentage
      let commonDomainsCount = 0;
      
      allDomains.forEach(domain => {
        // Count how many LLMs mentioned this domain
        const llmsWithDomain = llms.filter(llm => 
          citationsByLlm[llm].some(citation => citation.domain === domain)
        );
        
        // If domain appears in multiple LLMs, it's a common domain
        if (llmsWithDomain.length > 1) {
          commonDomainsCount++;
        }
      });
      
      // Calculate percentage of common domains
      const consistencyPercentage = (commonDomainsCount / allDomains.size) * 100;
      promptConsistencies.push(consistencyPercentage);
    });
    
    // Return average consistency across all prompts
    if (promptConsistencies.length === 0) return 0;
    return Math.round(promptConsistencies.reduce((sum, consistency) => sum + consistency, 0) / promptConsistencies.length);
  };

  const getBrandMentions = (brandName: string) => {
    const brandLower = brandName.toLowerCase();
    const promptsWithMentions = new Set<string>();
    let totalMentions = 0;

    // Check filtered LLM responses for mentions of this brand
    filteredLlmResponses.forEach(response => {
      if (response.answer_text) {
        const answerLower = response.answer_text.toLowerCase();
        if (answerLower.includes(brandLower)) {
          promptsWithMentions.add(response.prompt_id);
          // Count occurrences in this response
          const matches = answerLower.split(brandLower).length - 1;
          totalMentions += matches;
        }
      }
    });

    return {
      promptsWithMentions: promptsWithMentions.size,
      totalMentions,
    };
  };

  const handleRunAudit = (projectId: string) => {
    setShowLlmDropdown(false);
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
    fetchProjectData();
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
      fetchPromptGroups();
    }
  }, [activeTab, id]);

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
          group_id: insightConfig.groupId || null,
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
            groupId: insightConfig.groupId || null,
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
      await fetchProjectData();

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

      // Delete existing prompts
      const { error: deletePromptsError } = await supabase
        .from('prompts')
        .delete()
        .eq('project_id', id);

      if (deletePromptsError) throw deletePromptsError;

      // Add new prompts
      if (editFormData.prompts.trim()) {
        const parsedPrompts = editFormData.prompts
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
          });

        const { error: insertPromptsError } = await supabase
          .from('prompts')
          .insert(
            parsedPrompts.map(prompt => ({
              project_id: id,
              prompt_text: prompt.text,
              prompt_group: prompt.group,
            }))
          );

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
        await fetchProjectData();
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

  const getSentimentData = () => {
    const sentimentCounts = filteredCitations.reduce((acc, citation) => {
      const label = citation.sentiment_label || 'neutral';
      acc[label] = (acc[label] || 0) + 1;
      return acc;
    }, {});

    return Object.entries(sentimentCounts).map(([name, value]) => ({
      name: name.charAt(0).toUpperCase() + name.slice(1),
      value,
      color: SENTIMENT_COLORS[name as keyof typeof SENTIMENT_COLORS],
    }));
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
  const getFilteredPromptStats = () => {
    const promptStats = prompts.map(prompt => {
      const promptCitations = filteredCitations.filter(c => c.prompt_id === prompt.id);
      const sentimentCounts = promptCitations.reduce((acc, citation) => {
        const label = citation.sentiment_label || 'neutral';
        acc[label] = (acc[label] || 0) + 1;
        return acc;
      }, { positive: 0, neutral: 0, negative: 0 });

      const total = promptCitations.length;
      return {
        id: prompt.id,
        prompt: prompt.prompt_text,
        group: prompt.prompt_group,
        total,
        positive: total > 0 ? Math.round((sentimentCounts.positive / total) * 100) : 0,
        neutral: total > 0 ? Math.round((sentimentCounts.neutral / total) * 100) : 0,
        negative: total > 0 ? Math.round((sentimentCounts.negative / total) * 100) : 0,
        date: new Date(prompt.created_at).toLocaleDateString(),
      };
    });

    return promptStats;
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
        const isProjectBrandMentioned = llmResponsesForPrompt.some(response => {
          const answerText = response.answer_text?.toLowerCase() || '';
          return projectBrands.some(brandName =>
            answerText.includes(brandName.toLowerCase())
          );
        });

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
      'Page URL': page.page_url,
      'Domain': page.domain,
      'Citations (Cited)': page.mentions,
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
      'Citations (Cited)': domain.mentions,
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

  const exportAuditDataByLLM = () => {
    if (!lastAuditDate) {
      return;
    }

    // Debug: Show all available audit dates and which one we're exporting
    const allAuditDatesInResponses = [...new Set(llmResponses
      .map(r => r.audits?.created_at?.split('T')[0])
      .filter(Boolean)
    )].sort();

    console.log('Export Audit Selection:', {
      lastAuditDate,
      allAvailableAuditDates: allAuditDatesInResponses,
      isLastAuditMostRecent: lastAuditDate === allAuditDatesInResponses[allAuditDatesInResponses.length - 1]
    });

    const responsesFromLastAudit = llmResponses.filter(response =>
      response.audits?.created_at &&
      response.audits.created_at.split('T')[0] === lastAuditDate
    );

    // Filter citations to only those from the last audit
    const citationsFromLastAudit = citations.filter(citation =>
      citation.audits?.created_at &&
      citation.audits.created_at.split('T')[0] === lastAuditDate
    );

    const llmGroups = responsesFromLastAudit.reduce((acc, response) => {
      const llm = response.llm || 'unknown';
      if (!acc[llm]) {
        acc[llm] = [];
      }
      acc[llm].push(response);
      return acc;
    }, {} as Record<string, any[]>);

    const wb = xlsxUtils.book_new();

    Object.entries(llmGroups).forEach(([llm, responses]) => {
      // Group responses by prompt_id to avoid duplicates
      const responsesByPrompt = responses.reduce((acc, response) => {
        const promptId = response.prompt_id || 'unknown';
        if (!acc[promptId]) {
          acc[promptId] = [];
        }
        acc[promptId].push(response);
        return acc;
      }, {} as Record<string, any[]>);

      const exportData = Object.values(responsesByPrompt)
        .map(promptResponses => {
          // Use the first response for prompt text and basic info
          const response = promptResponses[0];
          const promptText = response.prompts?.prompt_text || '';

          // Collect all unique fan-out queries from all responses for this prompt
          const allFanOutQueries = new Set<string>();
          promptResponses.forEach(r => {
            if (r.web_search_query) {
              if (Array.isArray(r.web_search_query)) {
                r.web_search_query.forEach(q => allFanOutQueries.add(q));
              } else if (typeof r.web_search_query === 'string') {
                const cleaned = r.web_search_query
                  .replace(/^\[['"]?|['"]?\]$/g, '')
                  .replace(/^['"]|['"]$/g, '');
                if (cleaned) allFanOutQueries.add(cleaned);
              }
            }
          });
          const fanOutQueries = Array.from(allFanOutQueries).join('; ');

          // Get all citations for this prompt across all responses
          const promptCitations = citationsFromLastAudit.filter(citation =>
            citation.prompt_id === response.prompt_id &&
            citation.llm === response.llm
          );

          // Collect all unique sources from all responses
          const allSourcesSet = new Set<string>();
          promptResponses.forEach(r => {
            if (r.all_sources && Array.isArray(r.all_sources)) {
              r.all_sources.forEach((source: any) => {
                if (typeof source === 'string') {
                  allSourcesSet.add(source);
                } else if (source.url) {
                  allSourcesSet.add(source.url);
                }
              });
            }
          });
          const allSourcesText = Array.from(allSourcesSet).filter(Boolean).join('; ');

          // For SearchGPT: only include citations where cited=true
          // For other LLMs (Perplexity, Gemini): include cited=true or cited=null
          let citedCitations = '';
          if (llm === 'searchgpt') {
            const citedUrls = new Set<string>();

            // Get citations from citations table where cited=true
            promptCitations
              .filter(citation => citation.cited === true)
              .forEach(citation => {
                if (citation.page_url) citedUrls.add(citation.page_url);
              });

            // Also check links_attached field for SearchGPT
            promptResponses.forEach(r => {
              if (r.links_attached && Array.isArray(r.links_attached)) {
                r.links_attached.forEach((link: any) => {
                  if (link.url) citedUrls.add(link.url);
                });
              }
            });

            citedCitations = Array.from(citedUrls).join('; ');
          } else {
            const citedUrls = new Set(
              promptCitations
                .filter(citation => citation.cited === true || citation.cited == null) // Use == to catch both null and undefined
                .map(citation => citation.page_url)
                .filter(Boolean)
            );
            citedCitations = Array.from(citedUrls).join('; ');

            // Fallback for non-SearchGPT: If no citations found, use all_sources
            if (promptCitations.length === 0 && allSourcesText) {
              citedCitations = allSourcesText;
            }
          }

          // Citations with cited=false (Citations More)
          // This applies to all LLMs including SearchGPT: only include URLs where cited=false
          const moreUrls = new Set(
            promptCitations
              .filter(citation => citation.cited === false)
              .map(citation => citation.page_url)
              .filter(Boolean)
          );
          const moreCitations = Array.from(moreUrls).join('; ');

          // Use the answer from the first response
          const answer = response.answer_text || '';

          return {
            'prompt': promptText,
            'fan-out': fanOutQueries,
            'citations': citedCitations,
            'citations (more)': moreCitations,
            'all sources': allSourcesText,
            'answer': answer
          };
        })
        .filter(row => row.prompt.trim() !== ''); // Exclude rows with empty prompts

      const ws = xlsxUtils.json_to_sheet(exportData);
      xlsxUtils.book_append_sheet(wb, ws, llm);
    });

    const filename = `${project?.name || 'project'}_audit_${lastAuditDate}.xlsx`;
    xlsxWriteFile(wb, filename);
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

  // Normalize URL by removing query parameters for grouping
  const normalizeUrl = (url: string): string => {
    try {
      const urlObj = new URL(url);
      // Return URL without query parameters or hash
      return `${urlObj.origin}${urlObj.pathname}`;
    } catch (e) {
      // If URL parsing fails, return original
      return url;
    }
  };

  const getFilteredPageStats = () => {
    const pageStats = filteredCitations.reduce((acc, citation) => {
      if (!citation.page_url || !citation.domain) return acc;

      // Use normalized URL as key for grouping
      const normalizedUrl = normalizeUrl(citation.page_url);

      if (!acc[normalizedUrl]) {
        acc[normalizedUrl] = {
          page_url: citation.page_url, // Keep one original URL for display
          domain: citation.domain,
          mentions: 0,
          more_count: 0,
          all_sources_count: 0,
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

    const pages = Object.values(pageStats);

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
        citedPrompts,
        citedPromptsPercentage,
        citedPages,
        audits,
        citationsMore,
        totalCitations: domain.mentions + citationsMore,
        avgSentiment: domain.sentimentCount > 0
          ? (domain.sentimentSum / domain.sentimentCount).toFixed(2)
          : 'N/A',
      };
    })
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

  const getCitationRate = () => {
    if (!project?.domain) return { rate: 0, cited: 0, total: 0 };

    // Normalize project domain (remove www and lowercase) to match recalculate-metrics logic
    const projectDomain = project.domain.toLowerCase().replace(/^www\./, '');
    const domainMode = project.domain_mode || 'exact';

    const citedLlmResponseIds = new Set<string>();

    // Check citations from citations table (for SearchGPT, Perplexity, Gemini)
    filteredCitations
      .filter(c => {
        if (!c.domain || !c.audit_id || !c.prompt_id) return false;

        // Filter out citations with cited=false (SearchGPT "More" section)
        if (c.cited === false) return false;

        // Normalize citation domain (remove www and lowercase)
        const citationDomain = c.domain.toLowerCase().replace(/^www\./, '');

        if (domainMode === 'subdomains') {
          return citationDomain === projectDomain || citationDomain.endsWith(`.${projectDomain}`);
        } else {
          return citationDomain === projectDomain;
        }
      })
      .forEach(c => citedLlmResponseIds.add(`${c.audit_id}-${c.prompt_id}-${c.llm}`));

    // Check links_attached field for SearchGPT
    filteredLlmResponses
      .filter(r => r.audit_id && r.prompt_id && r.llm === 'searchgpt' && r.links_attached && Array.isArray(r.links_attached))
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
            citedLlmResponseIds.add(`${response.audit_id}-${response.prompt_id}-${response.llm}`);
          }
        } catch (error) {
          console.error('Error parsing links_attached:', error);
        }
      });

    // Check all_sources field for LLMs that store sources there (Bing, Google AI, Grok, etc.)
    filteredLlmResponses
      .filter(r => r.audit_id && r.prompt_id && r.all_sources)
      .forEach(response => {
        try {
          const sources = Array.isArray(response.all_sources) ? response.all_sources : JSON.parse(response.all_sources);

          const hasProjectDomain = sources.some((source: any) => {
            if (!source.domain && !source.url) return false;

            // Extract and normalize domain
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
            citedLlmResponseIds.add(`${response.audit_id}-${response.prompt_id}-${response.llm}`);
          }
        } catch (error) {
          console.error('Error parsing all_sources:', error);
        }
      });

    // Count total LLM responses using filtered data
    const totalLlmResponses = filteredLlmResponses.filter(r => r.audit_id && r.prompt_id).length;

    if (totalLlmResponses === 0) return { rate: 0, cited: 0, total: 0 };

    // Calculate percentage of LLM responses that cite the domain
    const rate = Math.round((citedLlmResponseIds.size / totalLlmResponses) * 100);
    return { rate, cited: citedLlmResponseIds.size, total: totalLlmResponses };
  };

  const getMentionRate = () => {
    const ownBrands = brands.filter(brand => !brand.is_competitor).map(brand => brand.brand_name);

    if (ownBrands.length === 0) return { rate: 0, mentioned: 0, total: 0 };

    // Response-level calculation — matches the tooltip formula:
    //   "Responses mentioning your brand / Total responses × 100"
    // Every llm_responses row counts independently: a prompt that runs on
    // N LLMs contributes N rows to the denominator, not 1. Previous versions
    // de-duplicated by (audit_id, prompt_id) which silently collapsed
    // multi-LLM runs and reported the wrong total (e.g. 240 instead of 480
    // for a 2-LLM / 240-prompt project).
    const relevantResponses = filteredLlmResponses.filter(
      r => r.audit_id && r.prompt_id
    );

    const total = relevantResponses.length;
    if (total === 0) return { rate: 0, mentioned: 0, total: 0 };

    const mentioned = relevantResponses.filter(response => {
      const answerText = response.answer_text?.toLowerCase() || '';
      return ownBrands.some(brandName =>
        answerText.includes(brandName.toLowerCase())
      );
    }).length;

    const rate = Math.round((mentioned / total) * 100);
    return { rate, mentioned, total };
  };

  // Calculate brand mentions data based on filtered responses
  const getBrandMentionsData = () => {
    const allBrands = [...brands, ...competitors];

    return allBrands.map(brand => {
      const brandLower = brand.brand_name.toLowerCase();

      // Count unique prompts where brand is mentioned
      const promptsWithMentions = new Set<string>();
      let searchgptResponsesWithMentions = 0;
      let perplexityResponsesWithMentions = 0;
      let geminiResponsesWithMentions = 0;
      let sentimentScores: number[] = [];

      filteredLlmResponses.forEach(response => {
        if (response.answer_text) {
          const answerLower = response.answer_text.toLowerCase();
          if (answerLower.includes(brandLower)) {
            // Track unique prompts (audit_id + prompt_id)
            if (response.audit_id && response.prompt_id) {
              promptsWithMentions.add(`${response.audit_id}-${response.prompt_id}`);
            }

            // Count by LLM (number of responses)
            if (response.llm === 'searchgpt') searchgptResponsesWithMentions++;
            else if (response.llm === 'perplexity') perplexityResponsesWithMentions++;
            else if (response.llm === 'gemini') geminiResponsesWithMentions++;

            // Collect sentiment scores
            if (response.sentiment_score !== null) {
              sentimentScores.push(response.sentiment_score);
            }
          }
        }
      });

      // Calculate mention rate as % of total unique prompts that mention this brand
      const totalUniquePrompts = new Set(
        filteredLlmResponses
          .filter(r => r.audit_id && r.prompt_id)
          .map(r => `${r.audit_id}-${r.prompt_id}`)
      );

      const mentionRate = totalUniquePrompts.size > 0 ?
        Math.round((promptsWithMentions.size / totalUniquePrompts.size) * 100) : 0;

      const avgSentiment = sentimentScores.length > 0 ?
        sentimentScores.reduce((sum, score) => sum + score, 0) / sentimentScores.length : null;

      return {
        brand_name: brand.brand_name,
        is_competitor: brand.is_competitor,
        total_mentions: promptsWithMentions.size,
        searchgpt_mentions: searchgptResponsesWithMentions,
        perplexity_mentions: perplexityResponsesWithMentions,
        gemini_mentions: geminiResponsesWithMentions,
        mention_rate: mentionRate,
        avg_sentiment: avgSentiment,
      };
    });
  };

  const getCitationConsistency = () => {
    if (!project?.domain || auditDates.length === 0) return 0;

    const projectDomain = project.domain.toLowerCase().replace(/^www\./, '');
    const domainMode = project.domain_mode || 'exact';
    let consistentAudits = 0;

    auditDates.forEach(date => {
      const auditCitations = citationsByAudit[date] || [];
      const hasDomainCitation = auditCitations.some(citation => {
        if (!citation.domain) return false;
        const citationDomain = citation.domain.toLowerCase().replace(/^www\./, '');

        if (domainMode === 'subdomains') {
          return citationDomain === projectDomain || citationDomain.endsWith(`.${projectDomain}`);
        } else {
          return citationDomain === projectDomain;
        }
      });
      if (hasDomainCitation) consistentAudits++;
    });

    return Math.round((consistentAudits / auditDates.length) * 100);
  };

  const tabs = [
    { id: 'overview', label: 'Overview', icon: List },
    { id: 'visibility', label: 'Visibility Overview', icon: BarChart3 },
    { id: 'prompts', label: 'Prompts', icon: MessageCircle },
    { id: 'pages', label: 'Pages', icon: FileText },
    { id: 'domains', label: 'Domains', icon: Globe },
    { id: 'mentions', label: 'Mentions', icon: BadgeCheck },
    { id: 'insights', label: 'Insights', icon: Lightbulb },
    { id: 'sentiment', label: 'Sentiment', icon: Smile },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

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
          >
            <Download className="w-4 h-4 mr-2" />
            Export
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

      {/* Filter Bar */}
      <Card>
        <CardContent className="p-6 pt-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center space-x-2">
                <Calendar className="w-4 h-4 text-gray-500" />
                <select
                  value={filters.dateRange}
                  onChange={(e) => handleFilterChange('dateRange', e.target.value)}
                  className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm font-sans focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary"
                >
                  <option value="lastAudit">
                    Last Audit {lastAuditDate && `(${new Date(lastAuditDate).toLocaleDateString()})`}
                  </option>
                  <option value="all">All time</option>
                  <option value="last7days">Last 7 days</option>
                  <option value="last14days">Last 14 days</option>
                  <option value="last30days">Last 30 days</option>
                  <option value="last90days">Last 90 days</option>
                  <option value="custom">Custom</option>
                </select>
              </div>
              
              <div className="relative flex items-center space-x-2 z-[30]">
                <Brain className="w-4 h-4 text-gray-500" />
                <div className="relative">
                  <button
                    ref={llmButtonRef}
                    type="button"
                    onClick={() => {
                      if (!showLlmDropdown) {
                        const rect = llmButtonRef.current?.getBoundingClientRect();
                        if (rect) setLlmDropdownPos({ top: rect.bottom + 4, left: rect.left, minWidth: rect.width });
                      }
                      setShowLlmDropdown(!showLlmDropdown);
                    }}
                    className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm font-sans focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary flex items-center space-x-2 justify-between"
                  >
                    <div className="flex items-center space-x-2">
                      {filters.llms !== 'all' && (
                        <img src={LLM_ICONS[filters.llms as keyof typeof LLM_ICONS]} alt="" className="w-4 h-4" />
                      )}
                      <span>
                        {filters.llms === 'all' ? 'All LLMs' :
                         filters.llms === 'searchgpt' ? 'SearchGPT' :
                         filters.llms === 'perplexity' ? 'Perplexity' :
                         filters.llms === 'gemini' ? 'Gemini' :
                         filters.llms === 'google-ai-overview' ? 'Google AI Overview' :
                         filters.llms === 'google-ai-mode' ? 'Google AI Mode' :
                         filters.llms === 'bing-copilot' ? 'Bing Copilot' :
                         filters.llms === 'grok' ? 'Grok' : 'All LLMs'}
                      </span>
                    </div>
                    <ChevronDown className="w-4 h-4" />
                  </button>
                  {showLlmDropdown && createPortal(
                    <>
                      <div
                        className="fixed inset-0 z-[9998]"
                        onClick={() => setShowLlmDropdown(false)}
                      />
                      <div
                        className="fixed bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-xl shadow-lg z-[9999] max-h-[400px] overflow-y-auto"
                        style={llmDropdownPos || {}}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            handleFilterChange('llms', 'all');
                            setShowLlmDropdown(false);
                          }}
                          className="w-full px-3 py-2 text-left text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-600 flex items-center space-x-2"
                        >
                          <span>All LLMs</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            handleFilterChange('llms', 'searchgpt');
                            setShowLlmDropdown(false);
                          }}
                          className="w-full px-3 py-2 text-left text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-600 flex items-center space-x-2"
                        >
                          <img src={LLM_ICONS.searchgpt} alt="" className="w-4 h-4" />
                          <span>SearchGPT</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            handleFilterChange('llms', 'perplexity');
                            setShowLlmDropdown(false);
                          }}
                          className="w-full px-3 py-2 text-left text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-600 flex items-center space-x-2"
                        >
                          <img src={LLM_ICONS.perplexity} alt="" className="w-4 h-4" />
                          <span>Perplexity</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            handleFilterChange('llms', 'gemini');
                            setShowLlmDropdown(false);
                          }}
                          className="w-full px-3 py-2 text-left text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-600 flex items-center space-x-2"
                        >
                          <img src={LLM_ICONS.gemini} alt="" className="w-4 h-4" />
                          <span>Gemini</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            handleFilterChange('llms', 'google-ai-overview');
                            setShowLlmDropdown(false);
                          }}
                          className="w-full px-3 py-2 text-left text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-600 flex items-center space-x-2"
                        >
                          <img src={LLM_ICONS['google-ai-overview']} alt="" className="w-4 h-4" />
                          <span>Google AI Overview</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            handleFilterChange('llms', 'google-ai-mode');
                            setShowLlmDropdown(false);
                          }}
                          className="w-full px-3 py-2 text-left text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-600 flex items-center space-x-2"
                        >
                          <img src={LLM_ICONS['google-ai-mode']} alt="" className="w-4 h-4" />
                          <span>Google AI Mode</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            handleFilterChange('llms', 'bing-copilot');
                            setShowLlmDropdown(false);
                          }}
                          className="w-full px-3 py-2 text-left text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-600 flex items-center space-x-2"
                        >
                          <img src={LLM_ICONS['bing-copilot']} alt="" className="w-4 h-4" />
                          <span>Bing Copilot</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            handleFilterChange('llms', 'grok');
                            setShowLlmDropdown(false);
                          }}
                          className="w-full px-3 py-2 text-left text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-600 flex items-center space-x-2"
                        >
                          <img src={LLM_ICONS.grok} alt="" className="w-4 h-4" />
                          <span>Grok</span>
                        </button>
                      </div>
                    </>,
                    document.body
                  )}
                </div>
              </div>
              
              <div className="relative flex items-center space-x-2">
                <FileText className="w-4 h-4 text-gray-500" />
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowPromptGroupDropdown(!showPromptGroupDropdown)}
                    className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm font-sans focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary flex items-center space-x-2 justify-between"
                  >
                    <span>
                      {filters.promptGroups.length === 0
                        ? 'All Prompt Groups'
                        : `${filters.promptGroups.length} selected`}
                    </span>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {showPromptGroupDropdown && (
                    <>
                      <div
                        className="fixed inset-0 z-10"
                        onClick={() => setShowPromptGroupDropdown(false)}
                      />
                      <div className="absolute z-20 mt-1 w-64 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl shadow-lg max-h-60 overflow-auto">
                        <div className="p-2 space-y-1">
                          {Array.from(new Set(prompts.map(p => p.prompt_group))).map(group => (
                            <label
                              key={group}
                              className="flex items-center p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={filters.promptGroups.includes(group)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setFilters(prev => ({
                                      ...prev,
                                      promptGroups: [...prev.promptGroups, group]
                                    }));
                                  } else {
                                    setFilters(prev => ({
                                      ...prev,
                                      promptGroups: prev.promptGroups.filter(g => g !== group)
                                    }));
                                  }
                                }}
                                className="w-4 h-4 text-brand-primary border-gray-300 dark:border-gray-600 rounded focus:ring-brand-primary"
                              />
                              <span className="ml-2 text-sm text-gray-900 dark:text-gray-100">
                                {group}
                              </span>
                            </label>
                          ))}
                        </div>
                        {filters.promptGroups.length > 0 && (
                          <div className="border-t border-gray-200 dark:border-gray-700 p-2">
                            <button
                              onClick={() => {
                                setFilters(prev => ({ ...prev, promptGroups: [] }));
                                setShowPromptGroupDropdown(false);
                              }}
                              className="w-full text-sm text-brand-primary hover:text-brand-secondary font-medium"
                            >
                              Clear all
                            </button>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
            
            <div className="flex items-center space-x-2">
              {getActiveFiltersCount() > 0 && (
                <div className="flex items-center space-x-2">
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    {getActiveFiltersCount()} filter{getActiveFiltersCount() > 1 ? 's' : ''} active
                  </span>
                  <div className="w-2 h-2 bg-brand-primary rounded-full"></div>
                </div>
              )}
              <Button variant="ghost" size="sm" onClick={resetFilters}>
                Reset
              </Button>
            </div>
          </div>
          
          {(filteredLlmResponses.length !== llmResponses.length || filteredCitations.length !== citations.length) && (
            <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
              <div className="text-sm text-gray-600 dark:text-gray-400">
                Showing {filteredLlmResponses.length} of {llmResponses.length} responses, {filteredCitations.length} of {citations.length} citations
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Custom Date Range Picker Modal */}
      <Modal 
        isOpen={showCustomDatePicker} 
        onClose={() => {
          setShowCustomDatePicker(false);
          if (!customDateRange.startDate || !customDateRange.endDate) {
            setFilters(prev => ({ ...prev, dateRange: 'last30days' }));
          }
        }} 
        title="Select Custom Date Range"
      >
        <div className="p-6 space-y-4">
          <div className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            Select from dates with available audit data
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Start Date
              </label>
              <select
                value={customDateRange.startDate}
                onChange={(e) => setCustomDateRange(prev => ({ ...prev, startDate: e.target.value }))}
                className="block w-full rounded-2xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2.5 text-gray-900 dark:text-gray-100 focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 font-sans"
              >
                <option value="">Select start date</option>
                {availableDates.map(date => (
                  <option key={date} value={date}>
                    {new Date(date).toLocaleDateString()}
                  </option>
                ))}
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                End Date
              </label>
              <select
                value={customDateRange.endDate}
                onChange={(e) => setCustomDateRange(prev => ({ ...prev, endDate: e.target.value }))}
                className="block w-full rounded-2xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2.5 text-gray-900 dark:text-gray-100 focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 font-sans"
                disabled={!customDateRange.startDate}
              >
                <option value="">Select end date</option>
                {availableDates
                  .filter(date => !customDateRange.startDate || date >= customDateRange.startDate)
                  .map(date => (
                    <option key={date} value={date}>
                      {new Date(date).toLocaleDateString()}
                    </option>
                  ))}
              </select>
            </div>
          </div>
          
          {customDateRange.startDate && customDateRange.endDate && (
            <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-xl">
              <div className="text-sm text-blue-800 dark:text-blue-200">
                Selected range: {new Date(customDateRange.startDate).toLocaleDateString()} - {new Date(customDateRange.endDate).toLocaleDateString()}
              </div>
            </div>
          )}
          
          <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200 dark:border-gray-700">
            <Button 
              variant="secondary" 
              onClick={() => {
                setShowCustomDatePicker(false);
                setFilters(prev => ({ ...prev, dateRange: 'lastAudit' }));
                setCustomDateRange({ startDate: '', endDate: '' });
              }}
            >
              Cancel
            </Button>
            <Button
              variant="gradient"
              onClick={() => {
                setShowCustomDatePicker(false);
                applyFilters();
              }}
              disabled={!customDateRange.startDate || !customDateRange.endDate}
            >
              Apply Date Range
            </Button>
          </div>
        </div>
      </Modal>

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
                    {getCitationRate().rate}%
                  </div>
                  <div className="text-sm text-white/90 font-medium">
                    Citation Rate
                  </div>
                  <div className="text-xs text-white/70 mt-1">
                    {getCitationRate().cited} of {getCitationRate().total} responses cite your domain
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
                    {getMentionRate().rate}%
                  </div>
                  <div className="text-sm text-white/90 font-medium">
                    Mention Rate
                  </div>
                  <div className="text-xs text-white/70 mt-1">
                    {getMentionRate().mentioned} of {getMentionRate().total} responses mention your brand
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
                  // Calculate metrics by LLM
                  const metricsByLlm: Record<string, { citationRate: number; mentionRate: number; totalResponses: number }> = {};

                  // Get unique LLMs from filtered responses
                  const uniqueLlms = [...new Set(filteredLlmResponses.map(r => r.llm))].sort();

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

                  const projectDomain = project?.domain?.toLowerCase().replace(/^www\./, '');
                  const domainMode = project?.domain_mode || 'exact';
                  const ownBrands = brands.filter(b => !b.is_competitor).map(b => b.brand_name);

                  uniqueLlms.forEach(llm => {
                    const llmResponses = filteredLlmResponses.filter(r => r.llm === llm);
                    const totalResponses = llmResponses.length;

                    // Calculate Citation Rate for this LLM
                    const responsesWithCitation = llmResponses.filter(response => {
                      // Check citations table (excluding cited=false) - use filteredCitations to respect filters
                      const responseCitations = filteredCitations.filter(c =>
                        c.prompt_id === response.prompt_id &&
                        c.audit_id === response.audit_id &&
                        c.llm === llm &&
                        c.cited !== false
                      );

                      const hasCitationInTable = responseCitations.some(c => {
                        if (!c.domain) return false;
                        const citationDomain = c.domain.toLowerCase().replace(/^www\./, '');

                        if (domainMode === 'subdomains') {
                          return citationDomain === projectDomain || citationDomain.endsWith(`.${projectDomain}`);
                        } else {
                          return citationDomain === projectDomain;
                        }
                      });

                      if (hasCitationInTable) return true;

                      // Check links_attached field for SearchGPT
                      if (llm === 'searchgpt' && response.links_attached && Array.isArray(response.links_attached)) {
                        const hasLinkInAttached = response.links_attached.some((link: any) => {
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

                        if (hasLinkInAttached) return true;
                      }

                      // Check all_sources field for LLMs that store sources there
                      if (response.all_sources) {
                        try {
                          const sources = Array.isArray(response.all_sources) ? response.all_sources : JSON.parse(response.all_sources);

                          return sources.some((source: any) => {
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
                        } catch (error) {
                          console.error('Error parsing all_sources:', error);
                          return false;
                        }
                      }

                      return false;
                    });

                    const citedCount = responsesWithCitation.length;
                    const citationRate = totalResponses > 0 ? Math.round((citedCount / totalResponses) * 100) : 0;

                    // Calculate Mention Rate for this LLM
                    const responsesWithMention = llmResponses.filter(response => {
                      const answerText = response.answer_text?.toLowerCase() || '';
                      return ownBrands.some(brandName => answerText.includes(brandName.toLowerCase()));
                    });

                    const mentionedCount = responsesWithMention.length;
                    const mentionRate = totalResponses > 0 ? Math.round((mentionedCount / totalResponses) * 100) : 0;

                    metricsByLlm[llm] = {
                      citationRate,
                      mentionRate,
                      totalResponses,
                      citedCount,
                      mentionedCount
                    };
                  });

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
                    const radarData = getCitationRateByPromptGroup();
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
                      onClick={() => {
                        setShowLlmDropdown(false);
                        setShowRunAuditModal(true);
                      }}
                    >
                      <Play className="w-4 h-4 mr-2" />
                      Run Audit
                    </Button>
                  </div>
                )}
              </div>

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
                      // Get unique LLMs
                      const uniqueLlms = Array.from(new Set(llmResponses.map(r => r.llm))).sort();

                      return (
                        <tr key={prompt.id} className="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                          <td className="sticky left-0 bg-white dark:bg-gray-800 px-4 py-3 text-sm text-gray-900 dark:text-gray-100 border-r border-gray-200 dark:border-gray-700 max-w-xs truncate z-10">
                            <div className="truncate" title={prompt.prompt_text}>
                              {prompt.prompt_text}
                            </div>
                          </td>
                          {uniqueLlms.map(llm => {
                            // Get responses for this prompt and LLM
                            const responsesForPromptLlm = llmResponses.filter(
                              r => r.prompt_id === prompt.id && r.llm === llm
                            );

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
                        {getFilteredAuditDates().map(date => (
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
                                  const webSearchQueries = filteredLlmResponses
                                    .filter(response => response.prompt_id === prompt.id && response.web_search_query)
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

                                  const isProjectBrandMentioned = llmResponsesForPrompt.some(response => {
                                    const answerText = response.answer_text?.toLowerCase() || '';
                                    return projectBrands.some(brandName =>
                                      answerText.includes(brandName.toLowerCase())
                                    );
                                  });

                                  return isProjectBrandMentioned ? (
                                    <BadgeCheck className="w-5 h-5 text-green-500" />
                                  ) : null;
                                })()}
                              </div>
                            </td>
                            {getFilteredAuditDates().map(date => {
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
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Page Citations</h3>
                <button
                  onClick={exportPagesToExcel}
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
                      <th className="text-center py-3 px-2 text-gray-900 dark:text-gray-100">
                        <button
                          onClick={() => handlePageSort('mentions')}
                          className="flex items-center gap-1 hover:text-brand-primary transition-colors mx-auto"
                        >
                          Citations (Cited)
                          {renderSortIcon('mentions', pageSortConfig)}
                        </button>
                      </th>
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
                    {getFilteredPageStats().map((page, index) => (
                      <tr key={index} className="border-b border-gray-100 dark:border-gray-800">
                        <td className="py-3 px-2 font-medium max-w-xs truncate">
                          <div className="flex items-center">
                            <img
                              src={`https://www.google.com/s2/favicons?domain=${extractDomain(page.page_url)}&sz=32`}
                              alt={`${extractDomain(page.page_url)} favicon`}
                              className="w-4 h-4 mr-2 flex-shrink-0"
                              onError={(e) => {
                                const target = e.target as HTMLImageElement;
                                target.style.display = 'none';
                              }}
                            />
                            <div className="text-sm text-gray-900 dark:text-gray-100 max-w-md truncate">
                              <a href={page.page_url} target="_blank" rel="noopener noreferrer" className="text-brand-primary hover:underline">
                                {page.page_url}
                              </a>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-2 text-gray-900 dark:text-gray-100">{page.domain}</td>
                        <td className="py-3 px-2 text-center text-gray-900 dark:text-gray-100">{page.mentions}</td>
                        <td className="py-3 px-2 text-center text-gray-900 dark:text-gray-100">{page.more_count || 0}</td>
                        <td className="py-3 px-2 text-center text-gray-900 dark:text-gray-100 font-semibold">{page.mentions + (page.more_count || 0)}</td>
                        <td className="py-3 px-2 text-center text-gray-900 dark:text-gray-100">{page.all_sources_count || 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'domains' && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Domain Performance</h3>
                <button
                  onClick={exportDomainsToExcel}
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
                      <th className="text-left py-3 px-2 text-gray-900 dark:text-gray-100">
                        <button
                          onClick={() => handleDomainSort('domain')}
                          className="flex items-center gap-1 hover:text-brand-primary transition-colors"
                        >
                          Domain
                          {renderSortIcon('domain', domainSortConfig)}
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
                    {getFilteredDomainStats().map((domain: any, index) => (
                      <tr key={index} className="border-b border-gray-100 dark:border-gray-800">
                        <td className="py-3 px-2 font-medium text-gray-900 dark:text-gray-100">
                          <div className="flex items-center">
                            <img
                              src={`https://www.google.com/s2/favicons?domain=${domain.domain}&sz=32`}
                              alt={`${domain.domain} favicon`}
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
                        <td className="py-3 px-2 text-center text-gray-900 dark:text-gray-100">{domain.mentions}</td>
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
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'mentions' && (
            <div className="space-y-8">
              {/* Brand Mentions Analysis Table */}
              <Card className="overflow-hidden">
                <CardHeader>
                  <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                    Brand Mentions Analysis
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                    Analysis of how often your brands and competitors are mentioned across LLM responses
                  </p>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="bg-gradient-to-r from-gray-50 to-gray-100/50 dark:from-gray-800 dark:to-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                          <th className="text-left py-4 px-6 font-semibold text-xs uppercase tracking-wider text-gray-700 dark:text-gray-300">
                            <div className="flex items-center gap-2">
                              Brand
                              <div className="group relative">
                                <Info className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400 cursor-help transition-colors" />
                                <div className="absolute top-full left-0 mt-2 w-64 p-3 bg-gray-900 text-white text-xs normal-case tracking-normal rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 pointer-events-none z-10">
                                  <div className="font-semibold mb-1">Brand Name</div>
                                  <div>The name of the brand being analyzed in LLM responses</div>
                                </div>
                              </div>
                            </div>
                          </th>
                          <th className="text-left py-4 px-6 font-semibold text-xs uppercase tracking-wider text-gray-700 dark:text-gray-300">
                            <div className="flex items-center gap-2">
                              Type
                              <div className="group relative">
                                <Info className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400 cursor-help transition-colors" />
                                <div className="absolute top-full left-0 mt-2 w-64 p-3 bg-gray-900 text-white text-xs normal-case tracking-normal rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 pointer-events-none z-10">
                                  <div className="font-semibold mb-1">Brand Type</div>
                                  <div>Indicates whether this is your own brand or a competitor</div>
                                </div>
                              </div>
                            </div>
                          </th>
                          <th className="text-center py-4 px-6 font-semibold text-xs uppercase tracking-wider text-gray-700 dark:text-gray-300">
                            <div className="flex items-center justify-center gap-2">
                              Prompts
                              <div className="group relative">
                                <Info className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400 cursor-help transition-colors" />
                                <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-64 p-3 bg-gray-900 text-white text-xs normal-case tracking-normal rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 pointer-events-none z-10">
                                  <div className="font-semibold mb-1">Total Mentions</div>
                                  <div className="mb-2">Total number of times this brand was mentioned across all LLM responses</div>
                                  <div className="text-white/70 italic">Formula: Count of responses mentioning brand</div>
                                </div>
                              </div>
                            </div>
                          </th>
                          <th className="text-center py-4 px-6 font-semibold text-xs uppercase tracking-wider text-gray-700 dark:text-gray-300">
                            <div className="flex items-center justify-center gap-2">
                              SearchGPT
                              <div className="group relative">
                                <Info className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400 cursor-help transition-colors" />
                                <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-64 p-3 bg-gray-900 text-white text-xs normal-case tracking-normal rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 pointer-events-none z-10">
                                  <div className="font-semibold mb-1">SearchGPT Mentions</div>
                                  <div>Number of mentions in SearchGPT responses</div>
                                </div>
                              </div>
                            </div>
                          </th>
                          <th className="text-center py-4 px-6 font-semibold text-xs uppercase tracking-wider text-gray-700 dark:text-gray-300">
                            <div className="flex items-center justify-center gap-2">
                              Perplexity
                              <div className="group relative">
                                <Info className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400 cursor-help transition-colors" />
                                <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-64 p-3 bg-gray-900 text-white text-xs normal-case tracking-normal rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 pointer-events-none z-10">
                                  <div className="font-semibold mb-1">Perplexity Mentions</div>
                                  <div>Number of mentions in Perplexity AI responses</div>
                                </div>
                              </div>
                            </div>
                          </th>
                          <th className="text-center py-4 px-6 font-semibold text-xs uppercase tracking-wider text-gray-700 dark:text-gray-300">
                            <div className="flex items-center justify-center gap-2">
                              Gemini
                              <div className="group relative">
                                <Info className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400 cursor-help transition-colors" />
                                <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-64 p-3 bg-gray-900 text-white text-xs normal-case tracking-normal rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 pointer-events-none z-10">
                                  <div className="font-semibold mb-1">Gemini Mentions</div>
                                  <div>Number of mentions in Google Gemini responses</div>
                                </div>
                              </div>
                            </div>
                          </th>
                          <th className="text-center py-4 px-6 font-semibold text-xs uppercase tracking-wider text-gray-700 dark:text-gray-300">
                            <div className="flex items-center justify-center gap-2">
                              Mention Rate
                              <div className="group relative">
                                <Info className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400 cursor-help transition-colors" />
                                <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-72 p-3 bg-gray-900 text-white text-xs normal-case tracking-normal rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 pointer-events-none z-10">
                                  <div className="font-semibold mb-1">Mention Rate</div>
                                  <div className="mb-2">Percentage of responses that mention this brand</div>
                                  <div className="text-white/70 italic">Formula: (Mentions / Total responses) × 100</div>
                                </div>
                              </div>
                            </div>
                          </th>
                          {project.sentiment && (
                            <th className="text-center py-4 px-6 font-semibold text-xs uppercase tracking-wider text-gray-700 dark:text-gray-300">
                              <div className="flex items-center justify-center gap-2">
                                Avg Sentiment
                                <div className="group relative">
                                  <Info className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400 cursor-help transition-colors" />
                                  <div className="absolute top-full right-0 mt-2 w-72 p-3 bg-gray-900 text-white text-xs normal-case tracking-normal rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 pointer-events-none z-10">
                                    <div className="font-semibold mb-1">Average Sentiment</div>
                                    <div className="mb-2">Average sentiment score for this brand across all mentions</div>
                                    <div className="text-white/70 italic">Scale: -1 (negative) to +1 (positive)</div>
                                  </div>
                                </div>
                              </div>
                            </th>
                          )}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                        {getBrandMentionsData().map((brand, index) => (
                          <tr
                            key={brand.brand_name}
                            className="group hover:bg-gradient-to-r hover:from-gray-50 hover:to-transparent dark:hover:from-gray-800/50 dark:hover:to-transparent transition-all duration-200"
                          >
                            <td className="py-4 px-6">
                              <div className="flex items-center gap-3">
                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm shadow-sm ${
                                  brand.is_competitor
                                    ? 'bg-gradient-to-br from-red-100 to-red-200 dark:from-red-900/30 dark:to-red-800/20 text-red-700 dark:text-red-400'
                                    : 'bg-gradient-to-br from-emerald-100 to-emerald-200 dark:from-emerald-900/30 dark:to-emerald-800/20 text-emerald-700 dark:text-emerald-400'
                                }`}>
                                  {brand.brand_name.charAt(0).toUpperCase()}
                                </div>
                                <div className="font-semibold text-gray-900 dark:text-gray-100">
                                  {brand.brand_name}
                                </div>
                              </div>
                            </td>
                            <td className="py-4 px-6">
                              <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl shadow-sm ${
                                brand.is_competitor
                                  ? 'bg-gradient-to-r from-red-100 to-red-50 dark:from-red-900/30 dark:to-red-800/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800/30'
                                  : 'bg-gradient-to-r from-emerald-100 to-emerald-50 dark:from-emerald-900/30 dark:to-emerald-800/20 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/30'
                              }`}>
                                <div className={`w-1.5 h-1.5 rounded-full ${
                                  brand.is_competitor
                                    ? 'bg-red-500 dark:bg-red-400'
                                    : 'bg-emerald-500 dark:bg-emerald-400'
                                }`} />
                                {brand.is_competitor ? 'Competitor' : 'Own Brand'}
                              </span>
                            </td>
                            <td className="py-4 px-6 text-center">
                              <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br from-blue-50 to-blue-100/50 dark:from-blue-900/20 dark:to-blue-800/10 border border-blue-200/50 dark:border-blue-800/30">
                                <span className="text-lg font-bold text-blue-700 dark:text-blue-400">
                                  {brand.total_mentions}
                                </span>
                              </div>
                            </td>
                            <td className="py-4 px-6 text-center">
                              <span className="text-base font-medium text-gray-700 dark:text-gray-300">
                                {brand.searchgpt_mentions}
                              </span>
                            </td>
                            <td className="py-4 px-6 text-center">
                              <span className="text-base font-medium text-gray-700 dark:text-gray-300">
                                {brand.perplexity_mentions}
                              </span>
                            </td>
                            <td className="py-4 px-6 text-center">
                              <span className="text-base font-medium text-gray-700 dark:text-gray-300">
                                {brand.gemini_mentions}
                              </span>
                            </td>
                            <td className="py-4 px-6 text-center">
                              <div className={`inline-flex items-center justify-center px-4 py-2 rounded-xl font-bold text-sm shadow-sm ${
                                brand.mention_rate >= 50
                                  ? 'bg-gradient-to-r from-emerald-100 to-emerald-50 dark:from-emerald-900/30 dark:to-emerald-800/20 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/30'
                                  : brand.mention_rate >= 25
                                  ? 'bg-gradient-to-r from-amber-100 to-amber-50 dark:from-amber-900/30 dark:to-amber-800/20 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800/30'
                                  : 'bg-gradient-to-r from-red-100 to-red-50 dark:from-red-900/30 dark:to-red-800/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800/30'
                              }`}>
                                {brand.mention_rate}%
                              </div>
                            </td>
                            {project.sentiment && (
                              <td className="py-4 px-6 text-center">
                                {brand.avg_sentiment !== null ? (
                                  <div className={`inline-flex items-center justify-center px-4 py-2 rounded-xl font-bold text-sm shadow-sm ${
                                    brand.avg_sentiment > 0.2
                                      ? 'bg-gradient-to-r from-emerald-100 to-emerald-50 dark:from-emerald-900/30 dark:to-emerald-800/20 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/30'
                                      : brand.avg_sentiment < -0.2
                                      ? 'bg-gradient-to-r from-red-100 to-red-50 dark:from-red-900/30 dark:to-red-800/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800/30'
                                      : 'bg-gradient-to-r from-amber-100 to-amber-50 dark:from-amber-900/30 dark:to-amber-800/20 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800/30'
                                  }`}>
                                    {brand.avg_sentiment > 0 ? '+' : ''}{brand.avg_sentiment.toFixed(2)}
                                  </div>
                                ) : (
                                  <span className="text-gray-400 text-sm">-</span>
                                )}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
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
                              const answerText = response.answer_text?.toLowerCase() || '';

                              allBrands.forEach(brand => {
                                if (answerText.includes(brand.brand_name.toLowerCase())) {
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
                              const hasBrandMention = projectBrands.some(brandName =>
                                response.answer_text?.toLowerCase().includes(brandName.toLowerCase())
                              );

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
                                              <div
                                                className={`w-2 h-2 rounded-full mr-1 ${
                                                  brand.is_competitor ? 'bg-red-500' : 'bg-blue-500'
                                                }`}
                                              />
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
                      <div className="flex gap-2 h-[46px]">
                        {(availableLlms.length === 0 || availableLlms.includes('searchgpt')) && (
                          <button
                            type="button"
                            onClick={() => setInsightConfig({ ...insightConfig, targetLlm: 'searchgpt' })}
                            className={`flex-1 flex items-center justify-center rounded-xl border-2 transition-all ${
                              insightConfig.targetLlm === 'searchgpt'
                                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                                : 'border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-700'
                            }`}
                            title="SearchGPT"
                          >
                            <img
                              src={LLM_ICONS.searchgpt}
                              alt="SearchGPT"
                              className="w-8 h-8 object-contain"
                              onError={(e) => {
                                e.currentTarget.style.display = 'none';
                                e.currentTarget.parentElement!.innerHTML += '<span class="text-xs font-medium">SearchGPT</span>';
                              }}
                            />
                          </button>
                        )}
                        {(availableLlms.length === 0 || availableLlms.includes('perplexity')) && (
                          <button
                            type="button"
                            onClick={() => setInsightConfig({ ...insightConfig, targetLlm: 'perplexity' })}
                            className={`flex-1 flex items-center justify-center rounded-xl border-2 transition-all ${
                              insightConfig.targetLlm === 'perplexity'
                                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                                : 'border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-700'
                            }`}
                            title="Perplexity"
                          >
                            <img
                              src={LLM_ICONS.perplexity}
                              alt="Perplexity"
                              className="w-8 h-8 object-contain"
                              onError={(e) => {
                                e.currentTarget.style.display = 'none';
                                e.currentTarget.parentElement!.innerHTML += '<span class="text-xs font-medium">Perplexity</span>';
                              }}
                            />
                          </button>
                        )}
                        {(availableLlms.length === 0 || availableLlms.includes('gemini')) && (
                          <button
                            type="button"
                            onClick={() => setInsightConfig({ ...insightConfig, targetLlm: 'gemini' })}
                            className={`flex-1 flex items-center justify-center rounded-xl border-2 transition-all ${
                              insightConfig.targetLlm === 'gemini'
                                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                                : 'border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-700'
                            }`}
                            title="Gemini"
                          >
                            <img
                              src={LLM_ICONS.gemini}
                              alt="Gemini"
                              className="w-8 h-8 object-contain"
                              onError={(e) => {
                                e.currentTarget.style.display = 'none';
                                e.currentTarget.parentElement!.innerHTML += '<span class="text-xs font-medium">Gemini</span>';
                              }}
                            />
                          </button>
                        )}
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
                          Prompts Group <span className="text-gray-500 text-xs">(optional)</span>
                        </label>
                        <select
                          value={insightConfig.groupId}
                          onChange={(e) => setInsightConfig({ ...insightConfig, groupId: e.target.value })}
                          className="w-full h-[46px] px-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                        >
                          <option value="">All Prompt Groups</option>
                          {promptGroups.map((groupName: string) => (
                            <option key={groupName} value={groupName}>
                              {groupName}
                            </option>
                          ))}
                        </select>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          Filter prompts by a specific group from your project
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
        </CardContent>
      </Card>

      <RunAuditModal
        isOpen={showRunAuditModal}
        onClose={() => {
          setShowRunAuditModal(false);
          setShowLlmDropdown(false);
        }}
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
