import React, { useState, useEffect } from 'react';
import { Clock, Save, Loader2, Calendar, Info } from 'lucide-react';
import { Button } from '../ui/Button';
import { supabase } from '../../lib/supabase';

interface ProjectScheduledAuditsSettingsProps {
  projectId: string;
  onUpdate?: () => void;
}

interface ScheduleConfig {
  scheduled_audits_enabled: boolean;
  schedule_frequency: 'daily' | 'weekly' | 'monthly' | null;
  schedule_time: string;
  schedule_day_of_week: number | null;
  schedule_day_of_month: number | null;
  schedule_timezone: string;
  schedule_llms: string[];
  next_scheduled_audit_at: string | null;
  last_scheduled_audit_at: string | null;
}

// Same catalogue as the Run Audit modal. Kept in sync manually — if an LLM is
// added there, add it here too.
const LLM_OPTIONS = [
  { id: 'searchgpt', name: 'SearchGPT', iconUrl: 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/SearchGPT.PNG' },
  { id: 'perplexity', name: 'Perplexity', iconUrl: 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/Perplexity.png' },
  { id: 'gemini', name: 'Gemini', iconUrl: 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/Gemini.png' },
  { id: 'google-ai-overview', name: 'Google AI Overview', iconUrl: 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/Google.png' },
  { id: 'google-ai-mode', name: 'Google AI Mode', iconUrl: 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/Google.png' },
  { id: 'bing-copilot', name: 'Bing Copilot', iconUrl: 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/bing_copilot.png' },
  { id: 'grok', name: 'Grok', iconUrl: 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/Grok-icon.png' },
];

// Historical default used when the column is NULL (pre-feature projects).
const DEFAULT_SCHEDULE_LLMS = ['searchgpt', 'perplexity'];

const DAYS_OF_WEEK = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
];

const TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Australia/Sydney',
];

function calculateNextScheduledRun(config: ScheduleConfig): Date {
  const now = new Date();
  const [hours, minutes] = config.schedule_time.split(':').map(Number);

  let nextRun = new Date(now);
  nextRun.setHours(hours, minutes, 0, 0);

  switch (config.schedule_frequency) {
    case 'daily':
      if (nextRun <= now) {
        nextRun.setDate(nextRun.getDate() + 1);
      }
      break;

    case 'weekly':
      const targetDay = config.schedule_day_of_week ?? 1;
      const currentDay = nextRun.getDay();
      let daysToAdd = targetDay - currentDay;

      if (daysToAdd < 0 || (daysToAdd === 0 && nextRun <= now)) {
        daysToAdd += 7;
      }

      nextRun.setDate(nextRun.getDate() + daysToAdd);
      break;

    case 'monthly':
      const targetDate = config.schedule_day_of_month ?? 1;
      nextRun.setDate(targetDate);

      if (nextRun <= now) {
        nextRun.setMonth(nextRun.getMonth() + 1);
      }

      const lastDayOfMonth = new Date(nextRun.getFullYear(), nextRun.getMonth() + 1, 0).getDate();
      if (targetDate > lastDayOfMonth) {
        nextRun.setDate(lastDayOfMonth);
      }
      break;

    default:
      nextRun.setDate(nextRun.getDate() + 1);
  }

  return nextRun;
}

export const ProjectScheduledAuditsSettings: React.FC<ProjectScheduledAuditsSettingsProps> = ({
  projectId,
  onUpdate,
}) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [config, setConfig] = useState<ScheduleConfig>({
    scheduled_audits_enabled: false,
    schedule_frequency: 'daily',
    schedule_time: '09:00',
    schedule_day_of_week: 1,
    schedule_day_of_month: 1,
    schedule_timezone: 'UTC',
    schedule_llms: DEFAULT_SCHEDULE_LLMS,
    next_scheduled_audit_at: null,
    last_scheduled_audit_at: null,
  });

  useEffect(() => {
    fetchScheduleConfig();
  }, [projectId]);

  const fetchScheduleConfig = async () => {
    try {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from('projects')
        .select('scheduled_audits_enabled, schedule_frequency, schedule_time, schedule_day_of_week, schedule_day_of_month, schedule_timezone, schedule_llms, next_scheduled_audit_at, last_scheduled_audit_at')
        .eq('id', projectId)
        .single();

      if (fetchError) throw fetchError;

      if (data) {
        setConfig({
          scheduled_audits_enabled: data.scheduled_audits_enabled ?? false,
          schedule_frequency: data.schedule_frequency || 'daily',
          schedule_time: data.schedule_time || '09:00',
          schedule_day_of_week: data.schedule_day_of_week ?? 1,
          schedule_day_of_month: data.schedule_day_of_month ?? 1,
          schedule_timezone: data.schedule_timezone || 'UTC',
          // NULL / empty = pre-feature project → historical default.
          schedule_llms: data.schedule_llms?.length ? data.schedule_llms : DEFAULT_SCHEDULE_LLMS,
          next_scheduled_audit_at: data.next_scheduled_audit_at,
          last_scheduled_audit_at: data.last_scheduled_audit_at,
        });
      }
    } catch (err: any) {
      console.error('Error fetching schedule config:', err);
      setError(err.message || 'Failed to load schedule configuration');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccessMessage(null);

      if (config.scheduled_audits_enabled && config.schedule_llms.length === 0) {
        setError('Select at least one LLM for the scheduled audit.');
        setSaving(false);
        return;
      }

      const nextRun = config.scheduled_audits_enabled
        ? calculateNextScheduledRun(config).toISOString()
        : null;

      const { error: updateError } = await supabase
        .from('projects')
        .update({
          scheduled_audits_enabled: config.scheduled_audits_enabled,
          schedule_frequency: config.schedule_frequency,
          schedule_time: config.schedule_time,
          schedule_day_of_week: config.schedule_day_of_week,
          schedule_day_of_month: config.schedule_day_of_month,
          schedule_timezone: config.schedule_timezone,
          schedule_llms: config.schedule_llms,
          next_scheduled_audit_at: nextRun,
        })
        .eq('id', projectId);

      if (updateError) throw updateError;

      setConfig(prev => ({
        ...prev,
        next_scheduled_audit_at: nextRun,
      }));

      setSuccessMessage('Schedule settings saved successfully');
      setTimeout(() => setSuccessMessage(null), 3000);

      if (onUpdate) {
        onUpdate();
      }
    } catch (err: any) {
      console.error('Error saving schedule config:', err);
      setError(err.message || 'Failed to save schedule configuration');
    } finally {
      setSaving(false);
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleString();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-brand-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-3">
        <Clock className="w-6 h-6 text-brand-primary" />
        <h3 className="text-xl font-semibold text-gray-900 dark:text-white">
          Scheduled Audits
        </h3>
      </div>

      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 flex items-start space-x-3">
        <Info className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-blue-800 dark:text-blue-200">
          <p className="font-medium mb-1">About Scheduled Audits</p>
          <p>
            Enable automated audits to run on a regular schedule. The system will automatically run audits for all groups in this project at the specified time.
          </p>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      {successMessage && (
        <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
          <p className="text-sm text-green-600 dark:text-green-400">{successMessage}</p>
        </div>
      )}

      <div className="space-y-6">
        <div className="flex items-center space-x-3">
          <input
            type="checkbox"
            id="enabled"
            checked={config.scheduled_audits_enabled}
            onChange={(e) => setConfig({ ...config, scheduled_audits_enabled: e.target.checked })}
            className="w-5 h-5 text-brand-primary focus:ring-brand-primary focus:ring-2 rounded cursor-pointer"
          />
          <label htmlFor="enabled" className="text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer">
            Enable scheduled audits
          </label>
        </div>

        {config.scheduled_audits_enabled && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Frequency
                </label>
                <select
                  value={config.schedule_frequency || 'daily'}
                  onChange={(e) => setConfig({ ...config, schedule_frequency: e.target.value as 'daily' | 'weekly' | 'monthly' })}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand-primary focus:border-transparent"
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Time
                </label>
                <input
                  type="time"
                  value={config.schedule_time}
                  onChange={(e) => setConfig({ ...config, schedule_time: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand-primary focus:border-transparent"
                />
              </div>

              {config.schedule_frequency === 'weekly' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Day of Week
                  </label>
                  <select
                    value={config.schedule_day_of_week ?? 1}
                    onChange={(e) => setConfig({ ...config, schedule_day_of_week: parseInt(e.target.value) })}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand-primary focus:border-transparent"
                  >
                    {DAYS_OF_WEEK.map(day => (
                      <option key={day.value} value={day.value}>{day.label}</option>
                    ))}
                  </select>
                </div>
              )}

              {config.schedule_frequency === 'monthly' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Day of Month
                  </label>
                  <select
                    value={config.schedule_day_of_month ?? 1}
                    onChange={(e) => setConfig({ ...config, schedule_day_of_month: parseInt(e.target.value) })}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand-primary focus:border-transparent"
                  >
                    {Array.from({ length: 31 }, (_, i) => i + 1).map(day => (
                      <option key={day} value={day}>{day}</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Timezone
                </label>
                <select
                  value={config.schedule_timezone}
                  onChange={(e) => setConfig({ ...config, schedule_timezone: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand-primary focus:border-transparent"
                >
                  {TIMEZONES.map(tz => (
                    <option key={tz} value={tz}>{tz}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                LLMs to audit
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {LLM_OPTIONS.map(llm => (
                  <label
                    key={llm.id}
                    className="flex items-center p-3 rounded-2xl border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={config.schedule_llms.includes(llm.id)}
                      onChange={() => {
                        setConfig(prev => ({
                          ...prev,
                          schedule_llms: prev.schedule_llms.includes(llm.id)
                            ? prev.schedule_llms.filter(id => id !== llm.id)
                            : [...prev.schedule_llms, llm.id],
                        }));
                      }}
                      className="w-4 h-4 text-brand-primary border-gray-300 rounded focus:ring-brand-primary"
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
                ))}
              </div>
              {config.schedule_llms.length === 0 && (
                <p className="text-xs text-red-600 dark:text-red-400 mt-2">
                  Select at least one LLM.
                </p>
              )}
            </div>

            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600 dark:text-gray-400">Next Scheduled Run:</span>
                <span className="font-medium text-gray-900 dark:text-white flex items-center space-x-2">
                  <Calendar className="w-4 h-4" />
                  <span>{formatDate(config.next_scheduled_audit_at)}</span>
                </span>
              </div>
              {config.last_scheduled_audit_at && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600 dark:text-gray-400">Last Scheduled Run:</span>
                  <span className="font-medium text-gray-900 dark:text-white">
                    {formatDate(config.last_scheduled_audit_at)}
                  </span>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <div className="flex justify-end pt-4">
        <Button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center space-x-2"
        >
          {saving ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Saving...</span>
            </>
          ) : (
            <>
              <Save className="w-4 h-4" />
              <span>Save Schedule</span>
            </>
          )}
        </Button>
      </div>
    </div>
  );
};
