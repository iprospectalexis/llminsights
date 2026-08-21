import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface RecalculateRequest {
  projectId?: string
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

    const { projectId }: RecalculateRequest = await req.json().catch(() => ({}))

    let projectsToProcess: any[] = []

    if (projectId) {
      // Recalculate for specific project
      const { data: project } = await supabaseClient
        .from('projects')
        .select('id, name, domain')
        .eq('id', projectId)
        .single()

      if (project) {
        projectsToProcess = [project]
      }
    } else {
      // Recalculate for all projects - LIMIT to prevent I/O exhaustion
      const { data: projects } = await supabaseClient
        .from('projects')
        .select('id, name, domain')
        .limit(50) // Limit to 50 projects at a time to prevent I/O exhaustion

      projectsToProcess = projects || []
    }

    console.log(`Recalculating metrics for ${projectsToProcess.length} projects`)

    const results = []

    // Add delay between projects to reduce I/O pressure
    for (let i = 0; i < projectsToProcess.length; i++) {
      const project = projectsToProcess[i];

      // Add 100ms delay between projects to prevent overwhelming the database
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      try {
        const metrics = await calculateProjectMetrics(project.id, supabaseClient)
        results.push({
          projectId: project.id,
          projectName: project.name,
          success: true,
          metrics
        })
        console.log(`✓ Calculated metrics for ${project.name}:`, metrics)
      } catch (error) {
        results.push({
          projectId: project.id,
          projectName: project.name,
          success: false,
          error: error.message
        })
        console.error(`✗ Error calculating metrics for ${project.name}:`, error)
      }
    }

    const successCount = results.filter(r => r.success).length
    const failCount = results.filter(r => !r.success).length

    // Skip materialized view refresh to reduce I/O pressure
    // The MV will be refreshed by scheduled cron job instead
    console.log('Skipping MV refresh to reduce I/O pressure (will be refreshed by cron)')

    return new Response(
      JSON.stringify({
        success: true,
        message: `Recalculated metrics for ${successCount}/${projectsToProcess.length} projects`,
        successCount,
        failCount,
        results
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    )

  } catch (error) {
    console.error('Error in recalculate-metrics function:', error)
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

async function calculateProjectMetrics(projectId: string, supabaseClient: any) {
  // Single source of truth: the recalculate_project_metrics() SQL function
  // (migration 20260820140000). This edge function used to carry its own
  // copy of the formulas, which drifted from the pipeline's and from the
  // Overview page's — a project card could read 66% / 3% while its own
  // Overview read 35% / 6%. The RPC computes per-response rates over
  // ANSWERED responses, matches brands on word boundaries (accent-
  // insensitive, aliases included) and ignores `cited = false` citations.
  const { data, error } = await supabaseClient.rpc('recalculate_project_metrics', {
    p_project_id: projectId,
  })

  if (error) {
    throw error
  }

  const row = Array.isArray(data) ? data[0] : data

  return {
    mention_rate: row?.mention_rate ?? 0,
    citation_rate: row?.citation_rate ?? 0,
    answered_responses: row?.answered_responses ?? 0,
    mentioned: row?.mentioned ?? 0,
    cited: row?.cited ?? 0,
  }
}
