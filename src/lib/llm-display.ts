/**
 * Shared LLM display metadata.
 *
 * Each dashboard page used to inline these tables; now consolidated
 * here so adding a new LLM updates everywhere at once.
 */

export const LLM_ICONS: Record<string, string> = {
  searchgpt: 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/SearchGPT.PNG',
  perplexity: 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/Perplexity.png',
  gemini: 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/Gemini.png',
  'google-ai-overview': 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/Google.png',
  'google-ai-mode': 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/Google.png',
  'bing-copilot': 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/bing_copilot.png',
  grok: 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/Grok-icon.png',
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
