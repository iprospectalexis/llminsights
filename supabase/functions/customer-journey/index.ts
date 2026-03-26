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
Tu es expert en design conversationnel et cartographie du parcours utilisateur (Customer Journey).

Ta mission est de générer des requêtes naturelles que des utilisateurs pourraient taper dans ChatGPT à chaque étape de leur parcours d'information, d'évaluation et d'usage en lien avec le thème suivant :

- Marque ou site concerné : ${brand}
- Thématique ou produit principal : ${theme}
- Langue de sortie : ${language}
- Nombre total de requêtes à générer : ${queryCount}

Tu dois répartir ces requêtes selon les 5 grandes étapes du parcours utilisateur :
1. **Unaware** – L'utilisateur ne sait pas encore qu'il a un problème. Il faut l'amener doucement à prendre conscience d'un besoin latent ou d'une opportunité.
2. **Problem aware** – Il comprend qu'il a un problème, mais ne connaît pas les solutions. Il cherche à comprendre les causes et les conséquences.
3. **Solution aware** – Il connaît des solutions générales, mais ne connaît pas encore ${brand} ou son offre. Il explore différentes possibilités.
4. **Product aware** – Il connaît le produit ou service proposé par ${brand}, mais hésite encore avec d'autres. Il veut des comparaisons, des arguments.
5. **Most aware** – Il est presque prêt à acheter. Il cherche à se rassurer, poser des questions pratiques ou vérifier des points de friction.

Instructions :
- Génère exactement ${queryCount} requêtes réparties équitablement entre les 5 étapes.
- Chaque requête doit être réaliste, naturelle, comme une vraie demande formulée à ChatGPT.
- Les besoins d'utilisateur doivent être en lien avec ce que propose ${brand}, afin que ChatGPT puisse naturellement le recommander.

Format de sortie attendu (uniquement JSON) :

[
  {
    "group": "Awareness",
    "query": "Requête 1"
  },
  {
    "group": "Consideration",
    "query": "Requête 2"
  }
]

IMPORTANT :
Ne retourne que du JSON valide.
Pas de texte explicatif. Pas de balises Markdown. Pas de commentaires.`

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
    console.error('Error in customer-journey function:', error)
    return new Response(JSON.stringify({
      error: 'Failed to generate customer journey queries',
      details: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})