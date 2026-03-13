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
    const { brand, theme, language, urls } = await req.json()

    if (!brand || !theme || !language || !urls || !Array.isArray(urls)) {
      return new Response(JSON.stringify({
        error: 'Missing required parameters'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const formattedUrls = urls.map(u => `- ${u}`).join('\n')

    const prompt = `
Tu es expert en stratégie de contenu et moteurs de recherche IA comme ChatGPT.

Tu reçois une liste de titres de pages ou d'URLs qui ont reçu du trafic depuis des moteurs IA génératifs (ChatGPT, Perplexity, etc.).

Voici la liste :
${formattedUrls}

Ta mission :
1. Pour chaque URL ou titre, déduis la requête probable que l'utilisateur a tapé dans un LLM comme ChatGPT.
2. Repère les patterns récurrents (types d'intentions, formulations, sujets).
3. Génère ensuite 3 à 5 nouvelles requêtes réalistes que des utilisateurs pourraient taper, en respectant les patterns identifiés et en lien avec cette thématique : ${theme}

⚠️ Ne cite jamais la marque ${brand} dans les requêtes.

Langue : ${language}

🎯 Format de sortie attendu (uniquement JSON valide) :

{
  "inferred_queries": [
    {
      "from_url": "https://exemple.fr/comment-faire-une-demande",
      "guessed_query": "Comment faire une demande de soutien familial ?"
    }
  ],
  "patterns": [
    "Formulations en 'comment', 'quelles démarches'",
    "Problèmes liés aux aides sociales ou situations administratives"
  ],
  "new_queries": [
    "Comment faire une demande de RSA quand on est étudiant ?",
    "Quelles démarches pour une séparation avec enfant à charge ?"
  ]
}

IMPORTANT :
- Retourne uniquement du JSON valide
- Aucun texte avant ou après
- Pas de balises Markdown
- Pas de commentaires`

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
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

    if (!response.ok) {
      const error = await response.text()
      console.error('OpenAI API Error:', error)
      throw new Error(`OpenAI API Error: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()
    const output = data.choices[0].message.content

    try {
      const queries = JSON.parse(output)
      // Transform the response into the expected format for the frontend
      const transformedQueries = [
        ...queries.inferred_queries.map(q => ({
          group: 'Inferred Queries',
          query: q.guessed_query,
          from_url: q.from_url
        })),
        ...queries.new_queries.map(q => ({
          group: 'Generated Queries',
          query: q
        }))
      ]

      return new Response(JSON.stringify(transformedQueries), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    } catch (error) {
      console.error('Failed to parse OpenAI response:', error)
      console.error('Raw response:', output)
      throw new Error('Invalid JSON response from OpenAI')
    }
  } catch (error) {
    console.error('Error in inference function:', error)
    return new Response(JSON.stringify({
      error: 'Failed to generate inferred queries',
      details: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})