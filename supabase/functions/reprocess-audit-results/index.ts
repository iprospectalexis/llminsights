import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface ReprocessRequest {
  audit_id: string
  job_id?: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      )
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { audit_id, job_id }: ReprocessRequest = await req.json()

    if (!audit_id) {
      return new Response(
        JSON.stringify({ error: 'audit_id is required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    console.log(`[reprocess] Starting reprocessing for audit ${audit_id}`)

    // Get all llm_responses for this audit FROM ONESEARCH API ONLY
    const { data: responses, error: responsesError } = await supabaseClient
      .from('llm_responses')
      .select('*')
      .eq('audit_id', audit_id)
      .eq('data_provider', 'OneSearch SERP API')

    if (responsesError || !responses || responses.length === 0) {
      return new Response(
        JSON.stringify({
          error: 'No OneSearch API responses found for this audit',
          audit_id,
          message: 'This audit may use BrightData or have no responses'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 }
      )
    }

    // Get unique job_ids
    const jobIds = [...new Set(responses.map(r => r.job_id).filter(Boolean))]

    if (jobIds.length === 0) {
      return new Response(
        JSON.stringify({
          error: 'No job_ids found for OneSearch API responses',
          audit_id,
          message: 'OneSearch responses do not have job_ids'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    console.log(`[reprocess] Found ${jobIds.length} job_ids to process`)

    let totalUpdated = 0
    const failedJobs: Array<{ job_id: string; reason: string }> = []

    // Process each job_id
    for (const currentJobId of jobIds) {
      if (job_id && currentJobId !== job_id) {
        continue // Skip if specific job_id is requested
      }

      console.log(`[reprocess] Processing job_id: ${currentJobId}`)

      // Fetch results from OneSearch API
      let results
      try {
        results = await fetchOneSearchResults(currentJobId)
      } catch (error) {
        const errorMsg = error.message || 'Unknown error'
        console.error(`[reprocess] Error fetching job ${currentJobId}:`, errorMsg)
        failedJobs.push({ job_id: currentJobId, reason: errorMsg })
        continue
      }

      if (!results || results.length === 0) {
        const reason = 'Job not found or has no results on OneSearch API'
        console.error(`[reprocess] No results found for job ${currentJobId}`)
        failedJobs.push({ job_id: currentJobId, reason })
        continue
      }

      console.log(`[reprocess] Fetched ${results.length} results for job ${currentJobId}`)

      // Get responses for this job_id
      const jobResponses = responses.filter(r => r.job_id === currentJobId)

      // Match and update each response
      for (const response of jobResponses) {
        const prompt = await getPromptText(response.prompt_id, supabaseClient)
        const matchedResult = results.find((r: any) => r.prompt === prompt)

        if (matchedResult) {
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
            })
            .eq('id', response.id)

          if (updateError) {
            console.error(`[reprocess] Error updating response:`, response.id, updateError)
          } else {
            totalUpdated++
            console.log(`[reprocess] Updated response ${response.id}`)

            // Parse and store citations
            await parseCitations(matchedResult, response, supabaseClient)
          }
        } else {
          console.warn(`[reprocess] No matching result found for response ${response.id}`)
        }
      }
    }

    console.log(`[reprocess] Updated ${totalUpdated}/${responses.length} responses`)

    // Get audit sentiment setting
    const { data: auditData } = await supabaseClient
      .from('audits')
      .select('sentiment')
      .eq('id', audit_id)
      .single()

    const sentimentEnabled = auditData?.sentiment || false

    // Run competitors extraction immediately on all responses with answers
    console.log(`[reprocess] Running competitors extraction on responses with answers`)
    await runCompetitorsExtraction(audit_id, supabaseClient)

    // Run sentiment analysis immediately if enabled
    if (sentimentEnabled) {
      console.log(`[reprocess] Running sentiment analysis on responses with answers`)
      await runSentimentAnalysis(audit_id, supabaseClient)
    }

    // Check if audit should be completed
    await checkAndCompleteAudit(audit_id, supabaseClient)

    // Refresh metrics for this audit
    await refreshAuditMetrics(audit_id, supabaseClient)

    const responseData: any = {
      success: totalUpdated > 0,
      message: `Reprocessed ${totalUpdated} of ${responses.length} responses`,
      audit_id,
      total_responses: responses.length,
      updated_count: totalUpdated,
    }

    if (failedJobs.length > 0) {
      responseData.failed_jobs = failedJobs
      responseData.warning = `${failedJobs.length} job(s) could not be fetched from OneSearch API`
    }

    return new Response(
      JSON.stringify(responseData),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error) {
    console.error('[reprocess] Error:', error)
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
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

  console.log(`[reprocess] Fetching results for job ${jobId}`)

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
        console.log(`[reprocess] OneSearch job ${jobId} not found (404)`)
        return null
      }
      const errorText = await statusResponse.text()
      console.error(`[reprocess] OneSearch status API error: ${statusResponse.status}`, errorText.substring(0, 500))
      throw new Error(`OneSearch API error: ${statusResponse.status} - ${errorText}`)
    }

    const statusData = await statusResponse.json()
    console.log(`[reprocess] OneSearch job ${jobId} status:`, JSON.stringify(statusData))

    // Check if job failed
    if (statusData.status === 'failed' || statusData.status === 'Failed') {
      console.error(`[reprocess] OneSearch job ${jobId} FAILED:`, JSON.stringify(statusData))
      throw new Error(`OneSearch job failed: ${JSON.stringify(statusData.error || statusData)}`)
    }

    // Check if job is completed
    if (statusData.status !== 'completed') {
      console.log(`[reprocess] OneSearch job ${jobId} status: ${statusData.status}`)
      return null
    }

    // Check if converted results file is available
    if (!statusData.converted_results_file) {
      console.log(`[reprocess] OneSearch job ${jobId} completed but converted_results_file not available yet`)
      return null
    }

    console.log(`[reprocess] OneSearch job ${jobId} completed with converted_results_file: ${statusData.converted_results_file}`)

    // Fetch results with pagination
    const resultsHeaders: Record<string, string> = {}
    if (onesearchApiKey) {
      resultsHeaders['X-API-Key'] = onesearchApiKey
    }

    const allResults: any[] = []
    let page = 1
    const perPage = 100
    let hasMore = true

    while (hasMore) {
      const resultsController = new AbortController()
      const resultsTimeoutId = setTimeout(() => resultsController.abort(), 60000)

      try {
        console.log(`[reprocess] Fetching page ${page} for job ${jobId}`)

        const resultsResponse = await fetch(
          `${onesearchApiUrl}/api/v1/jobs/${jobId}/results?format=converted&page=${page}&per_page=${perPage}`,
          {
            headers: resultsHeaders,
            signal: resultsController.signal,
          }
        )

        clearTimeout(resultsTimeoutId)

        if (!resultsResponse.ok) {
          const errorText = await resultsResponse.text()
          console.error(`[reprocess] OneSearch results API error ${resultsResponse.status}:`, errorText.substring(0, 500))
          throw new Error(`OneSearch results API error: ${resultsResponse.status}`)
        }

        const resultsData = await resultsResponse.json()
        const pageResults = resultsData.results || resultsData

        if (!Array.isArray(pageResults) || pageResults.length === 0) {
          hasMore = false
          break
        }

        allResults.push(...pageResults)
        console.log(`[reprocess] Fetched ${pageResults.length} results from page ${page} (total so far: ${allResults.length})`)

        if (pageResults.length < perPage) {
          hasMore = false
        } else {
          page++
        }
      } catch (pageError) {
        clearTimeout(resultsTimeoutId)
        if (pageError.name === 'AbortError') {
          throw new Error(`OneSearch API timeout for job ${jobId} page ${page}`)
        }
        throw pageError
      }
    }

    console.log(`[reprocess] Fetched total of ${allResults.length} results across ${page} page(s)`)
    return allResults

  } catch (error) {
    clearTimeout(timeoutId)
    if (error.name === 'AbortError') {
      throw new Error(`OneSearch API timeout for job ${jobId}`)
    }
    throw error
  }
}

async function checkAndCompleteAudit(auditId: string, supabaseClient: any) {
  const { data: allResponses, count: totalResponses } = await supabaseClient
    .from('llm_responses')
    .select('id, answer_text, raw_response_data', { count: 'exact' })
    .eq('audit_id', auditId)

  if (!allResponses || totalResponses === 0) {
    return
  }

  const unprocessedResponses = allResponses.filter(r => {
    const hasAnswerText = r.answer_text !== null
    const hasRawData = r.raw_response_data && Object.keys(r.raw_response_data).length > 0
    return !hasAnswerText && !hasRawData
  })

  const remainingResponses = unprocessedResponses.length

  console.log(`[reprocess] Audit ${auditId}: ${remainingResponses}/${totalResponses} responses still pending`)

  if (remainingResponses === 0) {
    console.log(`[reprocess] All responses processed, completing audit ${auditId}`)
    await completeAudit(auditId, supabaseClient)
  }
}

async function completeAudit(auditId: string, supabaseClient: any) {
  console.log(`[reprocess] Completing audit ${auditId}`)

  const { data: auditData } = await supabaseClient
    .from('audits')
    .select('sentiment')
    .eq('id', auditId)
    .single()

  const sentimentEnabled = auditData?.sentiment || false

  await runCompetitorsExtraction(auditId, supabaseClient)

  if (sentimentEnabled) {
    await runSentimentAnalysis(auditId, supabaseClient)
  }

  await supabaseClient
    .from('audit_steps')
    .update({ status: 'done', message: 'LLM results parsed successfully' })
    .eq('audit_id', auditId)
    .eq('step', 'parse')

  await supabaseClient
    .from('audit_steps')
    .update({ status: 'done' })
    .eq('audit_id', auditId)
    .in('step', ['sentiment', 'persist'])

  await supabaseClient
    .from('audits')
    .update({
      status: 'completed',
      progress: 100,
      finished_at: new Date().toISOString()
    })
    .eq('id', auditId)

  await calculateAndSaveProjectMetrics(auditId, supabaseClient)

  console.log(`[reprocess] Audit ${auditId} completed`)
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
      return
    }

    await supabaseClient
      .from('audit_steps')
      .update({ status: 'running', message: 'Extracting competitors...' })
      .eq('audit_id', auditId)
      .eq('step', 'competitors')

    const { data: responsesToProcess } = await supabaseClient
      .from('llm_responses')
      .select(`id, answer_text, answer_competitors, prompts (prompt_text)`)
      .eq('audit_id', auditId)
      .not('answer_text', 'is', null)
      .or('answer_competitors.is.null,answer_competitors.eq.{"brands":[]}' as any)

    if (!responsesToProcess || responsesToProcess.length === 0) {
      await supabaseClient
        .from('audit_steps')
        .update({ status: 'done', message: 'No responses to process' })
        .eq('audit_id', auditId)
        .eq('step', 'competitors')
      return
    }

    const batchSize = 3
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
          }
        } catch (error) {
          console.error(`[reprocess] Error extracting competitors:`, error)
        }
      }))

      if (i + batchSize < responsesToProcess.length) {
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    }

    await supabaseClient
      .from('audit_steps')
      .update({ status: 'done', message: 'Competitors extraction completed' })
      .eq('audit_id', auditId)
      .eq('step', 'competitors')

  } catch (error) {
    console.error(`[reprocess] Error in competitors extraction:`, error)
  }
}

