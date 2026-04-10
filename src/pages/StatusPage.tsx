import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { formatDistanceToNow, differenceInSeconds } from 'date-fns';
import {
  RefreshCw,
  CircleCheck as CheckCircle,
  Clock,
  Circle as XCircle,
  Trash2,
  TriangleAlert as AlertTriangle,
  ListFilter as Filter,
  Database,
  RotateCcw,
  ChevronDown,
  ChevronRight,
  Send,
  Radio,
  Users,
  Brain,
  Flag,
  ScrollText
} from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';

interface Audit {
  id: string;
  project_id: string;
  llms: string[];
  status: string;
  current_step?: string | null;
  pipeline_state?: string | null;
  responses_expected?: number;
  responses_received?: number;
  competitors_processed?: number;
  competitors_total?: number;
  sentiment_processed?: number;
  sentiment_total?: number;
  error_message?: string | null;
  last_activity_at?: string | null;
  progress: number;
  started_at: string | null;
  finished_at: string | null;
  processing_started_at: string | null;
  created_at: string;
  projects: {
    name: string;
    domain: string;
  };
  total_prompts?: number;
  responses_sent?: number;
  webhook_data?: {
    duration_seconds?: number;
    total_prompts?: number;
    processed_prompts?: number;
    failed_prompts?: number;
  } | null;
}

interface PipelineLog {
  state: string;
  phase: string;
  level: string;
  message: string;
  created_at: string;
}

