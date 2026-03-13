import React, { useState, useEffect } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { supabase } from '../../lib/supabase';
import { Brain, Search, Sparkles } from 'lucide-react';

interface RunAuditModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  onAuditStarted: (auditId: string) => void;
}

const llmOptions = [
  {
    id: 'searchgpt',
    name: 'SearchGPT',
    iconUrl: 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/SearchGPT.PNG',
    disabled: false
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    iconUrl: 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/Perplexity.png',
    disabled: false
  },
  {
    id: 'gemini',
    name: 'Gemini',
    iconUrl: 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/Gemini.png',
    disabled: true
  },
  {
    id: 'google-ai-overview',
    name: 'Google AI Overview',
    iconUrl: 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/Google.png',
    disabled: false
  },
  {
    id: 'google-ai-mode',
    name: 'Google AI Mode',
    iconUrl: 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/Google.png',
    disabled: false
  },
  {
    id: 'bing-copilot',
    name: 'Bing Copilot',
    iconUrl: 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/bing_copilot.png',
    disabled: false
  },
  {
    id: 'grok',
    name: 'Grok',
    iconUrl: 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/Grok-icon.png',
    disabled: false
  },
];

export const RunAuditModal: React.FC<RunAuditModalProps> = ({
  isOpen,
  onClose,
  projectId,
  onAuditStarted,
}) => {
  const [user, setUser] = useState<any>(null);
  const [canRunAudits, setCanRunAudits] = useState(true);
  const [selectedLlms, setSelectedLlms] = useState<string[]>(['searchgpt', 'perplexity']);
  const [enableSentiment, setEnableSentiment] = useState(true);
  const [forceWebSearch, setForceWebSearch] = useState(true);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getCurrentUser();
  }, []);

  const getCurrentUser = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      setUser(session.user);

      const { data: userProfile } = await supabase
        .from('users')
        .select('can_run_audits, role')
        .eq('id', session.user.id)
        .single();

      if (userProfile) {
        setCanRunAudits(userProfile.can_run_audits ?? true);
      }
    }
  };

  const handleLlmToggle = (llmId: string) => {
    setSelectedLlms(prev => 
      prev.includes(llmId)
        ? prev.filter(id => id !== llmId)
        : [...prev, llmId]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedLlms.length === 0) return;

    setLoading(true);

    try {
      console.log('RunAuditModal: Starting audit for project:', projectId);
      console.log('RunAuditModal: Selected LLMs:', selectedLlms);
      console.log('RunAuditModal: Enable sentiment:', enableSentiment);
      
      // Call the run-audit edge function
      const { data, error } = await supabase.functions.invoke('run-audit', {
        body: {
          projectId,
          llms: selectedLlms,
          enableSentiment,
          forceWebSearch,
        },
      });

      console.log('RunAuditModal: Edge function response:', { data, error });

      if (error) throw error;

      if (data?.success) {
        console.log('Audit started successfully:', data);
        onAuditStarted(data.auditId);
        onClose(); // Close the modal immediately
      } else {
        console.error('Audit start failed:', data);
        throw new Error(data?.error || 'Failed to start audit');
      }
    } catch (error) {
      console.error('Error starting audit:', error);
      alert(`Failed to start audit: ${error.message}. Please try again.`);
    }
    setLoading(false);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Run Audit" size="md">
      <form onSubmit={handleSubmit} className="p-6 space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
            Select LLMs
          </label>
          <div className="space-y-2">
            {llmOptions.map(llm => (
              <div key={llm.id}>
                <label
                  className={`flex items-center p-3 rounded-2xl border border-gray-200 dark:border-gray-600 transition-colors ${
                    llm.disabled
                      ? 'opacity-50 cursor-not-allowed bg-gray-100 dark:bg-gray-800'
                      : 'hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedLlms.includes(llm.id)}
                    onChange={() => handleLlmToggle(llm.id)}
                    disabled={llm.disabled}
                    className="w-4 h-4 text-brand-primary border-gray-300 rounded focus:ring-brand-primary disabled:cursor-not-allowed"
                  />
                  <img
                    src={llm.iconUrl}
                    alt={`${llm.name} icon`}
                    className="w-5 h-5 ml-3 mr-2 object-contain"
                  />
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {llm.name}
                  </span>
                </label>

                {llm.id === 'searchgpt' && selectedLlms.includes('searchgpt') && (
                  <div className="ml-8 mt-2">
                    <label className="flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={forceWebSearch}
                        onChange={(e) => setForceWebSearch(e.target.checked)}
                        className="w-4 h-4 text-brand-primary border-gray-300 rounded focus:ring-brand-primary"
                      />
                      <span className="text-xs font-medium text-gray-700 dark:text-gray-300 ml-2">
                        Force web-search
                      </span>
                    </label>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div>
          <label className="flex items-center p-3 rounded-2xl border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer transition-colors">
            <input
              type="checkbox"
              checked={enableSentiment}
              onChange={(e) => setEnableSentiment(e.target.checked)}
              className="w-4 h-4 text-brand-primary border-gray-300 rounded focus:ring-brand-primary"
            />
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100 ml-3">
              Enable Sentiment Analysis
            </span>
          </label>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 ml-3">
            Analyze the sentiment of citations using OpenAI
          </p>
        </div>

        {!canRunAudits && (
          <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-lg">
            <p className="text-sm text-yellow-800 dark:text-yellow-200">
              You do not have permission to run audits. Please contact your manager or admin to enable this feature.
            </p>
          </div>
        )}

        <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200 dark:border-gray-700">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="gradient"
            type="submit"
            loading={loading}
            disabled={selectedLlms.length === 0 || !canRunAudits}
          >
            Run the audit
          </Button>
        </div>
      </form>
    </Modal>
  );
};