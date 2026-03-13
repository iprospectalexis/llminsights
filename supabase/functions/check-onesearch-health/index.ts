import "jsr:@supabase/functions-js/edge-runtime.d.ts"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    })
  }

  try {
    const onesearchApiUrl = Deno.env.get('ONESEARCH_API_URL') || 'http://168.231.84.54:8000'
    const onesearchApiKey = Deno.env.get('ONESEARCH_API_KEY') || ''

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000)

    try {
      const headers: Record<string, string> = {}
      if (onesearchApiKey) {
        headers['X-API-Key'] = onesearchApiKey
      }

      const response = await fetch(`${onesearchApiUrl}/health`, {
        headers,
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (response.ok) {
        return new Response(
          JSON.stringify({
            status: 'healthy',
            url: onesearchApiUrl,
            apiKeyConfigured: !!onesearchApiKey,
            timestamp: new Date().toISOString(),
          }),
          {
            status: 200,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json',
            },
          }
        )
      } else {
        return new Response(
          JSON.stringify({
            status: 'unhealthy',
            url: onesearchApiUrl,
            apiKeyConfigured: !!onesearchApiKey,
            error: `HTTP ${response.status}`,
            timestamp: new Date().toISOString(),
          }),
          {
            status: 200,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json',
            },
          }
        )
      }
    } catch (error: any) {
      clearTimeout(timeoutId)

      let errorMessage = 'Unknown error'
      if (error.name === 'AbortError') {
        errorMessage = 'Connection timeout'
      } else if (error.message?.includes('Connection refused')) {
        errorMessage = 'Connection refused - server may be down'
      } else if (error.message?.includes('ECONNREFUSED')) {
        errorMessage = 'Connection refused - server may be down'
      } else if (error.message) {
        errorMessage = error.message
      }

      return new Response(
        JSON.stringify({
          status: 'unreachable',
          url: onesearchApiUrl,
          apiKeyConfigured: !!onesearchApiKey,
          error: errorMessage,
          details: error.toString(),
          timestamp: new Date().toISOString(),
        }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        }
      )
    }
  } catch (error: any) {
    console.error('Error checking OneSearch health:', error)
    return new Response(
      JSON.stringify({
        error: error.message || 'Failed to check OneSearch health',
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    )
  }
})
