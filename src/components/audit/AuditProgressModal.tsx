import React, { useEffect, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Progress } from '../ui/Progress';
import { Button } from '../ui/Button';
import { supabase } from '../../lib/supabase';
import { CheckCircle, Clock, AlertCircle, Loader2, Play } from 'lucide-react';
import { motion } from 'framer-motion';

const stepLabels = {
  fetch: 'Sending requests to LLMs',
  parse: 'Receiving answers',
  competitors: 'Retrieving competitors',
  sentiment: 'Analyzing Brand Sentiment',
  persist: 'Saving Results'
};

const stepIcons = {
  pending: Clock,
  running: Loader2,
  done: CheckCircle,
  error: AlertCircle
};

const LLM_ICONS = {
  searchgpt: 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/SearchGPT.PNG',
  perplexity: 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/Perplexity.png',
  gemini: 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/Gemini.png',
};

interface AuditProgressModalProps {
  isOpen: boolean;
  onClose: () => void;
  auditId: string;
}

interface LLMResponse {
  id: string;
  llm: string;
  snapshot_id: string;
  answer_text: string | null;
  raw_response_data: any;
  prompts: {
    prompt_text: string;
    prompt_group: string;
  } | null;
}

export const AuditProgressModal: React.FC<AuditProgressModalProps> = ({
  isOpen,
  onClose,
  auditId,
}) => {
  const [audit, setAudit] = useState<any>(null);
  const [steps, setSteps] = useState<any[]>([]);
  const [llmResponses, setLlmResponses] = useState<LLMResponse[]>([]);
  const [citations, setCitations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  useEffect(() => {
    if (!isOpen || !auditId) return;

    console.log('AuditProgressModal: Starting for audit ID:', auditId);

    // Fetch initial data
    setIsInitialLoad(true);
    fetchAuditData();

    // Realtime for audit status only (filter by PK 'id' works reliably)
    const auditChannel = supabase
      .channel(`audit-modal-${auditId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'audits',
          filter: `id=eq.${auditId}`,
        },
        (payload) => {
          console.log('AuditProgressModal: Audit updated:', payload.new);
          setAudit(payload.new);
          if (payload.new.status === 'completed' || payload.new.status === 'failed') {
            // Final fetch to get latest data
            fetchAuditSteps();
            fetchLlmResponses();
            fetchCitations();
          }
        }
      )
      .subscribe();

    // Refresh UI data every 30s (read-only queries)
    // Polling is handled by the backend scheduler — no edge function invocation needed
    const dataInterval = setInterval(() => {
      fetchAuditSteps();
      fetchLlmResponses();
      fetchCitations();
    }, 30000);

    return () => {
      supabase.removeChannel(auditChannel);
      clearInterval(dataInterval);
    };
  }, [isOpen, auditId]);

  const fetchAuditData = async () => {
    if (isInitialLoad) {
      setLoading(true);
    }

    try {
      const { data: auditData } = await supabase
        .from('audits')
        .select('id, status, progress, llms, sentiment, created_at')
        .eq('id', auditId)
        .single();

      if (auditData) {
        setAudit(prev => {
          if (!prev || JSON.stringify(prev) !== JSON.stringify(auditData)) {
            return auditData;
          }
          return prev;
        });
      }

      await Promise.all([
        fetchAuditSteps(),
        fetchLlmResponses(),
        fetchCitations()
      ]);
    } catch (error) {
      console.error('Error fetching audit data:', error);
    }

    if (isInitialLoad) {
      setLoading(false);
      setIsInitialLoad(false);
    }
  };

  const fetchAuditSteps = async () => {
    const { data } = await supabase
      .from('audit_steps')
      .select('id, audit_id, step, status, message, created_at')
      .eq('audit_id', auditId)
      .order('created_at');

    if (data) {
      setSteps(prev => {
        if (JSON.stringify(prev) !== JSON.stringify(data)) {
          return data;
        }
        return prev;
      });
    }
  };
  const fetchLlmResponses = async () => {
    const { data } = await supabase
      .from('llm_responses')
      .select(`
        id,
        llm,
        snapshot_id,
        answer_text,
        raw_response_data,
        sentiment_score,
        sentiment_label,
        prompts (
          prompt_text,
          prompt_group
        )
      `)
      .eq('audit_id', auditId)
      .order('created_at');

    if (data) {
      setLlmResponses(prev => {
        if (JSON.stringify(prev) !== JSON.stringify(data)) {
          console.log('AuditProgressModal: LLM responses updated:', data);
          return data;
        }
        return prev;
      });
    }
  };

  const fetchCitations = async () => {
    const { data } = await supabase
      .from('citations')
      .select('id, audit_id, position')
      .eq('audit_id', auditId)
      .order('position');

    if (data) {
      setCitations(prev => {
        if (JSON.stringify(prev) !== JSON.stringify(data)) {
          console.log('AuditProgressModal: Citations updated:', data.length);
          return data;
        }
        return prev;
      });
    }
  };

  const getStepStatus = (stepName: string) => {
    const step = steps.find(s => s.step === stepName);
    return step?.status || 'pending';
  };

  const getSentimentProgress = () => {
    if (!audit?.sentiment || llmResponses.length === 0) return null;

    const totalResponses = llmResponses.filter(r => r.answer_text).length;
    const analyzedResponses = llmResponses.filter(r => r.sentiment_score !== null || r.sentiment_label !== null).length;

    // Ensure analyzed never exceeds total
    const cappedAnalyzed = Math.min(analyzedResponses, totalResponses);

    // Calculate percentage and cap at 100%
    const percentage = totalResponses > 0
      ? Math.min(100, Math.round((cappedAnalyzed / totalResponses) * 100))
      : 0;

    return {
      total: totalResponses,
      analyzed: cappedAnalyzed,
      percentage
    };
  };
  const getResponseStatus = (response: LLMResponse) => {
    // Check if response has been processed (either successfully or with error)
    const hasData = response.raw_response_data && Object.keys(response.raw_response_data).length > 0;
    const hasError = response.raw_response_data?.error;
    
    if (response.answer_text && hasData) return 'completed';
    if (hasError) return 'failed';
    if (hasData) return 'completed'; // Has data but no answer_text yet
    if (response.snapshot_id) return 'processing';
    return 'pending';
  };

  const getCompletedCount = () => {
    return llmResponses.filter(r => {
      const hasData = r.raw_response_data && Object.keys(r.raw_response_data).length > 0;
      return hasData; // Count as completed if raw_response_data has content
    }).length;
  };

  const getSuccessfulCount = () => {
    return llmResponses.filter(r => {
      const hasData = r.raw_response_data && Object.keys(r.raw_response_data).length > 0;
      const hasError = r.raw_response_data?.error;
      return hasData && !hasError; // Has data but no error
    }).length;
  };

  const getFailedCount = () => {
    return llmResponses.filter(r => r.raw_response_data?.error).length;
  };

  const isAuditCompleted = () => {
    // First check database status
    if (audit?.status === 'completed' || audit?.status === 'failed') return true;

    // Check if all steps are completed
    const allStepsCompleted = Object.keys(stepLabels).every(stepKey => {
      // Skip sentiment step if not enabled
      if (stepKey === 'sentiment' && !audit?.sentiment) return true;
      const status = getStepStatus(stepKey);
      return status === 'done';
    });

    // Also check if all responses are processed
    const allResponsesProcessed = llmResponses.length > 0 && getCompletedCount() === llmResponses.length;

    console.log('AuditProgressModal: Completion check:', {
      allStepsCompleted,
      allResponsesProcessed,
      completedCount: getCompletedCount(),
      total: llmResponses.length,
      status: audit?.status
    });

    // Audit is completed only when all steps are done AND all responses are processed
    return allStepsCompleted && allResponsesProcessed;
  };

  const getOverallProgress = () => {
    // If audit is completed or failed, always return 100%
    if (audit?.status === 'completed' || audit?.status === 'failed') return 100;

    // If we have responses, calculate based on completion
    if (llmResponses.length > 0) {
      const completedCount = getCompletedCount();
      const progress = Math.round((completedCount / llmResponses.length) * 100);
      console.log('AuditProgressModal: Progress calculation:', { completedCount, total: llmResponses.length, progress, auditStatus: audit?.status });

      // If all responses are completed but audit status isn't updated yet, show 100%
      if (completedCount === llmResponses.length && llmResponses.length > 0) return 100;

      return progress;
    }

    // Use database progress as fallback
    return audit?.progress || 0;
  };

  if (loading) {
    return (
      <Modal isOpen={isOpen} onClose={onClose} title="Loading Audit..." size="md">
        <div className="p-6 text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-brand-primary" />
          <p className="text-gray-600 dark:text-gray-400">Loading audit details...</p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Running Audit" size="lg">
      <div className="p-6 space-y-6">
        {/* Overall Progress */}
        <div className="text-center">
          <div className="flex items-center justify-center space-x-3 mb-4">
            {isAuditCompleted() ? (
              <CheckCircle className="w-8 h-8 text-green-500" />
            ) : (
              <Loader2 className="w-8 h-8 text-brand-primary animate-spin" />
            )}
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {isAuditCompleted() ? 'Audit Completed' : 'Processing Audit'}
            </h2>
          </div>
          
          <div className="text-3xl font-bold text-brand-primary mb-2">
            {getOverallProgress()}%
          </div>
          <Progress value={getOverallProgress()} className="mb-4" />
          
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-3">
              <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                {getCompletedCount()}
              </div>
              <div className="text-blue-700 dark:text-blue-300">Completed</div>
            </div>
            <div className="bg-green-50 dark:bg-green-900/20 rounded-xl p-3">
              <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                {getSuccessfulCount()}
              </div>
              <div className="text-green-700 dark:text-green-300">Successful</div>
            </div>
            <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-3">
              <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                {getFailedCount()}
              </div>
              <div className="text-red-700 dark:text-red-300">Failed</div>
            </div>
          </div>
        </div>

        {/* Process Steps */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Process Steps
          </h3>
          
          <div className="space-y-3">
            {Object.entries(stepLabels).map(([stepKey, label]) => {
              const status = getStepStatus(stepKey);
              const Icon = stepIcons[status];
              
              // Special handling for sentiment step
              if (stepKey === 'sentiment' && audit?.sentiment) {
                const sentimentProgress = getSentimentProgress();
                return (
                  <div key={stepKey} className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center space-x-3">
                        <Icon 
                          className={`
                            w-5 h-5
                            ${status === 'done' ? 'text-green-500' : ''}
                            ${status === 'running' ? 'text-blue-500 animate-spin' : ''}
                            ${status === 'error' ? 'text-red-500' : ''}
                            ${status === 'pending' ? 'text-gray-400' : ''}
                          `}
                        />
                        <span className="font-medium text-gray-900 dark:text-gray-100">{label}</span>
                      </div>
                      {sentimentProgress && (
                        <span className="text-sm text-gray-600 dark:text-gray-400">
                          {sentimentProgress.analyzed}/{sentimentProgress.total} responses
                        </span>
                      )}
                    </div>
                    {sentimentProgress && sentimentProgress.total > 0 && (
                      <div className="space-y-2">
                        <Progress value={sentimentProgress.percentage} />
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {sentimentProgress.percentage}% of responses analyzed for brand sentiment
                        </div>
                      </div>
                    )}
                  </div>
                );
              }
              
              return (
                <div key={stepKey} className="flex items-center space-x-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-xl">
                  <Icon 
                    className={`
                      w-5 h-5
                      ${status === 'done' ? 'text-green-500' : ''}
                      ${status === 'running' ? 'text-blue-500 animate-spin' : ''}
                      ${status === 'error' ? 'text-red-500' : ''}
                      ${status === 'pending' ? 'text-gray-400' : ''}
                    `}
                  />
                  <span className="font-medium text-gray-900 dark:text-gray-100">{label}</span>
                </div>
              );
            })}
          </div>
        </div>
        {/* LLM Responses Progress */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            LLM Responses ({getCompletedCount()}/{llmResponses.length})
          </h3>
          
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {llmResponses.map((response, index) => {
              const status = getResponseStatus(response);
              return (
                <motion.div
                  key={response.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className={`
                    flex items-center p-4 rounded-2xl border transition-all duration-200
                    ${status === 'completed' 
                      ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-700' 
                      : status === 'failed'
                      ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700'
                      : status === 'processing'
                      ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-700'
                      : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700'
                    }
                  `}
                >
                  <div className="flex items-center space-x-3 flex-1">
                    <img 
                      src={LLM_ICONS[response.llm as keyof typeof LLM_ICONS]} 
                      alt={`${response.llm} icon`}
                      className="w-6 h-6 object-contain"
                    />
                    <div className="flex-1">
                      <div className="font-medium text-gray-900 dark:text-gray-100 capitalize">
                        {response.llm}
                      </div>
                      <div className="text-sm text-gray-600 dark:text-gray-400 truncate">
                        {response.prompts?.prompt_text || 'Unknown prompt'}
                      </div>
                      {response.prompts?.prompt_group && response.prompts.prompt_group !== 'General' && (
                        <div className="text-xs text-gray-500 dark:text-gray-500">
                          Group: {response.prompts.prompt_group}
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    {status === 'completed' && (
                      <CheckCircle className="w-5 h-5 text-green-500" />
                    )}
                    {status === 'failed' && (
                      <AlertCircle className="w-5 h-5 text-red-500" />
                    )}
                    {status === 'processing' && (
                      <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
                    )}
                    {status === 'pending' && (
                      <Clock className="w-5 h-5 text-gray-400" />
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>

        {/* Citations Summary */}
        {citations.length > 0 && (
          <div className="bg-gray-50 dark:bg-gray-800 rounded-2xl p-4">
            <h4 className="font-medium text-gray-900 dark:text-gray-100 mb-2">
              Citations Found
            </h4>
            <div className="text-2xl font-bold text-brand-primary">
              {citations.length}
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-400">
              Total citations extracted from responses
            </div>
          </div>
        )}

        {/* Completion Message */}
        {isAuditCompleted() && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-center p-6 bg-green-50 dark:bg-green-900/20 rounded-2xl border border-green-200 dark:border-green-700"
          >
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
            <h3 className="text-xl font-bold text-green-700 dark:text-green-400 mb-2">
              Audit Completed Successfully!
            </h3>
            <p className="text-green-600 dark:text-green-300">
              {getSuccessfulCount()} successful responses, {getFailedCount()} failed responses
            </p>
            {citations.length > 0 && (
              <p className="text-green-600 dark:text-green-300 mt-1">
                {citations.length} citations extracted
              </p>
            )}
          </motion.div>
        )}

        {/* Actions */}
        <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200 dark:border-gray-700">
          <Button variant="secondary" onClick={onClose}>
            {isAuditCompleted() ? 'Close' : 'Close & Run in Background'}
          </Button>
          {isAuditCompleted() && (
            <Button variant="gradient" onClick={onClose}>
              View Results
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
};