import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface TestRequest {
  prompt: string;
  llm: 'SearchGPT' | 'Perplexity' | 'Gemini';
  dataProvider: 'BrightData' | 'OneSearch SERP API';
  geolocation?: string;
  webSearch?: boolean;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const body: TestRequest = await req.json();
    const { prompt, llm, dataProvider, geolocation, webSearch } = body;

    if (!prompt || !llm || !dataProvider) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: prompt, llm, or dataProvider' }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        }
      );
    }

    let result: any;

    if (dataProvider === 'BrightData') {
      result = await testBrightData(llm, prompt, geolocation, webSearch);
    } else if (dataProvider === 'OneSearch SERP API') {
      result = await testOneSearchSERP(llm, prompt, geolocation, webSearch);
    } else {
      return new Response(
        JSON.stringify({ error: 'Invalid data provider' }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        llm,
        dataProvider,
        prompt,
        result,
        timestamp: new Date().toISOString(),
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error: any) {
    console.error('Error testing data provider:', error);
    return new Response(
      JSON.stringify({
        error: error.message || 'Failed to test data provider',
        details: error.toString(),
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  }
});

async function testBrightData(
  llm: string,
  prompt: string,
  geolocation?: string,
  webSearch?: boolean
): Promise<any> {
  const brightDataApiKey = Deno.env.get('BRIGHTDATA_API_KEY');

  if (!brightDataApiKey) {
    throw new Error('BRIGHTDATA_API_KEY is not configured');
  }

  let url = '';
  let payload: any[] = [];

  if (llm === 'SearchGPT') {
    url = 'https://api.brightdata.com/datasets/v3/trigger?dataset_id=gd_m7aof0k82r803d5bjm&include_errors=true';
    payload = [{
      url: 'https://chatgpt.com/',
      prompt,
      country: geolocation || 'US',
      web_search: webSearch !== undefined ? webSearch : true,
      additional_prompt: ''
    }];
  } else if (llm === 'Perplexity') {
    url = 'https://api.brightdata.com/datasets/v3/trigger?dataset_id=gd_m7dhdot1vw9a7gc1n&include_errors=true';
    payload = [{
      url: 'https://www.perplexity.ai',
      prompt,
      country: geolocation || 'US',
      index: Date.now()
    }];
  } else if (llm === 'Gemini') {
    url = 'https://api.brightdata.com/datasets/v3/trigger?dataset_id=gd_mbz66arm2mf9cu856y&include_errors=true';
    payload = [{
      url: 'https://gemini.google.com/',
      prompt,
      index: 1
    }];
  } else {
    throw new Error(`Unsupported LLM: ${llm}`);
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${brightDataApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`BrightData API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return {
    provider: 'BrightData',
    status: 'success',
    snapshotId: data.snapshot_id,
    message: 'Test request sent successfully. Data collection initiated.',
    data,
  };
}

async function testOneSearchSERP(
  llm: string,
  prompt: string,
  geolocation?: string,
  webSearch?: boolean
): Promise<any> {
  const oneSearchApiKey = Deno.env.get('ONESEARCH_API_KEY');
  const oneSearchApiUrl = Deno.env.get('ONESEARCH_API_URL') || 'http://168.231.84.54:8000';

  if (!oneSearchApiKey) {
    throw new Error('ONESEARCH_API_KEY is not configured');
  }

  // Map LLM names to OneSearch source names
  const sourceMap: Record<string, string> = {
    'SearchGPT': 'chatgpt',
    'Perplexity': 'perplexity',
    'Gemini': 'gemini',
  };

  const source = sourceMap[llm];
  if (!source) {
    throw new Error(`Unsupported LLM: ${llm}`);
  }

  // Create a job with the test prompt
  const payload = {
    prompts: [prompt],
    geo_targeting: geolocation || 'US',
    source,
    provider: 'serp',
  };

  const createJobResponse = await fetch(`${oneSearchApiUrl}/api/v1/jobs`, {
    method: 'POST',
    headers: {
      'X-API-Key': oneSearchApiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!createJobResponse.ok) {
    const errorText = await createJobResponse.text();
    throw new Error(`OneSearch SERP API error: ${createJobResponse.status} - ${errorText}`);
  }

  const jobData = await createJobResponse.json();

  // Poll for results (max 30 attempts, 10 seconds each = 5 minutes)
  let attempts = 0;
  const maxAttempts = 30;

  while (attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds

    const statusResponse = await fetch(`${oneSearchApiUrl}/api/v1/jobs/${jobData.id}`, {
      headers: {
        'X-API-Key': oneSearchApiKey,
      },
    });

    if (!statusResponse.ok) {
      throw new Error(`Failed to check job status: ${statusResponse.status}`);
    }

    const statusData = await statusResponse.json();

    if (statusData.status === 'completed') {
      // Fetch results
      const resultsResponse = await fetch(
        `${oneSearchApiUrl}/api/v1/jobs/${jobData.id}/results?format=converted&per_page=100`,
        {
          headers: {
            'X-API-Key': oneSearchApiKey,
          },
        }
      );

      if (!resultsResponse.ok) {
        throw new Error(`Failed to fetch results: ${resultsResponse.status}`);
      }

      const resultsData = await resultsResponse.json();

      return {
        provider: 'OneSearch SERP API',
        status: 'success',
        jobId: jobData.id,
        jobStatus: statusData.status,
        progress: statusData.progress,
        message: `Test completed successfully after ${attempts + 1} attempts (${(attempts + 1) * 10}s)`,
        results: resultsData.results || resultsData,
        fullJobData: statusData,
      };
    } else if (statusData.status === 'failed') {
      throw new Error(`Job failed: ${statusData.error_message || 'Unknown error'}`);
    }

    attempts++;
    console.log(`Attempt ${attempts}/${maxAttempts}: Job status is ${statusData.status} (${statusData.progress}%)`);
  }

  // Timeout
  return {
    provider: 'OneSearch SERP API',
    status: 'timeout',
    jobId: jobData.id,
    message: `Job still processing after ${maxAttempts * 10} seconds. Job ID: ${jobData.id}. Check status manually.`,
    jobData,
  };
}
