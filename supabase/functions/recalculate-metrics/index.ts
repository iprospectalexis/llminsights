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
  // Parallelize all independent queries to reduce total query time
  const [
    { count: totalPrompts },
    { count: totalAudits },
    { data: project },
    { data: brandsData },
    { data: auditsData }
  ] = await Promise.all([
    // Get total prompts count
    supabaseClient
      .from('prompts')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', projectId),

    // Get total completed audits count
    supabaseClient
      .from('audits')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .eq('status', 'completed'),

    // Get project domain and domain_mode
    supabaseClient
      .from('projects')
      .select('domain, domain_mode')
      .eq('id', projectId)
      .single(),

    // Get own brands
    supabaseClient
      .from('brands')
      .select('brand_name')
      .eq('project_id', projectId)
      .eq('is_competitor', false),

    // Get all audit IDs for this project
    supabaseClient
      .from('audits')
      .select('id')
      .eq('project_id', projectId)
      .eq('status', 'completed')
  ])

  const ownBrands = brandsData?.map(b => b.brand_name.toLowerCase()) || []
  const auditIds = auditsData?.map(a => a.id) || []

  // Calculate mention rate (count LLM responses, not unique prompts, to match citation rate)
  let mentionRate = 0
  if (auditIds.length > 0 && ownBrands.length > 0) {
    // Limit audit IDs to prevent unbounded query
    const limitedAuditIds = auditIds.slice(0, 100);

    const { data: llmResponsesData } = await supabaseClient
      .from('llm_responses')
      .select('answer_text, audit_id, prompt_id, llm')
      .in('audit_id', limitedAuditIds)
      .not('answer_text', 'is', null)
      .not('audit_id', 'is', null)
      .not('prompt_id', 'is', null)
      .limit(1000) // Add limit to prevent fetching too many rows

    if (llmResponsesData && llmResponsesData.length > 0) {
      // Count individual LLM responses with brand mentions (not unique prompts)
      const mentionedLlmResponseIds = new Set(
        llmResponsesData
          .filter(response => {
            const answerText = response.answer_text?.toLowerCase() || ''
            return ownBrands.some(brand => answerText.includes(brand))
          })
          .map(r => `${r.audit_id}-${r.prompt_id}-${r.llm}`)
      )

      // Total is count of all LLM responses (same as citation rate calculation)
      mentionRate = Math.round((mentionedLlmResponseIds.size / llmResponsesData.length) * 100)
    }
  }

  // Calculate citation rate - parallelize the two queries
  let citationRate = 0
  if (auditIds.length > 0 && project) {
    // Limit audit IDs to prevent unbounded query
    const limitedAuditIds = auditIds.slice(0, 100);

    // Run both queries in parallel
    const [{ data: citationsData }, { data: llmResponsesCount }] = await Promise.all([
      supabaseClient
        .from('citations')
        .select('domain, audit_id, prompt_id, llm')
        .in('audit_id', limitedAuditIds)
        .not('domain', 'is', null)
        .not('audit_id', 'is', null)
        .not('prompt_id', 'is', null)
        .limit(5000), // Add limit to prevent fetching too many rows

      supabaseClient
        .from('llm_responses')
        .select('audit_id, prompt_id, llm')
        .in('audit_id', limitedAuditIds)
        .not('audit_id', 'is', null)
        .not('prompt_id', 'is', null)
        .limit(1000) // Add limit to prevent fetching too many rows
    ])

    if (citationsData && llmResponsesCount && llmResponsesCount.length > 0) {
      const projectDomain = project.domain.toLowerCase().replace(/^www\./, '')
      const domainMode = project.domain_mode || 'exact'

      const citedLlmResponseIds = new Set(
        citationsData
          .filter(c => {
            const citationDomain = c.domain?.toLowerCase().replace(/^www\./, '') || ''

            if (domainMode === 'subdomains') {
              // Include exact match and subdomains
              return citationDomain === projectDomain || citationDomain.endsWith(`.${projectDomain}`)
            } else {
              // Exact match only
              return citationDomain === projectDomain
            }
          })
          .map(c => `${c.audit_id}-${c.prompt_id}-${c.llm}`)
      )

      citationRate = Math.round((citedLlmResponseIds.size / llmResponsesCount.length) * 100)
    }
  }

  // Get last audit timestamp
  const { data: lastAuditData } = await supabaseClient
    .from('audits')
    .select('finished_at')
    .eq('project_id', projectId)
    .eq('status', 'completed')
    .order('finished_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // Save metrics
  const { error: metricsError } = await supabaseClient
    .from('project_metrics')
    .upsert({
      project_id: projectId,
      mention_rate: mentionRate,
      citation_rate: citationRate,
      total_prompts: totalPrompts || 0,
      total_audits: totalAudits || 0,
      last_audit_at: lastAuditData?.finished_at || new Date().toISOString(),
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'project_id'
    })

  if (metricsError) {
    throw metricsError
  }

  return {
    mention_rate: mentionRate,
    citation_rate: citationRate,
    total_prompts: totalPrompts || 0,
    total_audits: totalAudits || 0
  }
}
