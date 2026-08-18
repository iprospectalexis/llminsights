import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { Input } from '../components/ui/Input';
import { supabase } from '../lib/supabase';
import { DOMAIN_CATEGORIES, categoryChipClass } from '../lib/domainCategories';
import { Search, ChevronLeft, ChevronRight, ArrowUpDown, Trophy } from 'lucide-react';

const LLM_NAMES = {
  searchgpt: 'SearchGPT',
  perplexity: 'Perplexity',
  gemini: 'Gemini',
  'google-ai-overview': 'Google AI Overview',
  'google-ai-mode': 'Google AI Mode',
  'bing-copilot': 'Bing Copilot',
  'grok': 'Grok',
};

const LLM_ICONS = {
  searchgpt: 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/SearchGPT.PNG',
  perplexity: 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/Perplexity.png',
  gemini: 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/Gemini.png',
  'google-ai-overview': 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/google_ai_overview.png',
  'google-ai-mode': 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/google_ai_mode.png',
  'bing-copilot': 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/bing_copilot.png',
  'grok': 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/Grok-icon.png',
};

interface DomainCitation {
  domain: string;
  llm: string;
  cited_count: number;
  more_count: number;
  total_citations: number;
  first_seen: string;
  last_seen: string;
  category: string;
}

interface PaginationInfo {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

const DATE_FRAMES = [
  { id: 'all', label: 'All time' },
  { id: '30', label: 'Last 30 days' },
  { id: '90', label: 'Last 90 days' },
] as const;

type DateFrame = (typeof DATE_FRAMES)[number]['id'];

export function TopSourcesPage() {
  const [domainCitations, setDomainCitations] = useState<DomainCitation[]>([]);
  const [domainLoading, setDomainLoading] = useState(true);
  const [selectedLLM, setSelectedLLM] = useState<string>('all');
  const [dateFrame, setDateFrame] = useState<DateFrame>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [domainSearch, setDomainSearch] = useState('');
  const [sortBy, setSortBy] = useState<'cited_count' | 'more_count' | 'total_citations'>('total_citations');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [pagination, setPagination] = useState<PaginationInfo>({
    page: 1,
    pageSize: 50,
    total: 0,
    totalPages: 0,
  });

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      fetchDomainCitations();
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [selectedLLM, dateFrame, categoryFilter, domainSearch, sortBy, sortOrder, pagination.page]);

