import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { brand, theme, language, keywords } = await req.json()

    if (!brand || !theme || !language || !keywords) {
      return new Response(JSON.stringify({
        error: 'Missing required parameters'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const prompt = `
Tu es un expert en SEO conversationnel et analyse d'intention utilisateur.

Ta mission est de transformer une série de mots-clés SEO en requêtes naturelles que des personnes poseraient à ChatGPT dans le même but ou état d'esprit que lorsqu'elles les tapent dans Google.

Contexte :
- Marque concernée (à ne pas mentionner dans les requêtes) : ${brand}
- Thématique : ${theme}
- Langue : ${language}
- Voici une liste de ${keywords.length} mots-clés SEO :
${keywords.map((k: string) => `- ${k}`).join('\n')}
- Pour chaque mot-clé, fais :
  1. Analyse l'intention principale (le besoin informationnel qui pousse la personne a1 effectuer cette requête de recherche). Pour cela analyse le contexte et la situation la plus probable dans laquelle la personne fait cette recherche dans ChatGPT.
  2. Reformule ce mot-clé en une requête claire et réaliste que cette même personne poserait dans ChatGPT, pour le même besoin.
  3. Sois proche du thème : ${theme}.

⚠️ Ne cite jamais la marque ${brand} dans les requêtes.

Format de réponse attendu : uniquement du JSON valide :

[
  {
    "group": "type d'intention",
    "query": "requête reformulée pour ChatGPT"
  }
]

IMPORTANT :
Ne retourne que du JSON. Aucun texte avant ou après. Pas de balises Markdown. Pas de commentaires.`

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-5-mini',
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
      })
    })

    if (!response.ok) {
      const error = await response.text()
      console.error('OpenAI API Error:', error)
      throw new Error(`OpenAI API Error: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()
    const output = data.choices[0].message.content

    try {
      // Extract JSON from the response
      const jsonStr = output.match(/\[[\s\S]*\]/)?.[0] || output
      const queries = JSON.parse(jsonStr)
      return new Response(JSON.stringify(queries), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    } catch (error) {
      console.error('Failed to parse OpenAI response:', error)
      console.error('Raw response:', output)
      throw new Error('Invalid JSON response from OpenAI')
    }
  } catch (error) {
    console.error('Error in seo function:', error)
    return new Response(JSON.stringify({
      error: 'Failed to generate SEO queries',
      details: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})