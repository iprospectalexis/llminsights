import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const url = new URL(req.url)
    const jobId = url.searchParams.get('job_id')
    const limit = parseInt(url.searchParams.get('limit') || '50')

    let query = supabaseClient
      .from('webhook_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (jobId) {
      query = query.eq('job_id', jobId)
    }

    const { data: logs, error } = await query

    if (error) {
      throw error
    }

    // Get summary stats
    const { data: stats } = await supabaseClient
      .from('webhook_logs')
      .select('status')

    const summary = {
      total_calls: stats?.length || 0,
      successful: stats?.filter(s => s.status === 'success').length || 0,
      errors: stats?.filter(s => s.status === 'error').length || 0,
      received: stats?.filter(s => s.status === 'received').length || 0,
    }

    return new Response(
      JSON.stringify({
        summary,
        logs,
        job_id_filter: jobId,
      }, null, 2),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    )

  } catch (error) {
    console.error('Error checking webhook activity:', error)
    return new Response(
      JSON.stringify({
        error: error.message || 'Internal server error'
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    )
  }
})
