#!/usr/bin/env -S deno run --allow-net --allow-env

/**
 * BrightData API Test Script (Deno/TypeScript version)
 *
 * Usage:
 *   deno run --allow-net --allow-env scripts/test-brightdata.ts searchgpt "What are the best CRM tools?"
 *   deno run --allow-net --allow-env scripts/test-brightdata.ts perplexity "How to improve SEO?"
 */

const BRIGHTDATA_API_KEY = Deno.env.get('BRIGHTDATA_API_KEY');
const DEFAULT_COUNTRY = 'US';

interface LLMConfig {
  url: string;
  payload: Record<string, any>[];
}

interface BrightDataTriggerResponse {
  snapshot_id: string;
}

interface Citation {
  url: string;
  text?: string;
  title?: string;
}

interface Source {
  url: string;
  title?: string;
  description?: string;
  snippet?: string;
}

interface Link {
  url: string;
  text?: string;
  position?: number;
}

interface BrightDataResult {
  url?: string;
  timestamp?: string;
  answer_text?: string;
  answer_text_markdown?: string;
  web_search_query?: string;
  citations?: Citation[];
  sources?: Source[];
  links_attached?: Link[];
  is_map?: boolean;
  shopping_visible?: boolean;
  shopping?: any;
}

if (!BRIGHTDATA_API_KEY) {
  console.error('❌ Error: BRIGHTDATA_API_KEY environment variable is not set');
  Deno.exit(1);
}

const llm = Deno.args[0];
const prompt = Deno.args[1];

if (!llm || !prompt) {
  console.error('Usage: deno run --allow-net --allow-env test-brightdata.ts <llm> <prompt>');
  console.error('Example: deno run --allow-net --allow-env test-brightdata.ts searchgpt "What are the best CRM tools?"');
  console.error('\nSupported LLMs: searchgpt, perplexity, gemini');
  Deno.exit(1);
}

function getLLMConfig(llm: string, prompt: string, country: string): LLMConfig {
  switch (llm.toLowerCase()) {
    case 'searchgpt':
      return {
        url: 'https://api.brightdata.com/datasets/v3/trigger?dataset_id=gd_m7aof0k82r803d5bjm&include_errors=true',
        payload: [{
          url: 'https://chatgpt.com/',
          prompt,
          country,
          web_search: true,
          additional_prompt: ''
        }]
      };

    case 'perplexity':
      return {
        url: 'https://api.brightdata.com/datasets/v3/trigger?dataset_id=gd_m7dhdot1vw9a7gc1n&include_errors=true',
        payload: [{
          url: 'https://www.perplexity.ai',
          prompt,
          country,
          index: Date.now()
        }]
      };

    case 'gemini':
      return {
        url: 'https://api.brightdata.com/datasets/v3/trigger?dataset_id=gd_mbz66arm2mf9cu856y&include_errors=true',
        payload: [{
          url: 'https://gemini.google.com/',
          prompt,
          index: 1
        }]
      };

    default:
      throw new Error(`Unsupported LLM: ${llm}. Use: searchgpt, perplexity, or gemini`);
  }
}

async function triggerQuery(llm: string, prompt: string, country: string): Promise<string> {
  console.log(`\n🚀 Triggering ${llm} query...`);
  console.log(`📝 Prompt: "${prompt}"`);
  console.log(`🌍 Country: ${country}\n`);

  const config = getLLMConfig(llm, prompt, country);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);

  try {
    const response = await fetch(config.url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${BRIGHTDATA_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(config.payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`BrightData API error: ${response.status} ${response.statusText}\n${errorText}`);
    }

    const data: BrightDataTriggerResponse = await response.json();
    console.log(`✅ Query triggered successfully!`);
    console.log(`📸 Snapshot ID: ${data.snapshot_id}\n`);

    return data.snapshot_id;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`Timeout: Request took longer than 60 seconds`);
    }
    throw error;
  }
}

