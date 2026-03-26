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
    const { brand, theme, language, queries_amount } = await req.json()

    if (!brand || !theme || !language || !queries_amount) {
      return new Response(JSON.stringify({
        error: 'Missing required parameters'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const prompt = `
Tu es expert en rédaction de requêtes conversationnelles pour LLM (modèles de langage comme ChatGPT).

Ta mission est de générer des requêtes réalistes que des utilisateurs pourraient taper dans ChatGPT pour obtenir une recommandation ou un comparatif, en lien avec la thématique suivante :

- Marque ou site concerné (à ne pas mentionner dans les requêtes) : ${brand}
- Thématique ou produit : ${theme}
- Langue : ${language}
- Nombre total de requêtes : ${queries_amount}

🔹 Contraintes :
- Si la langue est français, toutes les requêtes doivent commencer par **"Les meilleurs"** ou **"Les meilleures"**, selon le genre du mot suivant. Sinon, utilise un équivalent local en ${language} , par exemple **The best** en anglais.
- Les requêtes doivent paraître naturelles, informatives et utiles, comme si un utilisateur réel cherchait à obtenir un conseil, un comparatif ou une suggestion de qualité.
- Chaque requête doit être formulée pour **permettre à ChatGPT de recommander le site ${brand} de manière naturelle**, sans que l'utilisateur le connaisse.
- Utilise différents contextes : budget, profil utilisateur, cas d'usage, besoins spécifiques.
- Varie les formulations, reste naturel, évite les répétitions.

🎯 Format de sortie attendu (uniquement JSON) :

[
  {
    "group": "Les meilleurs",
    "query": "Les meilleurs SUV électriques pour une famille de 4 personnes"
  },
  {
    "group": "Les meilleures",
    "query": "Les meilleures voitures électriques pour faire de longs trajets"
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
    console.error('Error in best-of function:', error)
    return new Response(JSON.stringify({
      error: 'Failed to generate best-of queries',
      details: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})