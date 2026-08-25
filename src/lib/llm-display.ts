/**
 * Shared LLM display metadata.
 *
 * Each dashboard page used to inline these tables; now consolidated
 * here so adding a new LLM updates everywhere at once.
 */

// Served from our own /public — the previous raw.githubusercontent.com URLs
// were blocked by some corporate proxies, leaving every LLM icon blank.
export const LLM_ICONS: Record<string, string> = {
  searchgpt: '/llm/searchgpt.png',
  perplexity: '/llm/perplexity.png',
  gemini: '/llm/gemini.png',
  'google-ai-overview': '/llm/google-ai-overview.png',
  'google-ai-mode': '/llm/google-ai-mode.png',
  'bing-copilot': '/llm/bing-copilot.png',
  grok: '/llm/grok.png',
};

const LLM_DISPLAY_NAME: Record<string, string> = {
  searchgpt: 'SearchGPT',
  perplexity: 'Perplexity',
  gemini: 'Gemini',
  'google-ai-overview': 'Google AI',
  'google-ai-mode': 'Google AI Mode',
  'bing-copilot': 'Bing Copilot',
  grok: 'Grok',
};

export const getLlmDisplayName = (llm: string): string =>
  LLM_DISPLAY_NAME[llm] ?? llm;
