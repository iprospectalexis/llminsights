import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface AuditRequest {
  projectId: string
  llms?: string[]
  enableSentiment?: boolean
  forceWebSearch?: boolean
  groupIds?: string[]
  isScheduled?: boolean
}

interface BrightdataResponse {
  snapshot_id: string
}

interface OneSearchJobResponse {
  id: string
  status: string
  provider: string
  message: string
  total_prompts: number
  estimated_batches: number
}

interface LLMProviderSetting {
  llm_name: string
  data_provider: string
  provider_config?: {
    provider?: string
  }
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

    const { projectId, llms, enableSentiment, forceWebSearch, groupIds, isScheduled }: AuditRequest = await req.json()

    // Handle scheduled audits with default configuration
    const auditLlms = llms || ['searchgpt', 'perplexity']
    const auditEnableSentiment = enableSentiment !== undefined ? enableSentiment : true
    const auditForceWebSearch = forceWebSearch !== undefined ? forceWebSearch : true

    console.log(`[run-audit] Starting audit for project ${projectId}`)
    console.log(`[run-audit] LLMs: ${auditLlms.join(', ')}`)
    console.log(`[run-audit] Is scheduled: ${isScheduled || false}`)
    console.log(`[run-audit] Sentiment analysis: ${auditEnableSentiment}`)
    console.log(`[run-audit] Force web-search: ${auditForceWebSearch}`)

    // Get project details and prompts
    const { data: project, error: projectError } = await supabaseClient
      .from('projects')
      .select(`
        *,
        prompts (*)
      `)
      .eq('id', projectId)
      .single()

    if (projectError || !project) {
      throw new Error('Project not found')
    }

    // Helper function to convert llm id to LLM name
    const getLlmName = (llm: string): string => {
      const mapping: Record<string, string> = {
        'searchgpt': 'SearchGPT',
        'perplexity': 'Perplexity',
        'gemini': 'Gemini',
        'google-ai-overview': 'Google AI Overview',
        'google-ai-mode': 'Google AI Mode',
        'bing-copilot': 'Bing Copilot',
        'grok': 'Grok'
      }
      return mapping[llm] || llm
    }

    // Fetch data provider settings for each LLM
    const { data: providerSettings, error: settingsError } = await supabaseClient
      .from('llm_data_provider_settings')
      .select('llm_name, data_provider, provider_config')
      .in('llm_name', auditLlms.map(llm => getLlmName(llm)))

    if (settingsError) {
      console.error('Failed to fetch provider settings:', settingsError)
    }

    // Create a map of LLM to data provider (default to BrightData)
    const llmProviderMap = new Map<string, string>()
    const llmProviderConfigMap = new Map<string, any>()
    auditLlms.forEach(llm => {
      const llmKey = getLlmName(llm)
      const setting = providerSettings?.find(s => s.llm_name === llmKey)
      llmProviderMap.set(llm, setting?.data_provider || 'BrightData')
      if (setting?.provider_config) {
        llmProviderConfigMap.set(llm, setting.provider_config)
      }
    })

    // Determine the audit's data provider (use first LLM's provider or default)
    const auditDataProvider = llmProviderMap.get(auditLlms[0]) || 'BrightData'

    // Create audit record
    const { data: audit, error: auditError } = await supabaseClient
      .from('audits')
      .insert({
        project_id: projectId,
        llms: auditLlms,
        sentiment: auditEnableSentiment,
        status: 'running',
        current_step: 'getting_results',
        progress: 0,
        started_at: new Date().toISOString(),
        data_provider: auditDataProvider,
      })
      .select()
      .single()

    if (auditError || !audit) {
      throw new Error('Failed to create audit')
    }

    // Create audit steps
    const steps = ['fetch', 'parse', 'competitors', 'sentiment', 'persist']
    await supabaseClient
      .from('audit_steps')
      .insert(
        steps.map(step => ({
          audit_id: audit.id,
          step: step as any,
          status: step === 'fetch' ? 'running' : 'pending',
        }))
      )

    // Update fetch step to running
    await supabaseClient
      .from('audit_steps')
      .update({ 
        status: 'running',
        message: 'Triggering LLM queries...'
      })
      .eq('audit_id', audit.id)
      .eq('step', 'fetch')

    // Route to appropriate data provider based on settings
    const totalQueries = auditLlms.length * project.prompts.length
    const llmResponsesToInsert: any[] = []

    // Group LLMs by data provider
    const brightdataLLMs: string[] = []
    const onesearchLLMs: string[] = []

