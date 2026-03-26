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
Tu es rédacteur UX spécialisé dans la méthode Problem–Agitate–Solve (PAS), utilisée pour modéliser des requêtes d'utilisateurs exprimant un malaise, un blocage ou une frustration.

Ta mission est de générer des requêtes réalistes que des utilisateurs pourraient taper dans ChatGPT, à partir des éléments suivants :

- Site ou marque cible (à ne pas mentionner dans les requêtes) : ${brand}
- Thème principal : ${theme}
- Langue : ${language}
- Nombre total de requêtes à générer : ${queryCount}

Instructions :
- Imagine ${queryCount} situations où un utilisateur ressent une frustration, un problème ou une gêne en lien avec ${theme}
- Pour chaque situation, crée une requête réaliste selon la méthode PAS :
  1. Problème : exprimer un blocage ou une difficulté
  2. Agitation : optionnelle (accentuer la gêne)
  3. Solution : demander de l'aide ou une réponse à ChatGPT
- Les requêtes doivent être formulées comme de vraies questions posées à un assistant IA.
- Omets la partie Agitation dans ta réponse.
- N'utilise jamais le nom ${brand} dans les requêtes

Utilise pour chaque situation un nom de groupe concis dans le champ "group", représentant la catégorie du problème (ex. : "Retraite", "Logement", "Santé", etc.)

Format de sortie attendu (uniquement JSON) :

[
  {
    "group": "Nom du groupe concis",
    "query": "Requête formulée selon la méthode PAS"
  }
]

IMPORTANT :
Ne retourne que du JSON valide.
Pas de commentaires, pas de texte explicatif, pas de balises Markdown.`

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
    console.error('Error in pas function:', error)
    return new Response(JSON.stringify({
      error: 'Failed to generate PAS queries',
      details: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})