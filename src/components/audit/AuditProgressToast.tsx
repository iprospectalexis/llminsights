import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Progress } from '../ui/Progress';
import { Button } from '../ui/Button';
import { supabase } from '../../lib/supabase';
import { CheckCircle, Clock, AlertCircle, Loader2, X, Eye } from 'lucide-react';
import { AuditProgressModal } from './AuditProgressModal';

const LLM_ICONS: Record<string, string> = {
  searchgpt: 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/SearchGPT.PNG',
  perplexity: 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/Perplexity.png',
  gemini: 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/Gemini.png',
  'google-ai-overview': 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/Google.png',
  'google-ai-mode': 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/Google.png',
  'bing-copilot': 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/bing_copilot.png',
  grok: 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/Grok-icon.png',
};

interface AuditProgressToastProps {
  auditId: string;
  onCompleted: () => void;
  onClose: () => void;
}

const pipelineLabels: Record<string, string> = {
  created: 'Preparing audit...',
  fetching: 'Sending requests to LLMs...',
  polling: 'Receiving LLM answers...',
  extracting_competitors: 'Extracting competitors...',
  analyzing_sentiment: 'Analyzing sentiment...',
  finalizing: 'Computing metrics...',
  completed: 'Audit completed',
  failed: 'Audit failed',
};

const stepLabels: Record<string, string> = {
  fetch: 'Sending requests',
  parse: 'Receiving answers',
  competitors: 'Extracting competitors',
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
  const [steps, setSteps] = useState<any[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  const [showModal, setShowModal] = useState(false);

  const isCompleted = audit?.status === 'completed' || audit?.status === 'failed';

  const getProgressLabel = () => {
    if (!audit) return 'Initializing...';
    const state = audit.pipeline_state || audit.current_step;
    if (!state) return 'Preparing audit...';

    // Add counters to label
    if (state === 'polling' && audit.responses_expected > 0) {
      return `Receiving answers (${audit.responses_received || 0}/${audit.responses_expected})`;
    }
    if (state === 'extracting_competitors' && audit.competitors_total > 0) {
      return `Extracting competitors (${audit.competitors_processed || 0}/${audit.competitors_total})`;
    }
    if (state === 'analyzing_sentiment' && audit.sentiment_total > 0) {
      return `Analyzing sentiment (${audit.sentiment_processed || 0}/${audit.sentiment_total})`;
    }
    return pipelineLabels[state] || state;
  };

  const getProgress = () => {
    if (isCompleted) return 100;
    return audit?.progress || 0;
  };

  useEffect(() => {
    if (!auditId) return;
    setIsVisible(true);
    setAudit({ id: auditId, status: 'running', progress: 0 });

    fetchAuditData();

    // Realtime subscription for audit updates
    const channel = supabase
      .channel(`audit-toast-${auditId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'audits',
        filter: `id=eq.${auditId}`,
      }, (payload) => {
        setAudit(payload.new);
        if (payload.new.status === 'completed' || payload.new.status === 'failed') {
          fetchSteps();
          setTimeout(() => { onCompleted(); setIsVisible(false); }, 5000);
        }
      })
      .subscribe();

    // Periodic refresh for steps + counters
    const interval = setInterval(() => {
      fetchAuditData();
      fetchSteps();
    }, 15000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [auditId]);

  const fetchAuditData = async () => {
    const { data } = await supabase
      .from('audits')
      .select('id, status, progress, llms, sentiment, pipeline_state, responses_expected, responses_received, competitors_processed, competitors_total, sentiment_processed, sentiment_total')
      .eq('id', auditId)
      .single();
    if (data) setAudit(data);
  };

  const fetchSteps = async () => {
    const { data } = await supabase
      .from('audit_steps')
      .select('step, status, message, processed_count, total_count')
      .eq('audit_id', auditId)
      .order('created_at');
    if (data) setSteps(data);
  };

  const getStepStatus = (stepName: string) => {
    const step = steps.find((s: any) => s.step === stepName);
    return step?.status || 'pending';
  };

  const getStepDetail = (stepName: string) => {
    const step = steps.find((s: any) => s.step === stepName);
    if (!step) return null;
    if (step.processed_count && step.total_count) {
      return `${step.processed_count}/${step.total_count}`;
    }
    return step.message || null;
  };

  if (!audit || !isVisible) return null;

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
              {isCompleted ? (
                <CheckCircle className="w-5 h-5 text-green-500" />
              ) : (
                <Loader2 className="w-5 h-5 text-brand-primary animate-spin" />
              )}
              <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                {isCompleted ? (audit?.status === 'failed' ? 'Audit Failed' : 'Audit Completed') : 'Running Audit'}
              </h3>
            </div>
            <div className="flex items-center space-x-1">
              <Button variant="ghost" size="sm" onClick={() => setShowModal(true)} className="p-1">
                <Eye className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { setIsVisible(false); onClose(); }} className="p-1">
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600 dark:text-gray-400">
                {getProgressLabel()}
              </span>
              <span className="font-medium text-brand-primary">
                {getProgress()}%
              </span>
            </div>
            <Progress value={getProgress()} />

            {/* Granular counters */}
            {audit.pipeline_state === 'polling' && audit.responses_expected > 0 && (
              <div className="text-xs text-gray-500 dark:text-gray-400">
                Responses: {audit.responses_received || 0}/{audit.responses_expected}
              </div>
            )}
            {audit.pipeline_state === 'extracting_competitors' && audit.competitors_total > 0 && (
              <div className="text-xs text-gray-500 dark:text-gray-400">
                Competitors: {audit.competitors_processed || 0}/{audit.competitors_total}
              </div>
            )}
            {audit.pipeline_state === 'analyzing_sentiment' && audit.sentiment_total > 0 && (
              <div className="text-xs text-gray-500 dark:text-gray-400">
                Sentiment: {audit.sentiment_processed || 0}/{audit.sentiment_total}
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
              {/* Steps Progress */}
              <div className="space-y-2">
                {Object.entries(stepLabels).map(([stepKey, label]) => {
                  const status = getStepStatus(stepKey) as keyof typeof stepIcons;
                  const Icon = stepIcons[status] || Clock;
                  const detail = getStepDetail(stepKey);
                  return (
                    <div key={stepKey} className="flex items-center justify-between text-xs">
                      <div className="flex items-center space-x-2">
                        <Icon className={`w-3 h-3 ${
                          status === 'done' ? 'text-green-500' :
                          status === 'running' ? 'text-blue-500 animate-spin' :
                          status === 'error' ? 'text-red-500' : 'text-gray-400'
                        }`} />
                        <span className="text-gray-600 dark:text-gray-400">{label}</span>
                      </div>
                      {detail && (
                        <span className="text-gray-500 dark:text-gray-500 text-[10px]">{detail}</span>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Per-LLM icons */}
              {audit.llms?.length > 0 && (
                <div className="flex gap-2 pt-1">
                  {audit.llms.map((llm: string) => (
                    <img key={llm} src={LLM_ICONS[llm]} alt={llm}
                      className="w-5 h-5 object-contain rounded" title={llm} />
                  ))}
                </div>
              )}
            </motion.div>
          )}

          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="w-full mt-2 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            {isExpanded ? 'Less details' : 'More details'}
          </button>
        </div>
      </motion.div>

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
