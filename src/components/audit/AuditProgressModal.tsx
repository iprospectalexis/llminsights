import React, { useEffect, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Progress } from '../ui/Progress';
import { Button } from '../ui/Button';
import { supabase } from '../../lib/supabase';
import { CheckCircle, Clock, AlertCircle, Loader2 } from 'lucide-react';

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
  fetch: 'Sending requests to LLMs',
  parse: 'Receiving answers',
  competitors: 'Retrieving competitors',
  sentiment: 'Analyzing Brand Sentiment',
  persist: 'Saving Results',
};

const stepIcons = {
  pending: Clock,
  running: Loader2,
  done: CheckCircle,
  error: AlertCircle,
};

const LLM_ICONS: Record<string, string> = {
  searchgpt: 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/SearchGPT.PNG',
  perplexity: 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/Perplexity.png',
  gemini: 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/Gemini.png',
  'google-ai-overview': 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/Google.png',
  'google-ai-mode': 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/Google.png',
  'bing-copilot': 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/bing_copilot.png',
  grok: 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/Grok-icon.png',
};

interface AuditProgressModalProps {
  isOpen: boolean;
  onClose: () => void;
  auditId: string;
}

interface AuditStep {
  step: string;
  status: string;
  message: string | null;
  processed_count: number | null;
  total_count: number | null;
}

export const AuditProgressModal: React.FC<AuditProgressModalProps> = ({
  isOpen,
  onClose,
  auditId,
}) => {
  const [audit, setAudit] = useState<any>(null);
  const [steps, setSteps] = useState<AuditStep[]>([]);
  const [loading, setLoading] = useState(true);

  const isCompleted = audit?.status === 'completed' || audit?.status === 'failed';

  useEffect(() => {
    if (!isOpen || !auditId) return;

    setLoading(true);
    fetchAll().then(() => setLoading(false));

    // Realtime subscription for audit updates
    const channel = supabase
      .channel(`audit-modal-${auditId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'audits',
        filter: `id=eq.${auditId}`,
      }, (payload) => {
        setAudit(payload.new);
        if (payload.new.status === 'completed' || payload.new.status === 'failed') {
          fetchSteps();
        }
      })
      .subscribe();

    // Periodic refresh for steps + counters
    const interval = setInterval(() => {
      fetchAll();
    }, 15000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [isOpen, auditId]);

  const fetchAll = async () => {
    await Promise.all([fetchAudit(), fetchSteps()]);
  };

  const fetchAudit = async () => {
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

  const getProgressLabel = () => {
    if (!audit) return 'Initializing...';
    const state = audit.pipeline_state || audit.current_step;
    if (!state) return 'Preparing audit...';

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

  const getStepStatus = (stepName: string) => {
    const step = steps.find(s => s.step === stepName);
    return step?.status || 'pending';
  };

  const getStepDetail = (stepName: string) => {
    const step = steps.find(s => s.step === stepName);
    if (!step) return null;
    if (step.processed_count && step.total_count) {
      return `${step.processed_count}/${step.total_count}`;
    }
    return step.message || null;
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
            {isCompleted ? (
              <CheckCircle className="w-8 h-8 text-green-500" />
            ) : (
              <Loader2 className="w-8 h-8 text-brand-primary animate-spin" />
            )}
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {isCompleted
                ? (audit?.status === 'failed' ? 'Audit Failed' : 'Audit Completed')
                : 'Processing Audit'}
            </h2>
          </div>

          <div className="text-3xl font-bold text-brand-primary mb-2">
            {getProgress()}%
          </div>
          <Progress value={getProgress()} className="mb-2" />
          <div className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            {getProgressLabel()}
          </div>

          {/* Counters grid */}
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-3">
              <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                {audit?.responses_received || 0}
              </div>
              <div className="text-blue-700 dark:text-blue-300">
                / {audit?.responses_expected || 0} Responses
              </div>
            </div>
            <div className="bg-purple-50 dark:bg-purple-900/20 rounded-xl p-3">
              <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">
                {audit?.competitors_processed || 0}
              </div>
              <div className="text-purple-700 dark:text-purple-300">
                / {audit?.competitors_total || 0} Competitors
              </div>
            </div>
            <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-3">
              <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                {audit?.sentiment_processed || 0}
              </div>
              <div className="text-amber-700 dark:text-amber-300">
                / {audit?.sentiment_total || 0} Sentiment
              </div>
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
              const status = getStepStatus(stepKey) as keyof typeof stepIcons;
              const Icon = stepIcons[status] || Clock;
              const detail = getStepDetail(stepKey);

              return (
                <div key={stepKey} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-xl">
                  <div className="flex items-center space-x-3">
                    <Icon
                      className={`w-5 h-5 ${
                        status === 'done' ? 'text-green-500' :
                        status === 'running' ? 'text-blue-500 animate-spin' :
                        status === 'error' ? 'text-red-500' : 'text-gray-400'
                      }`}
                    />
                    <span className="font-medium text-gray-900 dark:text-gray-100">{label}</span>
                  </div>
                  {detail && (
                    <span className="text-sm text-gray-500 dark:text-gray-400">{detail}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Per-LLM icons */}
        {audit?.llms?.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">LLMs</h3>
            <div className="flex gap-3">
              {audit.llms.map((llm: string) => (
                <div key={llm} className="flex items-center space-x-2 bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2">
                  <img src={LLM_ICONS[llm]} alt={llm}
                    className="w-5 h-5 object-contain rounded" />
                  <span className="text-sm text-gray-700 dark:text-gray-300 capitalize">{llm}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Completion Message */}
        {isCompleted && audit?.status === 'completed' && (
          <div className="text-center p-6 bg-green-50 dark:bg-green-900/20 rounded-2xl border border-green-200 dark:border-green-700">
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
            <h3 className="text-xl font-bold text-green-700 dark:text-green-400 mb-2">
              Audit Completed Successfully!
            </h3>
            <p className="text-green-600 dark:text-green-300">
              {audit.responses_received || 0} responses processed
            </p>
          </div>
        )}

        {isCompleted && audit?.status === 'failed' && (
          <div className="text-center p-6 bg-red-50 dark:bg-red-900/20 rounded-2xl border border-red-200 dark:border-red-700">
            <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-3" />
            <h3 className="text-xl font-bold text-red-700 dark:text-red-400 mb-2">
              Audit Failed
            </h3>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200 dark:border-gray-700">
          <Button variant="secondary" onClick={onClose}>
            {isCompleted ? 'Close' : 'Close & Run in Background'}
          </Button>
          {isCompleted && audit?.status === 'completed' && (
            <Button variant="gradient" onClick={onClose}>
              View Results
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
};
