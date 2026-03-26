import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface PollRequest {
  auditId: string
  llm?: string
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

    const { auditId, llm }: PollRequest = await req.json()

    if (!auditId) {
      throw new Error('Audit ID is required')
    }

    const brightdataApiKey = Deno.env.get('BRIGHTDATA_API_KEY')
    if (!brightdataApiKey) {
      throw new Error('Brightdata API key not configured')
    }

    // Check if audit exists
    const { data: audit } = await supabaseClient
      .from('audits')
      .select('status')
      .eq('id', auditId)
      .single()

    if (!audit) {
      return new Response(
        JSON.stringify({
          success: false,
          message: 'Audit not found',
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 404
        }
      )
    }

    await pollForResults(auditId, supabaseClient, brightdataApiKey, llm)

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Polling batch completed successfully'
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    )

  } catch (error) {
    console.error('Error in poll-audit-results function:', error)
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

async function pollForResults(auditId: string, supabaseClient: any, apiKey: string, llmFilter?: string) {
  // Update parse step to running if not already
  await supabaseClient
    .from('audit_steps')
    .update({
      status: 'running',
      message: 'Polling for LLM results...'
    })
    .eq('audit_id', auditId)
    .eq('step', 'parse')
    .eq('status', 'pending')

  // Update audit current_step to getting_results
  await supabaseClient
    .from('audits')
    .update({ current_step: 'getting_results' })
    .eq('id', auditId)
    .eq('status', 'running')

  // Get a batch of pending LLM responses for this audit (max 100 at a time for throughput)
  // A response is "pending" if it has no answer_text AND no raw_response_data
  // (google-ai-overview may have null answer_text but valid raw_response_data when no AI Overview exists)
  let query = supabaseClient
    .from('llm_responses')
    .select('*')
    .eq('audit_id', auditId)
    .is('answer_text', null)
    .is('raw_response_data', null) // Exclude already processed responses (even those without answer_text)
    .limit(100)

  // Apply LLM filter if specified
  if (llmFilter) {
    query = query.eq('llm', llmFilter)
  }

  const { data: pendingResponses } = await query

  if (!pendingResponses || pendingResponses.length === 0) {
    // No pending responses, check if audit should be completed
    await checkAndCompleteAudit(auditId, supabaseClient)
    return
  }

  console.log(`Processing batch of ${pendingResponses.length} pending responses for audit ${auditId}`)

  // Group responses by processing method:
  // - Legacy BrightData: individual snapshot_id (old audits)
  // - Backend API (job-based): job_id — includes both BrightData and OneSearch providers
  const brightdataResponses = pendingResponses.filter(r => r.snapshot_id && !r.job_id)
  const onesearchResponses = pendingResponses.filter(r => r.job_id)

  const results: any[] = []

  // Process BrightData responses
  if (brightdataResponses.length > 0) {
    console.log(`Processing ${brightdataResponses.length} BrightData responses`)
    const brightdataResults = await Promise.all(
      brightdataResponses.map(async (response) => {
        try {
          console.log(`Starting fetch for ${response.llm} snapshot ${response.snapshot_id}`)
          const result = await fetchBrightDataResult(response.llm, response.snapshot_id, apiKey)

          if (result) {
            const { answer_html, response_raw, source_html, page_html, ...cleanedResult } = result

            // Google AI Overview uses aio_text instead of answer_text
            const isGoogleAio = response.llm === 'google-ai-overview' || response.llm === 'google-ai-mode'
            const answerText = isGoogleAio ? (result.aio_text || null) : result.answer_text
            const answerMarkdown = isGoogleAio ? (result.aio_text || null) : result.answer_text_markdown

            return {
              success: true,
              response,
              result,
              update: {
                id: response.id,
                response_url: result.url,
                answer_text: answerText,
                answer_text_markdown: answerMarkdown,
                response_timestamp: result.timestamp,
                raw_response_data: cleanedResult,
                web_search_query: result.web_search_query || null,
                citations: isGoogleAio ? (result.aio_citations || result.organic || null) : (result.citations || null),
                links_attached: result.links_attached || null,
                search_sources: result.search_sources || null,
                is_map: result.is_map || false,
                shopping: result.shopping || null,
                shopping_visible: result.shopping_visible || false,
              }
            }
          } else {
            console.log(`Result not ready yet for ${response.llm} snapshot ${response.snapshot_id}`)
            return { success: false, response, reason: 'not_ready' }
          }
        } catch (error) {
          console.error(`Error fetching result for ${response.llm} ${response.snapshot_id}:`, error)

          return {
            success: false,
            response,
            error: error.message,
            update: {
              id: response.id,
              raw_response_data: {
                error: error.message,
                failed_at: new Date().toISOString()
              }
            }
          }
        }
      })
    )
    results.push(...brightdataResults)
  }

  // Process OneSearch responses (grouped by job_id)
  if (onesearchResponses.length > 0) {
    console.log(`Processing ${onesearchResponses.length} OneSearch responses`)

    // Group by job_id to avoid fetching the same job multiple times
    const jobGroups = new Map<string, any[]>()
    for (const response of onesearchResponses) {
      if (!jobGroups.has(response.job_id)) {
        jobGroups.set(response.job_id, [])
      }
      jobGroups.get(response.job_id)!.push(response)
    }

    console.log(`Processing ${jobGroups.size} OneSearch jobs`)

    // Batch fetch all prompt texts to avoid N+1 queries
    const allPromptIds = onesearchResponses.map(r => r.prompt_id)
    const { data: promptsData } = await supabaseClient
      .from('prompts')
      .select('id, prompt_text')
      .in('id', allPromptIds)

    const promptsMap = new Map(promptsData?.map((p: any) => [p.id, p.prompt_text]) || [])

    for (const [jobId, responses] of jobGroups.entries()) {
      try {
        const onesearchResults = await fetchOneSearchResults(jobId)

        if (onesearchResults && onesearchResults.length > 0) {
          // Match results to responses by prompt text
          for (const response of responses) {
            const prompt = promptsMap.get(response.prompt_id) || ''
            const matchedResult = onesearchResults.find((r: any) => r.prompt === prompt)

            if (matchedResult) {
              results.push({
                success: true,
                response,
                result: matchedResult,
                update: {
                  id: response.id,
                  response_url: matchedResult.url || null,
                  answer_text: matchedResult.answer_text || null,
                  answer_text_markdown: matchedResult.answer_text_markdown || null,
                  response_timestamp: new Date().toISOString(),
                  raw_response_data: matchedResult,
                  web_search_query: matchedResult.web_search_query || null,
                  all_sources: matchedResult.all_sources || null,
                  citations: matchedResult.citations || null,
                  links_attached: matchedResult.links_attached || null,
                }
              })
            } else {
              console.log(`No matching result found for prompt in job ${jobId}`)
              results.push({ success: false, response, reason: 'no_match' })
            }
          }
        } else {
          console.log(`Results not ready yet for OneSearch job ${jobId}`)
          responses.forEach(response => {
            results.push({ success: false, response, reason: 'not_ready' })
          })
        }
      } catch (error) {
        console.error(`Error fetching OneSearch job ${jobId}:`, error)
        responses.forEach(response => {
          results.push({
            success: false,
            response,
            error: error.message,
            update: {
              id: response.id,
              raw_response_data: {
                error: error.message,
                failed_at: new Date().toISOString()
              }
            }
          })
        })
      }
    }
  }

  // Batch update all successful and failed responses using upsert
  const updatesToApply = results.filter(r => r.update).map(r => r.update)

  if (updatesToApply.length > 0) {
    // Use upsert with onConflict to perform batch update in a single query
    const { error: updateError } = await supabaseClient
      .from('llm_responses')
      .upsert(updatesToApply, { onConflict: 'id' })

    if (updateError) {
      console.error('Error batch updating LLM responses:', updateError)
    } else {
      console.log(`Batch updated ${updatesToApply.length} LLM responses in single query`)
    }
  }

  // Parse and store citations for successful results (batched)
  const successfulResults = results.filter(r => r.success && r.result)
  if (successfulResults.length > 0) {
    // Collect all citations across all responses
    const allCitations: any[] = []
    const deleteKeys: { audit_id: string; prompt_id: string; llm: string }[] = []

    for (const { result, response } of successfulResults) {
      deleteKeys.push({
        audit_id: response.audit_id,
        prompt_id: response.prompt_id,
        llm: response.llm,
      })
      // Use parseCitationsCollect to gather citations without DB operations
      const citations = collectCitations(result, response)
      allCitations.push(...citations)
    }

    // Batch delete existing citations for all processed responses
    for (const key of deleteKeys) {
      await supabaseClient
        .from('citations')
        .delete()
        .eq('audit_id', key.audit_id)
        .eq('prompt_id', key.prompt_id)
        .eq('llm', key.llm)
    }

    // Batch insert all citations in one operation
    if (allCitations.length > 0) {
      console.log(`Batch inserting ${allCitations.length} citations for ${successfulResults.length} responses`)
      const { error } = await supabaseClient
        .from('citations')
        .insert(allCitations)

      if (error) {
        console.error('Error batch inserting citations:', error)
      } else {
        console.log(`Successfully batch inserted ${allCitations.length} citations`)
      }
    }
  }
  
  // Log results summary
  const successful = results.filter(r => r.success).length
  const failed = results.filter(r => !r.success && r.error).length
  const notReady = results.filter(r => !r.success && r.reason === 'not_ready').length
  
  console.log(`Batch processing completed: ${successful} successful, ${failed} failed, ${notReady} not ready`)

  // Update overall audit progress and check for completion
  await updateAuditProgress(auditId, supabaseClient)
  await checkAndCompleteAudit(auditId, supabaseClient)

  // Refresh metrics for this audit
  await refreshAuditMetrics(auditId, supabaseClient)
}

async function updateAuditProgress(auditId: string, supabaseClient: any) {
  // Progress is now calculated by the materialized view and auto-completion logic
  // This function is kept for backward compatibility but does minimal work
  console.log(`Audit ${auditId} progress tracking delegated to materialized view`)
}

async function checkAndCompleteAudit(auditId: string, supabaseClient: any) {
  // Check if there are any remaining unprocessed responses
  // A response is considered processed if it has EITHER answer_text OR an error in raw_response_data
  const { data: allResponses, count: totalResponses } = await supabaseClient
    .from('llm_responses')
    .select('id, answer_text, raw_response_data', { count: 'exact' })
    .eq('audit_id', auditId)

  if (!allResponses || totalResponses === 0) {
    console.log(`No responses found for audit ${auditId}`)
    return
  }

  // Count responses that are NOT processed (no answer_text AND no raw_response_data with content)
  const unprocessedResponses = allResponses.filter(r => {
    const hasAnswerText = r.answer_text !== null
    const hasRawData = r.raw_response_data && Object.keys(r.raw_response_data).length > 0
    return !hasAnswerText && !hasRawData
  })

  const remainingResponses = unprocessedResponses.length

  console.log(`Audit ${auditId}: ${remainingResponses}/${totalResponses} responses still pending`)
  console.log(`Processed: ${totalResponses - remainingResponses}, Pending: ${remainingResponses}`)

  if (remainingResponses === 0) {
    console.log(`All responses processed for audit ${auditId} (including ${allResponses.filter(r => r.raw_response_data?.error).length} errors), completing audit`)
    await completeAudit(auditId, supabaseClient)
  } else {
    console.log(`${remainingResponses} responses still pending for audit ${auditId}`)
  }
}

async function runCompetitorsExtraction(auditId: string, supabaseClient: any) {
  try {
    // Check if competitors step is already done
    const { data: competitorsStep } = await supabaseClient
      .from('audit_steps')
      .select('status')
      .eq('audit_id', auditId)
      .eq('step', 'competitors')
      .single()

    if (competitorsStep?.status === 'done') {
      console.log(`Competitors extraction already completed for audit ${auditId}`)
      return
    }

    // Update competitors step to running
    await supabaseClient
      .from('audit_steps')
      .update({
        status: 'running',
        message: 'Extracting competitors from LLM responses...'
      })
      .eq('audit_id', auditId)
      .eq('step', 'competitors')

    // Update audit current_step to processing_results
    await supabaseClient
      .from('audits')
      .update({ current_step: 'processing_results' })
      .eq('id', auditId)
      .eq('status', 'running')

    // Get LLM responses that have answer_text but no extracted_competitors yet
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
      .or('answer_competitors.is.null,answer_competitors.eq.{"brands":[]}' as any)

    if (!responsesToProcess || responsesToProcess.length === 0) {
      console.log(`No LLM responses to process for competitors extraction in audit ${auditId}`)
      await supabaseClient
        .from('audit_steps')
        .update({ 
          status: 'done',
          message: 'No responses to process for competitors extraction'
        })
        .eq('audit_id', auditId)
        .eq('step', 'competitors')
      return
    }

    console.log(`Processing ${responsesToProcess.length} LLM responses for competitors extraction`)

    // Process responses in batches (increased from 3 for better throughput)
    const batchSize = 10
    let processedCount = 0

    for (let i = 0; i < responsesToProcess.length; i += batchSize) {
      const batch = responsesToProcess.slice(i, i + batchSize)
      
      await Promise.all(batch.map(async (response) => {
        try {
          console.log(`Extracting competitors from response ${response.id}`)
          
          const { data, error } = await supabaseClient.functions.invoke('extract-competitors', {
            body: {
              prompt: response.prompts?.prompt_text || '',
              answerText: response.answer_text,
              responseId: response.id,
              auditId: auditId
            }
          })

          if (error) {
            console.error(`Error extracting competitors for response ${response.id}:`, error)
            
            // Mark this response as failed for competitor extraction to prevent infinite retries
            await supabaseClient
              .from('llm_responses')
              .update({
                answer_competitors: {
                  brands: [],
                  error: 'extraction_failed',
                  details: error.message || 'Unknown error',
                  failed_at: new Date().toISOString()
                }
              })
              .eq('id', response.id)
          } else {
            console.log(`Successfully extracted competitors for response ${response.id}:`, data)
          }
        } catch (error) {
          console.error(`Error processing response ${response.id} for competitors:`, error)
          
          // Mark this response as failed for competitor extraction
          try {
            await supabaseClient
              .from('llm_responses')
              .update({
                answer_competitors: {
                  brands: [],
                  error: 'processing_failed',
                  details: error.message || 'Unknown processing error',
                  failed_at: new Date().toISOString()
                }
              })
              .eq('id', response.id)
          } catch (updateError) {
            console.error(`Failed to mark response ${response.id} as failed:`, updateError)
          }
        }
      }))

      processedCount += batch.length
      console.log(`Processed ${processedCount}/${responsesToProcess.length} responses for competitors extraction`)

      // Short delay between batches to avoid rate limiting
      if (i + batchSize < responsesToProcess.length) {
        await new Promise(resolve => setTimeout(resolve, 200))
      }
    }

    // Update competitors step to done
    await supabaseClient
      .from('audit_steps')
      .update({ 
        status: 'done',
        message: `Competitors extraction completed for ${processedCount} responses`
      })
      .eq('audit_id', auditId)
      .eq('step', 'competitors')

    console.log(`Competitors extraction completed for audit ${auditId}`)
  } catch (error) {
    console.error(`Error in competitors extraction for audit ${auditId}:`, error)
    
    // Mark competitors step as error
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

async function completeAudit(auditId: string, supabaseClient: any) {
  console.log(`Starting completion process for audit ${auditId}`)
  
  // Check if sentiment analysis is enabled for this audit
  const { data: auditData } = await supabaseClient
    .from('audits')
    .select('sentiment')
    .eq('id', auditId)
    .single()

  const sentimentEnabled = auditData?.sentiment || false

  // Run competitors extraction before sentiment analysis
  await runCompetitorsExtraction(auditId, supabaseClient)

  if (sentimentEnabled) {
    console.log(`Running sentiment analysis for audit ${auditId}`)
    await runSentimentAnalysis(auditId, supabaseClient)
  }

  // Update parse step to done
  await supabaseClient
    .from('audit_steps')
    .update({ 
      status: 'done',
      message: 'LLM results parsed successfully'
    })
    .eq('audit_id', auditId)
    .eq('step', 'parse')

  // Update sentiment and persist steps to done as well
  await supabaseClient
    .from('audit_steps')
    .update({ status: 'done' })
    .eq('audit_id', auditId)
    .in('step', ['sentiment', 'persist'])

  // Complete the audit
  await supabaseClient
    .from('audits')
    .update({
      status: 'completed',
      progress: 100,
      current_step: null,
      finished_at: new Date().toISOString()
    })
    .eq('id', auditId)

  // Calculate and save project metrics
  await calculateAndSaveProjectMetrics(auditId, supabaseClient)

  console.log(`Audit ${auditId} completed successfully`)
}

async function runSentimentAnalysis(auditId: string, supabaseClient: any) {
  try {
    // Update sentiment step to running
    await supabaseClient
      .from('audit_steps')
      .update({
        status: 'running',
        message: 'Running sentiment analysis...'
      })
      .eq('audit_id', auditId)
      .eq('step', 'sentiment')

    // Update audit current_step to sentiment_analysis
    await supabaseClient
      .from('audits')
      .update({ current_step: 'sentiment_analysis' })
      .eq('id', auditId)
      .eq('status', 'running')

    // Get project brands for this audit
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
      console.log('No brands found for sentiment analysis')
      return
    }

    const brands = auditWithProject.projects.brands.map(b => b.brand_name)
    console.log(`Found ${brands.length} own brands for sentiment analysis:`, brands)

    // Get all LLM responses for this audit that have answer_text and no sentiment yet
    const { data: llmResponses } = await supabaseClient
      .from('llm_responses')
      .select('*')
      .eq('audit_id', auditId)
      .not('answer_text', 'is', null)
      .is('sentiment_score', null)

    if (!llmResponses || llmResponses.length === 0) {
      console.log('No LLM responses found for sentiment analysis')
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

    console.log(`Running sentiment analysis on ${llmResponses.length} LLM responses for ${brands.length} brands`)

    // Process LLM responses in batches (increased from 5 for better throughput)
    const batchSize = 15
    let processedCount = 0
    const sentimentUpdates: any[] = []

    for (let i = 0; i < llmResponses.length; i += batchSize) {
      const batch = llmResponses.slice(i, i + batchSize)

      await Promise.all(batch.map(async (llmResponse) => {
        // Check each brand mentioned in this LLM response
        for (const brand of brands) {
          const responseText = llmResponse.answer_text.toLowerCase()
          const brandLower = brand.toLowerCase()

          // Simple check if brand is mentioned in LLM response
          if (responseText.includes(brandLower)) {
            try {
              console.log(`Analyzing sentiment for brand "${brand}" in LLM response ${llmResponse.id}`)

              // Call sentiment analysis function
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

                // Convert perception to sentiment_label and magnitude to sentiment_score
                const sentimentScore = perception === 'positive' ? magnitude / 5 :
                                    perception === 'negative' ? -magnitude / 5 : 0

                // Collect updates for batch operation
                sentimentUpdates.push({
                  id: llmResponse.id,
                  sentiment_score: sentimentScore,
                  sentiment_label: perception
                })

                console.log(`Prepared sentiment update for LLM response ${llmResponse.id}: ${perception} (${sentimentScore})`)
              } else {
                console.error(`Sentiment analysis failed for LLM response ${llmResponse.id}:`, sentimentResponse.error)
              }
            } catch (error) {
              console.error(`Error analyzing sentiment for LLM response ${llmResponse.id}:`, error)
            }
            break // Only analyze once per LLM response, even if multiple brands are mentioned
          }
        }
      }))

      processedCount += batch.length
      console.log(`Processed ${processedCount}/${llmResponses.length} LLM responses for sentiment analysis`)
    }

    // Batch update all sentiment scores in a single query
    if (sentimentUpdates.length > 0) {
      const { error: sentimentError } = await supabaseClient
        .from('llm_responses')
        .upsert(sentimentUpdates, { onConflict: 'id' })

      if (sentimentError) {
        console.error('Error batch updating sentiment scores:', sentimentError)
      } else {
        console.log(`Batch updated ${sentimentUpdates.length} sentiment scores in single query`)
      }
    }

    // Update sentiment step to done
    await supabaseClient
      .from('audit_steps')
      .update({
        status: 'done',
        message: `Sentiment analysis completed for ${processedCount} LLM responses`
      })
      .eq('audit_id', auditId)
      .eq('step', 'sentiment')

    console.log(`Sentiment analysis completed for audit ${auditId}`)
  } catch (error) {
    console.error(`Error in sentiment analysis for audit ${auditId}:`, error)
    
    // Mark sentiment step as error
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

  console.log(`[poll] Fetching OneSearch job ${jobId} from ${onesearchApiUrl}`)
  console.log(`[poll] API Key configured: ${onesearchApiKey ? 'Yes' : 'No'}`)

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 30000)

  try {
    // First check job status
    const statusHeaders: Record<string, string> = {}
    if (onesearchApiKey) {
      statusHeaders['X-API-Key'] = onesearchApiKey
    }

    const statusResponse = await fetch(`${onesearchApiUrl}/api/v1/jobs/${jobId}`, {
      headers: statusHeaders,
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!statusResponse.ok) {
      if (statusResponse.status === 404) {
        console.log(`[poll] OneSearch job ${jobId} not found (404)`)
        return null // Job not found or not ready
      }
      const errorText = await statusResponse.text()
      console.error(`[poll] OneSearch status API error: ${statusResponse.status}`, errorText.substring(0, 500))
      throw new Error(`OneSearch API error: ${statusResponse.status} - ${errorText}`)
    }

    const statusData = await statusResponse.json()
    console.log(`[poll] OneSearch job ${jobId} status:`, JSON.stringify(statusData))

    // Check if job failed
    if (statusData.status === 'failed' || statusData.status === 'Failed') {
      console.error(`[poll] OneSearch job ${jobId} FAILED:`, JSON.stringify(statusData))
      throw new Error(`OneSearch job failed: ${JSON.stringify(statusData.error || statusData)}`)
    }

    // Check if job is completed
    if (statusData.status !== 'completed') {
      console.log(`[poll] OneSearch job ${jobId} status: ${statusData.status}`)
      return null // Not ready yet
    }

    // Check if converted results file is available
    if (!statusData.converted_results_file) {
      console.log(`[poll] OneSearch job ${jobId} completed but converted_results_file not available yet`)
      return null // Results not ready yet
    }

    console.log(`[poll] OneSearch job ${jobId} completed with converted_results_file: ${statusData.converted_results_file}`)

    // Fetch results
    const resultsTimeoutId = setTimeout(() => controller.abort(), 30000)

    const resultsHeaders: Record<string, string> = {}
    if (onesearchApiKey) {
      resultsHeaders['X-API-Key'] = onesearchApiKey
    }

    const resultsResponse = await fetch(
      `${onesearchApiUrl}/api/v1/jobs/${jobId}/results?format=converted`,
      {
        headers: resultsHeaders,
        signal: controller.signal,
      }
    )

    clearTimeout(resultsTimeoutId)

    if (!resultsResponse.ok) {
      const errorText = await resultsResponse.text()
      console.error(`[poll] OneSearch results API error ${resultsResponse.status}:`, errorText.substring(0, 500))
      throw new Error(`OneSearch results API error: ${resultsResponse.status}`)
    }

    const resultsData = await resultsResponse.json()
    console.log(`[poll] OneSearch job ${jobId} fetched ${Array.isArray(resultsData) ? resultsData.length : Object.keys(resultsData).length} results`)

    // OneSearch returns results in { results: [...] } format or as an array
    return resultsData.results || resultsData

  } catch (error) {
    clearTimeout(timeoutId)
    if (error.name === 'AbortError') {
      console.log(`OneSearch API timeout for job ${jobId}`)
      return null // Return null so polling can retry
    }
    throw error
  }
}

async function fetchBrightDataResult(llm: string, snapshotId: string, apiKey: string): Promise<any> {
  let url: string

  // URL-encode the snapshot ID to handle special characters
  const encodedSnapshotId = encodeURIComponent(snapshotId)

  // All BrightData snapshots use the same download endpoint regardless of LLM/dataset
  const supportedLLMs = ['searchgpt', 'perplexity', 'gemini', 'google-ai-overview', 'google-ai-mode', 'copilot', 'grok']
  if (!supportedLLMs.includes(llm)) {
    throw new Error(`Unsupported LLM: ${llm}`)
  }

  url = `https://api.brightdata.com/datasets/v3/snapshot/${encodedSnapshotId}?format=json`

  // Create AbortController with 45-second timeout (leaving buffer for Edge Function timeout)
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 45000)

  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      if (response.status === 404) {
        return null // Result not ready yet
      }
      throw new Error(`Brightdata snapshot API error: ${response.status}`)
    }

    const data = await response.json()
    return data[0] // Brightdata returns an array, we want the first item
  } catch (error) {
    clearTimeout(timeoutId)
    if (error.name === 'AbortError') {
      console.log(`Brightdata API timeout for ${llm} snapshot ${snapshotId} after 45 seconds - will retry in next poll`)
      return null // Return null so polling can retry
    }
    if (error instanceof TypeError && error.message === 'Failed to fetch') {
      console.log(`Network error for ${llm} snapshot ${snapshotId} - will retry in next poll`)
      return null // Return null so polling can retry
    }
    throw error
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

  console.log(`Parsing citations for ${llmResponse.llm}`)
  console.log('Result structure:', Object.keys(result))

  // SearchGPT and ChatGPT: Use links_attached for citation count
  if ((llmResponse.llm === 'searchgpt' || llmResponse.llm === 'chatgpt') && result.links_attached) {
    console.log(`${llmResponse.llm}: Found ${result.links_attached.length} links_attached`)
    result.links_attached.forEach((link: any, index: number) => {
      citations.push({
        audit_id: llmResponse.audit_id,
        prompt_id: llmResponse.prompt_id,
        llm: llmResponse.llm,
        page_url: link.url,
        domain: extractDomain(link.url),
        citation_text: link.text || link.title || 'No description available',
        position: link.position || index + 1,
        cited: link.cited !== undefined ? link.cited : null,
        checked_at: new Date().toISOString(),
      })
    })
  } else if (llmResponse.llm === 'perplexity' && result.sources) {
    // Perplexity sources format
    console.log(`Perplexity: Found ${result.sources.length} sources`)
    console.log('First source structure:', result.sources[0] ? Object.keys(result.sources[0]) : 'No sources')

    result.sources.forEach((source: any, index: number) => {
      const citationText = source.title || source.description || source.snippet || 'No description available'
      console.log(`Processing source ${index + 1}:`, {
        url: source.url,
        title: source.title,
        description: source.description,
        snippet: source.snippet,
        citationText
      })

      citations.push({
        audit_id: llmResponse.audit_id,
        prompt_id: llmResponse.prompt_id,
        llm: llmResponse.llm,
        page_url: source.url,
        domain: extractDomain(source.url),
        citation_text: citationText,
        position: index + 1,
        checked_at: new Date().toISOString(),
      })
    })
  } else if ((llmResponse.llm === 'google-ai-overview' || llmResponse.llm === 'google-ai-mode') && result.aio_citations) {
    // Google AI Overview: citations from aio_citations
    console.log(`${llmResponse.llm}: Found ${result.aio_citations.length} aio_citations`)
    result.aio_citations.forEach((citation: any, index: number) => {
      citations.push({
        audit_id: llmResponse.audit_id,
        prompt_id: llmResponse.prompt_id,
        llm: llmResponse.llm,
        page_url: citation.url || citation.link || '',
        domain: extractDomain(citation.url || citation.link || ''),
        citation_text: citation.title || citation.text || citation.snippet || 'No description available',
        position: index + 1,
        checked_at: new Date().toISOString(),
      })
    })
  } else if ((llmResponse.llm === 'google-ai-overview' || llmResponse.llm === 'google-ai-mode') && result.organic) {
    // Google AI Overview fallback: use organic results as citations
    console.log(`${llmResponse.llm}: Using ${result.organic.length} organic results as citations`)
    result.organic.forEach((item: any, index: number) => {
      citations.push({
        audit_id: llmResponse.audit_id,
        prompt_id: llmResponse.prompt_id,
        llm: llmResponse.llm,
        page_url: item.url || item.link || '',
        domain: extractDomain(item.url || item.link || ''),
        citation_text: item.title || item.description || 'No description available',
        position: index + 1,
        checked_at: new Date().toISOString(),
      })
    })
  } else {
    console.log(`No citations found for ${llmResponse.llm}. Available fields:`, Object.keys(result))

    // Check for Gemini links_attached format
    if (llmResponse.llm === 'gemini' && result.links_attached) {
      console.log(`Gemini: Found ${result.links_attached.length} links_attached`)
      result.links_attached.forEach((link: any, index: number) => {
        citations.push({
          audit_id: llmResponse.audit_id,
          prompt_id: llmResponse.prompt_id,
          llm: llmResponse.llm,
          page_url: link.url,
          domain: extractDomain(link.url),
          citation_text: link.text || 'No description available',
          position: link.position || index + 1,
          checked_at: new Date().toISOString(),
        })
      })
    } else if ((llmResponse.llm === 'searchgpt' || llmResponse.llm === 'chatgpt') && result.citations) {
      // Fallback: Check for citations field if links_attached not found
      console.log(`${llmResponse.llm}: Found ${result.citations.length} citations (fallback)`)
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
    } else {
      if (llmResponse.llm === 'perplexity') {
        console.log('Perplexity result sample:', JSON.stringify(result, null, 2).substring(0, 1000))
      }
      if (llmResponse.llm === 'gemini') {
        console.log('Gemini result sample:', JSON.stringify(result, null, 2).substring(0, 1000))
      }
      if (llmResponse.llm === 'searchgpt' || llmResponse.llm === 'chatgpt') {
        console.log(`${llmResponse.llm} result sample:`, JSON.stringify(result, null, 2).substring(0, 1000))
      }
    }
  }

  if (citations.length > 0) {
    console.log(`Parsed ${citations.length} citations for ${llmResponse.llm}:`, citations)
    const { error } = await supabaseClient
      .from('citations')
      .insert(citations)
    
    if (error) {
      console.error(`Error inserting citations for ${llmResponse.llm}:`, error)
    } else {
      console.log(`Successfully inserted ${citations.length} citations for ${llmResponse.llm}`)
    }
  } else {
    console.log(`No citations parsed for ${llmResponse.llm}`)
  }
}

function collectCitations(result: any, llmResponse: any): any[] {
  const citations: any[] = []

  // SearchGPT and ChatGPT: Use links_attached
  if ((llmResponse.llm === 'searchgpt' || llmResponse.llm === 'chatgpt') && result.links_attached) {
    result.links_attached.forEach((link: any, index: number) => {
      citations.push({
        audit_id: llmResponse.audit_id,
        prompt_id: llmResponse.prompt_id,
        llm: llmResponse.llm,
        page_url: link.url,
        domain: extractDomain(link.url),
        citation_text: link.text || link.title || 'No description available',
        position: link.position || index + 1,
        cited: link.cited !== undefined ? link.cited : null,
        checked_at: new Date().toISOString(),
      })
    })
  } else if (llmResponse.llm === 'perplexity' && result.sources) {
    result.sources.forEach((source: any, index: number) => {
      citations.push({
        audit_id: llmResponse.audit_id,
        prompt_id: llmResponse.prompt_id,
        llm: llmResponse.llm,
        page_url: source.url,
        domain: extractDomain(source.url),
        citation_text: source.title || source.description || source.snippet || 'No description available',
        position: index + 1,
        checked_at: new Date().toISOString(),
      })
    })
  } else if ((llmResponse.llm === 'google-ai-overview' || llmResponse.llm === 'google-ai-mode') && result.aio_citations) {
    result.aio_citations.forEach((citation: any, index: number) => {
      citations.push({
        audit_id: llmResponse.audit_id,
        prompt_id: llmResponse.prompt_id,
        llm: llmResponse.llm,
        page_url: citation.url || citation.link || '',
        domain: extractDomain(citation.url || citation.link || ''),
        citation_text: citation.title || citation.text || citation.snippet || 'No description available',
        position: index + 1,
        checked_at: new Date().toISOString(),
      })
    })
  } else if ((llmResponse.llm === 'google-ai-overview' || llmResponse.llm === 'google-ai-mode') && result.organic) {
    result.organic.forEach((item: any, index: number) => {
      citations.push({
        audit_id: llmResponse.audit_id,
        prompt_id: llmResponse.prompt_id,
        llm: llmResponse.llm,
        page_url: item.url || item.link || '',
        domain: extractDomain(item.url || item.link || ''),
        citation_text: item.title || item.description || 'No description available',
        position: index + 1,
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
        checked_at: new Date().toISOString(),
      })
    })
  } else if ((llmResponse.llm === 'searchgpt' || llmResponse.llm === 'chatgpt') && result.citations) {
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
  }

  return citations
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
    console.log(`Refreshing metrics for audit ${auditId}`)

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
      console.error(`Error refreshing metrics:`, error)
    } else {
      console.log(`Metrics refreshed for audit ${auditId}`)
    }
  } catch (error) {
    console.error('Error in refreshAuditMetrics:', error)
  }
}