    for (const llm of auditLlms) {
      const provider = llmProviderMap.get(llm)
      if (provider === 'OneSearch SERP API') {
        onesearchLLMs.push(llm)
      } else {
        brightdataLLMs.push(llm)
      }
    }

    // Process BrightData LLMs
    if (brightdataLLMs.length > 0) {
      const brightdataApiKey = Deno.env.get('BRIGHTDATA_API_KEY')
      if (!brightdataApiKey) {
        throw new Error('BrightData API key not configured')
      }

      for (const llm of brightdataLLMs) {
        for (const prompt of project.prompts) {
          try {
            const snapshotId = await triggerBrightDataQuery(llm, prompt.prompt_text, project.country, brightdataApiKey)

            llmResponsesToInsert.push({
              audit_id: audit.id,
              prompt_id: prompt.id,
              llm,
              snapshot_id: snapshotId,
              country: project.country,
              data_provider: 'BrightData',
            })

          } catch (error) {
            console.error(`Failed to trigger ${llm} query for prompt ${prompt.id}:`, error)

            llmResponsesToInsert.push({
              audit_id: audit.id,
              prompt_id: prompt.id,
              llm,
              country: project.country,
              data_provider: 'BrightData',
              raw_response_data: { error: error.message },
            })
          }
        }
      }
    }

    // Process OneSearch LLMs (batch processing)
    if (onesearchLLMs.length > 0) {
      const onesearchApiKey = Deno.env.get('ONESEARCH_API_KEY') || ''
      const onesearchApiUrl = Deno.env.get('ONESEARCH_API_URL') || 'http://168.231.84.54:8000'

      console.log('[run-audit] Processing OneSearch LLMs:', onesearchLLMs)
      console.log('[run-audit] OneSearch API URL:', onesearchApiUrl)
      console.log('[run-audit] API Key configured:', onesearchApiKey ? 'Yes' : 'No')

      for (const llm of onesearchLLMs) {
        try {
          const prompts = project.prompts.map(p => p.prompt_text)
          const providerConfig = llmProviderConfigMap.get(llm)
          const jobId = await triggerOneSearchJob(llm, prompts, project.country, project.country_name, auditForceWebSearch, onesearchApiUrl, onesearchApiKey, providerConfig)

          // Create one response entry per prompt with the shared job_id
          for (const prompt of project.prompts) {
            llmResponsesToInsert.push({
              audit_id: audit.id,
              prompt_id: prompt.id,
              llm,
              job_id: jobId,
              country: project.country,
              data_provider: 'OneSearch SERP API',
            })
          }

        } catch (error) {
          console.error(`Failed to trigger ${llm} OneSearch job:`, error)

          // Mark all prompts as failed for this LLM
          for (const prompt of project.prompts) {
            llmResponsesToInsert.push({
              audit_id: audit.id,
              prompt_id: prompt.id,
              llm,
              country: project.country,
              data_provider: 'OneSearch SERP API',
              raw_response_data: { error: error.message },
            })
          }
        }
      }
    }

    // Batch insert all LLM responses in one operation
    if (llmResponsesToInsert.length > 0) {
      console.log(`[run-audit] Inserting ${llmResponsesToInsert.length} LLM responses`)
      console.log(`[run-audit] Sample response:`, JSON.stringify(llmResponsesToInsert[0]))

      const { error: insertError } = await supabaseClient
        .from('llm_responses')
        .insert(llmResponsesToInsert)

      if (insertError) {
        console.error('[run-audit] Failed to batch insert LLM responses:', insertError)
        throw new Error(`Failed to insert LLM responses: ${insertError.message}`)
      } else {
        console.log(`[run-audit] Successfully inserted ${llmResponsesToInsert.length} LLM responses`)
      }
    } else {
      console.error('[run-audit] No LLM responses to insert! This should not happen.')
    }

    // Update progress once after all queries are triggered
    const successfulQueries = llmResponsesToInsert.filter(r => r.snapshot_id || r.job_id).length
    const progress = Math.round((successfulQueries / totalQueries) * 25)

    await supabaseClient
      .from('audits')
      .update({ progress })
      .eq('id', audit.id)

    // Update fetch step to done
    await supabaseClient
      .from('audit_steps')
      .update({ 
        status: 'done',
        message: 'All LLM queries triggered successfully'
      })
      .eq('audit_id', audit.id)
      .eq('step', 'fetch')

    // Start polling for results
    // Note: Polling is now handled by a separate edge function and the frontend
    console.log('Audit initiated successfully, polling will be handled separately')