export function StatusPage() {
  const [audits, setAudits] = useState<Audit[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingAudit, setDeletingAudit] = useState<string | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [selectedAuditForDelete, setSelectedAuditForDelete] = useState<Audit | null>(null);
  const [resultModalOpen, setResultModalOpen] = useState(false);
  const [resultMessage, setResultMessage] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [reprocessingAudit, setReprocessingAudit] = useState<string | null>(null);
  const [retryingAudit, setRetryingAudit] = useState<string | null>(null);
  const [oneSearchHealth, setOneSearchHealth] = useState<{
    status: 'checking' | 'healthy' | 'unhealthy' | 'unreachable';
    error?: string;
  }>({ status: 'checking' });
  const [expandedAuditId, setExpandedAuditId] = useState<string | null>(null);
  const [pipelineLogs, setPipelineLogs] = useState<PipelineLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const navigate = useNavigate();
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const realtimeChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const fetchAudits = useCallback(async () => {
    try {
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-audits-with-metrics`;
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        console.error('No active session');
        setAudits([]);
        return;
      }

      const headers = {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      };

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          statusFilter: statusFilter === 'all' ? undefined : statusFilter,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to fetch audits');
      }

      const { audits: auditsWithMetrics } = await response.json();
      setAudits(auditsWithMetrics || []);
    } catch (error) {
      console.error('Error fetching audits:', error);
      setAudits([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchAudits();
    checkOneSearchHealth();
  }, [fetchAudits]);

  // Separate effect for smart polling with exponential backoff - only poll when there are running audits
  useEffect(() => {
    const hasRunningAudits = audits.some(a => a.status === 'running');

    // Clear existing interval
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }

    // Only set up polling if there are running audits
    if (hasRunningAudits) {
      // Use 15 second polling interval to reduce database load (was 5s)
      // This reduces query frequency by 66% while still providing timely updates
      pollIntervalRef.current = setInterval(fetchAudits, 15000);
    }

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [audits, fetchAudits]);

  // Realtime subscription for instant audit updates
  useEffect(() => {
    const channel = supabase
      .channel('status-page-audits')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'audits',
      }, (payload) => {
        setAudits(prev => prev.map(a =>
          a.id === payload.new.id ? { ...a, ...payload.new } : a
        ));
      })
      .subscribe();
    realtimeChannelRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
      realtimeChannelRef.current = null;
    };
  }, []);

  // Fetch pipeline logs when expanding an audit
  const fetchPipelineLogs = useCallback(async (auditId: string) => {
    setLogsLoading(true);
    try {
      const { data } = await supabase
        .from('audit_pipeline_log')
        .select('state, phase, level, message, created_at')
        .eq('audit_id', auditId)
        .order('created_at', { ascending: false })
        .limit(30);
      setPipelineLogs(data || []);
    } catch {
      setPipelineLogs([]);
    } finally {
      setLogsLoading(false);
    }
  }, []);

  const toggleExpandAudit = useCallback((auditId: string) => {
    setExpandedAuditId(prev => {
      const next = prev === auditId ? null : auditId;
      if (next) fetchPipelineLogs(next);
      else setPipelineLogs([]);
      return next;
    });
  }, [fetchPipelineLogs]);

  const checkOneSearchHealth = async () => {
    try {
      const data = await import('../lib/backendApi').then(m => m.checkHealth());
      setOneSearchHealth({
        status: data.status === 'healthy' ? 'healthy' : 'unhealthy',
        error: undefined,
      });
    } catch (error) {
      console.error('Error checking OneSearch health:', error);
      setOneSearchHealth({
        status: 'unreachable',
        error: 'Failed to check health',
      });
    }
  };

  const confirmDeleteAudit = (audit: Audit) => {
    setSelectedAuditForDelete(audit);
    setDeleteModalOpen(true);
  };

  const handleDeleteAudit = async () => {
    if (!selectedAuditForDelete) return;

    setDeletingAudit(selectedAuditForDelete.id);
    setDeleteModalOpen(false);

    try {
      const { error } = await supabase
        .from('audits')
        .delete()
        .eq('id', selectedAuditForDelete.id);

      if (error) throw error;

      setAudits(prev => prev.filter(a => a.id !== selectedAuditForDelete.id));

      setResultMessage({
        type: 'success',
        message: 'Audit deleted successfully.'
      });
      setResultModalOpen(true);
    } catch (error) {
      console.error('Error deleting audit:', error);
      setResultMessage({
        type: 'error',
        message: 'Failed to delete audit. Please try again.'
      });
      setResultModalOpen(true);
    } finally {
      setDeletingAudit(null);
      setSelectedAuditForDelete(null);
    }
  };

  const handleReprocessAudit = async (auditId: string) => {
    setReprocessingAudit(auditId);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('No active session');
      }

      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/reprocess-audit-results`;
      const headers = {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      };

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ audit_id: auditId }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to reprocess audit: ${response.status} ${errorText}`);
      }

      const result = await response.json();
      await fetchAudits();

      let message = `Successfully reprocessed ${result.updated_count} of ${result.total_responses} responses.`;
      let type: 'success' | 'error' = 'success';

      if (result.updated_count === 0) {
        type = 'error';
        message = 'No responses could be reprocessed. The OneSearch job may not exist or has no results available.';
      } else if (result.failed_jobs && result.failed_jobs.length > 0) {
        message += `\n\nWarning: ${result.failed_jobs.length} job(s) failed.`;
      }

      setResultMessage({ type, message });
      setResultModalOpen(true);
    } catch (error) {
      console.error('Error reprocessing audit:', error);
      setResultMessage({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to reprocess audit data.'
      });
      setResultModalOpen(true);
    } finally {
      setReprocessingAudit(null);
    }
  };

  const handleRetryFailedPrompts = async (auditId: string) => {
    setRetryingAudit(auditId);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('No active session');
      }

      // Call retry-failed-prompts to create new jobs/snapshots for failed prompts
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/retry-failed-prompts`;
      const headers = {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      };

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ auditId }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Failed to retry prompts:', errorText);
        throw new Error(`Failed to retry prompts: ${response.status}`);
      }

      const result = await response.json();

      await fetchAudits();

      setResultMessage({
        type: 'success',
        message: result.message || `Retried ${result.retriedCount || 0} failed prompt(s). Results will be available shortly.`
      });
      setResultModalOpen(true);
    } catch (error) {
      console.error('Error retrying failed prompts:', error);
      setResultMessage({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to retry failed prompts.'
      });
      setResultModalOpen(true);
    } finally {
      setRetryingAudit(null);
    }
  };

  const getStatusDisplay = (audit: Audit): string => {
    if (audit.status === 'running') {
      const state = audit.pipeline_state || audit.current_step;
      switch (state) {
        case 'fetching':
          return 'Sending Requests';
        case 'polling':
        case 'getting_results':
          return 'Receiving Answers';
        case 'extracting_competitors':
        case 'processing_results':
          return audit.competitors_total
            ? `Competitors (${audit.competitors_processed || 0}/${audit.competitors_total})`
            : 'Extracting Competitors';
        case 'analyzing_sentiment':
        case 'sentiment_analysis':
          return audit.sentiment_total
            ? `Sentiment (${audit.sentiment_processed || 0}/${audit.sentiment_total})`
            : 'Analyzing Sentiment';
        case 'finalizing':
        case 'completing':
          return 'Finalizing';
        default:
          return 'Running';
      }
    }
    return audit.status.charAt(0).toUpperCase() + audit.status.slice(1);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'running':
        return <Clock className="w-5 h-5 text-blue-500 animate-spin" />;
      case 'failed':
        return <XCircle className="w-5 h-5 text-red-500" />;
      default:
        return null;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20';
      case 'running':
        return 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20';
      case 'failed':
        return 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20';
      default:
        return 'text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800';
    }
  };

  const formatDuration = (audit: Audit) => {
    // Use webhook duration if available
    if (audit.webhook_data?.duration_seconds !== undefined) {
      const seconds = audit.webhook_data.duration_seconds;
      if (seconds < 60) return `${seconds}s`;
      if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;

      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      return `${hours}h ${minutes}m`;
    }

    // Fall back to calculated duration
    if (!audit.started_at) return '-';

    // For terminal states (completed/failed) without finished_at, show '-'
    if ((audit.status === 'completed' || audit.status === 'failed') && !audit.finished_at) {
      return '-';
    }

    // Use finished_at for completed/failed audits, current time for running audits
    const endTime = audit.finished_at ? new Date(audit.finished_at) : new Date();
    const startTime = new Date(audit.started_at);
    const seconds = differenceInSeconds(endTime, startTime);

    if (seconds < 0) return '-';
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  };

  const formatProcessingDuration = (audit: Audit) => {
    if (!audit.processing_started_at || !audit.finished_at) return '-';
    const start = new Date(audit.processing_started_at);
    const end = new Date(audit.finished_at);
    const seconds = differenceInSeconds(end, start);
    if (seconds < 0) return '-';
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  };

  // Pipeline step definitions for the stepper
  const PIPELINE_STEPS = [
    { key: 'fetching', label: 'Fetching', icon: Send },
    { key: 'polling', label: 'Polling', icon: Radio },
    { key: 'extracting_competitors', label: 'Competitors', icon: Users },
    { key: 'analyzing_sentiment', label: 'Sentiment', icon: Brain },
    { key: 'finalizing', label: 'Finalizing', icon: Flag },
  ] as const;

  const getStepStatus = (stepKey: string, audit: Audit): 'done' | 'running' | 'pending' | 'error' => {
    const state = audit.pipeline_state || audit.current_step || '';
    if (audit.status === 'failed') {
      const stepIdx = PIPELINE_STEPS.findIndex(s => s.key === stepKey);
      const currentIdx = PIPELINE_STEPS.findIndex(s => s.key === state);
      if (stepIdx < currentIdx) return 'done';
      if (stepIdx === currentIdx) return 'error';
      return 'pending';
    }
    if (audit.status === 'completed') return 'done';
    const stepIdx = PIPELINE_STEPS.findIndex(s => s.key === stepKey);
    const currentIdx = PIPELINE_STEPS.findIndex(s => s.key === state);
    if (currentIdx < 0) return stepKey === 'fetching' && audit.status === 'running' ? 'running' : 'pending';
    if (stepIdx < currentIdx) return 'done';
    if (stepIdx === currentIdx) return 'running';
    return 'pending';
  };

  const getStepCounter = (stepKey: string, audit: Audit): string | null => {
    switch (stepKey) {
      case 'polling': {
        const exp = audit.responses_expected || 0;
        const rec = audit.responses_received || 0;
        return exp > 0 ? `${rec}/${exp}` : null;
      }
      case 'extracting_competitors': {
        const p = audit.competitors_processed || 0;
        const t = audit.competitors_total || 0;
        return t > 0 ? `${p}/${t}` : null;
      }
      case 'analyzing_sentiment': {
        const p = audit.sentiment_processed || 0;
        const t = audit.sentiment_total || 0;
        return t > 0 ? `${p}/${t}` : null;
      }
      default:
        return null;
    }
  };

  const getStalenessColor = (audit: Audit): string | null => {
    if (audit.status !== 'running' || !audit.last_activity_at) return null;
    const seconds = differenceInSeconds(new Date(), new Date(audit.last_activity_at));
    if (seconds > 120) return 'bg-red-500';
    if (seconds > 30) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  const filteredAudits = statusFilter === 'all'
    ? audits
    : audits.filter(a => a.status === statusFilter);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <LoadingSpinner size="xl" />
      </div>
    );
  }

  return (
    <div className="space-y-4 md:space-y-8">
      <div className="w-full">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
            Audit Status
          </h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            Monitor audit progress and manage results
          </p>

          {/* OneSearch API Status */}
          <div className="mt-4">
            <div className={`inline-flex items-center px-4 py-2 rounded-lg ${
              oneSearchHealth.status === 'healthy'
                ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200'
                : oneSearchHealth.status === 'checking'
                ? 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200'
                : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200'
            }`}>
              {oneSearchHealth.status === 'healthy' && (
                <>
                  <CheckCircle className="w-4 h-4 mr-2" />
                  <span className="font-medium">OneSearch API: Online</span>
                </>
              )}
              {oneSearchHealth.status === 'checking' && (
                <>
                  <Clock className="w-4 h-4 mr-2 animate-pulse" />
                  <span className="font-medium">Checking OneSearch API...</span>
                </>
              )}
              {(oneSearchHealth.status === 'unhealthy' || oneSearchHealth.status === 'unreachable') && (
                <>
                  <AlertTriangle className="w-4 h-4 mr-2" />
                  <span className="font-medium">OneSearch API: {oneSearchHealth.error || 'Offline'}</span>
                </>
              )}
              <button
                onClick={checkOneSearchHealth}
                className="ml-2 hover:opacity-70 transition-opacity"
                title="Refresh status"
              >
                <RefreshCw className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-gray-600 dark:text-gray-400" />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Filter:</span>
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm"
          >
            <option value="all">All Audits</option>
            <option value="completed">Completed</option>
            <option value="running">Running</option>
            <option value="failed">Failed</option>
          </select>
          <span className="text-sm text-gray-600 dark:text-gray-400">
            {filteredAudits.length} audit{filteredAudits.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Table */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Project
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    LLMs
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Progress
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Started
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Duration
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Processing
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Total Prompts
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Processed
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Failed Prompts
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                {filteredAudits.map((audit) => {
                  const totalPrompts = audit.total_prompts ?? 0;
                  const responsesSent = audit.responses_sent || 0;
                  const responsesReceived = audit.responses_received || 0;
                  const processedPrompts = responsesReceived;
                  const failedCount = audit.status === 'running'
                    ? 0
                    : Math.max(0, responsesSent - responsesReceived);
                  const isExpanded = expandedAuditId === audit.id;
                  const staleness = getStalenessColor(audit);

                  return (
                    <React.Fragment key={audit.id}>
                      <tr
                        className="hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer"
                        onClick={(e) => {
                          e.preventDefault();
                          toggleExpandAudit(audit.id);
                        }}
                      >
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            {isExpanded
                              ? <ChevronDown className="w-4 h-4 text-gray-400" />
                              : <ChevronRight className="w-4 h-4 text-gray-400" />
                            }
                            <div className={`inline-flex items-center px-3 py-1 rounded-full ${getStatusColor(audit.status)}`}>
                              {getStatusIcon(audit.status)}
                              <span className="ml-2 text-sm font-medium">
                                {getStatusDisplay(audit)}
                              </span>
                              {staleness && (
                                <span className={`ml-2 w-2 h-2 rounded-full ${staleness} inline-block`} title="Activity indicator" />
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                            {audit.projects?.name}
                          </div>
                          <div className="text-sm text-gray-500 dark:text-gray-400">
                            {audit.projects?.domain}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-wrap gap-1">
                            {audit.llms?.map((llm) => (
                              <span
                                key={llm}
                                className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200"
                              >
                                {llm}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-2 mr-3 max-w-[120px]">
                              <div
                                className={`h-2 rounded-full transition-all duration-300 ${
                                  audit.progress === 100
                                    ? 'bg-green-500'
                                    : audit.progress > 0
                                    ? 'bg-blue-500'
                                    : 'bg-gray-400'
                                }`}
                                style={{ width: `${audit.progress}%` }}
                              />
                            </div>
                            <span className="text-sm font-medium text-gray-700 dark:text-gray-300 min-w-[45px]">
                              {audit.progress}%
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                          {audit.started_at ? formatDistanceToNow(new Date(audit.started_at), { addSuffix: true }) : '-'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">
                          {formatDuration(audit)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                          {formatProcessingDuration(audit)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-center">
                          <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200">
                            {totalPrompts}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-center">
                          <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200">
                            {processedPrompts}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-center" onClick={(e) => e.stopPropagation()}>
                          {failedCount > 0 ? (
                            <button
                              onClick={() => handleRetryFailedPrompts(audit.id)}
                              disabled={retryingAudit === audit.id}
                              className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200 hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors disabled:opacity-50"
                              title="Click to retry failed prompts"
                            >
                              {retryingAudit === audit.id ? (
                                <LoadingSpinner size="sm" />
                              ) : (
                                <>
                                  {failedCount}
                                  <RotateCcw className="w-3 h-3 ml-1" />
                                </>
                              )}
                            </button>
                          ) : (
                            <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
                              0
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-2">
                            {(audit.responses_sent || 0) > 0 && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  if (oneSearchHealth.status !== 'healthy') {
                                    setResultMessage({
                                      type: 'error',
                                      message: `OneSearch API is currently ${oneSearchHealth.status}. Please check the API status before reprocessing.`
                                    });
                                    setResultModalOpen(true);
                                    return;
                                  }
                                  handleReprocessAudit(audit.id);
                                }}
                                disabled={reprocessingAudit === audit.id}
                                className={`${
                                  oneSearchHealth.status !== 'healthy'
                                    ? 'text-gray-400 hover:text-gray-500'
                                    : 'text-blue-600 hover:text-blue-700'
                                }`}
                                title={
                                  oneSearchHealth.status !== 'healthy'
                                    ? `OneSearch API is ${oneSearchHealth.status}`
                                    : 'Reprocess audit data from OneSearch API'
                                }
                              >
                                {reprocessingAudit === audit.id ? (
                                  <LoadingSpinner size="sm" />
                                ) : (
                                  <Database className="w-4 h-4" />
                                )}
                              </Button>
                            )}
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => confirmDeleteAudit(audit)}
                              disabled={deletingAudit === audit.id}
                              className="text-red-600 hover:text-red-700 hover:border-red-600"
                            >
                              {deletingAudit === audit.id ? (
                                <LoadingSpinner size="sm" />
                              ) : (
                                <Trash2 className="w-4 h-4" />
                              )}
                            </Button>
                          </div>
                        </td>
                      </tr>

                      {/* Expanded detail row */}
                      {isExpanded && (
                        <tr>
                          <td colSpan={11} className="px-6 py-4 bg-gray-50 dark:bg-gray-900/50">
                            <div className="space-y-4">
                              {/* Pipeline Steps */}
                              <div>
                                <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Pipeline Steps</h4>
                                <div className="flex items-center gap-1">
                                  {PIPELINE_STEPS.map((step, idx) => {
                                    const status = getStepStatus(step.key, audit);
                                    const counter = getStepCounter(step.key, audit);
                                    const Icon = step.icon;
                                    const colors = {
                                      done: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 border-green-300 dark:border-green-700',
                                      running: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-700',
                                      pending: 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 border-gray-200 dark:border-gray-700',
                                      error: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 border-red-300 dark:border-red-700',
                                    };
                                    return (
                                      <React.Fragment key={step.key}>
                                        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${colors[status]} transition-all`}>
                                          <Icon className={`w-4 h-4 ${status === 'running' ? 'animate-pulse' : ''}`} />
                                          <span className="text-xs font-medium">{step.label}</span>
                                          {counter && (
                                            <span className="text-xs opacity-75">{counter}</span>
                                          )}
                                          {status === 'done' && <CheckCircle className="w-3 h-3" />}
                                        </div>
                                        {idx < PIPELINE_STEPS.length - 1 && (
                                          <div className={`w-6 h-px ${status === 'done' ? 'bg-green-400' : 'bg-gray-300 dark:bg-gray-600'}`} />
                                        )}
                                      </React.Fragment>
                                    );
                                  })}
                                </div>
                              </div>

                              {/* Error message */}
                              {audit.error_message && (
                                <div className="bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 rounded-lg p-3">
                                  <div className="flex items-start gap-2">
                                    <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                                    <p className="text-sm text-red-700 dark:text-red-300 whitespace-pre-wrap">{audit.error_message}</p>
                                  </div>
                                </div>
                              )}

                              {/* Counters row */}
                              <div className="grid grid-cols-3 gap-4">
                                <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
                                  <div className="text-xs text-gray-500 dark:text-gray-400">Responses</div>
                                  <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                                    {audit.responses_received || 0} / {audit.responses_expected || '—'}
                                  </div>
                                </div>
                                <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
                                  <div className="text-xs text-gray-500 dark:text-gray-400">Competitors Extracted</div>
                                  <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                                    {audit.competitors_processed || 0} / {audit.competitors_total || '—'}
                                  </div>
                                </div>
                                <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
                                  <div className="text-xs text-gray-500 dark:text-gray-400">Sentiment Analyzed</div>
                                  <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                                    {audit.sentiment_processed || 0} / {audit.sentiment_total || '—'}
                                  </div>
                                </div>
                              </div>

                              {/* Pipeline Log */}
                              <div>
                                <div className="flex items-center gap-2 mb-2">
                                  <ScrollText className="w-4 h-4 text-gray-500" />
                                  <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Pipeline Log</h4>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); fetchPipelineLogs(audit.id); }}
                                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                                    title="Refresh logs"
                                  >
                                    <RefreshCw className="w-3 h-3" />
                                  </button>
                                </div>
                                {logsLoading ? (
                                  <div className="flex justify-center py-4"><LoadingSpinner size="sm" /></div>
                                ) : pipelineLogs.length === 0 ? (
                                  <p className="text-xs text-gray-400 dark:text-gray-500 py-2">No pipeline log entries</p>
                                ) : (
                                  <div className="max-h-48 overflow-y-auto space-y-1">
                                    {pipelineLogs.map((log, i) => (
                                      <div key={i} className="flex items-start gap-2 text-xs font-mono">
                                        <span className="text-gray-400 whitespace-nowrap min-w-[140px]">
                                          {new Date(log.created_at).toLocaleString()}
                                        </span>
                                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${
                                          log.level === 'error'
                                            ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                                            : log.level === 'warning'
                                            ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300'
                                            : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                                        }`}>
                                          {log.level}
                                        </span>
                                        <span className="text-gray-500 dark:text-gray-400">[{log.state}/{log.phase}]</span>
                                        <span className="text-gray-700 dark:text-gray-300 break-all">{log.message}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>

                              {/* Go to project link */}
                              <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
                                <button
                                  onClick={(e) => { e.stopPropagation(); navigate(`/projects/${audit.project_id}`); }}
                                  className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                                >
                                  Go to project →
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {filteredAudits.length === 0 && (
            <div className="text-center py-12">
              <Clock className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
                No audits found
              </h3>
              <p className="text-gray-600 dark:text-gray-400">
                {statusFilter === 'all'
                  ? 'Run your first audit to see it here'
                  : `No ${statusFilter} audits found`}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Delete Modal */}
      <Modal
        isOpen={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        title="Delete Audit"
      >
        <div className="p-6 space-y-6">
          <div className="flex items-start space-x-4">
            <div className="flex-shrink-0 w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/20 flex items-center justify-center">
              <AlertTriangle className="w-6 h-6 text-red-600 dark:text-red-500" />
            </div>
            <div className="flex-1">
              <p className="text-gray-900 dark:text-gray-100 mb-4 text-base">
                Are you sure you want to delete this audit?
              </p>
              {selectedAuditForDelete && (
                <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-xl space-y-2 mb-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Project</span>
                    <span className="text-sm text-gray-900 dark:text-gray-100">{selectedAuditForDelete.projects?.name}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-600 dark:text-gray-400">LLMs</span>
                    <span className="text-sm text-gray-900 dark:text-gray-100">{selectedAuditForDelete.llms?.join(', ')}</span>
                  </div>
                </div>
              )}
              <div className="bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 rounded-xl p-4">
                <p className="text-sm text-red-700 dark:text-red-400">
                  <span className="font-semibold">Warning:</span> This action cannot be undone. All audit data will be permanently deleted.
                </p>
              </div>
            </div>
          </div>
          <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200 dark:border-gray-700">
            <Button
              variant="outline"
              onClick={() => setDeleteModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleDeleteAudit}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Delete Audit
            </Button>
          </div>
        </div>
      </Modal>

      {/* Result Modal */}
      <Modal
        isOpen={resultModalOpen}
        onClose={() => setResultModalOpen(false)}
        title={resultMessage?.type === 'success' ? 'Success' : 'Error'}
      >
        <div className="p-6 space-y-6">
          <div className="flex items-start space-x-4">
            <div className={`flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center ${
              resultMessage?.type === 'success'
                ? 'bg-green-100 dark:bg-green-900/20'
                : 'bg-red-100 dark:bg-red-900/20'
            }`}>
              {resultMessage?.type === 'success' ? (
                <CheckCircle className="w-6 h-6 text-green-600 dark:text-green-500" />
              ) : (
                <XCircle className="w-6 h-6 text-red-600 dark:text-red-500" />
              )}
            </div>
            <p className="text-gray-900 dark:text-gray-100 flex-1 pt-2 whitespace-pre-wrap">
              {resultMessage?.message}
            </p>
          </div>
          <div className="flex justify-end pt-4 border-t border-gray-200 dark:border-gray-700">
            <Button onClick={() => setResultModalOpen(false)}>
              Close
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
