import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, CircleCheck as CheckCircle2, Circle as XCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { Button } from '../components/ui/Button';
import { ProjectDetailPage } from './ProjectDetailPage';
import * as XLSX from 'xlsx';

const LLM_ICONS = {
  searchgpt: 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/SearchGPT.PNG',
  perplexity: 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/Perplexity.png',
  gemini: 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/Gemini.png',
  'google-ai-overview': 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/Google.png',
  'google-ai-mode': 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/Google.png',
  'bing-copilot': 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/bing_copilot.png',
  'grok': 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/Grok-icon.png',
};

interface VisibilityData {
  prompt_id: string;
  prompt_text: string;
  prompt_group: string;
  llm_responses: {
    llm_name: string;
    brand_mentioned: boolean;
    domain_cited: boolean;
    citation_urls: string[];
  }[];
}

interface GoogleAIData {
  prompt_id: string;
  prompt_text: string;
  prompt_group: string;
  google_ai_overview: {
    mentioned: boolean;
    cited: boolean;
  } | null;
  google_ai_mode: {
    mentioned: boolean;
    cited: boolean;
  } | null;
  organic_rank: number | null;
}

// Per-audit cell entry for the "All audits" tab: null = no response for
// this (prompt, LLM) pair in that audit; otherwise the mentioned/cited flags.
type AuditCell = { mentioned: boolean; cited: boolean; urls: string[] } | null;

interface AllAuditsData {
  prompt_id: string;
  prompt_text: string;
  prompt_group: string;
  // One entry per LLM; each array is aligned with `allAudits` (chronological)
  cells: Record<string, AuditCell[]>;
}

type DateRange = '7d' | '30d' | '90d' | 'all';

