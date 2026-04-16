import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { supabase } from '../lib/supabase';
import {
  ArrowLeft, Globe, ExternalLink, Download, Calendar, Hash,
  TrendingUp, BarChart3, Clock, Eye, MessageSquare, Filter, ChevronDown, ChevronUp
} from 'lucide-react';
import { format } from 'date-fns';
import * as XLSX from 'xlsx';

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

interface PromptCitation {
  promptId: string;
  promptText: string;
  promptGroup: string;
  citationCount: number;
  llms: string[];
}

interface URLData {
  url: string;
  totalCitations: number;
  uniquePrompts: number;
  llms: string[];
  firstSeen: string;
  lastSeen: string;
  sentiment?: {
    positive: number;
    neutral: number;
    negative: number;
  };
  citationText?: string;
  prompts: PromptCitation[];
}

export const DomainDetailPage: React.FC = () => {
  const { projectId, domain } = useParams<{ projectId: string; domain: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<any>(null);
  const [urlData, setUrlData] = useState<URLData[]>([]);
  const [filteredUrlData, setFilteredUrlData] = useState<URLData[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedUrls, setExpandedUrls] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState({
    sortBy: 'citations',
    llm: 'all',
    dateRange: 'all'
  });
  const [domainStats, setDomainStats] = useState({
    totalCitations: 0,
    totalUrls: 0,
    totalPrompts: 0,
    dateRange: { from: '', to: '' }
  });

  useEffect(() => {
    if (projectId && domain) {
      fetchData();
    }
  }, [projectId, domain]);

  useEffect(() => {
    applyFilters();
  }, [urlData, filters]);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Decode the domain parameter
      const decodedDomain = decodeURIComponent(domain!);

      // Fetch project details
      const { data: projectData } = await supabase
        .from('projects')
        .select('*')
        .eq('id', projectId)
        .single();

      if (projectData) {
        setProject(projectData);
      }

      // Fetch citations for this domain within the current project only
      const { data: citations } = await supabase
        .from('citations')
        .select(`
          *,
          prompts (
            id,
            prompt_text,
            prompt_group
          ),
          audits!inner (
            id,
            created_at,
            project_id
          )
        `)
        .eq('domain', decodedDomain)
        .eq('audits.project_id', projectId)
        .order('checked_at', { ascending: false })
        .limit(200);

      if (citations) {
        processUrlData(citations);
      }
    } catch (error) {
      console.error('Error fetching domain data:', error);
    } finally {
      setLoading(false);
    }
  };

  const processUrlData = (citations: any[]) => {
    const urlMap = new Map<string, any>();

    citations.forEach(citation => {
      const url = citation.page_url;
      if (!url) return;

      const checkedAt = citation.checked_at || citation.audits?.created_at;
      if (!checkedAt) return;

      if (!urlMap.has(url)) {
        urlMap.set(url, {
          url,
          totalCitations: 0,
          uniquePrompts: new Set(),
          llms: new Set(),
          firstSeen: checkedAt,
          lastSeen: checkedAt,
          sentiment: { positive: 0, neutral: 0, negative: 0 },
          citationTexts: [],
          promptMap: new Map()
        });
      }

      const urlInfo = urlMap.get(url);
      urlInfo.totalCitations++;
      urlInfo.uniquePrompts.add(citation.prompt_id);
      urlInfo.llms.add(citation.llm);

      // Track prompt details
      if (citation.prompt_id && citation.prompts) {
        if (!urlInfo.promptMap.has(citation.prompt_id)) {
          urlInfo.promptMap.set(citation.prompt_id, {
            promptId: citation.prompt_id,
            promptText: citation.prompts.prompt_text,
            promptGroup: citation.prompts.prompt_group,
            citationCount: 0,
            llms: new Set()
          });
        }
        const promptInfo = urlInfo.promptMap.get(citation.prompt_id);
        promptInfo.citationCount++;
        promptInfo.llms.add(citation.llm);
      }

      if (new Date(checkedAt) < new Date(urlInfo.firstSeen)) {
        urlInfo.firstSeen = checkedAt;
      }
      if (new Date(checkedAt) > new Date(urlInfo.lastSeen)) {
        urlInfo.lastSeen = checkedAt;
      }

      if (citation.sentiment_label) {
        urlInfo.sentiment[citation.sentiment_label]++;
      }

      if (citation.citation_text) {
        urlInfo.citationTexts.push(citation.citation_text);
      }
    });

    // Convert to array and process
    const urlDataArray: URLData[] = Array.from(urlMap.values()).map(data => ({
      url: data.url,
      totalCitations: data.totalCitations,
      uniquePrompts: data.uniquePrompts.size,
      llms: Array.from(data.llms),
      firstSeen: data.firstSeen,
      lastSeen: data.lastSeen,
      sentiment: data.sentiment,
      citationText: data.citationTexts[0], // Show first citation text as preview
      prompts: Array.from(data.promptMap.values()).map(p => ({
        ...p,
        llms: Array.from(p.llms)
      })).sort((a, b) => b.citationCount - a.citationCount)
    }));

    setUrlData(urlDataArray);

    // Calculate domain stats
    const totalCitations = citations.length;
    const totalUrls = urlDataArray.length;
    const uniquePrompts = new Set(citations.map(c => c.prompt_id)).size;
    const dates = citations
      .map(c => c.checked_at || c.audits?.created_at)
      .filter(Boolean)
      .sort();

    setDomainStats({
      totalCitations,
      totalUrls,
      totalPrompts: uniquePrompts,
      dateRange: {
        from: dates[dates.length - 1] || '',
        to: dates[0] || ''
      }
    });
  };

  const applyFilters = () => {
    let filtered = [...urlData];

    // Filter by LLM
    if (filters.llm !== 'all') {
      filtered = filtered.filter(url => url.llms.includes(filters.llm));
    }

    // Sort
    switch (filters.sortBy) {
      case 'citations':
        filtered.sort((a, b) => b.totalCitations - a.totalCitations);
        break;
      case 'prompts':
        filtered.sort((a, b) => b.uniquePrompts - a.uniquePrompts);
        break;
      case 'recent':
        filtered.sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime());
        break;
      case 'oldest':
        filtered.sort((a, b) => new Date(a.firstSeen).getTime() - new Date(b.firstSeen).getTime());
        break;
    }

    setFilteredUrlData(filtered);
  };

  const toggleUrlExpansion = (url: string) => {
    setExpandedUrls(prev => {
      const newSet = new Set(prev);
      if (newSet.has(url)) {
        newSet.delete(url);
      } else {
        newSet.add(url);
      }
      return newSet;
    });
  };

  const exportToExcel = () => {
    const exportData = filteredUrlData.map(url => ({
      'URL': url.url,
      'Total Citations': url.totalCitations,
      'Unique Prompts': url.uniquePrompts,
      'LLMs': url.llms.join(', '),
      'Positive Sentiment': url.sentiment?.positive || 0,
      'Neutral Sentiment': url.sentiment?.neutral || 0,
      'Negative Sentiment': url.sentiment?.negative || 0,
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Domain URLs');
    XLSX.writeFile(wb, `${decodeURIComponent(domain!)}_urls_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-primary"></div>
      </div>
    );
  }

  const decodedDomain = decodeURIComponent(domain!);

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between"
      >
        <div className="flex items-center gap-4">
          <Button
            variant="secondary"
            onClick={() => navigate(`/projects/${projectId}`)}
            className="flex items-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Project
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <img
                src={`https://www.google.com/s2/favicons?domain=${decodedDomain}&sz=64`}
                alt={`${decodedDomain} favicon`}
                className="w-8 h-8"
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  target.style.display = 'none';
                }}
              />
              <div>
                <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
                  {decodedDomain}
                </h1>
                <p className="text-gray-600 dark:text-gray-300 mt-1">
                  Domain Performance Analysis
                </p>
              </div>
            </div>
          </div>
        </div>
        <Button
          variant="gradient"
          onClick={exportToExcel}
          className="flex items-center gap-2"
        >
          <Download className="w-4 h-4" />
          Export to Excel
        </Button>
      </motion.div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">Total Citations</p>
                <p className="text-3xl font-bold text-gray-900 dark:text-gray-100 mt-1">
                  {domainStats.totalCitations}
                </p>
              </div>
              <Hash className="w-8 h-8 text-brand-primary" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">Unique URLs</p>
                <p className="text-3xl font-bold text-gray-900 dark:text-gray-100 mt-1">
                  {domainStats.totalUrls}
                </p>
              </div>
              <Globe className="w-8 h-8 text-brand-primary" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">Cited Prompts</p>
                <p className="text-3xl font-bold text-gray-900 dark:text-gray-100 mt-1">
                  {domainStats.totalPrompts}
                </p>
              </div>
              <MessageSquare className="w-8 h-8 text-brand-primary" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">Date Range</p>
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100 mt-1">
                  {domainStats.dateRange.from && format(new Date(domainStats.dateRange.from), 'MMM d')}
                  {' - '}
                  {domainStats.dateRange.to && format(new Date(domainStats.dateRange.to), 'MMM d, yyyy')}
                </p>
              </div>
              <Calendar className="w-8 h-8 text-brand-primary" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-gray-600 dark:text-gray-400" />
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Filters:</span>
            </div>

            <select
              value={filters.sortBy}
              onChange={(e) => setFilters({ ...filters, sortBy: e.target.value })}
              className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
            >
              <option value="citations">Most Citations</option>
              <option value="prompts">Most Prompts</option>
              <option value="recent">Most Recent</option>
              <option value="oldest">Oldest First</option>
            </select>

            <select
              value={filters.llm}
              onChange={(e) => setFilters({ ...filters, llm: e.target.value })}
              className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
            >
              <option value="all">All LLMs</option>
              <option value="searchgpt">SearchGPT</option>
              <option value="perplexity">Perplexity</option>
              <option value="gemini">Gemini</option>
            </select>

            <div className="ml-auto text-sm text-gray-600 dark:text-gray-400">
              Showing {filteredUrlData.length} of {urlData.length} URLs
            </div>
          </div>
        </CardContent>
      </Card>

      {/* URLs Table */}
      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            URLs from {decodedDomain}
          </h3>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <th className="text-left py-3 px-2 text-gray-900 dark:text-gray-100">URL</th>
                  <th className="text-center py-3 px-2 text-gray-900 dark:text-gray-100">Citations</th>
                  <th className="text-center py-3 px-2 text-gray-900 dark:text-gray-100">Prompts</th>
                  <th className="text-center py-3 px-2 text-gray-900 dark:text-gray-100">LLMs</th>
                  <th className="text-center py-3 px-2 text-gray-900 dark:text-gray-100">Sentiment</th>
                  <th className="text-center py-3 px-2 text-gray-900 dark:text-gray-100">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredUrlData.map((urlInfo, index) => (
                  <React.Fragment key={index}>
                    <tr className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                      <td className="py-3 px-2">
                        <div className="max-w-md">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => toggleUrlExpansion(urlInfo.url)}
                              className="flex-shrink-0 p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
                              title={expandedUrls.has(urlInfo.url) ? "Collapse prompts" : "Expand prompts"}
                            >
                              {expandedUrls.has(urlInfo.url) ? (
                                <ChevronUp className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                              ) : (
                                <ChevronDown className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                              )}
                            </button>
                            <a
                              href={urlInfo.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-brand-primary hover:underline text-sm break-all"
                            >
                              {urlInfo.url}
                            </a>
                          </div>
                          {urlInfo.citationText && (
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 ml-8 line-clamp-2">
                              {urlInfo.citationText}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-2 text-center">
                        <span className="inline-flex items-center justify-center px-3 py-1 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium">
                          {urlInfo.totalCitations}
                        </span>
                      </td>
                      <td className="py-3 px-2 text-center text-gray-900 dark:text-gray-100">
                        {urlInfo.uniquePrompts}
                      </td>
                      <td className="py-3 px-2">
                        <div className="flex items-center justify-center gap-1">
                          {urlInfo.llms.map(llm => (
                            <img
                              key={llm}
                              src={LLM_ICONS[llm as keyof typeof LLM_ICONS]}
                              alt={llm}
                              className="w-5 h-5"
                              title={llm}
                            />
                          ))}
                        </div>
                      </td>
                      <td className="py-3 px-2">
                        <div className="flex items-center justify-center gap-2 text-xs">
                          {urlInfo.sentiment && (
                            <>
                              <span className="text-green-600 dark:text-green-400">
                                +{urlInfo.sentiment.positive}
                              </span>
                              <span className="text-gray-600 dark:text-gray-400">
                                ={urlInfo.sentiment.neutral}
                              </span>
                              <span className="text-red-600 dark:text-red-400">
                                -{urlInfo.sentiment.negative}
                              </span>
                            </>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-2 text-center">
                        <a
                          href={urlInfo.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center p-2 text-gray-600 hover:text-brand-primary dark:text-gray-400 dark:hover:text-brand-primary transition-colors"
                          title="Open URL"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      </td>
                    </tr>
                    {expandedUrls.has(urlInfo.url) && urlInfo.prompts.length > 0 && (
                      <tr className="bg-gray-50 dark:bg-gray-800/30">
                        <td colSpan={6} className="py-4 px-8">
                          <div className="space-y-3">
                            <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">
                              Prompts citing this URL ({urlInfo.prompts.length})
                            </h4>
                            {urlInfo.prompts.map((prompt, pIndex) => (
                              <div
                                key={pIndex}
                                className="flex items-start gap-4 p-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700"
                              >
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 mb-2">
                                    <span className="text-xs font-medium px-2 py-1 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                                      {prompt.promptGroup}
                                    </span>
                                    <span className="text-xs text-gray-500 dark:text-gray-400">
                                      {prompt.citationCount} {prompt.citationCount === 1 ? 'citation' : 'citations'}
                                    </span>
                                  </div>
                                  <p className="text-sm text-gray-900 dark:text-gray-100">
                                    {prompt.promptText}
                                  </p>
                                </div>
                                <div className="flex items-center gap-1">
                                  {prompt.llms.map(llm => (
                                    <img
                                      key={llm}
                                      src={LLM_ICONS[llm as keyof typeof LLM_ICONS]}
                                      alt={llm}
                                      className="w-5 h-5"
                                      title={llm}
                                    />
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {filteredUrlData.length === 0 && (
            <div className="text-center py-12">
              <Globe className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600 dark:text-gray-400">No URLs found for this domain</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
