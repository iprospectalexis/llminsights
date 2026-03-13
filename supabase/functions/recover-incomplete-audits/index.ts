import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface RecoveryRequest {
  audit_id?: string
  auto_discover?: boolean
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const supabaseClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  )

  try {
    const { audit_id, auto_discover = true }: RecoveryRequest = await req.json()

    let auditsToRecover: string[] = []

    if (audit_id) {
      // Recover specific audit
      auditsToRecover = [audit_id]
    } else if (auto_discover) {
      // Find all completed audits with missing brand extraction
      const { data: incompleteAudits } = await supabaseClient
        .from('audits')
        .select('id')
        .eq('status', 'completed')
        .in('id',
          supabaseClient
            .from('audit_steps')
            .select('audit_id')
            .eq('step', 'competitors')
            .neq('status', 'done')
        )
        .limit(50)

      auditsToRecover = incompleteAudits?.map(a => a.id) || []
    }

    if (auditsToRecover.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No audits found that need recovery'
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200
        }
      )
    }

    console.log(`[recovery] Found ${auditsToRecover.length} audits to recover`)

    const results = []

    for (const auditId of auditsToRecover) {
      try {
        console.log(`[recovery] Processing audit ${auditId}`)

        // Check current state
        const { data: audit } = await supabaseClient
          .from('audits')
          .select('id, status, project_id')
          .eq('id', auditId)
          .single()

        if (!audit) {
          results.push({ audit_id: auditId, status: 'not_found' })
          continue
        }

        // Check responses
        const { data: responses, count: totalResponses } = await supabaseClient
          .from('llm_responses')
          .select('id, answer_text, answer_competitors', { count: 'exact' })
          .eq('audit_id', auditId)
          .not('answer_text', 'is', null)

        const responsesWithoutExtraction = responses?.filter(r => r.answer_competitors === null).length || 0

        console.log(`[recovery] Audit ${auditId}: ${responsesWithoutExtraction}/${totalResponses} responses need extraction`)

        if (responsesWithoutExtraction === 0) {
          results.push({
            audit_id: auditId,
            status: 'already_complete',
            message: 'All responses already have brand extraction'
          })
          continue
        }

        // Reset competitors step to pending
        await supabaseClient
          .from('audit_steps')
          .update({
            status: 'pending',
            message: null
          })
          .eq('audit_id', auditId)
          .eq('step', 'competitors')

        // Trigger brand extraction
        await runCompetitorsExtraction(auditId, supabaseClient)

        // Verify extraction completed
        const { count: remainingCount } = await supabaseClient
          .from('llm_responses')
          .select('id', { count: 'exact', head: true })
          .eq('audit_id', auditId)
          .not('answer_text', 'is', null)
          .is('answer_competitors', null)

        results.push({
          audit_id: auditId,
          status: 'recovered',
          responses_processed: responsesWithoutExtraction,
          remaining: remainingCount || 0
        })

        console.log(`[recovery] Completed recovery for audit ${auditId}`)

      } catch (error) {
        console.error(`[recovery] Error recovering audit ${auditId}:`, error)
        results.push({
          audit_id: auditId,
          status: 'error',
          error: error.message
        })
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Recovered ${results.filter(r => r.status === 'recovered').length} audits`,
        results
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    )

  } catch (error) {
    console.error('[recovery] Error:', error)
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

async function runCompetitorsExtraction(auditId: string, supabaseClient: any) {
  try {
    await supabaseClient
      .from('audit_steps')
      .update({
        status: 'running',
        message: 'Recovering: Extracting competitors from LLM responses...'
      })
      .eq('audit_id', auditId)
      .eq('step', 'competitors')

    const { data: responsesToProcess } = await supabaseClient
      .from('llm_responses')
      .select(`
        id,
        answer_text,
        answer_competitors,
        prompts (prompt_text)
      `)
      .eq('audit_id', auditId)
      .not('answer_text', 'is', null)
      .is('answer_competitors', null)

    if (!responsesToProcess || responsesToProcess.length === 0) {
      await supabaseClient
        .from('audit_steps')
        .update({
          status: 'done',
          message: 'Recovery: All responses already processed'
        })
        .eq('audit_id', auditId)
        .eq('step', 'competitors')
      return
    }

    console.log(`[recovery] Processing ${responsesToProcess.length} responses for competitors`)

    const batchSize = 3
    let successCount = 0
    let failureCount = 0

    for (let i = 0; i < responsesToProcess.length; i += batchSize) {
      const batch = responsesToProcess.slice(i, i + batchSize)

      await Promise.all(batch.map(async (response) => {
        try {
          const { error } = await supabaseClient.functions.invoke('extract-competitors', {
            body: {
              prompt: response.prompts?.prompt_text || '',
              answerText: response.answer_text,
              responseId: response.id,
              auditId: auditId
            }
          })

          if (error) {
            failureCount++
            await supabaseClient
              .from('llm_responses')
              .update({
                answer_competitors: {
                  brands: [],
                  error: 'extraction_failed',
                  details: error.message,
                  failed_at: new Date().toISOString()
                }
              })
              .eq('id', response.id)
          } else {
            successCount++
          }
        } catch (error) {
          failureCount++
          await supabaseClient
            .from('llm_responses')
            .update({
              answer_competitors: {
                brands: [],
                error: 'extraction_exception',
                details: error.message || 'Unknown error',
                failed_at: new Date().toISOString()
              }
            })
            .eq('id', response.id)
        }
      }))

      if (i + batchSize < responsesToProcess.length) {
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    }

    await supabaseClient
      .from('audit_steps')
      .update({
        status: 'done',
        message: `Recovery completed: ${successCount} success, ${failureCount} failed`
      })
      .eq('audit_id', auditId)
      .eq('step', 'competitors')

    console.log(`[recovery] Completed extraction for audit ${auditId}`)

  } catch (error) {
    console.error(`[recovery] Error in competitors extraction:`, error)
    await supabaseClient
      .from('audit_steps')
      .update({
        status: 'error',
        message: `Recovery failed: ${error.message}`
      })
      .eq('audit_id', auditId)
      .eq('step', 'competitors')
    throw error
  }
}