async function pollResults(llm: string, snapshotId: string, maxAttempts = 30): Promise<BrightDataResult> {
  console.log(`⏳ Polling for results (max ${maxAttempts} attempts)...\n`);

  const encodedSnapshotId = encodeURIComponent(snapshotId);
  const url = `https://api.brightdata.com/datasets/v3/snapshot/${encodedSnapshotId}?format=json`;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000);

    try {
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${BRIGHTDATA_API_KEY}`,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.status === 404) {
        console.log(`⏱️  Attempt ${attempt}/${maxAttempts}: Result not ready yet, waiting 10s...`);
        await sleep(10000);
        continue;
      }

      if (!response.ok) {
        throw new Error(`BrightData snapshot API error: ${response.status}`);
      }

      const data: BrightDataResult[] = await response.json();
      const result = data[0];

      if (!result) {
        console.log(`⏱️  Attempt ${attempt}/${maxAttempts}: Result not ready yet, waiting 10s...`);
        await sleep(10000);
        continue;
      }

      console.log(`\n✅ Results received after ${attempt} attempt(s)!\n`);
      return result;

    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        console.log(`⏱️  Attempt ${attempt}/${maxAttempts}: Timeout, retrying...`);
        await sleep(5000);
        continue;
      }
      throw error;
    }
  }

  throw new Error(`Timeout: Results not available after ${maxAttempts} attempts (~${maxAttempts * 10}s)`);
}

function displayResults(llm: string, result: BrightDataResult): void {
  console.log('═'.repeat(80));
  console.log(`📊 RESULTS FOR ${llm.toUpperCase()}`);
  console.log('═'.repeat(80));

  console.log(`\n📍 URL: ${result.url || 'N/A'}`);
  console.log(`⏰ Timestamp: ${result.timestamp || 'N/A'}`);

  if (result.web_search_query) {
    console.log(`🔍 Web Search Query: ${result.web_search_query}`);
  }

  console.log(`\n💬 ANSWER:\n`);
  console.log(result.answer_text || result.answer_text_markdown || 'No answer available');

  if (llm.toLowerCase() === 'searchgpt' && result.citations && result.citations.length > 0) {
    console.log(`\n📚 CITATIONS (${result.citations.length}):`);
    result.citations.forEach((citation, index) => {
      console.log(`  ${index + 1}. ${citation.text || citation.title}`);
      console.log(`     🔗 ${citation.url}`);
    });
  }

  if (llm.toLowerCase() === 'perplexity' && result.sources && result.sources.length > 0) {
    console.log(`\n📚 SOURCES (${result.sources.length}):`);
    result.sources.forEach((source, index) => {
      console.log(`  ${index + 1}. ${source.title || source.description || 'No title'}`);
      console.log(`     🔗 ${source.url}`);
    });
  }

  if (llm.toLowerCase() === 'gemini' && result.links_attached && result.links_attached.length > 0) {
    console.log(`\n📚 LINKS (${result.links_attached.length}):`);
    result.links_attached.forEach((link, index) => {
      console.log(`  ${index + 1}. ${link.text || 'No text'}`);
      console.log(`     🔗 ${link.url}`);
    });
  }

  console.log('\n' + '═'.repeat(80));

  console.log(`\n🔧 METADATA:`);
  console.log(`  - Is Map: ${result.is_map || false}`);
  console.log(`  - Shopping Visible: ${result.shopping_visible || false}`);
  console.log(`  - Has Shopping Data: ${result.shopping ? 'Yes' : 'No'}`);

  console.log('\n✨ Test completed successfully!\n');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  try {
    console.log('\n🔬 BrightData API Test Script (Deno/TypeScript)');
    console.log('═'.repeat(80));

    const startTime = Date.now();

    const snapshotId = await triggerQuery(llm, prompt, DEFAULT_COUNTRY);
    const result = await pollResults(llm, snapshotId);
    displayResults(llm, result);

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`⏱️  Total execution time: ${duration}s\n`);

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    Deno.exit(1);
  }
}

main();