async function calculateAndSaveProjectMetrics(auditId: string, supabaseClient: any) {
  try {
    console.log(`Calculating project metrics for audit ${auditId}`)

    // Get project ID from audit
    const { data: audit } = await supabaseClient
      .from('audits')
      .select('project_id')
      .eq('id', auditId)
      .single()

    if (!audit) {
      console.error('Audit not found for metrics calculation')
      return
    }

    const projectId = audit.project_id

    // Get total prompts count
    const { count: totalPrompts } = await supabaseClient
      .from('prompts')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', projectId)

    // Get total completed audits count
    const { count: totalAudits } = await supabaseClient
      .from('audits')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .eq('status', 'completed')

    // Get project domain and brands
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

    // Get all audit IDs for this project
    const { data: auditsData } = await supabaseClient
      .from('audits')
      .select('id')
      .eq('project_id', projectId)

    const auditIds = auditsData?.map(a => a.id) || []

    // Calculate mention rate
    let mentionRate = 0
    if (auditIds.length > 0 && ownBrands.length > 0) {
      const { data: llmResponsesData } = await supabaseClient
        .from('llm_responses')
        .select('answer_text, audit_id, prompt_id')
        .in('audit_id', auditIds)
        .not('answer_text', 'is', null)
        .not('audit_id', 'is', null)
        .not('prompt_id', 'is', null)

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

    // Calculate citation rate
    let citationRate = 0
    if (auditIds.length > 0 && project) {
      const { data: citationsData } = await supabaseClient
        .from('citations')
        .select('domain, audit_id, prompt_id, llm')
        .in('audit_id', auditIds)
        .not('domain', 'is', null)
        .not('audit_id', 'is', null)
        .not('prompt_id', 'is', null)

      const { data: llmResponsesCount } = await supabaseClient
        .from('llm_responses')
        .select('audit_id, prompt_id, llm')
        .in('audit_id', auditIds)
        .not('audit_id', 'is', null)
        .not('prompt_id', 'is', null)

      if (citationsData && llmResponsesCount && llmResponsesCount.length > 0) {
        const projectDomain = project.domain.toLowerCase().replace(/^www\./, '')

        const citedLlmResponseIds = new Set(
          citationsData
            .filter(c => {
              const citationDomain = c.domain?.toLowerCase().replace(/^www\./, '') || ''
              const matchesDomain = citationDomain === projectDomain || citationDomain.endsWith(`.${projectDomain}`)
              // Only count citations where cited is true or null (missing field)
              // Exclude citations where cited is explicitly false
              const isCited = c.cited !== false
              return matchesDomain && isCited
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
      .single()

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
      console.error('Error saving project metrics:', metricsError)
    } else {
      console.log(`Successfully saved metrics for project ${projectId}: mention_rate=${mentionRate}%, citation_rate=${citationRate}%`)
    }
  } catch (error) {
    console.error('Error calculating project metrics:', error)
  }
}
