#!/usr/bin/env node

/**
 * BrightData API Test Script
 *
 * Usage:
 *   node scripts/test-brightdata.js searchgpt "What are the best CRM tools for small business?"
 *   node scripts/test-brightdata.js perplexity "How to improve SEO for e-commerce?"
 */

const BRIGHTDATA_API_KEY = process.env.BRIGHTDATA_API_KEY;
const DEFAULT_COUNTRY = 'US';

if (!BRIGHTDATA_API_KEY) {
  console.error('❌ Error: BRIGHTDATA_API_KEY environment variable is not set');
  process.exit(1);
}

const llm = process.argv[2];
const prompt = process.argv[3];

if (!llm || !prompt) {
  console.error('Usage: node test-brightdata.js <llm> <prompt>');
  console.error('Example: node test-brightdata.js searchgpt "What are the best CRM tools?"');
  console.error('\nSupported LLMs: searchgpt, perplexity, gemini');
  process.exit(1);
}

// Configuration for each LLM
function getLLMConfig(llm, prompt, country) {
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

// Trigger LLM query
async function triggerQuery(llm, prompt, country) {
  console.log(`\n🚀 Triggering ${llm} query...`);
  console.log(`📝 Prompt: "${prompt}"`);
  console.log(`🌍 Country: ${country}\n`);

  const config = getLLMConfig(llm, prompt, country);

  try {
    const response = await fetch(config.url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${BRIGHTDATA_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(config.payload),
      signal: AbortSignal.timeout(60000)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`BrightData API error: ${response.status} ${response.statusText}\n${errorText}`);
    }

    const data = await response.json();
    console.log(`✅ Query triggered successfully!`);
    console.log(`📸 Snapshot ID: ${data.snapshot_id}\n`);

    return data.snapshot_id;
  } catch (error) {
    if (error.name === 'TimeoutError') {
      throw new Error(`Timeout: Request took longer than 60 seconds`);
    }
    throw error;
  }
}

// Poll for results
async function pollResults(llm, snapshotId, maxAttempts = 30) {
  console.log(`⏳ Polling for results (max ${maxAttempts} attempts)...\n`);

  const encodedSnapshotId = encodeURIComponent(snapshotId);
  const url = `https://api.brightdata.com/datasets/v3/snapshot/${encodedSnapshotId}?format=json`;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${BRIGHTDATA_API_KEY}`,
        },
        signal: AbortSignal.timeout(45000)
      });

      if (response.status === 404) {
        console.log(`⏱️  Attempt ${attempt}/${maxAttempts}: Result not ready yet, waiting 10s...`);
        await sleep(10000);
        continue;
      }

      if (!response.ok) {
        throw new Error(`BrightData snapshot API error: ${response.status}`);
      }

      const data = await response.json();
      const result = data[0];

      if (!result) {
        console.log(`⏱️  Attempt ${attempt}/${maxAttempts}: Result not ready yet, waiting 10s...`);
        await sleep(10000);
        continue;
      }

      console.log(`\n✅ Results received after ${attempt} attempt(s)!\n`);
      return result;

    } catch (error) {
      if (error.name === 'TimeoutError') {
        console.log(`⏱️  Attempt ${attempt}/${maxAttempts}: Timeout, retrying...`);
        await sleep(5000);
        continue;
      }
      throw error;
    }
  }

  throw new Error(`Timeout: Results not available after ${maxAttempts} attempts (~${maxAttempts * 10}s)`);
}

// Display results
function displayResults(llm, result) {
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

  // Display citations/sources
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

  // Additional metadata
  console.log(`\n🔧 METADATA:`);
  console.log(`  - Is Map: ${result.is_map || false}`);
  console.log(`  - Shopping Visible: ${result.shopping_visible || false}`);
  console.log(`  - Has Shopping Data: ${result.shopping ? 'Yes' : 'No'}`);

  console.log('\n✨ Test completed successfully!\n');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Main execution
(async () => {
  try {
    console.log('\n🔬 BrightData API Test Script');
    console.log('═'.repeat(80));

    const startTime = Date.now();

    // Step 1: Trigger the query
    const snapshotId = await triggerQuery(llm, prompt, DEFAULT_COUNTRY);

    // Step 2: Poll for results
    const result = await pollResults(llm, snapshotId);

    // Step 3: Display results
    displayResults(llm, result);

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`⏱️  Total execution time: ${duration}s\n`);

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
})();