async function runSentimentAnalysis(auditId: string, supabaseClient: any) {
  try {
    await supabaseClient
      .from('audit_steps')
      .update({ status: 'running', message: 'Running sentiment analysis...' })
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
        .update({ status: 'done', message: 'No responses to analyze' })
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
                  .update({ sentiment_score: sentimentScore, sentiment_label: perception })
                  .eq('id', llmResponse.id)
              }
            } catch (error) {
              console.error(`[reprocess] Error analyzing sentiment:`, error)
            }
            break
          }
        }
      }))
    }

    await supabaseClient
      .from('audit_steps')
      .update({ status: 'done', message: 'Sentiment analysis completed' })
      .eq('audit_id', auditId)
      .eq('step', 'sentiment')

  } catch (error) {
    console.error(`[reprocess] Error in sentiment analysis:`, error)
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
        checked_at: new Date().toISOString(),
      })
    })
  }

  if (citations.length > 0) {
    await supabaseClient.from('citations').insert(citations)
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
    console.log(`[reprocess] Refreshing metrics for audit ${auditId}`)

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
      console.error(`[reprocess] Error refreshing metrics:`, error)
    } else {
      console.log(`[reprocess] Metrics refreshed for audit ${auditId}`)
    }
  } catch (error) {
    console.error('[reprocess] Error in refreshAuditMetrics:', error)
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
              return matchesDomain
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

    console.log(`[reprocess] Saved metrics: mention=${mentionRate}%, citation=${citationRate}%`)
  } catch (error) {
    console.error('[reprocess] Error calculating metrics:', error)
  }
}
