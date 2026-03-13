import React, { useEffect, useState } from 'react';
import { Settings, Save, Loader2, Database, Send, TestTube } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';

type LLMName = 'SearchGPT' | 'Perplexity' | 'Gemini' | 'Google AI Overview' | 'Google AI Mode' | 'Bing Copilot' | 'Grok';
type DataProvider = 'BrightData' | 'OneSearch SERP API';
type OneSearchProvider = 'brightdata' | 'serp';

interface LLMSetting {
  id: string;
  llm_name: LLMName;
  data_provider: DataProvider;
  provider_config?: {
    provider?: OneSearchProvider;
  };
}

export const SettingsPage: React.FC = () => {
  const [settings, setSettings] = useState<LLMSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const llms: LLMName[] = ['SearchGPT', 'Perplexity', 'Gemini', 'Google AI Overview', 'Google AI Mode', 'Bing Copilot', 'Grok'];
  const dataProviders: DataProvider[] = ['BrightData', 'OneSearch SERP API'];

  const [testPrompt, setTestPrompt] = useState('best running shoes 2026');
  const [testLLM, setTestLLM] = useState<LLMName>('SearchGPT');
  const [testDataProvider, setTestDataProvider] = useState<DataProvider>('BrightData');
  const [testGeolocation, setTestGeolocation] = useState('US');
  const [testWebSearch, setTestWebSearch] = useState(true);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [testError, setTestError] = useState<string | null>(null);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from('llm_data_provider_settings')
        .select('*')
        .order('llm_name');

      if (fetchError) throw fetchError;

      setSettings(data || []);
    } catch (err: any) {
      console.error('Error fetching settings:', err);
      setError(err.message || 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  const handleProviderChange = (llmName: LLMName, provider: DataProvider) => {
    setSettings(prev =>
      prev.map(setting =>
        setting.llm_name === llmName
          ? { ...setting, data_provider: provider }
          : setting
      )
    );
  };

  const handleOneSearchProviderChange = (llmName: LLMName, oneSearchProvider: OneSearchProvider) => {
    setSettings(prev =>
      prev.map(setting =>
        setting.llm_name === llmName
          ? {
              ...setting,
              provider_config: {
                ...setting.provider_config,
                provider: oneSearchProvider
              }
            }
          : setting
      )
    );
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccessMessage(null);

      for (const setting of settings) {
        const updateData: any = {
          data_provider: setting.data_provider
        };

        // Include provider_config if it exists
        if (setting.provider_config) {
          updateData.provider_config = setting.provider_config;
        }

        const { error: updateError } = await supabase
          .from('llm_data_provider_settings')
          .update(updateData)
          .eq('llm_name', setting.llm_name);

        if (updateError) throw updateError;
      }

      setSuccessMessage('Settings saved successfully');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      console.error('Error saving settings:', err);
      setError(err.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleTestProvider = async () => {
    try {
      setTesting(true);
      setTestError(null);
      setTestResult(null);

      const payload: any = {
        prompt: testPrompt,
        llm: testLLM,
        dataProvider: testDataProvider,
      };

      if (testLLM === 'SearchGPT') {
        payload.geolocation = testGeolocation;
        payload.webSearch = testWebSearch;
      }

      const { data, error: functionError } = await supabase.functions.invoke('test-data-provider', {
        body: payload,
      });

      if (functionError) throw functionError;

      setTestResult(data);
    } catch (err: any) {
      console.error('Error testing provider:', err);
      setTestError(err.message || 'Failed to test data provider');
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-8">
        <div className="flex items-center space-x-3">
          <Settings className="w-8 h-8 text-brand-primary" />
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            Settings
          </h1>
        </div>
        <p className="mt-2 text-gray-600 dark:text-gray-400">
          Application settings and configuration
        </p>
      </div>

      {/* Data Providers Section */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8 mb-6">
        <div className="flex items-center space-x-3 mb-6">
          <Database className="w-6 h-6 text-brand-primary" />
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            Data Providers
          </h2>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-brand-primary" />
          </div>
        ) : (
          <>
            {error && (
              <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              </div>
            )}

            {successMessage && (
              <div className="mb-4 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                <p className="text-sm text-green-600 dark:text-green-400">{successMessage}</p>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className="text-left py-4 px-4 text-sm font-semibold text-gray-900 dark:text-white">
                      LLM
                    </th>
                    {dataProviders.map(provider => (
                      <th key={provider} className="text-center py-4 px-4 text-sm font-semibold text-gray-900 dark:text-white">
                        {provider}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {llms.map(llm => {
                    const setting = settings.find(s => s.llm_name === llm);
                    const selectedProvider = setting?.data_provider || 'BrightData';

                    return (
                      <tr key={llm} className="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                        <td className="py-4 px-4 text-sm font-medium text-gray-900 dark:text-white">
                          {llm}
                        </td>
                        {dataProviders.map(provider => (
                          <td key={provider} className="py-4 px-4 text-center">
                            <div className="flex justify-center">
                              <input
                                type="radio"
                                name={`provider-${llm}`}
                                checked={selectedProvider === provider}
                                onChange={() => handleProviderChange(llm, provider)}
                                className="w-5 h-5 text-brand-primary focus:ring-brand-primary focus:ring-2 cursor-pointer"
                              />
                            </div>
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* OneSearch Provider Configuration */}
            {settings.some(s => s.data_provider === 'OneSearch SERP API') && (
              <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                  OneSearch SERP API Configuration
                </h3>
                <div className="space-y-4">
                  {settings
                    .filter(s => s.data_provider === 'OneSearch SERP API')
                    .map(setting => {
                      const selectedProvider = (setting.provider_config?.provider || 'brightdata') as OneSearchProvider;
                      return (
                        <div key={setting.llm_name} className="flex items-center justify-between">
                          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                            {setting.llm_name} Provider:
                          </label>
                          <select
                            value={selectedProvider}
                            onChange={(e) => handleOneSearchProviderChange(setting.llm_name, e.target.value as OneSearchProvider)}
                            className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand-primary focus:border-transparent"
                          >
                            <option value="brightdata">BrightData</option>
                            <option value="serp">SERP</option>
                          </select>
                        </div>
                      );
                    })}
                </div>
                <p className="mt-3 text-xs text-gray-600 dark:text-gray-400">
                  Select the provider to use for OneSearch SERP API requests. BrightData and SERP are different data sources.
                </p>
              </div>
            )}

            <div className="mt-6 flex justify-end">
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
                    <span>Save Settings</span>
                  </>
                )}
              </Button>
            </div>
          </>
        )}
      </div>

      {/* Test Data Provider Section */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8 mb-6">
        <div className="flex items-center space-x-3 mb-6">
          <TestTube className="w-6 h-6 text-brand-primary" />
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            Test a Data Provider
          </h2>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Prompt
            </label>
            <Input
              type="text"
              value={testPrompt}
              onChange={(e) => setTestPrompt(e.target.value)}
              placeholder="Enter a test prompt"
              className="w-full"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                LLM
              </label>
              <select
                value={testLLM}
                onChange={(e) => setTestLLM(e.target.value as LLMName)}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand-primary focus:border-transparent"
              >
                {llms.map(llm => (
                  <option key={llm} value={llm}>{llm}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Data Provider
              </label>
              <select
                value={testDataProvider}
                onChange={(e) => setTestDataProvider(e.target.value as DataProvider)}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand-primary focus:border-transparent"
              >
                {dataProviders.map(provider => (
                  <option key={provider} value={provider}>{provider}</option>
                ))}
              </select>
            </div>
          </div>

          {testLLM === 'SearchGPT' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Geolocation
                </label>
                <Input
                  type="text"
                  value={testGeolocation}
                  onChange={(e) => setTestGeolocation(e.target.value)}
                  placeholder="e.g., US, UK, FR"
                  className="w-full"
                />
              </div>

              <div className="flex items-center">
                <label className="flex items-center space-x-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={testWebSearch}
                    onChange={(e) => setTestWebSearch(e.target.checked)}
                    className="w-5 h-5 text-brand-primary focus:ring-brand-primary focus:ring-2 rounded cursor-pointer"
                  />
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Enable Web Search
                  </span>
                </label>
              </div>
            </div>
          )}

          {testError && (
            <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <p className="text-sm text-red-600 dark:text-red-400">{testError}</p>
            </div>
          )}

          {testResult && (
            <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
              <h3 className="text-sm font-semibold text-green-900 dark:text-green-100 mb-2">
                Test Result
              </h3>
              <pre className="text-xs text-green-800 dark:text-green-200 overflow-x-auto whitespace-pre-wrap">
                {JSON.stringify(testResult, null, 2)}
              </pre>
            </div>
          )}

          <div className="flex justify-end">
            <Button
              onClick={handleTestProvider}
              disabled={testing || !testPrompt}
              className="flex items-center space-x-2"
            >
              {testing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Testing...</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>Send</span>
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
