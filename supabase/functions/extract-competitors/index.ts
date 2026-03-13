import { createClient } from 'npm:@supabase/supabase-js@2'
import OpenAI from 'npm:openai@4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface ExtractCompetitorsRequest {
  prompt: string
  answerText: string
  responseId: string
  auditId: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  let requestBody: ExtractCompetitorsRequest
  
  try {
    // Parse request body once and store it
    requestBody = await req.json()
    
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { prompt, answerText, responseId, auditId } = requestBody

    if (!prompt || !answerText || !responseId || !auditId) {
      return new Response(
        JSON.stringify({ error: 'Missing required parameters' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`Starting competitor extraction for response ${responseId}`)
    console.log(`Prompt: ${prompt.substring(0, 100)}...`)
    console.log(`Answer text length: ${answerText.length} characters`)

    // Initialize OpenAI client
    const openai = new OpenAI({
      apiKey: Deno.env.get('OPENAI_API_KEY'),
    })

    // Call OpenAI using standard chat completions API
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: `I want to extract the brands mentioned in a text, taking into account the following prompt: [${prompt}]. For each mentioned brand, extract the following information in JSON format:

name: The name of the brand (e.g., an insurance company or a service).
strengths: A list of strengths or characteristics of the brand, as mentioned in the text, that are relevant to the prompt. For example, if the prompt concerns insurance, include information related to coverage, options, and plan flexibility.

Expected output format:
{
  "brands": [
    {
      "name": "Brand name",
      "strengths": [
        "Strength 1",
        "Strength 2",
        "Strength 3"
      ]
    },
    {
      "name": "Another brand",
      "strengths": [
        "Strength 1",
        "Strength 2"
      ]
    }
  ]
}

Make sure to extract all the mentioned brands and their respective strengths. If some brands do not have clearly defined strengths, indicate an empty list for strengths.

Prompt: ${prompt}
Text: ${answerText}`
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_tokens: 2048,
    })

    console.log('OpenAI response received')
    console.log('Response structure:', Object.keys(response))

    // Extract the content from the standard chat completions response
    const outputText = response.choices?.[0]?.message?.content

    if (!outputText) {
      console.error('No output text found in OpenAI response')
      console.error('Full response:', JSON.stringify(response, null, 2))
      throw new Error('No output text received from OpenAI')
    }

    console.log('Raw OpenAI output:', outputText.substring(0, 500) + '...')

    let extractedData
    try {
      extractedData = JSON.parse(outputText)
      
      // Ensure extractedData has the expected structure
      if (!extractedData.brands || !Array.isArray(extractedData.brands)) {
        console.warn('Invalid response structure, creating fallback')
        extractedData = {
          brands: [],
          warning: 'Invalid response structure from OpenAI',
          original_response: extractedData
        }
      }
    } catch (parseError) {
      console.error('Failed to parse OpenAI JSON response:', parseError)
      console.error('Raw output:', outputText)
      
      // Set a fallback structure to prevent null values
      extractedData = {
        brands: [],
        error: 'Failed to parse OpenAI response',
        raw_output: outputText.substring(0, 1000) // Store first 1000 chars for debugging
      }
    }

    console.log(`Extracted ${extractedData.brands?.length || 0} competitors:`, extractedData.brands?.map(b => b.name))

    // Store the extracted competitors data in the answer_competitors column
    const { error: updateError } = await supabaseClient
      .from('llm_responses')
      .update({
        answer_competitors: extractedData
      })
      .eq('id', responseId)

    if (updateError) {
      console.error('Error updating LLM response with competitors:', updateError)
      throw new Error('Failed to store extracted competitors')
    }

    console.log(`Successfully stored competitors data for response ${responseId}`)

    return new Response(
      JSON.stringify({ 
        success: true, 
        competitors: extractedData,
        message: `Extracted ${extractedData.brands?.length || 0} competitors`
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    )

  } catch (error) {
    console.error('Error in extract-competitors function:', error)
    
    // Try to update the response with error information to prevent infinite retries
    try {
      const supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      )
      
      // Use the already parsed requestBody to avoid "Body already consumed" error
      if (requestBody?.responseId) {
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
          .eq('id', requestBody.responseId)
        
        console.log(`Marked response ${requestBody.responseId} as failed for competitor extraction`)
      }
    } catch (updateError) {
      console.error('Failed to update response with error status:', updateError)
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