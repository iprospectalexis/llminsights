import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey, X-Webhook-Secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface WebhookPayload {
  event: string
  job_id: string
  status: 'completed' | 'failed'
  progress: number
  total_prompts: number
  processed_prompts: number
  failed_prompts: number
  results?: string[]
  failed_queries?: string[]
  error_message?: string
  duration_seconds?: number
  completed_at: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const startTime = Date.now()
  const supabaseClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  )

  let payload: WebhookPayload | null = null
  let webhookLogId: string | null = null

  try {
    // Validate webhook secret for security
    const webhookSecret = req.headers.get('X-Webhook-Secret')
    const expectedSecret = Deno.env.get('ONESEARCH_WEBHOOK_SECRET')

    if (expectedSecret && webhookSecret !== expectedSecret) {
      console.error('[webhook] Invalid webhook secret')

      // Log unauthorized attempt
      await supabaseClient.from('webhook_logs').insert({
        webhook_type: 'onesearch',
        status: 'error',
        error_message: 'Invalid webhook secret',
        response_status: 401,
        processing_time_ms: Date.now() - startTime,
      })

      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 401
        }
      )
    }

    payload = await req.json()

    console.log('[webhook] Received webhook:', {
      event: payload.event,
      job_id: payload.job_id,
      status: payload.status,
      total_prompts: payload.total_prompts,
      processed_prompts: payload.processed_prompts,
      failed_prompts: payload.failed_prompts,
    })

    // Log incoming webhook
    const { data: logData } = await supabaseClient.from('webhook_logs').insert({
      webhook_type: 'onesearch',
      job_id: payload.job_id,
      event: payload.event,
      status: 'received',
      payload: payload,
      response_status: 200,
    }).select('id').single()

    webhookLogId = logData?.id

    // ── Handoff to Python pipeline ──────────────────────────────────────
    // The Python backend (audit_pipeline.py + audit_scheduler.py) is now
    // the single owner of the audit lifecycle: it polls OneSearch for
    // results, extracts competitors, runs sentiment V2, and finalizes.
    //
    // The historical `completeAudit` path below writes `audit_steps`,
    // `audits.pipeline_state`, and `llm_responses` via PostgREST, which
    // races against the Python writer (asyncpg) and produces tuple-level
    // deadlocks on `audit_steps` under load (40P01, observed on VPS).
    //
    // We keep this endpoint live so OneSearch/BrightData keeps getting a
    // 200 OK (no retry storms), but short-circuit to acknowledgement only.
    // `webhook_logs` still captures each delivery for audit/debugging.
    //
    // Everything after this return is dead code; leave it for now — it
    // will be deleted in a follow-up cleanup once the Python pipeline
    // handoff has been stable for a release cycle.
    return new Response(
      JSON.stringify({
        ok: true,
        handled_by: 'python_pipeline',
        webhook_log_id: webhookLogId,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )

    // Only process completed jobs
    if (payload.event !== 'job.completed' || payload.status !== 'completed') {
      console.log('[webhook] Skipping non-completed job')
      return new Response(
        JSON.stringify({
          success: true,
          message: 'Webhook received but job not completed yet'
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200
        }
      )
    }

    // Find all llm_responses with this job_id
    const { data: responses, error: responsesError } = await supabaseClient
      .from('llm_responses')
      .select('*')
      .eq('job_id', payload.job_id)

    if (responsesError || !responses || responses.length === 0) {
      console.error('[webhook] No responses found for job_id:', payload.job_id, responsesError)
      return new Response(
        JSON.stringify({
          error: 'No responses found for this job_id',
          job_id: payload.job_id
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 404
        }
      )
    }

    console.log(`[webhook] Found ${responses.length} responses for job ${payload.job_id}`)

    const auditId = responses[0].audit_id

    // Fetch results from OneSearch API
    const results = await fetchOneSearchResults(payload.job_id)

    if (!results || results.length === 0) {
      console.error('[webhook] Failed to fetch results from OneSearch API')
      return new Response(
        JSON.stringify({
          error: 'Failed to fetch results from OneSearch API'
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500
        }
      )
    }

    console.log(`[webhook] Fetched ${results.length} results from OneSearch API`)

    // Match and update each response
    let updatedCount = 0
    for (const response of responses) {
      const prompt = await getPromptText(response.prompt_id, supabaseClient)
      const matchedResult = results.find((r: any) => r.prompt === prompt)

      if (matchedResult) {
        // Extract organic results for Google AI Overview
        let organicResults = null
        if (response.llm === 'google-ai-overview' && matchedResult.organic) {
          organicResults = matchedResult.organic
        }

        // Update llm_response with result
        const { error: updateError } = await supabaseClient
          .from('llm_responses')
          .update({
            response_url: matchedResult.url || null,
            answer_text: matchedResult.answer_text || null,
            answer_text_markdown: matchedResult.answer_text_markdown || null,
            response_timestamp: new Date().toISOString(),
            raw_response_data: matchedResult,
            web_search_query: matchedResult.web_search_query || null,
            all_sources: matchedResult.all_sources || null,
            citations: matchedResult.citations || null,
            links_attached: matchedResult.links_attached || null,
            organic_results: organicResults,
          })
          .eq('id', response.id)

        if (updateError) {
          console.error('[webhook] Error updating response:', response.id, updateError)
        } else {
          updatedCount++
          console.log(`[webhook] Updated response ${response.id}`)

          // Parse and store citations
          await parseCitations(matchedResult, response, supabaseClient)
        }
      } else {
        console.warn(`[webhook] No matching result found for prompt in job ${payload.job_id}`)
      }
    }

    console.log(`[webhook] Updated ${updatedCount}/${responses.length} responses`)

    // Check if this audit should be completed
    await checkAndCompleteAudit(auditId, supabaseClient)

    // Refresh metrics for this audit
    await refreshAuditMetrics(auditId, supabaseClient)

    // Update log with success
    if (webhookLogId) {
      await supabaseClient.from('webhook_logs').update({
        status: 'success',
        processing_time_ms: Date.now() - startTime,
      }).eq('id', webhookLogId)
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Processed ${updatedCount} results for job ${payload?.job_id}`,
        audit_id: auditId,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    )

  } catch (error) {
    console.error('[webhook] Error processing webhook:', error)

    // Log error
    if (webhookLogId) {
      await supabaseClient.from('webhook_logs').update({
        status: 'error',
        error_message: error.message || 'Internal server error',
        processing_time_ms: Date.now() - startTime,
        response_status: 500,
      }).eq('id', webhookLogId)
    } else {
      // Create new error log if we couldn't create initial log
      await supabaseClient.from('webhook_logs').insert({
        webhook_type: 'onesearch',
        job_id: payload?.job_id || null,
        event: payload?.event || null,
        status: 'error',
        payload: payload,
        error_message: error.message || 'Internal server error',
        response_status: 500,
        processing_time_ms: Date.now() - startTime,
      })
    }

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

async function getPromptText(promptId: string, supabaseClient: any): Promise<string> {
  const { data: prompt } = await supabaseClient
    .from('prompts')
    .select('prompt_text')
    .eq('id', promptId)
    .single()

  return prompt?.prompt_text || ''
}

async function fetchOneSearchResults(jobId: string): Promise<any[] | null> {
  const onesearchApiKey = Deno.env.get('ONESEARCH_API_KEY') || ''
  const onesearchApiUrl = Deno.env.get('ONESEARCH_API_URL') || 'http://168.231.84.54:8000'

  console.log(`[webhook] Fetching results for job ${jobId}`)

  const resultsHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (onesearchApiKey) {
    resultsHeaders['X-API-Key'] = onesearchApiKey
  }

  const allResults: any[] = []
  let page = 1
  const perPage = 100
  let hasMore = true

  try {
    while (hasMore) {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 60000)

      try {
        console.log(`[webhook] Fetching page ${page} for job ${jobId}`)

        const resultsResponse = await fetch(
          `${onesearchApiUrl}/api/v1/jobs/${jobId}/results?format=converted&page=${page}&per_page=${perPage}`,
          {
            headers: resultsHeaders,
            signal: controller.signal,
          }
        )

        clearTimeout(timeoutId)

        if (!resultsResponse.ok) {
          const errorText = await resultsResponse.text()
          console.error(`[webhook] OneSearch results API error ${resultsResponse.status}:`, errorText.substring(0, 500))
          throw new Error(`OneSearch results API error: ${resultsResponse.status}`)
        }

        const resultsData = await resultsResponse.json()
        const pageResults = resultsData.results || resultsData

        if (!Array.isArray(pageResults) || pageResults.length === 0) {
          hasMore = false
          break
        }

        allResults.push(...pageResults)
        console.log(`[webhook] Fetched ${pageResults.length} results from page ${page} (total so far: ${allResults.length})`)

        if (pageResults.length < perPage) {
          hasMore = false
        } else {
          page++
        }
      } catch (pageError) {
        clearTimeout(timeoutId)
        if (pageError.name === 'AbortError') {
          throw new Error(`OneSearch API timeout for job ${jobId} page ${page}`)
        }
        throw pageError
      }
    }

    console.log(`[webhook] Fetched total of ${allResults.length} results across ${page} page(s)`)
    return allResults

  } catch (error) {
    throw error
  }
}

async function checkAndCompleteAudit(auditId: string, supabaseClient: any) {
  // Use PostgreSQL advisory lock to prevent race conditions
  // Only one webhook can execute completion logic at a time
  const lockId = parseInt(auditId.replace(/-/g, '').substring(0, 15), 16) % 2147483647

  const { data: lockData } = await supabaseClient.rpc('pg_try_advisory_lock', { key: lockId })

  if (!lockData) {
    console.log(`[webhook] Another webhook is already processing completion for audit ${auditId}, skipping`)
    return
  }

  try {
    const { data: allResponses, count: totalResponses } = await supabaseClient
      .from('llm_responses')
      .select('id, answer_text, raw_response_data, response_timestamp', { count: 'exact' })
      .eq('audit_id', auditId)

    if (!allResponses || totalResponses === 0) {
      console.log(`[webhook] No responses found for audit ${auditId}`)
      return
    }

    // Count unprocessed responses (no answer_text AND no raw_response_data)
    const unprocessedResponses = allResponses.filter(r => {
      const hasAnswerText = r.answer_text !== null
      const hasRawData = r.raw_response_data && Object.keys(r.raw_response_data).length > 0
      return !hasAnswerText && !hasRawData
    })

    const remainingResponses = unprocessedResponses.length

    console.log(`[webhook] Audit ${auditId}: ${remainingResponses}/${totalResponses} responses still pending`)

    if (remainingResponses === 0) {
      // Additional safety check: ensure at least 5 seconds have passed since last response update
      // This prevents race conditions where webhooks are still processing
      const latestResponseTime = allResponses
        .map(r => r.response_timestamp)
        .filter(t => t !== null)
        .map(t => new Date(t).getTime())
        .sort((a, b) => b - a)[0]

      const timeSinceLastUpdate = Date.now() - latestResponseTime
      const minWaitTime = 5000 // 5 seconds

      if (timeSinceLastUpdate < minWaitTime) {
        console.log(`[webhook] Waiting for stability: only ${timeSinceLastUpdate}ms since last update, need ${minWaitTime}ms`)
        return
      }

      console.log(`[webhook] All responses processed for audit ${auditId}, triggering completion`)

      // Call the complete audit logic (same as poll-audit-results)
      await completeAudit(auditId, supabaseClient)
    } else {
      console.log(`[webhook] ${remainingResponses} responses still pending for audit ${auditId}`)
    }
  } finally {
    // Always release the lock
    await supabaseClient.rpc('pg_advisory_unlock', { key: lockId })
  }
}

async function completeAudit(auditId: string, supabaseClient: any) {
  console.log(`[webhook] Starting completion process for audit ${auditId}`)

  // Check if sentiment analysis is enabled for this audit
  const { data: auditData } = await supabaseClient
    .from('audits')
    .select('sentiment')
    .eq('id', auditId)
    .single()

  const sentimentEnabled = auditData?.sentiment || false

  // Run competitors extraction before any completion logic.
  // NOTE: The webhook runs an older, inline extract-competitors path. The
  // Python pipeline has its own handle_competitors; whichever finishes first
  // "wins" and the second becomes a no-op because both are idempotent on
  // llm_responses.answer_competitors.
  await runCompetitorsExtraction(auditId, supabaseClient)

  // Update parse step to done
  await supabaseClient
    .from('audit_steps')
    .update({
      status: 'done',
      message: 'LLM results parsed successfully'
    })
    .eq('audit_id', auditId)
    .eq('step', 'parse')

  // Update persist step to done. `sentiment` step is handled per-branch below.
  await supabaseClient
    .from('audit_steps')
    .update({ status: 'done' })
    .eq('audit_id', auditId)
    .in('step', ['persist'])

  if (sentimentEnabled) {
    // Hand off to Python pipeline for V2 sentiment + finalize.
    //
    // The webhook's historical `runSentimentAnalysis` path is v1: it writes
    // only the legacy `llm_responses.sentiment_score/label` columns and never
    // populates `response_brand_sentiment`, which is what the current UI
    // (Sentiment tab + /mentions) actually reads. Running it here leaves the
    // dashboards empty and also races against the Python state machine,
    // producing zombie audits (status=completed with pipeline_state=created).
    //
    // Correct behaviour: leave `status` untouched (stays 'processing'/'running'),
    // advance `pipeline_state` to 'analyzing_sentiment' so the Python worker
    // picks it up on its next scheduler tick. The Python `handle_sentiment` +
    // `handle_finalize` will then set status='completed' + pipeline_state='completed'
    // atomically via `transition_state`.
    console.log(
      `[webhook] Audit ${auditId}: handing off to Python pipeline for V2 sentiment`
    )
    await supabaseClient
      .from('audits')
      .update({
        pipeline_state: 'analyzing_sentiment',
        current_step: 'analyzing_sentiment',
      })
      .eq('id', auditId)

    // Mark sentiment step as pending so the UI reflects the handoff.
    await supabaseClient
      .from('audit_steps')
      .update({
        status: 'running',
        message: 'Waiting for Python pipeline to run V2 sentiment analysis',
      })
      .eq('audit_id', auditId)
      .eq('step', 'sentiment')

    // Still refresh metrics for what we already have (responses, citations,
    // competitors). Python finalize will refresh them again later.
    await calculateAndSaveProjectMetrics(auditId, supabaseClient)
    return
  }

  // Sentiment disabled — no Python handoff is needed. Mark the audit fully
  // complete here, BUT always set `status` and `pipeline_state` in the same
  // UPDATE to keep them consistent (enforced by the audits_status_pipeline_state
  // CHECK constraint introduced in the defense-in-depth migration).
  await supabaseClient
    .from('audit_steps')
    .update({ status: 'done', message: 'Sentiment analysis disabled' })
    .eq('audit_id', auditId)
    .eq('step', 'sentiment')

  await supabaseClient
    .from('audits')
    .update({
      status: 'completed',
      pipeline_state: 'completed',
      progress: 100,
      finished_at: new Date().toISOString()
    })
    .eq('id', auditId)

  // Calculate and save project metrics
  await calculateAndSaveProjectMetrics(auditId, supabaseClient)

  console.log(`[webhook] Audit ${auditId} completed (sentiment disabled)`)
}

async function runCompetitorsExtraction(auditId: string, supabaseClient: any) {
  try {
    const { data: competitorsStep } = await supabaseClient
      .from('audit_steps')
      .select('status')
      .eq('audit_id', auditId)
      .eq('step', 'competitors')
      .single()

    if (competitorsStep?.status === 'done') {
      console.log(`[webhook] Competitors extraction already completed`)
      return
    }

    // Check if already running to prevent duplicate processing
    if (competitorsStep?.status === 'running') {
      console.log(`[webhook] Competitors extraction already running, skipping`)
      return
    }

    await supabaseClient
      .from('audit_steps')
      .update({
        status: 'running',
        message: 'Extracting competitors from LLM responses...'
      })
      .eq('audit_id', auditId)
      .eq('step', 'competitors')

    // Get all responses with answer_text that haven't been processed yet
    // Key fix: Only process responses where answer_competitors is NULL (not empty array)
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
      console.log(`[webhook] No responses to process for competitors extraction`)
      await supabaseClient
        .from('audit_steps')
        .update({
          status: 'done',
          message: 'All responses already processed for competitors extraction'
        })
        .eq('audit_id', auditId)
        .eq('step', 'competitors')
      return
    }

    console.log(`[webhook] Processing ${responsesToProcess.length} responses for competitors`)

    const batchSize = 3
    let processedCount = 0
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
            console.error(`[webhook] Extraction failed for response ${response.id}:`, error)
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
          console.error(`[webhook] Error extracting competitors for response ${response.id}:`, error)
          failureCount++
          // Set empty array to mark as processed (even if failed)
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

      processedCount += batch.length
      console.log(`[webhook] Processed ${processedCount}/${responsesToProcess.length} responses (${successCount} success, ${failureCount} failed)`)

      if (i + batchSize < responsesToProcess.length) {
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    }

    await supabaseClient
      .from('audit_steps')
      .update({
        status: 'done',
        message: `Competitors extraction completed: ${successCount} success, ${failureCount} failed`
      })
      .eq('audit_id', auditId)
      .eq('step', 'competitors')

    console.log(`[webhook] Competitors extraction completed for audit ${auditId}`)

  } catch (error) {
    console.error(`[webhook] Error in competitors extraction:`, error)
    await supabaseClient
      .from('audit_steps')
      .update({
        status: 'error',
        message: `Competitors extraction failed: ${error.message}`
      })
      .eq('audit_id', auditId)
      .eq('step', 'competitors')
  }
}

async function runSentimentAnalysis(auditId: string, supabaseClient: any) {
  try {
    await supabaseClient
      .from('audit_steps')
      .update({
        status: 'running',
        message: 'Running sentiment analysis...'
      })
      .eq('audit_id', auditId)
      .eq('step', 'sentiment')

    const { data: auditWithProject } = await supabaseClient
      .from('audits')
      .select(`
        id,
        projects!inner (
          id,
          created_by,
          brands!inner (brand_name, is_competitor)
        )
      `)
      .eq('id', auditId)
      .eq('projects.brands.is_competitor', false)
      .single()

    if (!auditWithProject?.projects?.brands) {
      return
    }

    const brands = auditWithProject.projects.brands.map(b => b.brand_name)

    const { data: llmResponses } = await supabaseClient
      .from('llm_responses')
      .select('*')
      .eq('audit_id', auditId)
      .not('answer_text', 'is', null)
      .is('sentiment_score', null)

    if (!llmResponses || llmResponses.length === 0) {
      await supabaseClient
        .from('audit_steps')
        .update({
          status: 'done',
          message: 'No LLM responses to analyze'
        })
        .eq('audit_id', auditId)
        .eq('step', 'sentiment')
      return
    }

    const batchSize = 5

    for (let i = 0; i < llmResponses.length; i += batchSize) {
      const batch = llmResponses.slice(i, i + batchSize)

      await Promise.all(batch.map(async (llmResponse) => {
        for (const brand of brands) {
          const responseText = llmResponse.answer_text.toLowerCase()
          const brandLower = brand.toLowerCase()

          if (responseText.includes(brandLower)) {
            try {
              const sentimentResponse = await supabaseClient.functions.invoke('analyze-sentiment', {
                body: {
                  brand,
                  answer: llmResponse.answer_text,
                  projectId: auditWithProject.projects.id,
                  responseId: llmResponse.id,
                  platform: llmResponse.llm,
                  userId: auditWithProject.projects.created_by
                }
              })

              if (sentimentResponse.data && !sentimentResponse.error) {
                const { perception, magnitude } = sentimentResponse.data

                const sentimentScore = perception === 'positive' ? magnitude / 5 :
                                    perception === 'negative' ? -magnitude / 5 : 0

                await supabaseClient
                  .from('llm_responses')
                  .update({
                    sentiment_score: sentimentScore,
                    sentiment_label: perception
                  })
                  .eq('id', llmResponse.id)
              }
            } catch (error) {
              console.error(`[webhook] Error analyzing sentiment:`, error)
            }
            break
          }
        }
      }))
    }

    await supabaseClient
      .from('audit_steps')
      .update({
        status: 'done',
        message: 'Sentiment analysis completed'
      })
      .eq('audit_id', auditId)
      .eq('step', 'sentiment')

  } catch (error) {
    console.error(`[webhook] Error in sentiment analysis:`, error)
    await supabaseClient
      .from('audit_steps')
      .update({
        status: 'error',
        message: `Sentiment analysis failed: ${error.message}`
      })
      .eq('audit_id', auditId)
      .eq('step', 'sentiment')
  }
}

async function parseCitations(result: any, llmResponse: any, supabaseClient: any) {
  // Delete existing citations for this response to avoid duplicates
  await supabaseClient
    .from('citations')
    .delete()
    .eq('audit_id', llmResponse.audit_id)
    .eq('prompt_id', llmResponse.prompt_id)
    .eq('llm', llmResponse.llm)

  const citations: any[] = []

  // SearchGPT and ChatGPT: Use links_attached for citation count
  if ((llmResponse.llm === 'searchgpt' || llmResponse.llm === 'chatgpt') && result.links_attached) {
    // links_attached represents actual citations shown in the answer (cited=true)
    result.links_attached.forEach((link: any, index: number) => {
      citations.push({
        audit_id: llmResponse.audit_id,
        prompt_id: llmResponse.prompt_id,
        llm: llmResponse.llm,
        page_url: link.url,
        domain: extractDomain(link.url),
        citation_text: link.text || link.title || 'No description available',
        position: link.position || index + 1,
        cited: link.cited !== undefined ? link.cited : true, // links_attached are always cited
        checked_at: new Date().toISOString(),
      })
    })

    // Also add citations with cited=false from the citations array (for "More" section)
    if (result.citations && Array.isArray(result.citations)) {
      result.citations.forEach((citation: any, index: number) => {
        // Only add if explicitly marked as cited=false (the "More" section)
        if (citation.cited === false) {
          citations.push({
            audit_id: llmResponse.audit_id,
            prompt_id: llmResponse.prompt_id,
            llm: llmResponse.llm,
            page_url: citation.url,
            domain: extractDomain(citation.url),
            citation_text: citation.title || citation.description || 'No description available',
            position: citations.length + index + 1,
            cited: false,
            checked_at: new Date().toISOString(),
          })
        }
      })
    }
  } else if ((llmResponse.llm === 'searchgpt' || llmResponse.llm === 'chatgpt') && result.citations) {
    // Fallback for SearchGPT/ChatGPT if links_attached not available
    result.citations.forEach((citation: any, index: number) => {
      citations.push({
        audit_id: llmResponse.audit_id,
        prompt_id: llmResponse.prompt_id,
        llm: llmResponse.llm,
        page_url: citation.url,
        domain: extractDomain(citation.url),
        citation_text: citation.text || citation.title,
        position: index + 1,
        cited: citation.cited !== undefined ? citation.cited : null,
        checked_at: new Date().toISOString(),
      })
    })
  } else if (llmResponse.llm === 'perplexity' && result.citations) {
    result.citations.forEach((citation: any, index: number) => {
      const citationText = citation.title || citation.description || citation.snippet || 'No description available'

      citations.push({
        audit_id: llmResponse.audit_id,
        prompt_id: llmResponse.prompt_id,
        llm: llmResponse.llm,
        page_url: citation.url,
        domain: extractDomain(citation.url),
        citation_text: citationText,
        position: parseInt(citation.position) || index + 1,
        cited: null,
        checked_at: new Date().toISOString(),
      })
    })
  } else if (llmResponse.llm === 'gemini' && result.links_attached) {
    result.links_attached.forEach((link: any, index: number) => {
      citations.push({
        audit_id: llmResponse.audit_id,
        prompt_id: llmResponse.prompt_id,
        llm: llmResponse.llm,
        page_url: link.url,
        domain: extractDomain(link.url),
        citation_text: link.text || 'No description available',
        position: link.position || index + 1,
        cited: true,
        checked_at: new Date().toISOString(),
      })
    })
  } else if (result.all_sources && Array.isArray(result.all_sources)) {
    result.all_sources.forEach((source: any, index: number) => {
      citations.push({
        audit_id: llmResponse.audit_id,
        prompt_id: llmResponse.prompt_id,
        llm: llmResponse.llm,
        page_url: source.url,
        domain: source.domain || extractDomain(source.url),
        citation_text: source.title || 'No description available',
        position: index + 1,
        cited: true,
        checked_at: new Date().toISOString(),
      })
    })
  }

  if (citations.length > 0) {
    console.log(`[webhook] Parsed ${citations.length} citations for ${llmResponse.llm}`)
    const { error } = await supabaseClient
      .from('citations')
      .insert(citations)

    if (error) {
      console.error(`[webhook] Error inserting citations:`, error)
    }
  }
}

function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url)
    return urlObj.hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

async function refreshAuditMetrics(auditId: string, supabaseClient: any) {
  try {
    console.log(`[webhook] Refreshing metrics for audit ${auditId}`)

    // Queue the audit for metrics refresh
    await supabaseClient
      .from('audit_metrics_refresh_queue')
      .upsert({
        audit_id: auditId,
        queued_at: new Date().toISOString()
      }, {
        onConflict: 'audit_id'
      })

    // Trigger the refresh function
    const { error } = await supabaseClient.rpc('refresh_audit_metrics', { p_audit_id: auditId })

    if (error) {
      console.error(`[webhook] Error refreshing metrics:`, error)
    } else {
      console.log(`[webhook] Metrics refreshed for audit ${auditId}`)
    }
  } catch (error) {
    console.error('[webhook] Error in refreshAuditMetrics:', error)
  }
}

async function calculateAndSaveProjectMetrics(auditId: string, supabaseClient: any) {
  try {
    const { data: audit } = await supabaseClient
      .from('audits')
      .select('project_id')
      .eq('id', auditId)
      .single()

    if (!audit) return

    const projectId = audit.project_id

    const { count: totalPrompts } = await supabaseClient
      .from('prompts')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', projectId)

    const { count: totalAudits } = await supabaseClient
      .from('audits')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .eq('status', 'completed')

    const { data: project } = await supabaseClient
      .from('projects')
      .select('domain')
      .eq('id', projectId)
      .single()

    const { data: brandsData } = await supabaseClient
      .from('brands')
      .select('brand_name')
      .eq('project_id', projectId)
      .eq('is_competitor', false)

    const ownBrands = brandsData?.map(b => b.brand_name.toLowerCase()) || []

    const { data: auditsData } = await supabaseClient
      .from('audits')
      .select('id')
      .eq('project_id', projectId)

    const auditIds = auditsData?.map(a => a.id) || []

    let mentionRate = 0
    if (auditIds.length > 0 && ownBrands.length > 0) {
      const { data: llmResponsesData } = await supabaseClient
        .from('llm_responses')
        .select('answer_text, audit_id, prompt_id')
        .in('audit_id', auditIds)
        .not('answer_text', 'is', null)

      if (llmResponsesData && llmResponsesData.length > 0) {
        const uniquePrompts = new Set(
          llmResponsesData.map(r => `${r.audit_id}-${r.prompt_id}`)
        )

        const promptsWithMentions = new Set(
          llmResponsesData
            .filter(response => {
              const answerText = response.answer_text?.toLowerCase() || ''
              return ownBrands.some(brand => answerText.includes(brand))
            })
            .map(r => `${r.audit_id}-${r.prompt_id}`)
        )

        mentionRate = Math.round((promptsWithMentions.size / uniquePrompts.size) * 100)
      }
    }

    let citationRate = 0
    if (auditIds.length > 0 && project) {
      const { data: citationsData } = await supabaseClient
        .from('citations')
        .select('domain, audit_id, prompt_id, llm')
        .in('audit_id', auditIds)

      const { data: llmResponsesCount } = await supabaseClient
        .from('llm_responses')
        .select('audit_id, prompt_id, llm')
        .in('audit_id', auditIds)

      if (citationsData && llmResponsesCount && llmResponsesCount.length > 0) {
        const projectDomain = project.domain.toLowerCase().replace(/^www\./, '')

        const citedLlmResponseIds = new Set(
          citationsData
            .filter(c => {
              const citationDomain = c.domain?.toLowerCase().replace(/^www\./, '') || ''
              const matchesDomain = citationDomain === projectDomain || citationDomain.endsWith(`.${projectDomain}`)
              const isCited = c.cited !== false
              return matchesDomain && isCited
            })
            .map(c => `${c.audit_id}-${c.prompt_id}-${c.llm}`)
        )

        citationRate = Math.round((citedLlmResponseIds.size / llmResponsesCount.length) * 100)
      }
    }

    const { data: lastAuditData } = await supabaseClient
      .from('audits')
      .select('finished_at')
      .eq('project_id', projectId)
      .eq('status', 'completed')
      .order('finished_at', { ascending: false })
      .limit(1)
      .single()

    await supabaseClient
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

    console.log(`[webhook] Saved metrics: mention=${mentionRate}%, citation=${citationRate}%`)
  } catch (error) {
    console.error('[webhook] Error calculating metrics:', error)
  }
}
