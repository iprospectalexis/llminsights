import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Card, CardContent, CardHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { supabase } from '../lib/supabase';
import {
  Calendar, FileText, BarChart3, Globe, ArrowLeft, Brain,
  Filter, Download, ExternalLink, MessageSquare, Clock, Eye, X,
  Award, TrendingUp, ThumbsUp, ThumbsDown, Minus, Users, Search
} from 'lucide-react';
import { format } from 'date-fns';

const LLM_ICONS = {
  searchgpt: 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/SearchGPT.PNG',
  perplexity: 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/Perplexity.png',
  gemini: 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/Gemini.png',
  'google-ai-overview': 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/google_ai_overview.png',
  'google-ai-mode': 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/google_ai_mode.png',
  'bing-copilot': 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/bing_copilot.png',
  'grok': 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/Grok-icon.png',
};

const SENTIMENT_COLORS = {
  positive: '#10B981',
  neutral: '#6B7280',
  negative: '#EF4444',
};

interface LLMResponse {
  id: string;
  llm: string;
  answer_text: string | null;
  answer_text_markdown?: string | null;
  answer_html?: string | null;
  response_url: string | null;
  response_timestamp: string | null;
  country: string;
  raw_response_data: any;
  web_search_query?: string | null;
  answer_competitors?: {
    brands?: Array<{
      name: string;
      strengths?: string[];
      weaknesses?: string[];
      mention_type?: 'recommended' | 'compared' | 'mentioned';
      rank?: number | null;
    }>;
    error?: string;
  } | null;
  sentiment_score?: number | null;
  sentiment_label?: 'positive' | 'neutral' | 'negative' | null;
  created_at: string;
  audits: {
    id: string;
    created_at: string;
  } | null;
}

interface ProcessedCitation {
  url: string;
  domain: string;
  title?: string;
  description?: string;
  position?: number;
  llm: string;
  auditDate: string;
  sentiment_score?: number;
  sentiment_label?: string;
}