  const fetchDomainCitations = async () => {
    setDomainLoading(true);

    try {
      // Aggregation lives in the top_source_domains RPC: it sums the live
      // citations table by domain across ALL projects (the old
      // domain_citations_mv rows were per project×domain×llm, so the
      // single-LLM view showed the same domain fragmented per project),
      // applies the LLM / date-frame / search filters, sorts and paginates
      // server-side, and respects citations RLS.
      const { data, error } = await supabase.rpc('top_source_domains', {
        p_llm: selectedLLM !== 'all' ? selectedLLM : null,
        p_days: dateFrame === 'all' ? null : parseInt(dateFrame, 10),
        p_search: domainSearch || null,
        p_sort: sortBy,
        p_asc: sortOrder === 'asc',
        p_limit: pagination.pageSize,
        p_offset: (pagination.page - 1) * pagination.pageSize,
        p_category: categoryFilter !== 'all' ? categoryFilter : null,
      });

      if (error) {
        console.error('Error fetching domain citations:', error);
        throw error;
      }

      const rows = (data || []) as any[];
      setDomainCitations(rows.map((r) => ({
        domain: r.domain,
        llm: selectedLLM,
        cited_count: Number(r.cited_count),
        more_count: Number(r.more_count),
        total_citations: Number(r.total_citations),
        first_seen: r.first_seen,
        last_seen: r.last_seen,
        category: r.category || 'Unknown',
      })));

      const total = rows.length > 0 ? Number(rows[0].total_count) : 0;
      setPagination(prev => ({
        ...prev,
        total,
        totalPages: Math.ceil(total / prev.pageSize),
      }));
    } catch (error) {
      console.error('Error fetching domain citations:', error);
      setDomainCitations([]);
      setPagination(prev => ({ ...prev, total: 0, totalPages: 0 }));
    } finally {
      setDomainLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-blue-50 to-purple-50 dark:from-gray-900 dark:via-gray-900 dark:to-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <div className="flex items-center space-x-4">
            <div className="p-3 bg-gradient-to-br from-brand-primary to-brand-secondary rounded-2xl shadow-lg">
              <Trophy className="w-8 h-8 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
                TOP Sources
              </h1>
              <p className="text-gray-600 dark:text-gray-400 mt-1">
                Top cited domains across all projects
              </p>
            </div>
          </div>
        </motion.div>

        {/* Domain Citations Table */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <Card>
            <CardHeader>
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white">
                Domain Citations
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                Citation statistics aggregated by domain
              </p>

              {/* Filters */}
              <div className="flex flex-col sm:flex-row gap-4 mt-4">
                {/* LLM Icon Selector */}
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Filter by LLM
                  </label>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => {
                        setSelectedLLM('all');
                        setPagination({ ...pagination, page: 1 });
                      }}
                      className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${
                        selectedLLM === 'all'
                          ? 'bg-brand-primary text-white shadow-md'
                          : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                      }`}
                    >
                      All LLMs
                    </button>
                    {Object.entries(LLM_ICONS).map(([llm, iconUrl]) => (
                      <button
                        key={llm}
                        onClick={() => {
                          setSelectedLLM(llm);
                          setPagination({ ...pagination, page: 1 });
                        }}
                        className={`p-2 rounded-lg transition-all ${
                          selectedLLM === llm
                            ? 'ring-2 ring-brand-primary bg-white dark:bg-gray-800 shadow-md'
                            : 'bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                        }`}
                        title={LLM_NAMES[llm as keyof typeof LLM_NAMES]}
                      >
                        <img
                          src={iconUrl}
                          alt={LLM_NAMES[llm as keyof typeof LLM_NAMES]}
                          className="w-8 h-8 object-contain"
                        />
                      </button>
                    ))}
                  </div>
                </div>