export const ProjectPromptsPage: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'evolution' | 'visibility' | 'all-audits' | 'google-ai'>('visibility');
  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<any>(null);
  const [visibilityData, setVisibilityData] = useState<VisibilityData[]>([]);
  const [llmList, setLlmList] = useState<string[]>([]);
  const [googleAIData, setGoogleAIData] = useState<GoogleAIData[]>([]);
  const [ownBrandNames, setOwnBrandNames] = useState<string[]>([]);

  // "All audits" tab state
  const [dateRange, setDateRange] = useState<DateRange>('30d');
  const [allAudits, setAllAudits] = useState<{ id: string; created_at: string }[]>([]);
  const [allAuditsData, setAllAuditsData] = useState<AllAuditsData[]>([]);
  const [allAuditsLlmList, setAllAuditsLlmList] = useState<string[]>([]);

  useEffect(() => {
    if (id && activeTab === 'visibility') {
      loadVisibilityData();
    } else if (id && activeTab === 'google-ai') {
      loadGoogleAIData();
    } else if (id && activeTab === 'all-audits') {
      loadAllAuditsData();
    }
  }, [id, activeTab, dateRange]);

  const loadVisibilityData = async () => {
    try {
      setLoading(true);

      // Load project
      const { data: projectData, error: projectError } = await supabase
        .from('projects')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (projectError) throw projectError;
      setProject(projectData);

      // Fetch own brands for mention detection
      const { data: brandsData } = await supabase
        .from('brands')
        .select('brand_name')
        .eq('project_id', id)
        .eq('is_competitor', false);

      const brandNames = (brandsData || []).map(b => b.brand_name.toLowerCase());
      setOwnBrandNames(brandNames);

      // Get the most recent audit for this project
      const { data: mostRecentAudit, error: auditError } = await supabase
        .from('audits')
        .select('id, created_at')
        .eq('project_id', id)
        .eq('status', 'completed')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (auditError) throw auditError;

      if (!mostRecentAudit) {
        setVisibilityData([]);
        setLlmList([]);
        setLoading(false);
        return;
      }

      // Load ALL prompts for this project to get unique prompt texts
      const { data: allPromptsData, error: allPromptsError } = await supabase
        .from('prompts')
        .select('id, prompt_text, prompt_group')
        .eq('project_id', id);

      if (allPromptsError) throw allPromptsError;

      // Get unique prompts by text and group
      const uniquePromptsMap = new Map<string, { id: string; prompt_text: string; prompt_group: string }>();
      if (allPromptsData) {
        for (const prompt of allPromptsData) {
          const key = `${prompt.prompt_text}|||${prompt.prompt_group}`;
          if (!uniquePromptsMap.has(key)) {
            uniquePromptsMap.set(key, prompt);
          }
        }
      }

      const uniquePrompts = Array.from(uniquePromptsMap.values()).sort((a, b) =>
        a.prompt_group.localeCompare(b.prompt_group) || a.prompt_text.localeCompare(b.prompt_text)
      );

      // Load LLM responses for the most recent audit
      const { data: llmResponsesData, error: llmResponsesError } = await supabase
        .from('llm_responses')
        .select('id, prompt_id, llm, answer_text, answer_competitors, citations, links_attached')
        .eq('audit_id', mostRecentAudit.id);

      if (llmResponsesError) throw llmResponsesError;

      // Create a map of prompt_id to responses for quick lookup
      const responsesByPromptId = new Map<string, any[]>();
      if (llmResponsesData) {
        for (const response of llmResponsesData) {
          if (!responsesByPromptId.has(response.prompt_id)) {
            responsesByPromptId.set(response.prompt_id, []);
          }
          responsesByPromptId.get(response.prompt_id)!.push(response);
        }
      }

      // Process data
      const uniqueLlms = new Set<string>();
      const processedData: VisibilityData[] = [];

      for (const prompt of uniquePrompts) {
        // Find any prompt ID that matches this text and group (from the most recent audit)
        const matchingPromptIds = allPromptsData
          ?.filter(p => p.prompt_text === prompt.prompt_text && p.prompt_group === prompt.prompt_group)
          .map(p => p.id) || [];

        // Get all LLM responses for any of the matching prompt IDs
        const promptResponses = matchingPromptIds.flatMap(promptId =>
          responsesByPromptId.get(promptId) || []
        );

        if (promptResponses.length > 0) {
          const llmResponses = promptResponses.map((response: any) => {
            uniqueLlms.add(response.llm);

            // Check if own brand is mentioned (via answer_competitors JSON or text fallback)
            const brandMentioned = checkBrandMentioned(response, projectData);

            // Check if domain is cited - use links_attached for SearchGPT, citations for others
            let domainCited = false;
            const citationUrls: string[] = [];

            // Helper function to extract domain from URL
            const extractDomain = (url: string): string => {
              try {
                const urlObj = new URL(url);
                return urlObj.hostname.toLowerCase().replace(/^www\./, '');
              } catch {
                return '';
              }
            };

            // Helper function to check if domain matches
            const domainMatches = (url: string, targetDomain: string): boolean => {
              const urlDomain = extractDomain(url);
              const cleanTargetDomain = targetDomain.toLowerCase().replace(/^www\./, '');

              // Check exact match or subdomain match
              return urlDomain === cleanTargetDomain ||
                     urlDomain.endsWith(`.${cleanTargetDomain}`) ||
                     url.toLowerCase().includes(cleanTargetDomain);
            };

            // For SearchGPT/ChatGPT, use links_attached
            if (response.llm === 'searchgpt' && response.links_attached && Array.isArray(response.links_attached)) {
              const matchingCitations = response.links_attached.filter((citation: any) => {
                return citation.url && domainMatches(citation.url, projectData?.domain || '');
              });

              domainCited = matchingCitations.length > 0;
              citationUrls.push(...matchingCitations.map((c: any) => c.url).filter(Boolean));
            }
            // For other LLMs, use citations field
            else if (response.citations && Array.isArray(response.citations)) {
              const matchingCitations = response.citations.filter((citation: any) => {
                // For LLMs like SearchGPT that have a 'cited' field, check it
                // For LLMs like Perplexity that don't have a 'cited' field, all citations are considered cited
                const isCited = citation.cited === undefined || citation.cited === true;

                if (!isCited) return false;

                // Check domain field or extract from URL
                if (citation.domain) {
                  const citationDomain = citation.domain.toLowerCase().replace(/^www\./, '');
                  const targetDomain = (projectData?.domain || '').toLowerCase().replace(/^www\./, '');
                  return citationDomain.includes(targetDomain) || targetDomain.includes(citationDomain);
                } else if (citation.url) {
                  return domainMatches(citation.url, projectData?.domain || '');
                }
                return false;
              });

              domainCited = matchingCitations.length > 0;
              citationUrls.push(...matchingCitations.map((c: any) => c.url).filter(Boolean));
            }

            return {
              llm_name: response.llm,
              brand_mentioned: brandMentioned,
              domain_cited: domainCited,
              citation_urls: citationUrls
            };
          });

          processedData.push({
            prompt_id: prompt.id,
            prompt_text: prompt.prompt_text,
            prompt_group: prompt.prompt_group,
            llm_responses: llmResponses
          });
        }
      }

      setLlmList(Array.from(uniqueLlms).sort());
      setVisibilityData(processedData);
    } catch (error) {
      console.error('Error loading visibility data:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadGoogleAIData = async () => {
    try {
      setLoading(true);

      // Load project
      const { data: projectData, error: projectError } = await supabase
        .from('projects')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (projectError) throw projectError;
      setProject(projectData);

      // Fetch own brands for mention detection
      const { data: brandsData } = await supabase
        .from('brands')
        .select('brand_name')
        .eq('project_id', id)
        .eq('is_competitor', false);

      const brandNames = (brandsData || []).map(b => b.brand_name.toLowerCase());
      setOwnBrandNames(brandNames);

      // Get the most recent audit for this project
      const { data: mostRecentAudit, error: auditError } = await supabase
        .from('audits')
        .select('id, created_at')
        .eq('project_id', id)
        .eq('status', 'completed')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (auditError) throw auditError;

      if (!mostRecentAudit) {
        setGoogleAIData([]);
        setLoading(false);
        return;
      }

      // Load ALL prompts for this project
      const { data: allPromptsData, error: allPromptsError } = await supabase
        .from('prompts')
        .select('id, prompt_text, prompt_group')
        .eq('project_id', id);

      if (allPromptsError) throw allPromptsError;

      // Get unique prompts by text and group
      const uniquePromptsMap = new Map<string, { id: string; prompt_text: string; prompt_group: string }>();
      if (allPromptsData) {
        for (const prompt of allPromptsData) {
          const key = `${prompt.prompt_text}|||${prompt.prompt_group}`;
          if (!uniquePromptsMap.has(key)) {
            uniquePromptsMap.set(key, prompt);
          }
        }
      }

      const uniquePrompts = Array.from(uniquePromptsMap.values()).sort((a, b) =>
        a.prompt_group.localeCompare(b.prompt_group) || a.prompt_text.localeCompare(b.prompt_text)
      );

      // Load LLM responses for the most recent audit (only Google AI variants)
      const { data: llmResponsesData, error: llmResponsesError } = await supabase
        .from('llm_responses')
        .select('id, prompt_id, llm, answer_text, answer_competitors, citations, organic_results')
        .eq('audit_id', mostRecentAudit.id)
        .in('llm', ['google-ai-overview', 'google-ai-mode']);

      if (llmResponsesError) throw llmResponsesError;

      // Create a map of prompt_id to responses for quick lookup
      const responsesByPromptId = new Map<string, any[]>();
      if (llmResponsesData) {
        for (const response of llmResponsesData) {
          if (!responsesByPromptId.has(response.prompt_id)) {
            responsesByPromptId.set(response.prompt_id, []);
          }
          responsesByPromptId.get(response.prompt_id)!.push(response);
        }
      }

      const projectDomain = projectData?.domain?.toLowerCase().replace(/^www\./, '');

      // Process data
      const processedData: GoogleAIData[] = [];

      for (const prompt of uniquePrompts) {
        // Find matching prompt IDs
        const matchingPromptIds = allPromptsData
          ?.filter(p => p.prompt_text === prompt.prompt_text && p.prompt_group === prompt.prompt_group)
          .map(p => p.id) || [];

        // Get all LLM responses for matching prompt IDs
        const promptResponses = matchingPromptIds.flatMap(promptId =>
          responsesByPromptId.get(promptId) || []
        );

        if (promptResponses.length > 0) {
          const overviewResponse = promptResponses.find(r => r.llm === 'google-ai-overview');
          const modeResponse = promptResponses.find(r => r.llm === 'google-ai-mode');

          let googleAIOverview = null;
          let googleAIMode = null;
          let organicRank = null;

          // Process Google AI Overview
          if (overviewResponse) {
            const brandMentioned = checkBrandMentioned(overviewResponse, projectData);
            const domainCited = checkDomainCited(overviewResponse, projectData);
            googleAIOverview = { mentioned: brandMentioned, cited: domainCited };

            // Extract organic rank
            if (overviewResponse.organic_results && Array.isArray(overviewResponse.organic_results)) {
              const matchingOrganic = overviewResponse.organic_results.find((result: any) => {
                const resultDomain = extractDomainFromUrl(result.url)?.toLowerCase().replace(/^www\./, '');
                return resultDomain === projectDomain || resultDomain?.endsWith(`.${projectDomain}`);
              });

              if (matchingOrganic && matchingOrganic.rank) {
                organicRank = matchingOrganic.rank;
              }
            }
          }

          // Process Google AI Mode
          if (modeResponse) {
            const brandMentioned = checkBrandMentioned(modeResponse, projectData);
            const domainCited = checkDomainCited(modeResponse, projectData);
            googleAIMode = { mentioned: brandMentioned, cited: domainCited };
          }

          if (googleAIOverview || googleAIMode) {
            processedData.push({
              prompt_id: prompt.id,
              prompt_text: prompt.prompt_text,
              prompt_group: prompt.prompt_group,
              google_ai_overview: googleAIOverview,
              google_ai_mode: googleAIMode,
              organic_rank: organicRank
            });
          }
        }
      }

      setGoogleAIData(processedData);
    } catch (error) {
      console.error('Error loading Google AI data:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStartDateForRange = (range: DateRange): string | null => {
    if (range === 'all') return null;
    const now = new Date();
    const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
    const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    return start.toISOString();
  };

  const loadAllAuditsData = async () => {
    try {
      setLoading(true);

      // Load project
      const { data: projectData, error: projectError } = await supabase
        .from('projects')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (projectError) throw projectError;
      setProject(projectData);

      // Own brands (for mention detection)
      const { data: brandsData } = await supabase
        .from('brands')
        .select('brand_name')
        .eq('project_id', id)
        .eq('is_competitor', false);
      const brandNames = (brandsData || []).map(b => b.brand_name.toLowerCase());
      setOwnBrandNames(brandNames);

      // Fetch all completed audits within the selected timeframe (oldest first
      // → icons render chronologically left-to-right in each cell).
      const startDate = getStartDateForRange(dateRange);
      let auditsQuery = supabase
        .from('audits')
        .select('id, created_at')
        .eq('project_id', id)
        .eq('status', 'completed')
        .order('created_at', { ascending: true });
      if (startDate) {
        auditsQuery = auditsQuery.gte('created_at', startDate);
      }
      const { data: auditsList, error: auditsError } = await auditsQuery;
      if (auditsError) throw auditsError;

      if (!auditsList || auditsList.length === 0) {
        setAllAudits([]);
        setAllAuditsData([]);
        setAllAuditsLlmList([]);
        setLoading(false);
        return;
      }
      setAllAudits(auditsList);
      const auditIds = auditsList.map(a => a.id);

      // All prompts for this project (dedup by text+group — prompt_id may
      // repeat across audits if the user edits and re-runs).
      const { data: allPromptsData } = await supabase
        .from('prompts')
        .select('id, prompt_text, prompt_group')
        .eq('project_id', id);
      const uniquePromptsMap = new Map<string, { id: string; prompt_text: string; prompt_group: string }>();
      for (const p of allPromptsData || []) {
        const key = `${p.prompt_text}|||${p.prompt_group}`;
        if (!uniquePromptsMap.has(key)) uniquePromptsMap.set(key, p);
      }
      const uniquePrompts = Array.from(uniquePromptsMap.values()).sort((a, b) =>
        a.prompt_group.localeCompare(b.prompt_group) || a.prompt_text.localeCompare(b.prompt_text)
      );

      // All LLM responses across the selected audits.
      const { data: responses, error: respError } = await supabase
        .from('llm_responses')
        .select('id, audit_id, prompt_id, llm, answer_text, answer_competitors, citations, links_attached')
        .in('audit_id', auditIds);
      if (respError) throw respError;

      // Group responses by (promptText+group, llm, audit_id) → response
      // (first match wins — duplicates within an audit are rare).
      type Key = string;
      const byCell = new Map<Key, any>();
      const promptIdToKey = new Map<string, string>();
      for (const p of allPromptsData || []) {
        promptIdToKey.set(p.id, `${p.prompt_text}|||${p.prompt_group}`);
      }
      const uniqueLlms = new Set<string>();
      for (const r of responses || []) {
        const promptKey = promptIdToKey.get(r.prompt_id);
        if (!promptKey) continue;
        uniqueLlms.add(r.llm);
        const k = `${promptKey}|||${r.llm}|||${r.audit_id}`;
        if (!byCell.has(k)) byCell.set(k, r);
      }
      const llmListSorted = Array.from(uniqueLlms).sort();

      const projectDomain = projectData?.domain || '';

      // Build per-prompt row: for each LLM, one cell per audit (in order)
      const processed: AllAuditsData[] = [];
      for (const prompt of uniquePrompts) {
        const promptKey = `${prompt.prompt_text}|||${prompt.prompt_group}`;
        const cells: Record<string, AuditCell[]> = {};
        for (const llm of llmListSorted) {
          cells[llm] = auditsList.map(audit => {
            const response = byCell.get(`${promptKey}|||${llm}|||${audit.id}`);
            if (!response) return null;
            const mentioned = checkBrandMentionedWithBrands(response, brandNames);
            const { cited, urls } = checkDomainCitedWithUrls(response, projectDomain);
            return { mentioned, cited, urls };
          });
        }
        // Only include prompts that have at least one response across all
        // audits/LLMs (otherwise they're noise).
        const hasAny = Object.values(cells).some(arr => arr.some(c => c !== null));
        if (hasAny) {
          processed.push({
            prompt_id: prompt.id,
            prompt_text: prompt.prompt_text,
            prompt_group: prompt.prompt_group,
            cells,
          });
        }
      }

      setAllAuditsLlmList(llmListSorted);
      setAllAuditsData(processed);
    } catch (error) {
      console.error('Error loading all-audits data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Pure variant (doesn't depend on component state) for use inside
  // loadAllAuditsData where ownBrandNames state isn't yet settled.
  const checkBrandMentionedWithBrands = (response: any, brands: string[]): boolean => {
    if (response.answer_competitors?.brands && Array.isArray(response.answer_competitors.brands)) {
      const found = response.answer_competitors.brands.some((comp: any) =>
        brands.some(bn =>
          comp.name?.toLowerCase().includes(bn) || bn.includes(comp.name?.toLowerCase() || '')
        )
      );
      if (found) return true;
    }
    const answerText = response.answer_text?.toLowerCase() || '';
    return brands.some(bn => answerText.includes(bn));
  };

  const checkDomainCitedWithUrls = (response: any, rawDomain: string): { cited: boolean; urls: string[] } => {
    const target = (rawDomain || '').toLowerCase().replace(/^www\./, '');
    if (!target) return { cited: false, urls: [] };

    const extractDomain = (url: string): string => {
      try {
        return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
      } catch { return ''; }
    };
    const domainMatches = (url: string): boolean => {
      const d = extractDomain(url);
      return d === target || d.endsWith(`.${target}`) || url.toLowerCase().includes(target);
    };

    const urls: string[] = [];

    // SearchGPT uses links_attached; others use citations
    if (response.llm === 'searchgpt' && Array.isArray(response.links_attached)) {
      for (const c of response.links_attached) {
        if (c?.url && domainMatches(c.url)) urls.push(c.url);
      }
    } else if (Array.isArray(response.citations)) {
      for (const c of response.citations) {
        const isCited = c.cited === undefined || c.cited === true;
        if (!isCited) continue;
        if (c.domain) {
          const cd = c.domain.toLowerCase().replace(/^www\./, '');
          if (cd.includes(target) || target.includes(cd)) {
            if (c.url) urls.push(c.url);
            else urls.push(`https://${cd}`);
          }
        } else if (c.url && domainMatches(c.url)) {
          urls.push(c.url);
        }
      }
    }
    return { cited: urls.length > 0, urls };
  };

  const checkBrandMentioned = (response: any, _projectData: any) => {
    // Level 1: Check answer_competitors JSON against own brand names
    if (response.answer_competitors?.brands && Array.isArray(response.answer_competitors.brands)) {
      const found = response.answer_competitors.brands.some((comp: any) =>
        ownBrandNames.some(bn =>
          comp.name?.toLowerCase().includes(bn) || bn.includes(comp.name?.toLowerCase() || '')
        )
      );
      if (found) return true;
    }

    // Level 2: Fallback — text search in answer_text
    const answerText = response.answer_text?.toLowerCase() || '';
    return ownBrandNames.some(bn => answerText.includes(bn));
  };

  const checkDomainCited = (response: any, projectData: any) => {
    let domainCited = false;
    if (response.citations && Array.isArray(response.citations)) {
      domainCited = response.citations.some((citation: any) => {
        // For LLMs like SearchGPT that have a 'cited' field, check it
        // For LLMs like Perplexity that don't have a 'cited' field, all citations are considered cited
        const isCited = citation.cited === undefined || citation.cited === true;

        return isCited && (
          citation.domain?.toLowerCase().includes(projectData?.domain?.toLowerCase().replace('.com', '')) ||
          citation.url?.toLowerCase().includes(projectData?.domain?.toLowerCase())
        );
      });
    }
    return domainCited;
  };

  const extractDomainFromUrl = (url: string): string | null => {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch {
      return null;
    }
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

  const exportToExcel = () => {
    // Create data for Excel export
    const excelData = visibilityData.map((row) => {
      const rowData: any = {
        'Prompt': row.prompt_text,
        'Group': row.prompt_group
      };

      llmList.forEach((llm) => {
        const response = row.llm_responses.find((r) => r.llm_name === llm);
        const llmDisplayName = getLlmDisplayName(llm);

        if (response) {
          rowData[`${llmDisplayName} - Mentioned`] = response.brand_mentioned ? 'Yes' : 'No';
          rowData[`${llmDisplayName} - Cited`] = response.domain_cited ? 'Yes' : 'No';
          rowData[`${llmDisplayName} - Citation URLs`] = response.citation_urls.length > 0
            ? response.citation_urls.join(', ')
            : '';
        } else {
          rowData[`${llmDisplayName} - Mentioned`] = '-';
          rowData[`${llmDisplayName} - Cited`] = '-';
          rowData[`${llmDisplayName} - Citation URLs`] = '';
        }
      });

      return rowData;
    });

    const worksheet = XLSX.utils.json_to_sheet(excelData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Visibility Report');

    XLSX.writeFile(workbook, `${project?.name || 'project'}_visibility_report.xlsx`);
  };

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
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
                Prompts
              </h1>
              <p className="mt-2 text-gray-600 dark:text-gray-400">
                {project?.name}
              </p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="mb-6">
          <div className="border-b border-gray-200 dark:border-gray-700">
            <nav className="-mb-px flex space-x-8">
              <button
                onClick={() => setActiveTab('visibility')}
                className={`
                  py-4 px-1 border-b-2 font-medium text-sm transition-colors
                  ${activeTab === 'visibility'
                    ? 'border-[rgb(126,34,206)] text-[rgb(126,34,206)] dark:border-purple-400 dark:text-purple-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
                  }
                `}
              >
                Last audit
              </button>
              <button
                onClick={() => setActiveTab('all-audits')}
                className={`
                  py-4 px-1 border-b-2 font-medium text-sm transition-colors
                  ${activeTab === 'all-audits'
                    ? 'border-[rgb(126,34,206)] text-[rgb(126,34,206)] dark:border-purple-400 dark:text-purple-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
                  }
                `}
              >
                All audits
              </button>
              <button
                onClick={() => setActiveTab('google-ai')}
                className={`
                  py-4 px-1 border-b-2 font-medium text-sm transition-colors
                  ${activeTab === 'google-ai'
                    ? 'border-[rgb(126,34,206)] text-[rgb(126,34,206)] dark:border-purple-400 dark:text-purple-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
                  }
                `}
              >
                Google AI
              </button>
              <button
                onClick={() => setActiveTab('evolution')}
                className={`
                  py-4 px-1 border-b-2 font-medium text-sm transition-colors
                  ${activeTab === 'evolution'
                    ? 'border-[rgb(126,34,206)] text-[rgb(126,34,206)] dark:border-purple-400 dark:text-purple-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
                  }
                `}
              >
                Evolution
              </button>
            </nav>
          </div>
        </div>

        {/* Google AI Tab Content */}
        {activeTab === 'google-ai' && (
          <>
            {loading ? (
              <div className="flex items-center justify-center h-64">
                <LoadingSpinner size="lg" />
              </div>
            ) : (
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="border-b-2 border-gray-200 dark:border-gray-700">
                        <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider bg-gray-50 dark:bg-gray-900 sticky left-0 z-10">
                          Prompt
                        </th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider bg-gray-50 dark:bg-gray-900">
                          Group
                        </th>
                        <th className="px-6 py-4 text-center border-l border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900" colSpan={2}>
                          <div className="flex flex-col items-center gap-2 mb-2">
                            <img
                              src={LLM_ICONS['google-ai-overview']}
                              alt="Google AI Overview"
                              className="w-6 h-6 rounded"
                            />
                            <span className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                              Google AI
                            </span>
                          </div>
                          <div className="flex justify-center gap-4 mt-2">
                            <span className="text-xs text-gray-500 dark:text-gray-500">
                              Mentioned
                            </span>
                            <span className="text-xs text-gray-500 dark:text-gray-500">
                              Cited
                            </span>
                          </div>
                        </th>
                        <th className="px-6 py-4 text-center border-l border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900" colSpan={2}>
                          <div className="flex flex-col items-center gap-2 mb-2">
                            <img
                              src={LLM_ICONS['google-ai-mode']}
                              alt="Google AI Mode"
                              className="w-6 h-6 rounded"
                            />
                            <span className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                              Google AI Mode
                            </span>
                          </div>
                          <div className="flex justify-center gap-4 mt-2">
                            <span className="text-xs text-gray-500 dark:text-gray-500">
                              Mentioned
                            </span>
                            <span className="text-xs text-gray-500 dark:text-gray-500">
                              Cited
                            </span>
                          </div>
                        </th>
                        <th className="px-6 py-4 text-center border-l border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                          <span className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                            Organic Rank
                          </span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {googleAIData.length === 0 ? (
                        <tr>
                          <td
                            colSpan={7}
                            className="px-6 py-12 text-center text-gray-500 dark:text-gray-400"
                          >
                            No Google AI audit data available. Run an audit with Google AI Overview or Google AI Mode to see data.
                          </td>
                        </tr>
                      ) : (
                        googleAIData.map((row) => (
                          <tr
                            key={row.prompt_id}
                            className="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750"
                          >
                            <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-100 max-w-md sticky left-0 bg-white dark:bg-gray-800 z-10">
                              <button
                                onClick={() => navigate(`/projects/${id}/prompts/${row.prompt_id}`)}
                                className="text-left hover:text-[rgb(126,34,206)] dark:hover:text-purple-400 transition-colors cursor-pointer"
                              >
                                {row.prompt_text}
                              </button>
                            </td>
                            <td className="px-6 py-4 text-sm">
                              <span className="px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded-lg text-xs text-gray-900 dark:text-gray-100">
                                {row.prompt_group}
                              </span>
                            </td>

                            {/* Google AI Overview */}
                            {row.google_ai_overview ? (
                              <>
                                <td className={`px-6 py-4 text-center border-l border-gray-200 dark:border-gray-700 ${
                                  row.google_ai_overview.mentioned
                                    ? 'bg-green-50 dark:bg-green-950/30'
                                    : 'bg-red-50 dark:bg-red-950/30'
                                }`}>
                                  {row.google_ai_overview.mentioned ? (
                                    <CheckCircle2 className="w-5 h-5 text-green-500 mx-auto" />
                                  ) : (
                                    <XCircle className="w-5 h-5 text-red-500 mx-auto" />
                                  )}
                                </td>
                                <td className={`px-6 py-4 text-center ${
                                  row.google_ai_overview.cited
                                    ? 'bg-green-50 dark:bg-green-950/30'
                                    : 'bg-red-50 dark:bg-red-950/30'
                                }`}>
                                  {row.google_ai_overview.cited ? (
                                    <CheckCircle2 className="w-5 h-5 text-green-500 mx-auto" />
                                  ) : (
                                    <XCircle className="w-5 h-5 text-red-500 mx-auto" />
                                  )}
                                </td>
                              </>
                            ) : (
                              <>
                                <td className="px-6 py-4 text-center border-l border-gray-200 dark:border-gray-700">
                                  <span className="text-gray-400">-</span>
                                </td>
                                <td className="px-6 py-4 text-center">
                                  <span className="text-gray-400">-</span>
                                </td>
                              </>
                            )}

                            {/* Google AI Mode */}
                            {row.google_ai_mode ? (
                              <>
                                <td className={`px-6 py-4 text-center border-l border-gray-200 dark:border-gray-700 ${
                                  row.google_ai_mode.mentioned
                                    ? 'bg-green-50 dark:bg-green-950/30'
                                    : 'bg-red-50 dark:bg-red-950/30'
                                }`}>
                                  {row.google_ai_mode.mentioned ? (
                                    <CheckCircle2 className="w-5 h-5 text-green-500 mx-auto" />
                                  ) : (
                                    <XCircle className="w-5 h-5 text-red-500 mx-auto" />
                                  )}
                                </td>
                                <td className={`px-6 py-4 text-center ${
                                  row.google_ai_mode.cited
                                    ? 'bg-green-50 dark:bg-green-950/30'
                                    : 'bg-red-50 dark:bg-red-950/30'
                                }`}>
                                  {row.google_ai_mode.cited ? (
                                    <CheckCircle2 className="w-5 h-5 text-green-500 mx-auto" />
                                  ) : (
                                    <XCircle className="w-5 h-5 text-red-500 mx-auto" />
                                  )}
                                </td>
                              </>
                            ) : (
                              <>
                                <td className="px-6 py-4 text-center border-l border-gray-200 dark:border-gray-700">
                                  <span className="text-gray-400">-</span>
                                </td>
                                <td className="px-6 py-4 text-center">
                                  <span className="text-gray-400">-</span>
                                </td>
                              </>
                            )}

                            {/* Organic Rank */}
                            <td className={`px-6 py-4 text-center border-l border-gray-200 dark:border-gray-700 ${
                              row.organic_rank
                                ? row.organic_rank <= 3
                                  ? 'bg-green-50 dark:bg-green-950/30'
                                  : row.organic_rank <= 10
                                  ? 'bg-yellow-50 dark:bg-yellow-950/30'
                                  : 'bg-orange-50 dark:bg-orange-950/30'
                                : ''
                            }`}>
                              {row.organic_rank ? (
                                <span className={`font-semibold ${
                                  row.organic_rank <= 3
                                    ? 'text-green-600 dark:text-green-400'
                                    : row.organic_rank <= 10
                                    ? 'text-yellow-600 dark:text-yellow-400'
                                    : 'text-orange-600 dark:text-orange-400'
                                }`}>
                                  #{row.organic_rank}
                                </span>
                              ) : (
                                <span className="text-gray-400">-</span>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Legend */}
                <div className="border-t border-gray-200 dark:border-gray-700 p-6">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">
                    Legend
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    <div className="flex items-center">
                      <CheckCircle2 className="w-5 h-5 text-green-500 mr-3" />
                      <span className="text-gray-700 dark:text-gray-300">
                        Brand mentioned / Domain cited
                      </span>
                    </div>
                    <div className="flex items-center">
                      <XCircle className="w-5 h-5 text-red-500 mr-3" />
                      <span className="text-gray-700 dark:text-gray-300">
                        Brand not mentioned / Domain not cited
                      </span>
                    </div>
                    <div className="flex items-center">
                      <span className="text-gray-400 mr-3 font-medium">-</span>
                      <span className="text-gray-700 dark:text-gray-300">
                        No audit data available
                      </span>
                    </div>
                    <div className="flex items-center">
                      <span className="px-2 py-1 bg-green-50 dark:bg-green-950/30 text-green-600 dark:text-green-400 rounded font-semibold mr-3">
                        #1-3
                      </span>
                      <span className="text-gray-700 dark:text-gray-300">
                        Top 3 organic position
                      </span>
                    </div>
                    <div className="flex items-center">
                      <span className="px-2 py-1 bg-yellow-50 dark:bg-yellow-950/30 text-yellow-600 dark:text-yellow-400 rounded font-semibold mr-3">
                        #4-10
                      </span>
                      <span className="text-gray-700 dark:text-gray-300">
                        Top 10 organic position
                      </span>
                    </div>
                    <div className="flex items-center">
                      <span className="px-2 py-1 bg-orange-50 dark:bg-orange-950/30 text-orange-600 dark:text-orange-400 rounded font-semibold mr-3">
                        #11+
                      </span>
                      <span className="text-gray-700 dark:text-gray-300">
                        Lower organic position
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* Evolution Tab Content */}
        {activeTab === 'evolution' && (
          <ProjectDetailPage activeTabOverride="prompts" hideTabNavigation />
        )}

        {/* All Audits Tab Content */}
        {activeTab === 'all-audits' && (
          <>
            {/* Date range + summary */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
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
                {!loading && allAudits.length > 0 && (
                  <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">
                    {allAudits.length} audit{allAudits.length === 1 ? '' : 's'} · oldest {new Date(allAudits[0].created_at).toLocaleDateString()} → newest {new Date(allAudits[allAudits.length - 1].created_at).toLocaleDateString()}
                  </span>
                )}
              </div>
            </div>

            {loading ? (
              <div className="flex items-center justify-center h-64">
                <LoadingSpinner size="lg" />
              </div>
            ) : allAudits.length === 0 ? (
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-12 text-center text-gray-500 dark:text-gray-400">
                No completed audits in the selected timeframe.
              </div>
            ) : (
              <>
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr className="border-b-2 border-gray-200 dark:border-gray-700">
                          <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider bg-gray-50 dark:bg-gray-900 sticky left-0 z-10">
                            Prompt
                          </th>
                          <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider bg-gray-50 dark:bg-gray-900">
                            Group
                          </th>
                          {allAuditsLlmList.map((llm) => (
                            <th
                              key={llm}
                              className="px-4 py-4 text-center border-l border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900"
                              colSpan={2}
                            >
                              <div className="flex flex-col items-center gap-2 mb-2">
                                {LLM_ICONS[llm as keyof typeof LLM_ICONS] && (
                                  <img
                                    src={LLM_ICONS[llm as keyof typeof LLM_ICONS]}
                                    alt={getLlmDisplayName(llm)}
                                    className="w-6 h-6 rounded"
                                  />
                                )}
                                <span className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                                  {getLlmDisplayName(llm)}
                                </span>
                              </div>
                              <div className="flex justify-center gap-4 mt-2">
                                <span className="text-xs text-gray-500 dark:text-gray-500">
                                  Mentioned
                                </span>
                                <span className="text-xs text-gray-500 dark:text-gray-500">
                                  Cited
                                </span>
                              </div>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {allAuditsData.length === 0 ? (
                          <tr>
                            <td
                              colSpan={allAuditsLlmList.length * 2 + 2}
                              className="px-6 py-12 text-center text-gray-500 dark:text-gray-400"
                            >
                              No response data across audits in this timeframe.
                            </td>
                          </tr>
                        ) : (
                          allAuditsData.map((row) => (
                            <tr
                              key={row.prompt_id}
                              className="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750"
                            >
                              <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-100 max-w-md sticky left-0 bg-white dark:bg-gray-800 z-10">
                                <button
                                  onClick={() => navigate(`/projects/${id}/prompts/${row.prompt_id}`)}
                                  className="text-left hover:text-[rgb(126,34,206)] dark:hover:text-purple-400 transition-colors cursor-pointer"
                                >
                                  {row.prompt_text}
                                </button>
                              </td>
                              <td className="px-6 py-4 text-sm">
                                <span className="px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded-lg text-xs text-gray-900 dark:text-gray-100">
                                  {row.prompt_group}
                                </span>
                              </td>
                              {allAuditsLlmList.map((llm) => {
                                const cells = row.cells[llm] || [];
                                return (
                                  <React.Fragment key={llm}>
                                    {/* Mentioned column — one icon per audit */}
                                    <td className="px-3 py-3 border-l border-gray-200 dark:border-gray-700 align-middle">
                                      <div className="flex flex-wrap justify-center gap-1 max-w-[160px] mx-auto">
                                        {cells.map((cell, idx) => {
                                          const auditDate = new Date(allAudits[idx].created_at).toLocaleDateString();
                                          if (cell === null) {
                                            return (
                                              <span
                                                key={idx}
                                                title={`${auditDate} — no response`}
                                                className="text-gray-400 dark:text-gray-600 font-medium text-sm leading-none px-0.5"
                                              >
                                                —
                                              </span>
                                            );
                                          }
                                          return cell.mentioned ? (
                                            <CheckCircle2
                                              key={idx}
                                              title={`${auditDate} — mentioned`}
                                              className="w-4 h-4 text-green-500"
                                            />
                                          ) : (
                                            <XCircle
                                              key={idx}
                                              title={`${auditDate} — not mentioned`}
                                              className="w-4 h-4 text-red-400"
                                            />
                                          );
                                        })}
                                      </div>
                                    </td>
                                    {/* Cited column */}
                                    <td className="px-3 py-3 align-middle">
                                      <div className="flex flex-wrap justify-center gap-1 max-w-[160px] mx-auto">
                                        {cells.map((cell, idx) => {
                                          const auditDate = new Date(allAudits[idx].created_at).toLocaleDateString();
                                          if (cell === null) {
                                            return (
                                              <span
                                                key={idx}
                                                title={`${auditDate} — no response`}
                                                className="text-gray-400 dark:text-gray-600 font-medium text-sm leading-none px-0.5"
                                              >
                                                —
                                              </span>
                                            );
                                          }
                                          return cell.cited ? (
                                            <CheckCircle2
                                              key={idx}
                                              title={`${auditDate} — cited`}
                                              className="w-4 h-4 text-green-500"
                                            />
                                          ) : (
                                            <XCircle
                                              key={idx}
                                              title={`${auditDate} — not cited`}
                                              className="w-4 h-4 text-red-400"
                                            />
                                          );
                                        })}
                                      </div>
                                    </td>
                                  </React.Fragment>
                                );
                              })}
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Legend */}
                <div className="mt-6 bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">
                    Legend
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                    Each icon represents one audit's response for that prompt × LLM pair, in chronological order (oldest → newest). Hover for audit date.
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                    <div className="flex items-center">
                      <CheckCircle2 className="w-4 h-4 text-green-500 mr-3" />
                      <span className="text-gray-700 dark:text-gray-300">
                        Brand mentioned / Domain cited
                      </span>
                    </div>
                    <div className="flex items-center">
                      <XCircle className="w-4 h-4 text-red-400 mr-3" />
                      <span className="text-gray-700 dark:text-gray-300">
                        Not mentioned / Not cited
                      </span>
                    </div>
                    <div className="flex items-center">
                      <span className="text-gray-400 dark:text-gray-600 mr-3 font-medium">—</span>
                      <span className="text-gray-700 dark:text-gray-300">
                        No response for that audit
                      </span>
                    </div>
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {/* Visibility Tab Content */}
        {activeTab === 'visibility' && (
          <>
            {loading ? (
              <div className="flex items-center justify-center h-64">
                <LoadingSpinner size="lg" />
              </div>
            ) : (
              <>
                {/* Export Button */}
            <div className="flex justify-end mb-4">
              <Button onClick={exportToExcel} variant="outline">
                <Download className="w-4 h-4 mr-2" />
                Export to Excel
              </Button>
            </div>

            {/* Visibility Table */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b-2 border-gray-200 dark:border-gray-700">
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider bg-gray-50 dark:bg-gray-900 sticky left-0 z-10">
                        Prompt
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider bg-gray-50 dark:bg-gray-900">
                        Group
                      </th>
                      {llmList.map((llm) => (
                        <th
                          key={llm}
                          className="px-6 py-4 text-center border-l border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900"
                          colSpan={2}
                        >
                          <div className="flex flex-col items-center gap-2 mb-2">
                            {LLM_ICONS[llm as keyof typeof LLM_ICONS] && (
                              <img
                                src={LLM_ICONS[llm as keyof typeof LLM_ICONS]}
                                alt={getLlmDisplayName(llm)}
                                className="w-6 h-6 rounded"
                              />
                            )}
                            <span className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                              {getLlmDisplayName(llm)}
                            </span>
                          </div>
                          <div className="flex justify-center gap-4 mt-2">
                            <span className="text-xs text-gray-500 dark:text-gray-500">
                              Mentioned
                            </span>
                            <span className="text-xs text-gray-500 dark:text-gray-500">
                              Cited
                            </span>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibilityData.length === 0 ? (
                      <tr>
                        <td
                          colSpan={llmList.length * 2 + 2}
                          className="px-6 py-12 text-center text-gray-500 dark:text-gray-400"
                        >
                          No audit data available. Run an audit to see visibility data.
                        </td>
                      </tr>
                    ) : (
                      visibilityData.map((row) => (
                        <tr
                          key={row.prompt_id}
                          className="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750"
                        >
                          <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-100 max-w-md sticky left-0 bg-white dark:bg-gray-800 z-10">
                            <button
                              onClick={() => navigate(`/projects/${id}/prompts/${row.prompt_id}`)}
                              className="text-left hover:text-[rgb(126,34,206)] dark:hover:text-purple-400 transition-colors cursor-pointer"
                            >
                              {row.prompt_text}
                            </button>
                          </td>
                          <td className="px-6 py-4 text-sm">
                            <span className="px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded-lg text-xs text-gray-900 dark:text-gray-100">
                              {row.prompt_group}
                            </span>
                          </td>
                          {llmList.map((llm) => {
                            const response = row.llm_responses.find((r) => r.llm_name === llm);

                            if (!response) {
                              return (
                                <React.Fragment key={llm}>
                                  <td className="px-6 py-4 text-center border-l border-gray-200 dark:border-gray-700">
                                    <span className="text-gray-400">-</span>
                                  </td>
                                  <td className="px-6 py-4 text-center">
                                    <span className="text-gray-400">-</span>
                                  </td>
                                </React.Fragment>
                              );
                            }

                            return (
                              <React.Fragment key={llm}>
                                <td className={`px-6 py-4 text-center border-l border-gray-200 dark:border-gray-700 ${
                                  response.brand_mentioned
                                    ? 'bg-green-50 dark:bg-green-950/30'
                                    : 'bg-red-50 dark:bg-red-950/30'
                                }`}>
                                  {response.brand_mentioned ? (
                                    <CheckCircle2 className="w-5 h-5 text-green-500 mx-auto" />
                                  ) : (
                                    <XCircle className="w-5 h-5 text-red-500 mx-auto" />
                                  )}
                                </td>
                                <td className={`px-6 py-4 text-center ${
                                  response.domain_cited
                                    ? 'bg-green-50 dark:bg-green-950/30'
                                    : 'bg-red-50 dark:bg-red-950/30'
                                }`}>
                                  {response.domain_cited ? (
                                    <CheckCircle2 className="w-5 h-5 text-green-500 mx-auto" />
                                  ) : (
                                    <XCircle className="w-5 h-5 text-red-500 mx-auto" />
                                  )}
                                </td>
                              </React.Fragment>
                            );
                          })}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Legend */}
            <div className="mt-6 bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">
                Legend
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div className="flex items-center">
                  <CheckCircle2 className="w-5 h-5 text-green-500 mr-3" />
                  <span className="text-gray-700 dark:text-gray-300">
                    Brand mentioned / Domain cited
                  </span>
                </div>
                <div className="flex items-center">
                  <XCircle className="w-5 h-5 text-red-500 mr-3" />
                  <span className="text-gray-700 dark:text-gray-300">
                    Brand not mentioned / Domain not cited
                  </span>
                </div>
                <div className="flex items-center">
                  <span className="text-gray-400 mr-3 font-medium">-</span>
                  <span className="text-gray-700 dark:text-gray-300">
                    No audit data available for this LLM
                  </span>
                </div>
              </div>
            </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
};
