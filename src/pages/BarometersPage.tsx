import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { supabase } from '../lib/supabase';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Telescope, Calendar } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';

const LLM_COLORS: Record<string, string> = {
  searchgpt: '#3b82f6',
  perplexity: '#8b5cf6',
  gemini: '#10b981',
  'google-ai-overview': '#ea4335',
  'google-ai-mode': '#fbbc04',
  'bing-copilot': '#00a4ef',
  grok: '#1d9bf0',
};

const LLM_NAMES: Record<string, string> = {
  searchgpt: 'SearchGPT',
  perplexity: 'Perplexity',
  gemini: 'Gemini',
  'google-ai-overview': 'Google AI Overview',
  'google-ai-mode': 'Google AI Mode',
  'bing-copilot': 'Bing Copilot',
  grok: 'Grok',
};

interface TimeSeriesData {
  date: string;
  [llm: string]: string | number | undefined;
}

export function BarometersPage() {
  const { isDarkMode } = useTheme();
  const [loading, setLoading] = useState(true);
  const [timeGranularity, setTimeGranularity] = useState<'day' | 'week' | 'month'>('day');
  const [lengthUnit, setLengthUnit] = useState<'characters' | 'words'>('characters');
  const [webSearchCountData, setWebSearchCountData] = useState<TimeSeriesData[]>([]);
  const [webSearchLengthData, setWebSearchLengthData] = useState<TimeSeriesData[]>([]);
  const [webSearchTriggerPercentageData, setWebSearchTriggerPercentageData] = useState<TimeSeriesData[]>([]);

  // State to track visible lines for each chart - default all LLMs to visible
  const defaultVisible = Object.keys(LLM_COLORS).reduce((acc, k) => ({ ...acc, [k]: true }), {} as Record<string, boolean>);
  const [visibleLinesCount, setVisibleLinesCount] = useState<{ [key: string]: boolean }>(defaultVisible);
  const [visibleLinesLength, setVisibleLinesLength] = useState<{ [key: string]: boolean }>(defaultVisible);
  const [visibleLinesTrigger, setVisibleLinesTrigger] = useState<{ [key: string]: boolean }>(defaultVisible);

  // More discreet grid color in dark mode
  const gridColor = isDarkMode ? '#374151' : '#e5e7eb';

  useEffect(() => {
    fetchBarometerData();
  }, [timeGranularity]);

  useEffect(() => {
    // Only fetch length data when unit changes (not on initial load)
    if (!loading) {
      fetchLengthData();
    }
  }, [lengthUnit]);

  const getDateTrunc = () => {
    switch (timeGranularity) {
      case 'day':
        return 'day';
      case 'week':
        return 'week';
      case 'month':
        return 'month';
    }
  };

  const fetchLengthData = async () => {
    const dateTrunc = getDateTrunc();
    const lengthFunction = lengthUnit === 'characters'
      ? 'get_web_search_length_by_time'
      : 'get_web_search_word_count_by_time';

    const { data: lengthData, error: lengthError } = await supabase
      .rpc(lengthFunction, { date_trunc_arg: dateTrunc });

    if (lengthError) {
      console.error('Error fetching web search length:', lengthError);
      setWebSearchLengthData([]);
    } else {
      const transformedLengthData = transformData(lengthData || []);
      setWebSearchLengthData(transformedLengthData);
    }
  };

  const fetchBarometerData = async () => {
    setLoading(true);

    try {
      const dateTrunc = getDateTrunc();

      // Fetch count of web search queries per LLM per time period
      const { data: countData, error: countError } = await supabase
        .rpc('get_web_search_count_by_time', { date_trunc_arg: dateTrunc });

      if (countError) {
        console.error('Error fetching web search count:', countError);
        setWebSearchCountData([]);
      } else {
        // Transform count data
        const transformedCountData = transformData(countData || []);
        setWebSearchCountData(transformedCountData);
      }

      // Fetch average length of web search queries per LLM per time period
      await fetchLengthData();

      // Fetch percentage of prompts triggering web search per LLM per time period
      const { data: triggerPercentageData, error: triggerPercentageError } = await supabase
        .rpc('get_web_search_trigger_percentage_by_time', { date_trunc_arg: dateTrunc });

      if (triggerPercentageError) {
        console.error('Error fetching web search trigger percentage:', triggerPercentageError);
        setWebSearchTriggerPercentageData([]);
      } else {
        // Transform trigger percentage data
        const transformedTriggerPercentageData = transformData(triggerPercentageData || []);
        setWebSearchTriggerPercentageData(transformedTriggerPercentageData);
      }

    } catch (error) {
      console.error('Error fetching barometer data:', error);
    } finally {
      setLoading(false);
    }
  };

  const transformData = (data: any[]): TimeSeriesData[] => {
    const dateMap: { [key: string]: TimeSeriesData } = {};

    data.forEach((row) => {
      const date = row.time_period;
      const llm = row.llm;
      const value = row.value != null ? parseFloat(row.value) : null;

      if (!dateMap[date]) {
        dateMap[date] = { date };
      }

      // Only set value if it's a valid number (skip null/NaN)
      if (value !== null && !isNaN(value)) {
        dateMap[date][llm] = value;
      }
    });

    // Only keep dates that have at least one valid data point
    return Object.values(dateMap)
      .filter(d => Object.keys(d).some(k => k !== 'date' && d[k] !== undefined))
      .sort((a, b) => (a.date as string).localeCompare(b.date as string));
  };

  const formatXAxis = (date: string) => {
    if (timeGranularity === 'week') {
      return date;
    }
    const d = new Date(date);
    if (timeGranularity === 'day') {
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
    return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  };

  // Toggle handlers for each chart
  const handleLegendClickCount = (dataKey: string) => {
    setVisibleLinesCount((prev) => ({
      ...prev,
      [dataKey]: !prev[dataKey],
    }));
  };

  const handleLegendClickLength = (dataKey: string) => {
    setVisibleLinesLength((prev) => ({
      ...prev,
      [dataKey]: !prev[dataKey],
    }));
  };

  const handleLegendClickTrigger = (dataKey: string) => {
    setVisibleLinesTrigger((prev) => ({
      ...prev,
      [dataKey]: !prev[dataKey],
    }));
  };

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700">
          <p className="font-semibold text-gray-900 dark:text-white mb-2">{label}</p>
          {payload.map((entry: any, index: number) => (
            <p key={index} style={{ color: entry.color }} className="text-sm">
              {LLM_NAMES[entry.dataKey as keyof typeof LLM_NAMES]}: {entry.value?.toFixed(2) ?? 'N/A'}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-blue-50 to-purple-50 dark:from-gray-900 dark:via-gray-900 dark:to-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="p-3 bg-gradient-to-br from-brand-primary to-brand-secondary rounded-2xl shadow-lg">
                <Telescope className="w-8 h-8 text-white" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
                  Barometers
                </h1>
                <p className="text-gray-600 dark:text-gray-400 mt-1">
                  Global insights from our data
                </p>
              </div>
            </div>

            {/* Time Granularity Selector */}
            <div className="flex items-center space-x-2 bg-white dark:bg-gray-800 rounded-xl p-1 shadow-sm">
              <Button
                variant={timeGranularity === 'day' ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setTimeGranularity('day')}
              >
                <Calendar className="w-4 h-4 mr-1" />
                Day
              </Button>
              <Button
                variant={timeGranularity === 'week' ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setTimeGranularity('week')}
              >
                <Calendar className="w-4 h-4 mr-1" />
                Week
              </Button>
              <Button
                variant={timeGranularity === 'month' ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setTimeGranularity('month')}
              >
                <Calendar className="w-4 h-4 mr-1" />
                Month
              </Button>
            </div>
          </div>
        </motion.div>

        {/* Charts */}
        <div className="space-y-6">
          {/* Chart 1: Number of Web Search Queries */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <Card>
              <CardHeader>
                <h3 className="text-xl font-semibold text-gray-900 dark:text-white">
                  Average number of fan-out queries per response
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  Average number of web search queries per response with citations by LLM over time
                </p>
              </CardHeader>
              <CardContent>
                {webSearchCountData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={400}>
                    <LineChart data={webSearchCountData}>
                      <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                      <XAxis
                        dataKey="date"
                        tickFormatter={formatXAxis}
                        stroke="#6b7280"
                      />
                      <YAxis stroke="#6b7280" />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend
                        formatter={(value) => LLM_NAMES[value as keyof typeof LLM_NAMES] || value}
                        onClick={(e) => handleLegendClickCount(e.dataKey)}
                        wrapperStyle={{ cursor: 'pointer' }}
                      />
                      {Object.keys(LLM_COLORS).map((llm) => (
                        <Line
                          key={llm}
                          type="monotone"
                          dataKey={llm}
                          stroke={LLM_COLORS[llm as keyof typeof LLM_COLORS]}
                          strokeWidth={2}
                          dot={{ r: 4 }}
                          activeDot={{ r: 6 }}
                          connectNulls
                          hide={!visibleLinesCount[llm]}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-64 text-gray-500 dark:text-gray-400">
                    No data available for the selected time period
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>

          {/* Chart 2: Length of Web Search Queries */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-xl font-semibold text-gray-900 dark:text-white">
                      Length of Web Search Queries (Fan-out)
                    </h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                      Average {lengthUnit === 'characters' ? 'character length' : 'word count'} of fan-out queries per LLM over time
                    </p>
                  </div>

                  {/* Length Unit Toggle */}
                  <div className="flex items-center space-x-2 bg-white dark:bg-gray-800 rounded-xl p-1 shadow-sm border border-gray-200 dark:border-gray-700">
                    <Button
                      variant={lengthUnit === 'characters' ? 'primary' : 'secondary'}
                      size="sm"
                      onClick={() => setLengthUnit('characters')}
                    >
                      Characters
                    </Button>
                    <Button
                      variant={lengthUnit === 'words' ? 'primary' : 'secondary'}
                      size="sm"
                      onClick={() => setLengthUnit('words')}
                    >
                      Words
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {webSearchLengthData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={400}>
                    <LineChart data={webSearchLengthData}>
                      <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                      <XAxis
                        dataKey="date"
                        tickFormatter={formatXAxis}
                        stroke="#6b7280"
                      />
                      <YAxis stroke="#6b7280" />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend
                        formatter={(value) => LLM_NAMES[value as keyof typeof LLM_NAMES] || value}
                        onClick={(e) => handleLegendClickLength(e.dataKey)}
                        wrapperStyle={{ cursor: 'pointer' }}
                      />
                      {Object.keys(LLM_COLORS).map((llm) => (
                        <Line
                          key={llm}
                          type="monotone"
                          dataKey={llm}
                          stroke={LLM_COLORS[llm as keyof typeof LLM_COLORS]}
                          strokeWidth={2}
                          dot={{ r: 4 }}
                          activeDot={{ r: 6 }}
                          connectNulls
                          hide={!visibleLinesLength[llm]}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-64 text-gray-500 dark:text-gray-400">
                    No data available for the selected time period
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>

          {/* Chart 3: Percentage of Responses Triggering Web Search */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            <Card>
              <CardHeader>
                <h3 className="text-xl font-semibold text-gray-900 dark:text-white">
                  Percentage of Responses Triggering Web Search
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  Percentage of LLM responses with citations (web search triggered) per LLM over time
                </p>
              </CardHeader>
              <CardContent>
                {webSearchTriggerPercentageData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={400}>
                    <LineChart data={webSearchTriggerPercentageData}>
                      <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                      <XAxis
                        dataKey="date"
                        tickFormatter={formatXAxis}
                        stroke="#6b7280"
                      />
                      <YAxis stroke="#6b7280" label={{ value: '%', position: 'insideLeft' }} />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend
                        formatter={(value) => LLM_NAMES[value as keyof typeof LLM_NAMES] || value}
                        onClick={(e) => handleLegendClickTrigger(e.dataKey)}
                        wrapperStyle={{ cursor: 'pointer' }}
                      />
                      {Object.keys(LLM_COLORS).map((llm) => (
                        <Line
                          key={llm}
                          type="monotone"
                          dataKey={llm}
                          stroke={LLM_COLORS[llm as keyof typeof LLM_COLORS]}
                          strokeWidth={2}
                          dot={{ r: 4 }}
                          activeDot={{ r: 6 }}
                          connectNulls
                          hide={!visibleLinesTrigger[llm]}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-64 text-gray-500 dark:text-gray-400">
                    No data available for the selected time period
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