                {/* Date frame */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Date range
                  </label>
                  <div className="flex items-center gap-2">
                    {DATE_FRAMES.map(frame => (
                      <button
                        key={frame.id}
                        type="button"
                        onClick={() => {
                          setDateFrame(frame.id);
                          setPagination(prev => ({ ...prev, page: 1 }));
                        }}
                        className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${
                          dateFrame === frame.id
                            ? 'bg-brand-primary text-white shadow-md'
                            : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                        }`}
                      >
                        {frame.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Category */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Category
                  </label>
                  <select
                    value={categoryFilter}
                    onChange={(e) => {
                      setCategoryFilter(e.target.value);
                      setPagination(prev => ({ ...prev, page: 1 }));
                    }}
                    className="px-3 py-2 rounded-lg text-sm font-medium bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-brand-primary"
                  >
                    <option value="all">All categories</option>
                    {DOMAIN_CATEGORIES.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                    <option value="Unknown">Unknown</option>
                  </select>
                </div>

                {/* Domain Search */}
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Search domain
                  </label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <Input
                      type="text"
                      placeholder="Enter domain name..."
                      value={domainSearch}
                      onChange={(e) => {
                        setDomainSearch(e.target.value);
                        setPagination({ ...pagination, page: 1 });
                      }}
                      className="pl-10"
                    />
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {domainLoading ? (
                <div className="flex items-center justify-center py-12">
                  <LoadingSpinner size="lg" />
                </div>
              ) : domainCitations.length > 0 ? (
                <>
                  {/* Table */}
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            Domain
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            Category
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            LLM
                          </th>
                          <th
                            className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700"
                            onClick={() => {
                              if (sortBy === 'cited_count') {
                                setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                              } else {
                                setSortBy('cited_count');
                                setSortOrder('desc');
                              }
                            }}
                          >
                            <div className="flex items-center space-x-1">
                              <span>Citations (Cited)</span>
                              <ArrowUpDown className="w-3 h-3" />
                            </div>
                          </th>
                          <th
                            className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700"
                            onClick={() => {
                              if (sortBy === 'more_count') {
                                setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                              } else {
                                setSortBy('more_count');
                                setSortOrder('desc');
                              }
                            }}
                          >
                            <div className="flex items-center space-x-1">
                              <span>Citations (More)</span>
                              <ArrowUpDown className="w-3 h-3" />
                            </div>
                          </th>
                          <th
                            className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700"
                            onClick={() => {
                              if (sortBy === 'total_citations') {
                                setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                              } else {
                                setSortBy('total_citations');
                                setSortOrder('desc');
                              }
                            }}
                          >
                            <div className="flex items-center space-x-1">
                              <span>Total</span>
                              <ArrowUpDown className="w-3 h-3" />
                            </div>
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
                        {domainCitations.map((citation, index) => (
                          <tr
                            key={`${citation.domain}-${citation.llm}-${index}`}
                            className="hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                          >
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white font-medium">
                              <div className="flex items-center">
                                <img
                                  src={`https://www.google.com/s2/favicons?domain=${citation.domain}&sz=32`}
                                  alt={`${citation.domain} favicon`}
                                  className="w-4 h-4 mr-2 flex-shrink-0"
                                  onError={(e) => {
                                    const target = e.target as HTMLImageElement;
                                    target.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIGZpbGw9IiNFNUU3RUIiLz48cGF0aCBkPSJNOCA0QzYuOSA0IDYgNC45IDYgNkM2IDcuMSA2LjkgOCA4IDhDOS4xIDggMTAgNy4xIDEwIDZDMTAgNC45IDkuMSA0IDggNFpNOCAxMEM2LjkgMTAgNiAxMC45IDYgMTJDNiAxMy4xIDYuOSAxNCA4IDE0QzkuMSAxNCAxMCAxMy4xIDEwIDEyQzEwIDEwLjkgOS4xIDEwIDggMTBaIiBmaWxsPSIjOUI5QkEzIi8+PC9zdmc+';
                                  }}
                                />
                                {citation.domain}
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm">
                              <span className={categoryChipClass(citation.category)}>
                                {citation.category}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm">
                              {citation.llm === 'all' ? (
                                <span className="px-3 py-1 rounded-lg text-xs font-medium bg-gradient-to-r from-brand-primary to-brand-secondary text-white">
                                  All LLMs
                                </span>
                              ) : (
                                <img
                                  src={LLM_ICONS[citation.llm as keyof typeof LLM_ICONS]}
                                  alt={LLM_NAMES[citation.llm as keyof typeof LLM_NAMES]}
                                  title={LLM_NAMES[citation.llm as keyof typeof LLM_NAMES]}
                                  className="w-6 h-6 object-contain"
                                />
                              )}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                              {citation.cited_count}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                              {citation.more_count}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white font-semibold">
                              {citation.total_citations}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination */}
                  {pagination.totalPages > 1 && (
                    <div className="flex items-center justify-between mt-6 px-4">
                      <div className="text-sm text-gray-600 dark:text-gray-400">
                        Showing {((pagination.page - 1) * pagination.pageSize) + 1} to{' '}
                        {Math.min(pagination.page * pagination.pageSize, pagination.total)} of{' '}
                        {pagination.total} results
                      </div>
                      <div className="flex items-center space-x-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setPagination({ ...pagination, page: pagination.page - 1 })}
                          disabled={pagination.page === 1}
                        >
                          <ChevronLeft className="w-4 h-4" />
                          Previous
                        </Button>
                        <span className="text-sm text-gray-600 dark:text-gray-400">
                          Page {pagination.page} of {pagination.totalPages}
                        </span>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setPagination({ ...pagination, page: pagination.page + 1 })}
                          disabled={pagination.page === pagination.totalPages}
                        >
                          Next
                          <ChevronRight className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex items-center justify-center py-12 text-gray-500 dark:text-gray-400">
                  No domain citations found
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