export const PromptDetailPage: React.FC = () => {
  const { projectId, promptId } = useParams<{ projectId: string; promptId: string }>();
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState<any>(null);
  const [project, setProject] = useState<any>(null);
  const [llmResponses, setLlmResponses] = useState<LLMResponse[]>([]);
  const [filteredResponses, setFilteredResponses] = useState<LLMResponse[]>([]);
  const [processedCitations, setProcessedCitations] = useState<ProcessedCitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('responses');
  const [filters, setFilters] = useState({
    dateRange: 'lastAudit',
    llms: 'all',
    sentiment: 'all',
  });
  const [showCustomDatePicker, setShowCustomDatePicker] = useState(false);
  const [customDateRange, setCustomDateRange] = useState({
    startDate: '',
    endDate: '',
  });
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [selectedResponse, setSelectedResponse] = useState<LLMResponse | null>(null);
  const [showResponseModal, setShowResponseModal] = useState(false);
  const [lastAuditDate, setLastAuditDate] = useState<string>('');
  const [loadingFullResponse, setLoadingFullResponse] = useState(false);

  useEffect(() => {
    if (projectId && promptId) {
      fetchPromptData();
    }
  }, [projectId, promptId]);

  useEffect(() => {
    applyFilters();
  }, [llmResponses, filters]);

  useEffect(() => {
    if (llmResponses.length > 0) {
      // Extract available dates from responses
      const dates = llmResponses.map(r => r.created_at.split('T')[0]);
      const uniqueDates = [...new Set(dates)].sort();
      setAvailableDates(uniqueDates);
      
      // Set last audit date (most recent date)
      if (uniqueDates.length > 0) {
        const mostRecentDate = uniqueDates[uniqueDates.length - 1];
        setLastAuditDate(mostRecentDate);
      }
      
      // Process citations from raw response data
      const citations = processLlmResponsesIntoCitations(llmResponses);
      setProcessedCitations(citations);
    }
  }, [llmResponses]);

  const extractDomainFromUrl = (url: string): string => {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  };

  const processLlmResponsesIntoCitations = (responses: LLMResponse[]): ProcessedCitation[] => {
    const citations: ProcessedCitation[] = [];

    responses.forEach(response => {
      if (!response.raw_response_data) return;

      const auditDate = response.audits?.created_at ? 
        response.audits.created_at.split('T')[0] : 
        response.created_at.split('T')[0];

      if (response.llm === 'perplexity' && response.raw_response_data.sources) {
        response.raw_response_data.sources.forEach((source: any, index: number) => {
          if (source.url) {
            citations.push({
              url: source.url,
              domain: extractDomainFromUrl(source.url),
              title: source.title,
              description: source.description,
              position: index + 1,
              llm: response.llm,
              auditDate,
            });
          }
        });
      }

      if (response.llm === 'searchgpt') {
        // Try multiple possible fields for SearchGPT citations
        let searchGptCitations = [];
        
        if (response.raw_response_data.citations) {
          searchGptCitations = response.raw_response_data.citations;
        } else if (response.raw_response_data.links_attached) {
          searchGptCitations = response.raw_response_data.links_attached;
        } else if (response.raw_response_data.sources) {
          searchGptCitations = response.raw_response_data.sources;
        }
        
        searchGptCitations.forEach((link: any, index: number) => {
          if (link.url) {
            citations.push({
              url: link.url,
              domain: extractDomainFromUrl(link.url),
              title: link.text || link.title || link.description,
              position: link.position || index + 1,
              llm: response.llm,
              auditDate,
            });
          }
        });
      }

      if (response.llm === 'gemini') {
        // Handle Gemini citations
        let geminiCitations = [];
        
        if (response.raw_response_data.links_attached) {
          geminiCitations = response.raw_response_data.links_attached;
        } else if (response.raw_response_data.citations) {
          geminiCitations = response.raw_response_data.citations;
        } else if (response.raw_response_data.sources) {
          geminiCitations = response.raw_response_data.sources;
        }
        
        geminiCitations.forEach((link: any, index: number) => {
          if (link.url) {
            citations.push({
              url: link.url,
              domain: extractDomainFromUrl(link.url),
              title: link.text || link.title || link.description,
              position: link.position || index + 1,
              llm: response.llm,
              auditDate,
            });
          }
        });
      }
    });

    return citations;
  };

  const applyFilters = () => {
    let filtered = [...llmResponses];

    // Apply date range filter
    if (filters.dateRange !== 'all') {
      if (filters.dateRange === 'lastAudit' && lastAuditDate) {
        // Filter to show only responses from the last audit date
        filtered = filtered.filter(response => 
          response.created_at.split('T')[0] === lastAuditDate
        );
      } else if (filters.dateRange === 'custom') {
        if (customDateRange.startDate && customDateRange.endDate) {
          const startDate = new Date(customDateRange.startDate);
          const endDate = new Date(customDateRange.endDate);
          endDate.setHours(23, 59, 59, 999);
          
          filtered = filtered.filter(response => {
            const responseDate = new Date(response.created_at);
            return responseDate >= startDate && responseDate <= endDate;
          });
        }
      } else {
        const now = new Date();
        now.setHours(23, 59, 59, 999);
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
        
        cutoffDate.setHours(0, 0, 0, 0);
        
        filtered = filtered.filter(response => 
          new Date(response.created_at) >= cutoffDate && new Date(response.created_at) <= now
        );
      }
    }

    // Apply LLM filter
    if (filters.llms !== 'all') {
      filtered = filtered.filter(response => response.llm === filters.llms);
    }

    // Apply sentiment filter
    if (filters.sentiment !== 'all') {
      filtered = filtered.filter(response => response.sentiment_label === filters.sentiment);
    }

    setFilteredResponses(filtered);
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
      sentiment: 'all',
    });
    setShowCustomDatePicker(false);
    setCustomDateRange({ startDate: '', endDate: '' });
  };

  const getActiveFiltersCount = () => {
    let count = 0;
    if (filters.dateRange !== 'lastAudit') count++;
    if (filters.llms !== 'all') count++;
    if (filters.sentiment !== 'all') count++;
    return count;
  };

  const fetchPromptData = async () => {
    if (!projectId || !promptId) return;

    setLoading(true);
    try {
      // Fetch project details with brands
      const { data: projectData } = await supabase
        .from('projects')
        .select('*, brands (*)')
        .eq('id', projectId)
        .single();

      if (projectData) {
        setProject(projectData);
      }

      // Fetch prompt details
      const { data: promptData } = await supabase
        .from('prompts')
        .select('*')
        .eq('id', promptId)
        .single();

      if (promptData) {
        setPrompt(promptData);
      }

      // Fetch all audits for this project (limit to recent ones)
      // Fetch LLM responses for this specific prompt using direct join
      const { data: responsesData } = await supabase
        .from('llm_responses')
        .select(`
          id,
          llm,
          answer_text,
          response_url,
          response_timestamp,
          country,
          raw_response_data,
          web_search_query,
          answer_competitors,
          sentiment_score,
          sentiment_label,
          created_at,
          audits!inner (
            id,
            created_at,
            project_id
          )
        `)
        .eq('prompt_id', promptId)
        .order('created_at', { ascending: false })
        .limit(50);

      setLlmResponses(responsesData || []);
    } catch (error) {
      console.error('Error fetching prompt data:', error);
    }
    setLoading(false);
  };

  const getResponseCitations = (response: LLMResponse): ProcessedCitation[] => {
    const citations: ProcessedCitation[] = [];
    
    if (!response.raw_response_data) return citations;

    const auditDate = response.audits?.created_at ? 
      response.audits.created_at.split('T')[0] : 
      response.created_at.split('T')[0];

    if (response.llm === 'perplexity' && response.raw_response_data.sources) {
      response.raw_response_data.sources.forEach((source: any, index: number) => {
        if (source.url) {
          citations.push({
            url: source.url,
            domain: extractDomainFromUrl(source.url),
            title: source.title,
            description: source.description,
            position: index + 1,
            llm: response.llm,
            auditDate,
          });
        }
      });
    }

    if (response.llm === 'searchgpt') {
      const linksAttached = response.raw_response_data.links_attached || [];
      
      linksAttached.forEach((link: any, index: number) => {
        if (link.url) {
          citations.push({
            url: link.url,
            domain: extractDomainFromUrl(link.url),
            title: link.text || link.title || link.description,
            position: link.position || index + 1,
            llm: response.llm,
            auditDate,
          });
        }
      });
    }

    if (response.llm === 'gemini') {
      const linksAttached = response.raw_response_data.links_attached || [];
      
      linksAttached.forEach((link: any, index: number) => {
        if (link.url) {
          citations.push({
            url: link.url,
            domain: extractDomainFromUrl(link.url),
            title: link.text || link.title || link.description,
            position: link.position || index + 1,
            llm: response.llm,
            auditDate,
          });
        }
      });
    }
    return citations;
  };

  const loadFullResponse = async (responseId: string) => {
    setLoadingFullResponse(true);
    try {
      const { data: fullResponse } = await supabase
        .from('llm_responses')
        .select('answer_text_markdown, answer_html')
        .eq('id', responseId)
        .single();

      if (fullResponse && selectedResponse) {
        setSelectedResponse({
          ...selectedResponse,
          answer_text_markdown: fullResponse.answer_text_markdown,
          answer_html: fullResponse.answer_html,
        });
      }
    } catch (error) {
      console.error('Error loading full response:', error);
    }
    setLoadingFullResponse(false);
  };

  const getAllCitations = (): ProcessedCitation[] => {
    const allCitations: ProcessedCitation[] = [];
    
    // Use filteredResponses but also apply date filter to citations themselves
    filteredResponses.forEach(response => {
      const citations = getResponseCitations(response);
      allCitations.push(...citations);
    });

    // Apply date filter to citations based on their audit dates
    return filterCitationsByDate(allCitations);
  };

  const filterCitationsByDate = (citations: ProcessedCitation[]): ProcessedCitation[] => {
    if (filters.dateRange === 'all') {
      return citations;
    }

    if (filters.dateRange === 'lastAudit' && lastAuditDate) {
      return citations.filter(citation => citation.auditDate === lastAuditDate);
    }

    if (filters.dateRange === 'custom') {
      if (customDateRange.startDate && customDateRange.endDate) {
        return citations.filter(citation => {
          const citationDate = citation.auditDate;
          return citationDate >= customDateRange.startDate && citationDate <= customDateRange.endDate;
        });
      }
      return citations;
    }

    // Handle relative date ranges
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
      default:
        return citations;
    }
    
    const cutoffDateString = cutoffDate.toISOString().split('T')[0];
    const nowDateString = now.toISOString().split('T')[0];
    
    return citations.filter(citation => 
      citation.auditDate >= cutoffDateString && citation.auditDate <= nowDateString
    );
  };
  const getDomainStats = () => {
    const citations = getAllCitations();
    const domainStats = citations.reduce((acc, citation) => {
      if (!acc[citation.domain]) {
        acc[citation.domain] = {
          domain: citation.domain,
          mentions: 0,
          llms: new Set(),
          firstSeen: citation.auditDate,
          lastSeen: citation.auditDate,
          auditDates: new Set(),
        };
      }

      acc[citation.domain].mentions++;
      acc[citation.domain].llms.add(citation.llm);
      acc[citation.domain].auditDates.add(citation.auditDate);
      
      if (citation.auditDate < acc[citation.domain].firstSeen) {
        acc[citation.domain].firstSeen = citation.auditDate;
      }
      if (citation.auditDate > acc[citation.domain].lastSeen) {
        acc[citation.domain].lastSeen = citation.auditDate;
      }

      return acc;
    }, {} as any);

    return Object.values(domainStats).map((domain: any) => ({
      ...domain,
      llms: Array.from(domain.llms),
      totalDays: domain.auditDates.size,
      avgMentionsPerDay: domain.auditDates.size > 0 ? (domain.mentions / domain.auditDates.size).toFixed(1) : '0',
    })).sort((a: any, b: any) => b.mentions - a.mentions);
  };

  // ── Brand highlighting ──────────────────────────────────────────────
  const getOwnBrandNames = (): string[] => {
    return (project?.brands || [])
      .filter((b: any) => !b.is_competitor)
      .map((b: any) => b.brand_name?.toLowerCase())
      .filter(Boolean);
  };

  const isOwnBrand = (brandName: string): boolean => {
    const own = getOwnBrandNames();
    const lower = brandName.toLowerCase();
    return own.some(ob => lower === ob || lower.includes(ob) || ob.includes(lower));
  };

  const highlightBrands = (text: string, brands: Array<{ name: string }>) => {
    if (!brands || brands.length === 0) return <>{text}</>;
    const brandNames = brands.map(b => b.name).filter(Boolean);
    if (brandNames.length === 0) return <>{text}</>;

    // Build regex matching all brand names (case-insensitive, longest first)
    const sorted = [...brandNames].sort((a, b) => b.length - a.length);
    const escaped = sorted.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const regex = new RegExp(`(${escaped.join('|')})`, 'gi');

    const parts = text.split(regex);
    return (
      <>
        {parts.map((part, i) => {
          const matched = brandNames.find(b => b.toLowerCase() === part.toLowerCase());
          if (!matched) return <span key={i}>{part}</span>;
          const own = isOwnBrand(matched);
          return (
            <mark
              key={i}
              className={
                own
                  ? 'bg-amber-200 dark:bg-amber-700/50 text-amber-900 dark:text-amber-100 px-0.5 rounded font-medium'
                  : 'bg-blue-100 dark:bg-blue-800/40 text-blue-900 dark:text-blue-100 px-0.5 rounded font-medium'
              }
              title={own ? 'Your brand' : 'Competitor'}
            >
              {part}
            </mark>
          );
        })}
      </>
    );
  };

  const getBrandPillColor = (mentionType?: string, brandName?: string) => {
    if (brandName && isOwnBrand(brandName)) {
      return 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-700';
    }
    switch (mentionType) {
      case 'recommended':
        return 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200 border border-green-300 dark:border-green-700';
      case 'compared':
        return 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 border border-blue-300 dark:border-blue-700';
      default:
        return 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600';
    }
  };

  const getSentimentIcon = (label?: string | null) => {
    switch (label) {
      case 'positive': return <ThumbsUp className="w-3.5 h-3.5" />;
      case 'negative': return <ThumbsDown className="w-3.5 h-3.5" />;
      default: return <Minus className="w-3.5 h-3.5" />;
    }
  };

  const getSentimentColor = (label?: string | null) => {
    switch (label) {
      case 'positive': return 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20';
      case 'negative': return 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20';
      case 'neutral': return 'text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-700';
      default: return '';
    }
  };

  // ── Competitors aggregation for tab ────────────────────────────────
  const getCompetitorsAggregation = () => {
    const brandMap = new Map<string, {
      name: string;
      mentions: number;
      mentionTypes: Map<string, number>;
      strengths: Set<string>;
      weaknesses: Set<string>;
      llms: Set<string>;
      ranks: number[];
    }>();

    filteredResponses.forEach(response => {
      const brands = response.answer_competitors?.brands;
      if (!brands || !Array.isArray(brands)) return;
      brands.forEach(brand => {
        if (!brand.name) return;
        const key = brand.name.toLowerCase();
        if (!brandMap.has(key)) {
          brandMap.set(key, {
            name: brand.name,
            mentions: 0,
            mentionTypes: new Map(),
            strengths: new Set(),
            weaknesses: new Set(),
            llms: new Set(),
            ranks: [],
          });
        }
        const entry = brandMap.get(key)!;
        entry.mentions++;
        entry.llms.add(response.llm);
        if (brand.mention_type) {
          entry.mentionTypes.set(brand.mention_type, (entry.mentionTypes.get(brand.mention_type) || 0) + 1);
        }
        brand.strengths?.forEach(s => entry.strengths.add(s));
        brand.weaknesses?.forEach(w => entry.weaknesses.add(w));
        if (brand.rank != null) entry.ranks.push(brand.rank);
      });
    });

    return Array.from(brandMap.values())
      .map(entry => ({
        ...entry,
        isOwnBrand: isOwnBrand(entry.name),
        topMentionType: entry.mentionTypes.size > 0
          ? [...entry.mentionTypes.entries()].sort((a, b) => b[1] - a[1])[0][0]
          : 'mentioned',
        avgRank: entry.ranks.length > 0 ? (entry.ranks.reduce((a, b) => a + b, 0) / entry.ranks.length).toFixed(1) : null,
        mentionRate: filteredResponses.length > 0 ? Math.round((entry.mentions / filteredResponses.length) * 100) : 0,
        llms: Array.from(entry.llms),
        strengths: Array.from(entry.strengths).slice(0, 5),
        weaknesses: Array.from(entry.weaknesses).slice(0, 5),
      }))
      .sort((a, b) => b.mentions - a.mentions);
  };

  const tabs = [
    { id: 'responses', label: 'LLM Responses', icon: Brain },
    { id: 'competitors', label: 'Competitors', icon: Users },
    { id: 'citations', label: 'Citations', icon: FileText },
    { id: 'domains', label: 'Domains', icon: Globe },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-brand-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-600 dark:text-gray-400">Loading prompt details...</p>
        </div>
      </div>
    );
  }

  if (!prompt || !project) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
          Prompt not found
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
        <div className="flex items-center space-x-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(`/projects/${projectId}`)}
            className="p-2"
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
              Prompt Analysis
            </h1>
            <p className="text-gray-600 dark:text-gray-400">
              {project.name} • {prompt.prompt_group}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <Button variant="secondary">
            <Download className="w-4 h-4 mr-2" />
            Export
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
                  className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-sm font-sans focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary"
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
              
              <div className="flex items-center space-x-2">
                <Brain className="w-4 h-4 text-gray-500" />
                <select
                  value={filters.llms}
                  onChange={(e) => handleFilterChange('llms', e.target.value)}
                  className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-sm font-sans focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary"
                >
                  <option value="all">All LLMs</option>
                  <option value="searchgpt">SearchGPT</option>
                  <option value="perplexity">Perplexity</option>
                  <option value="gemini">Gemini</option>
                </select>
              </div>

              <div className="flex items-center space-x-2">
                <ThumbsUp className="w-4 h-4 text-gray-500" />
                <select
                  value={filters.sentiment}
                  onChange={(e) => handleFilterChange('sentiment', e.target.value)}
                  className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-sm font-sans focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary"
                >
                  <option value="all">All Sentiments</option>
                  <option value="positive">Positive</option>
                  <option value="neutral">Neutral</option>
                  <option value="negative">Negative</option>
                </select>
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
          
          {filteredResponses.length !== llmResponses.length && (
            <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
              <div className="text-sm text-gray-600 dark:text-gray-400">
                Showing {filteredResponses.length} of {llmResponses.length} responses
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
            setFilters(prev => ({ ...prev, dateRange: 'lastAudit' }));
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

      {/* Prompt Details Card */}
      <Card>
        <CardHeader>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            Prompt Details
          </h2>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-4">
              <div className="bg-gray-50 dark:bg-gray-700 rounded-2xl p-4">
                <h3 className="font-medium text-gray-900 dark:text-gray-100 mb-2">Prompt Text</h3>
                <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
                  {prompt.prompt_text}
                </p>
              </div>

              {/* Web Search Queries */}
              {(() => {
                // Normalise `web_search_query` — historically stored inconsistently:
                //   • raw string            → "durabilité sacs"
                //   • JSON array (unicode)  → '["qualité...", "durabilité..."]'
                //   • JSON array (escaped)  → '["qualit\\u00e9...", "durabilit\\u00e9..."]'
                // Parse JSON when it looks like an array, fall back to the raw string.
                const normalise = (raw: unknown): string[] => {
                  if (!raw) return [];
                  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
                  if (typeof raw !== 'string') return [];
                  const trimmed = raw.trim();
                  if (!trimmed) return [];
                  if (trimmed.startsWith('[')) {
                    try {
                      const parsed = JSON.parse(trimmed);
                      if (Array.isArray(parsed)) {
                        return parsed.map(String).map(s => s.trim()).filter(Boolean);
                      }
                    } catch {
                      // fall through — treat as plain string
                    }
                  }
                  return [trimmed];
                };

                const queries = filteredResponses.flatMap(r => normalise(r.web_search_query));
                if (queries.length === 0) return null;

                // Count query frequencies (case-insensitive, trimmed)
                const queryCounts = new Map<string, number>();
                for (const q of queries) {
                  const key = q.toLowerCase();
                  queryCounts.set(key, (queryCounts.get(key) || 0) + 1);
                }
                // Keep one canonical display form per lowercase key (first seen).
                const displayByKey = new Map<string, string>();
                for (const q of queries) {
                  const key = q.toLowerCase();
                  if (!displayByKey.has(key)) displayByKey.set(key, q);
                }
                const sortedQueries = Array.from(queryCounts.entries())
                  .sort(([, a], [, b]) => b - a);

                return (
                  <div className="bg-gray-50 dark:bg-gray-700 rounded-2xl p-4">
                    <h3 className="font-medium text-gray-900 dark:text-gray-100 mb-3 flex items-center gap-2">
                      <Search className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                      Web Search Queries
                      <span className="text-xs font-normal text-gray-500 dark:text-gray-400">
                        ({sortedQueries.length} unique)
                      </span>
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {sortedQueries.map(([key, count]) => (
                        <span
                          key={key}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-gray-600 border border-gray-200 dark:border-gray-500 rounded-full text-sm text-gray-700 dark:text-gray-200 shadow-sm"
                          title={displayByKey.get(key)}
                        >
                          <Search className="w-3 h-3 text-gray-400 dark:text-gray-400 flex-shrink-0" />
                          <span>{displayByKey.get(key)}</span>
                          {count > 1 && (
                            <span className="ml-1 px-1.5 py-0.5 text-xs font-medium bg-brand-primary/10 text-brand-primary rounded-full">
                              {count}×
                            </span>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
            <div className="space-y-4">
              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-2xl p-4">
                <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                  {filteredResponses.length}
                </div>
                <div className="text-sm text-blue-600 dark:text-blue-400 font-medium">
                  LLM Responses
                </div>
              </div>
              <div className="bg-green-50 dark:bg-green-900/20 rounded-2xl p-4">
                <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                  {getAllCitations().length}
                </div>
                <div className="text-sm text-green-600 dark:text-green-400 font-medium">
                  Total Citations
                </div>
              </div>
              <div className="bg-purple-50 dark:bg-purple-900/20 rounded-2xl p-4">
                <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">
                  {getDomainStats().length}
                </div>
                <div className="text-sm text-purple-600 dark:text-purple-400 font-medium">
                  Unique Domains
                </div>
              </div>
              <div className="bg-amber-50 dark:bg-amber-900/20 rounded-2xl p-4">
                <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                  {getCompetitorsAggregation().length}
                </div>
                <div className="text-sm text-amber-600 dark:text-amber-400 font-medium">
                  Brands Detected
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

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
                  className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-sm font-sans focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary"
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
              
              <div className="flex items-center space-x-2">
                <Brain className="w-4 h-4 text-gray-500" />
                <select
                  value={filters.llms}
                  onChange={(e) => handleFilterChange('llms', e.target.value)}
                  className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-sm font-sans focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary"
                >
                  <option value="all">All LLMs</option>
                  <option value="searchgpt">SearchGPT</option>
                  <option value="perplexity">Perplexity</option>
                  <option value="gemini">Gemini</option>
                </select>
              </div>

              <div className="flex items-center space-x-2">
                <ThumbsUp className="w-4 h-4 text-gray-500" />
                <select
                  value={filters.sentiment}
                  onChange={(e) => handleFilterChange('sentiment', e.target.value)}
                  className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-sm font-sans focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary"
                >
                  <option value="all">All Sentiments</option>
                  <option value="positive">Positive</option>
                  <option value="neutral">Neutral</option>
                  <option value="negative">Negative</option>
                </select>
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
          
          {filteredResponses.length !== llmResponses.length && (
            <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
              <div className="text-sm text-gray-600 dark:text-gray-400">
                Showing {filteredResponses.length} of {llmResponses.length} responses
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tabs */}
      <Card>
        <CardHeader className="pb-0">
          <div className="border-b border-gray-200 dark:border-gray-700">
            <nav className="flex space-x-8">
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

        <CardContent className="p-6">
          {activeTab === 'responses' && (
            <div className="space-y-6">
              {filteredResponses.length === 0 ? (
                <div className="text-center py-12">
                  <MessageSquare className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
                    No responses found
                  </h3>
                  <p className="text-gray-600 dark:text-gray-400">
                    No LLM responses available for this prompt with the current filters.
                  </p>
                </div>
              ) : (
                <div className="grid gap-6">
                  {filteredResponses.map((response, index) => {
                    const citations = getResponseCitations(response);
                    return (
                      <motion.div
                        key={response.id}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.1 }}
                      >
                        <Card>
                          <CardHeader>
                            <div className="flex items-center justify-between">
                              <div className="flex items-center space-x-3">
                                <img 
                                  src={LLM_ICONS[response.llm as keyof typeof LLM_ICONS]} 
                                  alt={`${response.llm} icon`}
                                  className="w-6 h-6 object-contain"
                                />
                                <div>
                                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 capitalize">
                                    {response.llm}
                                  </h3>
                                  <div className="flex items-center space-x-4 text-sm text-gray-600 dark:text-gray-400">
                                    <div className="flex items-center">
                                      <Clock className="w-4 h-4 mr-1" />
                                      {format(new Date(response.created_at), 'MMM d, yyyy HH:mm')}
                                    </div>
                                    <div className="flex items-center">
                                      <Globe className="w-4 h-4 mr-1" />
                                      {response.country}
                                    </div>
                                    <div className="flex items-center">
                                      <FileText className="w-4 h-4 mr-1" />
                                      {citations.length} citations
                                    </div>
                                    {response.sentiment_label && (
                                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${getSentimentColor(response.sentiment_label)}`}>
                                        {getSentimentIcon(response.sentiment_label)}
                                        {response.sentiment_label}
                                      </span>
                                    )}
                                  </div>
                                  {response.llm === 'searchgpt' && response.web_search_query && (
                                    <div className="mt-2 flex flex-wrap gap-2">
                                      {(() => {
                                        const queryString = response.web_search_query;
                                        const queries = queryString.match(/"([^"]*)"/g)?.map(q => q.replace(/"/g, '')) ||
                                                       queryString.split(',').map(q => q.trim()).filter(q => q);

                                        return queries.map((query, idx) => (
                                          <span
                                            key={idx}
                                            className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-700"
                                          >
                                            {query}
                                          </span>
                                        ));
                                      })()}
                                    </div>
                                  )}
                                </div>
                              </div>
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => {
                                  setSelectedResponse(response);
                                  setShowResponseModal(true);
                                  if (!response.answer_text_markdown) {
                                    loadFullResponse(response.id);
                                  }
                                }}
                              >
                                <Eye className="w-4 h-4 mr-2" />
                                View Full Response
                              </Button>
                            </div>
                          </CardHeader>
                          <CardContent>
                            <div className="space-y-4">
                              {/* Response Preview with brand highlighting */}
                              {response.answer_text && (
                                <div>
                                  <h4 className="font-medium text-gray-900 dark:text-gray-100 mb-2">
                                    Response Preview
                                  </h4>
                                  <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-4">
                                    <p className="text-gray-700 dark:text-gray-300 text-sm leading-relaxed line-clamp-4">
                                      {highlightBrands(
                                        response.answer_text.substring(0, 500) + (response.answer_text.length > 500 ? '...' : ''),
                                        response.answer_competitors?.brands || []
                                      )}
                                    </p>
                                  </div>
                                </div>
                              )}

                              {/* Brands Mentioned */}
                              {response.answer_competitors?.brands && response.answer_competitors.brands.length > 0 && !response.answer_competitors.error && (
                                <div>
                                  <h4 className="font-medium text-gray-900 dark:text-gray-100 mb-2">
                                    Brands Mentioned ({response.answer_competitors.brands.length})
                                  </h4>
                                  <div className="flex flex-wrap gap-2">
                                    {response.answer_competitors.brands.map((brand, bIdx) => (
                                      <span
                                        key={bIdx}
                                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${getBrandPillColor(brand.mention_type, brand.name)}`}
                                        title={[
                                          brand.strengths?.length ? `Strengths: ${brand.strengths.join(', ')}` : '',
                                          brand.weaknesses?.length ? `Weaknesses: ${brand.weaknesses.join(', ')}` : '',
                                        ].filter(Boolean).join(' | ') || brand.name}
                                      >
                                        {isOwnBrand(brand.name) && <Award className="w-3 h-3" />}
                                        {brand.rank != null && <span className="font-bold">#{brand.rank}</span>}
                                        {brand.name}
                                        {brand.mention_type && brand.mention_type !== 'mentioned' && (
                                          <span className="opacity-60 ml-0.5">{brand.mention_type}</span>
                                        )}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Citations */}
                              {citations.length > 0 && (
                                <div>
                                  <h4 className="font-medium text-gray-900 dark:text-gray-100 mb-2">
                                    Citations ({citations.length})
                                  </h4>
                                  <div className="space-y-2 max-h-48 overflow-y-auto">
                                    {citations.slice(0, 15).map((citation, citIndex) => (
                                      <div
                                        key={citIndex}
                                        className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-xl"
                                      >
                                        <div className="flex-1 min-w-0">
                                          <div className="flex items-center space-x-2">
                                            <span className="text-xs bg-brand-primary/10 text-brand-primary px-2 py-1 rounded-lg font-medium">
                                              #{citation.position}
                                            </span>
                                            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                              {citation.domain}
                                            </span>
                                          </div>
                                          {citation.title && (
                                            <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 truncate">
                                              {citation.title}
                                            </p>
                                          )}
                                        </div>
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          onClick={() => window.open(citation.url, '_blank')}
                                          className="p-1 ml-2"
                                        >
                                          <ExternalLink className="w-4 h-4" />
                                        </Button>
                                      </div>
                                    ))}
                                    {citations.length > 10 && (
                                      <div className="text-center py-2">
                                        <span className="text-sm text-gray-500 dark:text-gray-400">
                                          +{citations.length - 10} more citations
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {activeTab === 'competitors' && (
            <div>
              {(() => {
                const competitors = getCompetitorsAggregation();
                if (competitors.length === 0) {
                  return (
                    <div className="text-center py-12">
                      <Users className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
                        No Competitors Data
                      </h3>
                      <p className="text-gray-600 dark:text-gray-400">
                        No brand mentions extracted from the responses yet.
                      </p>
                    </div>
                  );
                }
                return (
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                      Brands Detected ({competitors.length})
                    </h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-200 dark:border-gray-700">
                            <th className="text-left py-3 px-2 text-gray-900 dark:text-gray-100">Brand</th>
                            <th className="text-center py-3 px-2 text-gray-900 dark:text-gray-100">Mentions</th>
                            <th className="text-center py-3 px-2 text-gray-900 dark:text-gray-100">Rate</th>
                            <th className="text-center py-3 px-2 text-gray-900 dark:text-gray-100">Type</th>
                            <th className="text-center py-3 px-2 text-gray-900 dark:text-gray-100">Avg Rank</th>
                            <th className="text-left py-3 px-2 text-gray-900 dark:text-gray-100">LLMs</th>
                            <th className="text-left py-3 px-2 text-gray-900 dark:text-gray-100">Strengths</th>
                            <th className="text-left py-3 px-2 text-gray-900 dark:text-gray-100">Weaknesses</th>
                          </tr>
                        </thead>
                        <tbody>
                          {competitors.map((comp, idx) => (
                            <tr key={idx} className={`border-b border-gray-100 dark:border-gray-700/50 ${comp.isOwnBrand ? 'bg-amber-50/50 dark:bg-amber-900/10' : ''}`}>
                              <td className="py-3 px-2">
                                <div className="flex items-center gap-2">
                                  {comp.isOwnBrand && <Award className="w-4 h-4 text-amber-500" />}
                                  <span className={`font-medium ${comp.isOwnBrand ? 'text-amber-700 dark:text-amber-300' : 'text-gray-900 dark:text-gray-100'}`}>
                                    {comp.name}
                                  </span>
                                  {comp.isOwnBrand && (
                                    <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
                                      your brand
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="py-3 px-2 text-center font-semibold text-gray-900 dark:text-gray-100">
                                {comp.mentions}
                              </td>
                              <td className="py-3 px-2 text-center">
                                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-brand-primary/10 text-brand-primary">
                                  {comp.mentionRate}%
                                </span>
                              </td>
                              <td className="py-3 px-2 text-center">
                                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getBrandPillColor(comp.topMentionType)}`}>
                                  {comp.topMentionType}
                                </span>
                              </td>
                              <td className="py-3 px-2 text-center text-gray-700 dark:text-gray-300">
                                {comp.avgRank ? `#${comp.avgRank}` : '-'}
                              </td>
                              <td className="py-3 px-2">
                                <div className="flex gap-1">
                                  {comp.llms.map(llm => (
                                    <img
                                      key={llm}
                                      src={LLM_ICONS[llm as keyof typeof LLM_ICONS]}
                                      alt={llm}
                                      className="w-5 h-5 object-contain"
                                      title={llm}
                                    />
                                  ))}
                                </div>
                              </td>
                              <td className="py-3 px-2 max-w-48">
                                <div className="flex flex-wrap gap-1">
                                  {comp.strengths.map((s, si) => (
                                    <span key={si} className="text-xs px-1.5 py-0.5 rounded bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 truncate max-w-32" title={s}>
                                      {s}
                                    </span>
                                  ))}
                                </div>
                              </td>
                              <td className="py-3 px-2 max-w-48">
                                <div className="flex flex-wrap gap-1">
                                  {comp.weaknesses.map((w, wi) => (
                                    <span key={wi} className="text-xs px-1.5 py-0.5 rounded bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 truncate max-w-32" title={w}>
                                      {w}
                                    </span>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {activeTab === 'citations' && (
            <div>
              <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">
                All Citations ({getAllCitations().length})
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700">
                      <th className="text-left py-3 px-2 text-gray-900 dark:text-gray-100">Position</th>
                      <th className="text-left py-3 px-2 text-gray-900 dark:text-gray-100">URL</th>
                      <th className="text-left py-3 px-2 text-gray-900 dark:text-gray-100">Domain</th>
                      <th className="text-left py-3 px-2 text-gray-900 dark:text-gray-100">Title</th>
                      <th className="text-center py-3 px-2 text-gray-900 dark:text-gray-100">LLM</th>
                      <th className="text-center py-3 px-2 text-gray-900 dark:text-gray-100">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {getAllCitations().map((citation, index) => (
                      <tr key={index} className="border-b border-gray-100 dark:border-gray-800">
                        <td className="py-3 px-2 text-center">
                          <span className="bg-brand-primary/10 text-brand-primary px-2 py-1 rounded-lg text-xs font-medium">
                            #{citation.position}
                          </span>
                        </td>
                        <td className="py-3 px-2 max-w-xs">
                          <a 
                            href={citation.url} 
                            target="_blank" 
                            rel="noopener noreferrer" 
                            className="text-brand-primary hover:underline truncate block"
                          >
                            {citation.url}
                          </a>
                        </td>
                        <td className="py-3 px-2 font-medium text-gray-900 dark:text-gray-100">
                          {citation.domain}
                        </td>
                        <td className="py-3 px-2 text-gray-700 dark:text-gray-300 max-w-xs truncate">
                          {citation.title || citation.description || '-'}
                        </td>
                        <td className="py-3 px-2 text-center">
                          <div className="flex items-center justify-center">
                            <img 
                              src={LLM_ICONS[citation.llm as keyof typeof LLM_ICONS]} 
                              alt={`${citation.llm} icon`}
                              className="w-4 h-4 object-contain"
                            />
                          </div>
                        </td>
                        <td className="py-3 px-2 text-center text-gray-900 dark:text-gray-100">
                          {new Date(citation.auditDate).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'domains' && (
            <div>
              <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">
                Domain Performance
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700">
                      <th className="text-left py-3 px-2 text-gray-900 dark:text-gray-100">Domain</th>
                      <th className="text-center py-3 px-2 text-gray-900 dark:text-gray-100">Citations</th>
                      <th className="text-center py-3 px-2 text-gray-900 dark:text-gray-100">Days</th>
                      <th className="text-center py-3 px-2 text-gray-900 dark:text-gray-100">Avg/Day</th>
                      <th className="text-center py-3 px-2 text-gray-900 dark:text-gray-100">LLMs</th>
                      <th className="text-center py-3 px-2 text-gray-900 dark:text-gray-100">First Seen</th>
                      <th className="text-center py-3 px-2 text-gray-900 dark:text-gray-100">Last Seen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {getDomainStats().map((domain: any, index) => (
                      <tr key={index} className="border-b border-gray-100 dark:border-gray-800">
                        <td className="py-3 px-2 font-medium text-gray-900 dark:text-gray-100">
                          {domain.domain}
                        </td>
                        <td className="py-3 px-2 text-center text-gray-900 dark:text-gray-100">
                          {domain.mentions}
                        </td>
                        <td className="py-3 px-2 text-center text-gray-900 dark:text-gray-100">
                          {domain.totalDays}
                        </td>
                        <td className="py-3 px-2 text-center text-gray-900 dark:text-gray-100">
                          {domain.avgMentionsPerDay}
                        </td>
                        <td className="py-3 px-2 text-center">
                          <div className="flex items-center justify-center space-x-1">
                            {domain.llms.map((llm: string) => (
                              <img 
                                key={llm}
                                src={LLM_ICONS[llm as keyof typeof LLM_ICONS]} 
                                alt={`${llm} icon`}
                                className="w-4 h-4 object-contain"
                              />
                            ))}
                          </div>
                        </td>
                        <td className="py-3 px-2 text-center text-gray-900 dark:text-gray-100">
                          {new Date(domain.firstSeen).toLocaleDateString()}
                        </td>
                        <td className="py-3 px-2 text-center text-gray-900 dark:text-gray-100">
                          {new Date(domain.lastSeen).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Response Detail Modal */}
      {selectedResponse && (
        <div className={`fixed inset-0 z-50 ${showResponseModal ? 'block' : 'hidden'}`}>
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowResponseModal(false)} />
          <div className="fixed inset-0 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 w-full max-w-4xl max-h-[90vh] overflow-hidden"
            >
              <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
                <div className="flex items-center space-x-3">
                  <img 
                    src={LLM_ICONS[selectedResponse.llm as keyof typeof LLM_ICONS]} 
                    alt={`${selectedResponse.llm} icon`}
                    className="w-6 h-6 object-contain"
                  />
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white capitalize">
                    {selectedResponse.llm} Response
                  </h3>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowResponseModal(false)}
                  className="p-2"
                >
                  <X className="w-5 h-5" />
                </Button>
              </div>
              
              <div className="overflow-y-auto max-h-[calc(90vh-80px)] p-6 space-y-6">
                {/* Response Metadata */}
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                  <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-4">
                    <h4 className="font-medium text-gray-900 dark:text-gray-100 mb-2">Query Settings</h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">Country:</span>
                        <span className="text-gray-900 dark:text-gray-100">{selectedResponse.country}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">Timestamp:</span>
                        <span className="text-gray-900 dark:text-gray-100">
                          {selectedResponse.response_timestamp ?
                            format(new Date(selectedResponse.response_timestamp), 'MMM d, yyyy HH:mm') :
                            format(new Date(selectedResponse.created_at), 'MMM d, yyyy HH:mm')
                          }
                        </span>
                      </div>
                      {selectedResponse.response_url && (
                        <div className="flex justify-between">
                          <span className="text-gray-600 dark:text-gray-400">Source URL:</span>
                          <a
                            href={selectedResponse.response_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-brand-primary hover:underline"
                          >
                            View Original
                          </a>
                        </div>
                      )}
                      {selectedResponse.sentiment_label && (
                        <div className="flex justify-between items-center">
                          <span className="text-gray-600 dark:text-gray-400">Sentiment:</span>
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${getSentimentColor(selectedResponse.sentiment_label)}`}>
                            {getSentimentIcon(selectedResponse.sentiment_label)}
                            {selectedResponse.sentiment_label}
                            {selectedResponse.sentiment_score != null && ` (${selectedResponse.sentiment_score})`}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-4">
                    <h4 className="font-medium text-gray-900 dark:text-gray-100 mb-2">Citations Summary</h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">Total Citations:</span>
                        <span className="text-gray-900 dark:text-gray-100">{getResponseCitations(selectedResponse).length}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">Unique Domains:</span>
                        <span className="text-gray-900 dark:text-gray-100">
                          {new Set(getResponseCitations(selectedResponse).map(c => c.domain)).size}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Brands Detected summary */}
                  <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-4">
                    <h4 className="font-medium text-gray-900 dark:text-gray-100 mb-2">Brands Detected</h4>
                    {selectedResponse.answer_competitors?.brands && selectedResponse.answer_competitors.brands.length > 0 && !selectedResponse.answer_competitors.error ? (
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-600 dark:text-gray-400">Total Brands:</span>
                          <span className="text-gray-900 dark:text-gray-100">{selectedResponse.answer_competitors.brands.length}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600 dark:text-gray-400">Recommended:</span>
                          <span className="text-green-600 dark:text-green-400 font-medium">
                            {selectedResponse.answer_competitors.brands.filter(b => b.mention_type === 'recommended').length}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1 mt-2">
                          {selectedResponse.answer_competitors.brands.slice(0, 6).map((brand, i) => (
                            <span key={i} className={`text-xs px-1.5 py-0.5 rounded ${getBrandPillColor(brand.mention_type, brand.name)}`}>
                              {brand.name}
                            </span>
                          ))}
                          {selectedResponse.answer_competitors.brands.length > 6 && (
                            <span className="text-xs text-gray-500">+{selectedResponse.answer_competitors.brands.length - 6}</span>
                          )}
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-gray-500 dark:text-gray-400">No brands extracted</p>
                    )}
                  </div>
                </div>

                {/* Full Response Text */}
                {selectedResponse.answer_text_markdown && (
                  <div>
                    <h4 className="font-medium text-gray-900 dark:text-gray-100 mb-2">
                      Full Response (Markdown)
                    </h4>
                    <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-4 max-h-96 overflow-y-auto">
                      <pre className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-mono">
                        {selectedResponse.answer_text_markdown}
                      </pre>
                    </div>
                  </div>
                )}

                {/* Loading state for full response */}
                {loadingFullResponse && !selectedResponse.answer_text_markdown && (
                  <div className="text-center py-8">
                    <div className="w-6 h-6 border-2 border-brand-primary border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                    <p className="text-sm text-gray-600 dark:text-gray-400">Loading full response...</p>
                  </div>
                )}

                {/* Response Content */}
                {selectedResponse.raw_response_data && (
                  <div>
                    <h4 className="font-medium text-gray-900 dark:text-gray-100 mb-2">
                      Response Content
                    </h4>
                    {selectedResponse.answer_text_markdown ? (
                      <div className="bg-gray-50 dark:bg-gray-700 p-4 rounded-xl max-h-96 overflow-auto">
                        <div className="prose prose-sm dark:prose-invert max-w-none">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {selectedResponse.answer_text_markdown}
                          </ReactMarkdown>
                        </div>
                      </div>
                    ) : selectedResponse.answer_text ? (
                      <div className="bg-gray-50 dark:bg-gray-700 p-4 rounded-xl max-h-96 overflow-auto">
                        <div className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
                          {highlightBrands(
                            selectedResponse.answer_text,
                            selectedResponse.answer_competitors?.brands || []
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="bg-gray-50 dark:bg-gray-700 p-4 rounded-xl">
                        <div className="text-sm text-gray-500 dark:text-gray-400">
                          No response content available
                        </div>
                      </div>
                    )}
                  </div>
                )}

              </div>
            </motion.div>
          </div>
        </div>
      )}
    </div>
  );
};