    return new Response(
      JSON.stringify({ 
        success: true, 
        auditId: audit.id,
        message: 'Audit started successfully, results will be processed in background'
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    )

  } catch (error) {
    console.error('Error in run-audit function:', error)
    console.error('Error stack:', error.stack)
    console.error('Error details:', JSON.stringify(error, Object.getOwnPropertyNames(error)))
    return new Response(
      JSON.stringify({
        error: error.message || 'Internal server error',
        details: error.stack || String(error)
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    )
  }
})

async function triggerBrightDataQuery(llm: string, prompt: string, country: string, apiKey: string): Promise<string> {
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
        index: Date.now() // Use timestamp as index
      }]
      break

    case 'gemini':
      url = 'https://api.brightdata.com/datasets/v3/trigger?dataset_id=gd_mbz66arm2mf9cu856y&include_errors=true'
      payload = [{
        url: 'https://gemini.google.com/',
        prompt,
        country: country,
        index: 1
      }]
      break

    case 'google-ai-overview':
    case 'google-ai-mode':
      // Google AI Overview and Mode use Google Search SERP
      // Dataset ID for Google SERP (web search)
      url = 'https://api.brightdata.com/datasets/v3/trigger?dataset_id=gd_l7q7dkf244hwxijb&include_errors=true'
      payload = [{
        url: 'https://www.google.com/',
        keyword: prompt,
        country: country
      }]
      break

    default:
      throw new Error(`Unsupported LLM: ${llm}`)
  }

  // Create AbortController with 1-minute timeout
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

    const data: BrightdataResponse = await response.json()
    return data.snapshot_id
  } catch (error) {
    clearTimeout(timeoutId)
    if (error.name === 'AbortError') {
      throw new Error(`Brightdata API timeout for ${llm} - request took longer than 1 minute`)
    }
    throw error
  }
}

async function triggerOneSearchJob(
  llm: string,
  prompts: string[],
  country: string,
  countryName: string | null | undefined,
  forceWebSearch: boolean,
  apiUrl: string,
  apiKey: string,
  providerConfig?: any
): Promise<string> {
  const sourceMap: Record<string, string> = {
    'searchgpt': 'chatgpt',
    'perplexity': 'perplexity',
    'gemini': 'gemini',
    'google-ai-overview': 'google_ai_overview',
    'google-ai-mode': 'google_ai_mode',
    'bing-copilot': 'copilot',
    'grok': 'grok',
  }

  // Build webhook URL
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const webhookSecret = Deno.env.get('ONESEARCH_WEBHOOK_SECRET') ?? ''
  const webhookUrl = `${supabaseUrl}/functions/v1/onesearch-webhook`

  // Get provider from config or default to 'brightdata'
  const provider = providerConfig?.provider || 'brightdata'

  const payload: any = {
    prompts,
    provider,
    geo_targeting: country || 'FR',
    source: sourceMap[llm] || 'chatgpt',
    webhook_url: webhookUrl,
  }

  if (llm === 'searchgpt') {
    payload.web_search = forceWebSearch
  }

  console.log(`[OneSearch] Using provider: ${provider}`)

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 60000)

  const requestUrl = `${apiUrl}/api/v1/jobs`
  console.log(`[OneSearch] Calling ${requestUrl} for ${llm}`)
  console.log(`[OneSearch] API Key configured: ${apiKey ? 'Yes' : 'No'}`)
  console.log(`[OneSearch] Number of prompts: ${prompts.length}`)
  console.log(`[OneSearch] Prompt lengths:`, prompts.map(p => p.length))
  console.log(`[OneSearch] First 100 chars of each prompt:`, prompts.map(p => p.substring(0, 100)))
  console.log(`[OneSearch] Full payload:`, JSON.stringify(payload, null, 2))

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    if (apiKey) {
      headers['X-API-Key'] = apiKey
    }

    const response = await fetch(requestUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    console.log(`[OneSearch] Response status: ${response.status} ${response.statusText}`)

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`[OneSearch] Error response:`, errorText.substring(0, 500))
      throw new Error(`OneSearch API error: ${response.status} ${response.statusText}\n${errorText}`)
    }

    const data: OneSearchJobResponse = await response.json()
    console.log(`[OneSearch] Job created successfully:`, JSON.stringify(data))
    console.log(`[OneSearch] Job ID: ${data.id}, Status: ${data.status}`)

    return data.id

  } catch (error) {
    clearTimeout(timeoutId)
    if (error.name === 'AbortError') {
      throw new Error(`OneSearch API timeout for ${llm} - request took longer than 1 minute`)
    }
    throw error
  }
}
