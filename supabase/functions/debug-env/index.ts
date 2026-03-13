import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const onesearchApiKey = Deno.env.get('ONESEARCH_API_KEY');
    const onesearchApiUrl = Deno.env.get('ONESEARCH_API_URL');
    const brightdataApiKey = Deno.env.get('BRIGHTDATA_API_KEY');

    const debug = {
      onesearch: {
        url: onesearchApiUrl || 'NOT SET',
        keyExists: !!onesearchApiKey,
        keyLength: onesearchApiKey?.length || 0,
        keyPrefix: onesearchApiKey?.substring(0, 8) || 'EMPTY',
      },
      brightdata: {
        keyExists: !!brightdataApiKey,
        keyLength: brightdataApiKey?.length || 0,
        keyPrefix: brightdataApiKey?.substring(0, 8) || 'EMPTY',
      }
    };

    return new Response(
      JSON.stringify(debug, null, 2),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({
        error: error.message || 'Failed to debug env',
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
