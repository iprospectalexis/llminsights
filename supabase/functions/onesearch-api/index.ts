import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

interface OneSearchJobRequest {
  prompts: string[]
  geo_targeting?: string
  source?: string
  provider?: string
  webhook_url?: string
}

interface OneSearchJobResponse {
  id: string
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
  provider: string
  message: string
  total_prompts: number
  estimated_batches: number
}

interface OneSearchJobStatus {
  id: string
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
  provider: string
  source: string
  progress: number
  total_prompts: number
  processed_prompts: number
  failed_prompts: number
  results?: any[]
  merged_results_file?: string
  merged_results_count?: number
  converted_results_file?: string
  failed_queries?: string[]
  error_message?: string
  webhook_url?: string
  created_at: string
  started_at?: string
  completed_at?: string
  duration_seconds?: number
}

interface OneSearchResult {
  prompt: string
  geo_targeting: string
  source: string
  answer_text?: string
  answer_text_markdown?: string
  web_search_query?: string
  all_sources?: any
  citations?: Array<{
    url: string
    title?: string
    text?: string
  }>
  sources?: Array<{
    url: string
    title?: string
    description?: string
  }>
  links_attached?: Array<{
    url: string
    text?: string
  }>
  raw_data?: any
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const url = new URL(req.url)
    const path = url.pathname
    const apiKey = Deno.env.get('ONESEARCH_API_KEY') || ''
    const apiUrl = Deno.env.get('ONESEARCH_API_URL') || 'http://168.231.84.54:8000'

    console.log('Using OneSearch API URL:', apiUrl)
    console.log('API Key configured:', apiKey ? 'Yes' : 'No')

    if (path.endsWith('/create-job')) {
      return await createJob(req, apiUrl, apiKey)
    } else if (path.endsWith('/get-job-status')) {
      return await getJobStatus(req, apiUrl, apiKey)
    } else if (path.endsWith('/get-job-results')) {
      return await getJobResults(req, apiUrl, apiKey)
    } else {
      return new Response(
        JSON.stringify({ error: 'Invalid endpoint' }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 404
        }
      )
    }

  } catch (error) {
    console.error('Error in onesearch-api function:', error)
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

async function createJob(req: Request, apiUrl: string, apiKey: string): Promise<Response> {
  const body: OneSearchJobRequest = await req.json()

  const payload = {
    prompts: body.prompts,
    geo_targeting: body.geo_targeting || 'FR',
    source: body.source || 'chatgpt',
    provider: body.provider || 'serp',
    webhook_url: body.webhook_url,
  }

  console.log('Creating job with payload:', JSON.stringify(payload))

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 60000)

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    if (apiKey) {
      headers['X-API-Key'] = apiKey
    }

    const response = await fetch(`${apiUrl}/api/v1/jobs`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    console.log('OneSearch API response status:', response.status)

    clearTimeout(timeoutId)

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`OneSearch API error: ${response.status} ${response.statusText}\n${errorText}`)
    }

    const data: OneSearchJobResponse = await response.json()

    return new Response(
      JSON.stringify(data),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 201
      }
    )

  } catch (error) {
    clearTimeout(timeoutId)
    if (error.name === 'AbortError') {
      throw new Error('OneSearch API timeout - request took longer than 60 seconds')
    }
    throw error
  }
}

async function getJobStatus(req: Request, apiUrl: string, apiKey: string): Promise<Response> {
  const { jobId } = await req.json()

  if (!jobId) {
    throw new Error('jobId is required')
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 30000)

  try {
    const headers: Record<string, string> = {}

    if (apiKey) {
      headers['X-API-Key'] = apiKey
    }

    const response = await fetch(`${apiUrl}/api/v1/jobs/${jobId}`, {
      method: 'GET',
      headers,
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('Job not found')
      }
      throw new Error(`OneSearch API error: ${response.status} ${response.statusText}`)
    }

    const data: OneSearchJobStatus = await response.json()

    return new Response(
      JSON.stringify(data),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    )

  } catch (error) {
    clearTimeout(timeoutId)
    if (error.name === 'AbortError') {
      throw new Error('OneSearch API timeout')
    }
    throw error
  }
}

async function getJobResults(req: Request, apiUrl: string, apiKey: string): Promise<Response> {
  const { jobId, page = 1, per_page = 100, format = 'converted' } = await req.json()

  if (!jobId) {
    throw new Error('jobId is required')
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 30000)

  try {
    const headers: Record<string, string> = {}

    if (apiKey) {
      headers['X-API-Key'] = apiKey
    }

    const response = await fetch(
      `${apiUrl}/api/v1/jobs/${jobId}/results?page=${page}&per_page=${per_page}&format=${format}`,
      {
        method: 'GET',
        headers,
        signal: controller.signal,
      }
    )

    clearTimeout(timeoutId)

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('Job results not found')
      }
      throw new Error(`OneSearch API error: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()

    return new Response(
      JSON.stringify(data),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    )

  } catch (error) {
    clearTimeout(timeoutId)
    if (error.name === 'AbortError') {
      throw new Error('OneSearch API timeout')
    }
    throw error
  }
}
