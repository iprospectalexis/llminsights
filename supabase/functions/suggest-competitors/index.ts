const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY_MS = 2000;

async function fetchWithRetry(url: string, options: any, retries = MAX_RETRIES): Promise<Response> {
  try {
    const response = await fetch(url, options);
    // Retry on rate limiting (429) or server errors (5xx)
    if ((response.status === 429 || response.status >= 500) && retries > 0) {
      const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, MAX_RETRIES - retries) + Math.random() * 1000;
      console.log(`Request failed with status ${response.status}, retrying in ${delay}ms... (${retries} retries left)`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return fetchWithRetry(url, options, retries - 1);
    }
    return response;
  } catch (error) {
    if (retries > 0) {
      const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, MAX_RETRIES - retries) + Math.random() * 1000;
      console.log(`Request failed with error, retrying in ${delay}ms... (${retries} retries left)`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return fetchWithRetry(url, options, retries - 1);
    }
    throw error;
  }
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }

  try {
    const { domain, brands, industry } = await req.json();

    if (!domain || !brands || brands.length === 0) {
      return new Response(JSON.stringify({
        error: 'Missing required parameters'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    const prompt = `
You are an expert market analyst specializing in competitive intelligence.

I need you to identify the top competitors for a company with the following details:
- Domain: ${domain}
- Brand names: ${brands.join(', ')}
- Industry focus: ${industry || 'general market visibility'}

Please provide a list of 5-10 competitor brand names that would be most relevant to track for competitive analysis.

Guidelines:
- Focus on direct competitors in the same industry
- Include both major players and emerging competitors
- Consider companies that target similar customer segments
- Only include the brand names, not domains or descriptions
- Provide only well-known, legitimate companies
- Do not include the original brand names provided

Return ONLY an array of strings with competitor brand names. No explanations, no JSON formatting, just the array.

Example response format:
["Competitor1", "Competitor2", "Competitor3", "Competitor4", "Competitor5"]
`;

    const response = await fetchWithRetry('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4',
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('OpenAI API Error:', error);
      throw new Error(`OpenAI API Error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const output = data.choices[0].message.content;

    try {
      // Extract array from the response
      let competitors;
      // Try to parse as JSON first
      try {
        competitors = JSON.parse(output);
      } catch (e) {
        // If not valid JSON, try to extract array using regex
        const match = output.match(/\[(.*)\]/s);
        if (match) {
          // Convert the matched string to a proper array
          const arrayString = match[0];
          competitors = JSON.parse(arrayString);
        } else {
          // If no array format found, split by lines or commas
          competitors = output
            .split(/[\n,]/)
            .map((item) => item.trim())
            .filter((item) => item && !item.includes('[') && !item.includes(']'))
            .map((item) => item.replace(/^["']|["']$/g, '')); // Remove quotes
        }
      }

      // Ensure we have an array and limit to 10 items
      if (!Array.isArray(competitors)) {
        competitors = [];
      }
      competitors = competitors
        .filter((c) => typeof c === 'string' && c.trim().length > 0)
        .slice(0, 10);

      return new Response(JSON.stringify(competitors), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    } catch (error) {
      console.error('Failed to parse OpenAI response:', error);
      console.error('Raw response:', output);
      throw new Error('Invalid response format from OpenAI');
    }
  } catch (error) {
    console.error('Error in suggest-competitors function:', error);
    return new Response(JSON.stringify({
      error: 'Failed to suggest competitors',
      details: error.message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});