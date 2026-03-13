import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

// Helper function to extract JSON from OpenAI response
function extractJSON(text: string): any {
  try {
    // First, try to parse the text directly as JSON
    return JSON.parse(text)
  } catch (error) {
    // If that fails, try to extract JSON from markdown code blocks
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1])
      } catch (parseError) {
        console.error('Failed to parse JSON from code block:', parseError)
      }
    }
    
    // Try to find JSON array pattern in the text
    const arrayMatch = text.match(/\[[\s\S]*\]/)
    if (arrayMatch) {
      try {
        return JSON.parse(arrayMatch[0])
      } catch (parseError) {
        console.error('Failed to parse JSON array:', parseError)
      }
    }
    
    // If all else fails, throw the original error
    throw error
  }
}

// Retry configuration
const MAX_RETRIES = 5
const INITIAL_RETRY_DELAY_MS = 2000

async function fetchWithRetry(url: string, options: any, retryCount = 0): Promise<Response> {
  try {
    const response = await fetch(url, options)
    
    // If the request was successful or it's not a retryable error, return the response
    if (response.ok || (response.status !== 429 && response.status < 500)) {
      return response
    }
    
    // If we've exhausted our retries, throw the error
    if (retryCount >= MAX_RETRIES) {
      throw new Error(`OpenAI API Error: ${response.status} ${response.statusText}`)
    }
    
    // Calculate delay with exponential backoff
    const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, retryCount)
    // Add some jitter to prevent all retries happening at exactly the same time
    const jitter = Math.random() * 200
    
    await new Promise(resolve => setTimeout(resolve, delay + jitter))
    
    // Retry the request
    return fetchWithRetry(url, options, retryCount + 1)
  } catch (error) {
    if (retryCount >= MAX_RETRIES) {
      throw error
    }
    
    // Retry on network errors as well
    const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, retryCount)
    const jitter = Math.random() * 200
    
    await new Promise(resolve => setTimeout(resolve, delay + jitter))
    return fetchWithRetry(url, options, retryCount + 1)
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { brand, theme, queryCount, language } = await req.json()

    if (!brand || !theme || !queryCount || !language) {
      return new Response(JSON.stringify({
        error: 'Missing required parameters'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const prompt = `
Tu es un expert en modélisation d'usages conversationnels dans les assistants IA comme ChatGPT.

Ta mission est de générer exactement ${queryCount} requêtes réalistes que des utilisateurs pourraient taper dans ChatGPT, en lien avec le sujet suivant :

→ Thème : ${theme}

Contexte :
- L'utilisateur ne connaît pas nécessairement la marque ou le site suivant : ${brand}
- Cependant, tu dois générer des requêtes où ChatGPT pourrait naturellement recommander ou mentionner un site comme ${brand} en tant que ressource fiable, pertinente ou experte
- La langue utilisée doit être : ${language}
- Le ton doit être naturel, comme dans une vraie interaction avec ChatGPT

Les requêtes doivent suivre les archétypes de requêtes typiques dans un assistant LLM, par exemple :
- "Peux-tu + action/question..."
- "Sais-tu"
- "Explique-moi ..."
- "Compare ..."
- "Pourquoi..."
- "Aide-moi à comprendre..."
- "Les meilleurs ..."
- "Qu'est-ce que ..."

Instructions supplémentaires :
- GÉNÈRE EXACTEMENT ${queryCount} REQUÊTES.
- Regroupe ces requêtes en groupes thématiques (entre 3 et 6 groupes maximum, selon leur sens logique).
- Répartis équitablement les requêtes entre ces groupes.
- Chaque groupe doit représenter une catégorie d'intention conversationnelle (ex. : Recommandations, Explications, Génération de contenu…).
- Ne mentionne jamais la marque ${brand} dans les requêtes.

IMPORTANT : Ne retourne **rien d'autre que du JSON valide**.  
Pas de texte explicatif, pas de commentaires, pas de balises Markdown.

[
  {
    "group": "Nom du groupe 1",
    "query": "Requête 1"
  }
]`

    const response = await fetchWithRetry('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4',
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7
      })
    })

    const data = await response.json()
    const output = data.choices[0].message.content

    try {
      const queries = extractJSON(output)
      return new Response(JSON.stringify(queries), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    } catch (error) {
      console.error('Failed to parse OpenAI response:', error)
      console.error('Raw response:', output)
      throw new Error('Invalid JSON response from OpenAI')
    }
  } catch (error) {
    console.error('Error in archetypes function:', error)
    return new Response(JSON.stringify({
      error: 'Failed to generate archetypes',
      details: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})