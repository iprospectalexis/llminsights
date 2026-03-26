import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Progress } from '../ui/Progress';
import { Button } from '../ui/Button';
import { supabase } from '../../lib/supabase';
import { CheckCircle, Clock, AlertCircle, Loader2, X, Eye } from 'lucide-react';
import { AuditProgressModal } from './AuditProgressModal';

const LLM_ICONS = {
  searchgpt: 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/SearchGPT.PNG',
  perplexity: 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/Perplexity.png',
  gemini: 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/Gemini.png',
};

interface AuditProgressToastProps {
  auditId: string;
  onCompleted: () => void;
  onClose: () => void;
}

interface AuditStep {
  step: 'fetch' | 'parse' | 'sentiment' | 'persist';
  status: 'pending' | 'running' | 'done' | 'error';
  message?: string;
}

const stepLabels = {
  fetch: 'Fetching LLM data',
  parse: 'Parsing citations',
  competitors: 'Retrieving competitors',
  sentiment: 'Analyzing sentiment',
  persist: 'Saving results',
};

const stepIcons = {
  pending: Clock,
  running: Loader2,
  done: CheckCircle,
  error: AlertCircle,
};

export const AuditProgressToast: React.FC<AuditProgressToastProps> = ({
  auditId,
  onCompleted,
  onClose,
}) => {
  const [audit, setAudit] = useState<any>(null);
  const [steps, setSteps] = useState<AuditStep[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [llmResponses, setLlmResponses] = useState<any[]>([]);
  const [citations, setCitations] = useState<any[]>([]);
  const [isVisible, setIsVisible] = useState(true);
  const [showModal, setShowModal] = useState(false);

  // Helper function to check if audit is actually completed
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

    // Also check if all LLM responses have been processed (including errors)
    const allResponsesProcessed = llmResponses.length > 0 && llmResponses.filter(r => {
      const hasData = r.raw_response_data && Object.keys(r.raw_response_data).length > 0;
      return hasData; // Either successful or failed, but processed
    }).length === llmResponses.length;

    console.log('AuditProgressToast: Completion check:', {
      allStepsCompleted,
      allResponsesProcessed,
      completedCount: llmResponses.filter(r => r.raw_response_data && Object.keys(r.raw_response_data).length > 0).length,
      total: llmResponses.length,
      status: audit?.status
    });

    // Audit is completed only when all steps are done AND all responses are processed
    return allStepsCompleted && allResponsesProcessed;
  };

  const getOverallProgress = () => {
    // If audit is completed or failed, always show 100%
    if (audit?.status === 'completed' || audit?.status === 'failed') return 100;

    if (llmResponses.length > 0) {
      const completedCount = llmResponses.filter(r => {
        const hasData = r.raw_response_data && Object.keys(r.raw_response_data).length > 0;
        return hasData;
      }).length;

      const progress = Math.round((completedCount / llmResponses.length) * 100);
      console.log('AuditProgressToast: Progress calculation:', { completedCount, total: llmResponses.length, progress, auditStatus: audit?.status });

      // If all responses are completed but audit status isn't updated yet, show 100%
      if (completedCount === llmResponses.length && llmResponses.length > 0) return 100;

      return progress;
    }

    // Use audit progress from database, but ensure minimum progress for running audits
    const dbProgress = audit?.progress || 0;
    return audit?.status === 'running' ? Math.max(dbProgress, 5) : dbProgress;
  };

  const getSentimentProgress = () => {
    if (!audit?.sentiment || llmResponses.length === 0) return null;
    
    const totalResponses = llmResponses.filter(r => r.answer_text).length;
    const analyzedResponses = llmResponses.filter(r => r.sentiment_score !== null || r.sentiment_label !== null).length;
    
    return {
      total: totalResponses,
      analyzed: analyzedResponses,
      percentage: totalResponses > 0 ? Math.round((analyzedResponses / totalResponses) * 100) : 0
    };
  };
  useEffect(() => {
    if (!auditId) return;

    console.log('AuditProgressToast: Starting for audit ID:', auditId);
    setIsVisible(true);
    
    // Show toast immediately with initial state
    setAudit({
      id: auditId,
      status: 'running',
      progress: 0,
      llms: []
    });

    // Fetch initial data
    fetchAuditData();

    // Realtime for audit status only (filter by PK 'id' works reliably)
    const auditChannel = supabase
      .channel(`audit-progress-${auditId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'audits',
          filter: `id=eq.${auditId}`,
        },
        (payload) => {
          console.log('AuditProgressToast: Audit update received:', payload.new);
          setAudit(payload.new);
          if (payload.new.status === 'completed' || payload.new.status === 'failed') {
            // Final fetch to get latest data, then auto-close
            fetchAuditSteps();
            fetchLlmResponses();
            fetchCitations();
            setTimeout(() => {
              onCompleted();
              setIsVisible(false);
            }, 5000);
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
  }, [auditId]);

  // Check for completion and auto-close
  useEffect(() => {
    const completed = isAuditCompleted();

    if (completed && audit?.status !== 'completed' && audit?.status !== 'failed') {
      // Update audit status in database if it's not already marked as completed
      console.log('AuditProgressToast: All responses processed, updating audit status to completed');
      const updateAuditStatus = async () => {
        try {
          await supabase
            .from('audits')
            .update({
              status: 'completed',
              progress: 100,
              finished_at: new Date().toISOString()
            })
            .eq('id', auditId);

          // Update local state immediately
          setAudit(prev => ({ ...prev, status: 'completed', progress: 100 }));
        } catch (error) {
          console.error('Error updating audit status:', error);
        }
      };
      updateAuditStatus();
    }

    // Auto-close after completion
    if (completed) {
      console.log('AuditProgressToast: Audit completed, scheduling auto-close');
      const timer = setTimeout(() => {
        console.log('AuditProgressToast: Auto-closing after completion');
        onCompleted();
        setIsVisible(false);
      }, 5000);

      return () => clearTimeout(timer);
    }
  }, [llmResponses, audit?.status, auditId]);

  const fetchAuditData = async () => {
    console.log('AuditProgressToast: Fetching audit data for:', auditId);
    const { data, error } = await supabase
      .from('audits')
      .select('id, status, progress, llms, sentiment, created_at')
      .eq('id', auditId)
      .single();
    
    if (error) {
      console.error('AuditProgressToast: Error fetching audit:', error);
      // If audit doesn't exist yet, keep the initial state
      return;
    }
    
    console.log('AuditProgressToast: Audit data received:', data);
    if (data) {
      setAudit(data);
    }

    fetchAuditSteps();
    fetchLlmResponses();
    fetchCitations();
  };

  const fetchAuditSteps = async () => {
    console.log('AuditProgressToast: Fetching steps for:', auditId);
    const { data, error } = await supabase
      .from('audit_steps')
      .select('id, audit_id, step, status, message, created_at')
      .eq('audit_id', auditId)
      .order('created_at');
    
    if (error) {
      console.error('AuditProgressToast: Error fetching steps:', error);
      return;
    }
    
    console.log('AuditProgressToast: Steps received:', data);
    if (data) {
      setSteps(data);
    }
  };

  const fetchLlmResponses = async () => {
    console.log('AuditProgressToast: Fetching LLM responses for:', auditId);
    const { data } = await supabase
      .from('llm_responses')
      .select('id, llm, answer_text, raw_response_data, sentiment_score, sentiment_label, prompts(prompt_text, prompt_group)')
      .eq('audit_id', auditId)
      .order('created_at');
    
    console.log('AuditProgressToast: LLM responses received:', data);
    if (data) {
      setLlmResponses(data);
    }
  };

  const fetchCitations = async () => {
    console.log('AuditProgressToast: Fetching citations for:', auditId);
    const { data } = await supabase
      .from('citations')
      .select('id, audit_id, domain, position')
      .eq('audit_id', auditId)
      .order('position');
    
    console.log('AuditProgressToast: Citations received:', data?.length || 0);
    if (data) {
      setCitations(data);
    }
  };
  const getStepStatus = (stepName: string) => {
    const step = steps.find(s => s.step === stepName);
    return step?.status || 'pending';
  };

  const getCurrentStep = () => {
    if (!steps.length) return 'Initializing audit...';
    
    const runningStep = steps.find(s => s.status === 'running');
    if (runningStep) return stepLabels[runningStep.step];
    
    const lastDoneStep = steps.filter(s => s.status === 'done').pop();
    if (lastDoneStep) return `${stepLabels[lastDoneStep.step]} completed`;
    
    return 'Preparing audit...';
  };

  const getLlmProgress = () => {
    if (!llmResponses.length) return { completed: 0, total: 0 };
    
    const totalExpected = llmResponses.length;
    const completed = llmResponses.filter(r => {
      // Count as completed if it has answer_text OR if raw_response_data exists (success or error)
      return r.answer_text || (r.raw_response_data && Object.keys(r.raw_response_data).length > 0);
    }).length;
    
    console.log('AuditProgressToast: LLM Progress:', { completed, total: totalExpected, responses: llmResponses });
    console.log('AuditProgressToast: Response details:', llmResponses.map(r => ({
      id: r.id,
      llm: r.llm,
      hasAnswerText: !!r.answer_text,
      hasRawData: !!(r.raw_response_data && Object.keys(r.raw_response_data).length > 0),
      rawDataKeys: r.raw_response_data ? Object.keys(r.raw_response_data) : []
    })));
    
    return { completed, total: totalExpected };
  };

  if (!audit || !isVisible) return null;

  const llmProgress = getLlmProgress();
  const sentimentProgress = getSentimentProgress();

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 50, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 50, scale: 0.95 }}
        className="fixed bottom-4 right-4 z-50 w-96 bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700"
      >
        <div className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center space-x-2">
              {isAuditCompleted() ? (
                <CheckCircle className="w-5 h-5 text-green-500" />
              ) : (
                <Loader2 className="w-5 h-5 text-brand-primary animate-spin" />
              )}
              <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                {isAuditCompleted() ? 'Audit Completed' : 'Running Audit'}
              </h3>
            </div>
            <div className="flex items-center space-x-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowModal(true)}
                className="p-1"
              >
                <Eye className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setIsVisible(false);
                  onClose();
                }}
                className="p-1"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600 dark:text-gray-400">
                {isAuditCompleted() ? 'Audit completed successfully' : getCurrentStep()}
              </span>
              <span className="font-medium text-brand-primary">
                {getOverallProgress()}%
              </span>
            </div>
            <Progress value={getOverallProgress()} />
            
            {/* Show LLM progress if available */}
            {llmProgress.total > 0 && (
              <div className="text-xs text-gray-500 dark:text-gray-400">
                LLM Responses: {llmProgress.completed}/{llmProgress.total}
              </div>
            )}
            
            {/* Show sentiment progress if enabled and available */}
            {sentimentProgress && (
              <div className="text-xs text-gray-500 dark:text-gray-400">
                Sentiment Analysis: {sentimentProgress.analyzed}/{sentimentProgress.total} responses ({sentimentProgress.percentage}%)
              </div>
            )}
            
            {/* Show initial message when no steps yet */}
            {steps.length === 0 && (
              <div className="text-xs text-gray-500 dark:text-gray-400">
                Setting up audit pipeline...
              </div>
            )}
          </div>

          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="mt-4 space-y-3 border-t border-gray-200 dark:border-gray-700 pt-3"
            >
              {/* LLM Progress */}
              {llmProgress.total > 0 && (
                <div className="space-y-2">
                <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  LLM Responses: {llmProgress.completed}/{llmProgress.total}
                </div>
                {audit.llms?.map((llm: string) => {
                  const llmCount = llmResponses.filter(r => r.llm === llm && r.answer_text).length;
                  const totalForLlm = llmResponses.filter(r => r.llm === llm).length;
                  return (
                    <div key={llm} className="flex justify-between text-xs">
                      <div className="flex items-center space-x-1">
                        <img 
                          src={LLM_ICONS[llm as keyof typeof LLM_ICONS]} 
                          alt={`${llm} icon`}
                          className="w-3 h-3 object-contain"
                        />
                        <span className="capitalize text-gray-600 dark:text-gray-400">
                          {llm}
                        </span>
                      </div>
                      <span className="text-gray-900 dark:text-gray-100">
                        {llmCount}/{totalForLlm}
                      </span>
                    </div>
                  );
                })}
                </div>
              )}

              {/* Sentiment Analysis Progress */}
              {sentimentProgress && (
                <div className="space-y-2">
                  <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Sentiment Analysis: {sentimentProgress.analyzed}/{sentimentProgress.total}
                  </div>
                  <div className="bg-gray-100 dark:bg-gray-700 rounded-lg p-2">
                    <Progress value={sentimentProgress.percentage} />
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {sentimentProgress.percentage}% of citations analyzed
                    </div>
                  </div>
                </div>
              )}
              {/* Steps Progress */}
              <div className="space-y-2">
                <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Process Steps
                </div>
                {Object.entries(stepLabels).map(([stepKey, label]) => {
                  const status = getStepStatus(stepKey);
                  const Icon = stepIcons[status];
                  return (
                    <div key={stepKey} className="flex items-center space-x-2 text-xs">
                      <Icon 
                        className={`
                          w-3 h-3
                          ${status === 'done' ? 'text-green-500' : ''}
                          ${status === 'running' ? 'text-blue-500 animate-spin' : ''}
                          ${status === 'error' ? 'text-red-500' : ''}
                          ${status === 'pending' ? 'text-gray-400' : ''}
                        `}
                      />
                      <span className="text-gray-600 dark:text-gray-400">{label}</span>
                    </div>
                  );
                })}
              </div>

              {isAuditCompleted() && (
                <div className="text-center pt-2">
                  <div className="text-xs text-green-600 dark:text-green-400">
                    ✓ Audit completed successfully
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </div>
      </motion.div>

      {/* Import and use the modal */}
      {showModal && (
        <AuditProgressModal
          isOpen={showModal}
          onClose={() => setShowModal(false)}
          auditId={auditId}
        />
      )}
    </AnimatePresence>
  );
};