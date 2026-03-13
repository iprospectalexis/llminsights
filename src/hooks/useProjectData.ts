import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export const useProjectData = (projectId: string | undefined) => {
  const [project, setProject] = useState<any>(null);
  const [citations, setCitations] = useState<any[]>([]);
  const [prompts, setPrompts] = useState<any[]>([]);
  const [llmResponses, setLlmResponses] = useState<any[]>([]);
  const [brands, setBrands] = useState<any[]>([]);
  const [competitors, setCompetitors] = useState<any[]>([]);
  const [auditsData, setAuditsData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [processedCitations, setProcessedCitations] = useState<any[]>([]);
  const [runningAuditInfo, setRunningAuditInfo] = useState<{status: string, currentStep: string} | null>(null);

  const fetchProjectData = async () => {
    if (!projectId) return;

    try {
      setLoading(true);

      // Parallelize independent queries and add limits to prevent excessive data fetching
      const [
        { data: projectData, error: projectError },
        { data: auditsDataResult, error: auditsError },
        { data: brandsData, error: brandsError },
        { data: promptsData, error: promptsError },
        { data: responsesData, error: responsesError },
        { data: citationsData, error: citationsError }
      ] = await Promise.all([
        // Fetch project details
        supabase
          .from('projects')
          .select('*')
          .eq('id', projectId)
          .single(),

        // Fetch recent audits (limit to last 50)
        supabase
          .from('audits')
          .select('*')
          .eq('project_id', projectId)
          .order('created_at', { ascending: false })
          .limit(50),

        // Fetch brands
        supabase
          .from('brands')
          .select('*')
          .eq('project_id', projectId),

        // Fetch prompts (all needed for audit functionality)
        supabase
          .from('prompts')
          .select('*')
          .eq('project_id', projectId),

        // Fetch recent LLM responses (limit to last 500)
        supabase
          .from('llm_responses')
          .select(`
            *,
            prompts (
              id,
              prompt_text,
              prompt_group
            ),
            audits (
              id,
              created_at
            )
          `)
          .eq('project_id', projectId)
          .order('created_at', { ascending: false })
          .limit(500),

        // Fetch recent citations (limit to last 1000)
        supabase
          .from('citations')
          .select(`
            *,
            audits (
              id,
              created_at
            )
          `)
          .eq('project_id', projectId)
          .order('checked_at', { ascending: false })
          .limit(1000)
      ]);

      if (projectError) throw projectError;
      setProject(projectData);

      if (!auditsError && auditsDataResult) {
        setAuditsData(auditsDataResult);
      }

      if (!brandsError && brandsData) {
        setBrands(brandsData);
        setCompetitors(brandsData.filter((b: any) => b.is_competitor));
      }

      if (!promptsError && promptsData) {
        setPrompts(promptsData);
      }

      if (!responsesError && responsesData) {
        setLlmResponses(responsesData);
      }

      if (!citationsError && citationsData) {
        setCitations(citationsData);
        setProcessedCitations(citationsData);
      }

      // Check for running audit
      const runningAudit = auditsDataResult?.find((a: any) =>
        a.status === 'processing' || a.status === 'pending'
      );

      if (runningAudit) {
        setRunningAuditInfo({
          status: runningAudit.status,
          currentStep: runningAudit.current_step || 'Initializing...'
        });
      }

    } catch (error) {
      console.error('Error fetching project data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (projectId) {
      fetchProjectData();
    }
  }, [projectId]);

  return {
    project,
    citations,
    prompts,
    llmResponses,
    brands,
    competitors,
    auditsData,
    loading,
    processedCitations,
    runningAuditInfo,
    refetch: fetchProjectData
  };
};
