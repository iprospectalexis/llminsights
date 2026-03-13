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
Tu es expert en design conversationnel et analyse des motivations utilisateur.

Ta mission est de générer exactement ${queryCount} requêtes réalistes qu'un utilisateur pourrait taper dans ChatGPT, en lien avec le thème suivant :

→ Thème : ${theme}

Contexte :
- L'utilisateur ne connaît pas nécessairement la marque ou le site suivant : ${brand}
- Mais tu dois générer des requêtes où ChatGPT pourrait naturellement recommander ou mentionner un site comme ${brand}, car celui-ci est reconnu pour fournir des informations fiables, utiles ou expertes sur ce thème.
- Langue utilisée : ${language}

Les requêtes doivent se répartir équitablement entre deux types de motivation :
- Pain : frustrations, problèmes, obstacles, difficultés
- Gain : objectifs, bénéfices attendus, améliorations recherchées

Exemples de formulations :
- Pain : "Je ne comprends pas comment fonctionne...", "Pourquoi est-ce si compliqué de...", "Comment éviter les erreurs quand on..."
- Gain : "Comment optimiser...", "Quels sont les avantages de...", "Comment faire pour mieux..."

Consignes supplémentaires :
- Regroupe les requêtes dans deux groupes :
  - "group": "Pain"
  - "group": "Gain"
- Répartis les requêtes de manière égale (moitié/moitié si nombre pair, ou équilibré si impair).
- Les requêtes doivent être formulées en langage naturel, comme une personne réelle s'adressant à ChatGPT.
- Ne mentionne jamais le nom ${brand} dans les requêtes.

Format de sortie attendu (JSON valide uniquement, sans texte explicatif) :

[
  {
    "group": "Pain",
    "query": "Requête orientée frustration"
  },
  {
    "group": "Gain",
    "query": "Requête orientée bénéfice"
  }
]

IMPORTANT :
Ne retourne que du JSON valide.
Pas de commentaires.
Pas de texte avant ou après.
Pas de balises Markdown.`

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
    console.error('Error in pain-gain function:', error)
    return new Response(JSON.stringify({
      error: 'Failed to generate pain-gain queries',
      details: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})