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
Tu es un utilisateur ou une utilisatrice qui envisage peut-être d'acheter ou d'utiliser un produit proposé par une marque.

Tu poses des questions à ChatGPT comme si tu parlais à un ami de confiance ou à un assistant personnel. Tu veux savoir ce que vaut la marque, ce que les gens disent, ce qu'il faut éviter ou surveiller, etc.

Voici le contexte :

- Marque concernée : ${brand}
- Produit ou thématique : ${theme}
- Langue : ${language}
- Nombre de requêtes à générer : ${queries_amount}

Ton objectif est de poser à ChatGPT des questions naturelles, sincères, réalistes, du point de vue d'un utilisateur qui cherche à se faire un avis :

🔎 Les sujets possibles incluent :
- Demander un avis général
- Vérifier la fiabilité ou les retours clients
- Exprimer des doutes ou hésitations
- Comparer avec d'autres marques ou modèles
- Obtenir des conseils avant achat

📌 Contraintes :
- Chaque requête doit inclure la marque ${brand}
- Le ton doit être personnel et naturel, comme si tu parlais à ChatGPT en toute confiance
- Ne sois jamais commercial ou robotique
- Ne retourne que des requêtes formulées comme un humain qui doute, hésite ou cherche un conseil
- Formule les phrases avec des tournures comme :
  - "Tu penses quoi de… ?"
  - "Est-ce que je peux leur faire confiance pour… ?"
  - "Ça vaut le coup d'aller vers eux ?"
  - "Qu'est-ce que t'en dis, honnêtement ?"

🎯 Format attendu (JSON uniquement) :

[
  {
    "group": "Intention (Avis, Frictions, Confiance, etc.)",
    "query": "Requête formulée de façon personnelle et naturelle"
  }
]

❗ Ne retourne que du JSON valide. Pas de texte autour, pas de balises Markdown, pas d'explication.`

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
    console.error('Error in brand-perception function:', error)
    return new Response(JSON.stringify({
      error: 'Failed to generate brand perception queries',
      details: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})