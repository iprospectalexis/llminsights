import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface RetryRequest {
  auditId: string
  llm?: string
}

interface OneSearchJobResponse {
  id: string
  status: string
  provider: string
  message: string
  total_prompts: number
  estimated_batches: number
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

    const { auditId, llm }: RetryRequest = await req.json()

    if (!auditId) {
      throw new Error('Audit ID is required')
    }

    // Get audit details
    const { data: audit } = await supabaseClient
      .from('audits')
      .select(`
        id,
        project_id,
        llms,
        projects (
          country,
          country_name,
          prompts (id, prompt_text)
        )
      `)
      .eq('id', auditId)
      .single()

    if (!audit) {
      throw new Error('Audit not found')
    }

    // Get failed responses (no answer_text OR has error in raw_response_data)
    let query = supabaseClient
      .from('llm_responses')
      .select('id, llm, prompt_id, data_provider')
      .eq('audit_id', auditId)
      .or('answer_text.is.null,raw_response_data->error.not.is.null')

    if (llm) {
      query = query.eq('llm', llm)
    }

    const { data: failedResponses, error: fetchError } = await query

    if (fetchError) throw fetchError

    if (!failedResponses || failedResponses.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          message: 'No failed prompts found to retry',
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200
        }
      )
    }

    console.log(`Found ${failedResponses.length} failed responses to retry`)

    // Group by LLM and data provider
    const llmGroups = new Map<string, { dataProvider: string; responseIds: string[]; promptIds: string[] }>()

    for (const response of failedResponses) {
      const key = response.llm
      if (!llmGroups.has(key)) {
        llmGroups.set(key, {
          dataProvider: response.data_provider || 'BrightData',
          responseIds: [],
          promptIds: []
        })
      }
      llmGroups.get(key)!.responseIds.push(response.id)
      llmGroups.get(key)!.promptIds.push(response.prompt_id)
    }

    let totalRetried = 0

    // Retry each LLM group
    for (const [llmName, group] of llmGroups.entries()) {
      console.log(`Retrying ${group.responseIds.length} prompts for ${llmName} using ${group.dataProvider}`)

      // Get unique prompts for this LLM
      const uniquePromptIds = [...new Set(group.promptIds)]
      const prompts = audit.projects.prompts.filter(p => uniquePromptIds.includes(p.id))

      if (group.dataProvider === 'OneSearch SERP API') {
        // Retry with OneSearch
        try {
          const jobId = await retryWithOneSearch(
            llmName,
            prompts.map(p => p.prompt_text),
            audit.projects.country,
            audit.projects.country_name,
            auditId
          )

          // Update all failed responses with new job_id and clear errors
          for (const responseId of group.responseIds) {
            await supabaseClient
              .from('llm_responses')
              .update({
                job_id: jobId,
                answer_text: null,
                raw_response_data: null,
                response_timestamp: null,
              })
              .eq('id', responseId)
          }

          totalRetried += group.responseIds.length
          console.log(`Created OneSearch job ${jobId} for ${group.responseIds.length} prompts`)

        } catch (error) {
          console.error(`Failed to retry ${llmName} with OneSearch:`, error)
          // Continue with other LLMs even if one fails
        }

      } else if (group.dataProvider === 'BrightData') {
        // Retry with BrightData
        const brightdataApiKey = Deno.env.get('BRIGHTDATA_API_KEY')
        if (!brightdataApiKey) {
          console.error('BrightData API key not configured')
          continue
        }

        for (const responseId of group.responseIds) {
          try {
            const response = failedResponses.find(r => r.id === responseId)!
            const prompt = prompts.find(p => p.id === response.prompt_id)
            if (!prompt) continue

            const snapshotId = await retryWithBrightData(
              llmName,
              prompt.prompt_text,
              audit.projects.country,
              brightdataApiKey
            )

            // Update response with new snapshot_id and clear errors
            await supabaseClient
              .from('llm_responses')
              .update({
                snapshot_id: snapshotId,
                answer_text: null,
                raw_response_data: null,
                response_timestamp: null,
              })
              .eq('id', responseId)

            totalRetried++
            console.log(`Created BrightData snapshot ${snapshotId} for prompt ${prompt.id}`)

          } catch (error) {
            console.error(`Failed to retry prompt with BrightData:`, error)
            // Continue with other prompts even if one fails
          }
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Retried ${totalRetried} failed prompts. Results will be available shortly.`,
        retriedCount: totalRetried,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    )

  } catch (error) {
    console.error('Error in retry-failed-prompts function:', error)
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

async function retryWithOneSearch(
  llm: string,
  prompts: string[],
  country: string,
  countryName: string | null | undefined,
  auditId: string
): Promise<string> {
  const onesearchApiKey = Deno.env.get('ONESEARCH_API_KEY') || ''
  const onesearchApiUrl = Deno.env.get('ONESEARCH_API_URL') || 'http://168.231.84.54:8000'

  const sourceMap: Record<string, string> = {
    'searchgpt': 'chatgpt',
    'perplexity': 'perplexity',
    'gemini': 'gemini',
  }

  // Build webhook URL
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const webhookUrl = `${supabaseUrl}/functions/v1/onesearch-webhook`

  const payload: any = {
    prompts,
    geo_targeting: countryName || 'Paris,Paris,Ile-de-France,France',
    source: sourceMap[llm] || 'chatgpt',
    webhook_url: webhookUrl,
  }

  if (llm === 'searchgpt') {
    payload.web_search = true
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 60000)

  const requestUrl = `${onesearchApiUrl}/api/v1/jobs`
  console.log(`[retry] Creating OneSearch job for ${llm} with ${prompts.length} prompts`)
  console.log(`[retry] Request URL: ${requestUrl}`)
  console.log(`[retry] API Key configured: ${onesearchApiKey ? 'Yes' : 'No'}`)
  console.log(`[retry] Payload:`, JSON.stringify(payload, null, 2))

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    if (onesearchApiKey) {
      headers['X-API-Key'] = onesearchApiKey
    }

    const response = await fetch(requestUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    console.log(`[retry] Response status: ${response.status} ${response.statusText}`)

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`[retry] Error response:`, errorText)
      throw new Error(`OneSearch API error: ${response.status} ${response.statusText}\n${errorText}`)
    }

    const data: OneSearchJobResponse = await response.json()
    console.log(`[retry] Job created successfully:`, JSON.stringify(data))
    console.log(`[retry] Job ID: ${data.id}, Status: ${data.status}`)

    return data.id

  } catch (error) {
    clearTimeout(timeoutId)
    if (error.name === 'AbortError') {
      throw new Error(`OneSearch API timeout for ${llm} - request took longer than 60 seconds`)
    }
    throw error
  }
}

async function retryWithBrightData(
  llm: string,
  prompt: string,
  country: string,
  apiKey: string
): Promise<string> {
  let url: string
  let payload: any

  switch (llm) {
    case 'searchgpt':
      url = 'https://api.brightdata.com/datasets/v3/trigger?dataset_id=gd_m7aof0k82r803d5bjm&include_errors=true'
      payload = [{
        url: 'https://chatgpt.com/',
        prompt,
        country: country,
        web_search: true,
        additional_prompt: ''
      }]
      break

    case 'perplexity':
      url = 'https://api.brightdata.com/datasets/v3/trigger?dataset_id=gd_m7dhdot1vw9a7gc1n&include_errors=true'
      payload = [{
        url: 'https://www.perplexity.ai',
        prompt,
        country: country,
        index: Date.now()
      }]
      break

    case 'gemini':
      url = 'https://api.brightdata.com/datasets/v3/trigger?dataset_id=gd_mbz66arm2mf9cu856y&include_errors=true'
      payload = [{
        url: 'https://gemini.google.com/',
        prompt,
        index: 1
      }]
      break

    default:
      throw new Error(`Unsupported LLM: ${llm}`)
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 60000)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      throw new Error(`Brightdata API error: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()
    return data.snapshot_id

  } catch (error) {
    clearTimeout(timeoutId)
    if (error.name === 'AbortError') {
      throw new Error(`Brightdata API timeout for ${llm}`)
    }
    throw error
  }
}
