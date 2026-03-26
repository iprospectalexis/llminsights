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
    const { brand, theme, language, queryCount } = await req.json()

    if (!brand || !theme || !language || !queryCount) {
      return new Response(JSON.stringify({
        error: 'Missing required parameters'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const prompt = `
Tu es expert en modélisation d'intentions utilisateur selon la méthode "Jobs To Be Done" (JTBD).

Ta mission est de générer des requêtes naturelles que des utilisateurs pourraient taper dans ChatGPT lorsqu'ils cherchent à accomplir un "job" : une tâche, un besoin ou un objectif dans un contexte précis.

Tu recevras :
- Une marque ou site à ne pas mentionner dans les requêtes : ${brand}
- Une thématique principale : ${theme}
- Une langue : ${language}
- Le nombre total de requêtes à générer : ${queryCount}

Pour chaque requête :
1. Décris mentalement un contexte où une personne a un besoin ou une tâche à accomplir (ex. : "Quand je suis perdu dans les démarches…")
2. Reformule ce besoin en une requête réaliste et naturelle, comme une vraie question posée à ChatGPT
3. Cette requête doit permettre à ChatGPT de répondre de manière utile, idéalement en mentionnant un site comme ${brand}, sans que l'utilisateur le connaisse

Format attendu (uniquement JSON valide) :

[
  {
    "group": "Quand je [situation], je veux [action], afin de [résultat]",
    "query": "Requête naturelle posée à ChatGPT"
  }
]

IMPORTANT :
- Ne cite jamais ${brand} dans la requête
- Retourne uniquement du JSON valide
- Pas de texte explicatif ou de commentaire
- Pas de balises Markdown`

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
    console.error('Error in jtbd function:', error)
    return new Response(JSON.stringify({
      error: 'Failed to generate JTBD queries',
      details: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})