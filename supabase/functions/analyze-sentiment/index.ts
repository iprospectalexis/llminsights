import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Helper function to extract JSON from OpenAI response
function extractJSON(text: string): any {
  // First, try to parse the text directly
  try {
    return JSON.parse(text.trim())
  } catch (e) {
    // If direct parsing fails, try to extract JSON from markdown code blocks
    const jsonBlockMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/)
    if (jsonBlockMatch) {
      try {
        return JSON.parse(jsonBlockMatch[1])
      } catch (e) {
        // Continue to next extraction method
      }
    }

    // Try to find the outermost curly braces
    const firstBrace = text.indexOf('{')
    const lastBrace = text.lastIndexOf('}')
    
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      try {
        const jsonString = text.substring(firstBrace, lastBrace + 1)
        return JSON.parse(jsonString)
      } catch (e) {
        // Continue to next extraction method
      }
    }

    // Try to extract JSON using regex for object pattern
    const jsonMatch = text.match(/\{[^{}]*"perception"\s*:\s*"[^"]*"[^{}]*"magnitude"\s*:\s*\d+[^{}]*\}/)
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0])
      } catch (e) {
        // Continue to fallback
      }
    }

    // If all extraction methods fail, throw the original error
    throw new Error('Could not extract valid JSON from response')
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { brand, answer, projectId, responseId, platform, userId } = await req.json()

    if (!brand || !answer) {
      return new Response(
        JSON.stringify({ error: 'Missing required parameters' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Prompt structured for JSON return
    const prompt = `
Tu es un client potentiel qui vient de lire le texte suivant à propos de la marque ${brand}. En te mettant dans la peau d'un consommateur qui envisage un achat, quelle est ta perception de cette marque dans cette réponse ?

Réponse :
${answer}

IMPORTANT: Ta réponse doit être UNIQUEMENT un objet JSON strict sans aucun texte supplémentaire, commentaire ou formatage markdown.

Format requis (copie exactement cette structure) :
{"perception": "positive", "magnitude": 3}

Les valeurs autorisées :
- "perception" : "positive", "neutral", ou "negative"
- "magnitude" : nombre entier entre 1 et 5

Réponds SEULEMENT avec l'objet JSON, rien d'autre.
`

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1, // Lower temperature for more consistent output
        max_tokens: 50 // Limit tokens to encourage concise JSON response
      })
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`OpenAI API Error: ${error}`)
    }

    const data = await response.json()
    const output = data.choices[0].message.content

    try {
      const result = extractJSON(output)
      
      // Validate the extracted JSON has the required structure
      if (!result || typeof result !== 'object' || 
          !result.perception || !result.magnitude ||
          !['positive', 'neutral', 'negative'].includes(result.perception) ||
          typeof result.magnitude !== 'number' ||
          result.magnitude < 1 || result.magnitude > 5) {
        throw new Error('Invalid JSON structure or values')
      }

      // If projectId, responseId, platform, and userId are provided, store the result in Supabase
      if (projectId && responseId && platform && userId) {
        // Initialize Supabase client
        const supabaseUrl = Deno.env.get('SUPABASE_URL')
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

        if (!supabaseUrl || !supabaseKey) {
          console.warn('Missing Supabase configuration, skipping storage')
        } else {
          const supabase = createClient(supabaseUrl, supabaseKey)

          // Convert perception to sentiment_label and magnitude to sentiment_score
          const sentimentScore = result.perception === 'positive' ? result.magnitude / 5 : 
                                result.perception === 'negative' ? -result.magnitude / 5 : 0;

          // Update the llm_response with sentiment data
          const { error: updateError } = await supabase
            .from('llm_responses')
            .update({
              sentiment_score: sentimentScore,
              sentiment_label: result.perception
            })
            .eq('id', responseId);

          if (updateError) {
            console.error('Error storing sentiment analysis:', updateError)
          }
        }
      }

      return new Response(
        JSON.stringify(result),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    } catch (error) {
      console.error('Failed to parse OpenAI response:', error)
      console.error('Raw response:', output)
      
      // Return a fallback response instead of failing completely
      return new Response(
        JSON.stringify({ 
          perception: "neutral", 
          magnitude: 3,
          _fallback: true,
          _originalError: error.message
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
  } catch (error) {
    console.error('Error in analyze-sentiment function:', error)
    return new Response(
      JSON.stringify({ 
        error: 'Failed to analyze sentiment', 
        details: error.message 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})