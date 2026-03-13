import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

const MAX_RETRIES = 3
const INITIAL_RETRY_DELAY_MS = 1000

function extractJSON(text: string): any {
  // First try to find JSON within code blocks
  const codeBlockMatch = text.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/)
  if (codeBlockMatch) {
    return JSON.parse(codeBlockMatch[1])
  }
  
  // If no code block, try to find the outermost array
  const firstBracket = text.indexOf('[')
  const lastBracket = text.lastIndexOf(']')
  
  if (firstBracket !== -1 && lastBracket !== -1) {
    return JSON.parse(text.slice(firstBracket, lastBracket + 1))
  }
  
  throw new Error('No valid JSON array found in response')
}

async function callOpenAI(prompt: string, retryCount = 0): Promise<any> {
  try {
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
      
      // If we hit rate limits (429) or server errors (5xx) and haven't exceeded max retries
      if ((response.status === 429 || response.status >= 500) && retryCount < MAX_RETRIES) {
        const delayMs = INITIAL_RETRY_DELAY_MS * Math.pow(2, retryCount)
        console.log(`Retrying after ${delayMs}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`)
        await new Promise(resolve => setTimeout(resolve, delayMs))
        return callOpenAI(prompt, retryCount + 1)
      }
      
      throw new Error(`OpenAI API Error: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()
    return data
  } catch (error) {
    if (retryCount < MAX_RETRIES) {
      const delayMs = INITIAL_RETRY_DELAY_MS * Math.pow(2, retryCount)
      console.log(`Retrying after ${delayMs}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`)
      await new Promise(resolve => setTimeout(resolve, delayMs))
      return callOpenAI(prompt, retryCount + 1)
    }
    throw error
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { domain, theme, language, selectedPersona, customPersona, queryCount } = await req.json()

    // Handle custom persona - generate queries directly from description
    if (customPersona) {
      if (!customPersona.description || !domain || !language || !queryCount) {
        return new Response(JSON.stringify({
          error: 'Missing required parameters for custom persona query generation'
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      const prompt = `
Tu es un expert en simulation d'usage conversationnel.

Ta mission est de te mettre dans la peau de la personne décrite ci-dessous, et de générer des requêtes naturelles qu'elle taperait dans un assistant comme ChatGPT où celui-ci pourrait naturellement recommander un site comme ${domain}, sans que la personne ne le connaisse.

Description de la personne : ${customPersona.description}

Objectif :
- Générer des requêtes où un assistant comme ChatGPT pourrait naturellement recommander un site comme ${domain}, sans que la personne ne le connaisse.
- Générer exactement ${queryCount} requêtes en langue ${language}.
- Regrouper ces requêtes en **groupes thématiques** (2 à 5 groupes selon la cohérence du contenu).
- Répartir équitablement les requêtes entre les groupes.
- Les requêtes doivent être **réalistes**, **formulées en ${language}**, et adaptées au profil décrit.
- Elles doivent refléter un véritable besoin d'information ou de clarification.

Format de réponse attendu (JSON uniquement, sans texte autour) :

[
  {
    "group": "Nom du groupe 1",
    "query": "Requête 1"
  },
  {
    "group": "Nom du groupe 1",
    "query": "Requête 2"
  },
  {
    "group": "Nom du groupe 2",
    "query": "Requête 3"
  }
]`

      const data = await callOpenAI(prompt)
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
    }

    // If no selectedPersona, generate personas
    if (!selectedPersona) {
      if (!domain || !theme || !language) {
        return new Response(JSON.stringify({
          error: 'Missing required parameters for persona generation'
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      const prompt = `
Tu es un expert UX et marketing conversationnel.

Ton rôle est de générer des profils réalistes d'utilisateurs potentiels qui ne connaissent pas nécessairement la marque ${domain}, mais qui s'intéressent au sujet suivant : ${theme}.

Langue à utiliser : ${language}

Ta mission :
- Génère 3 personas uniques qui pourraient avoir besoin de produits ou services liés à ${theme}, mais sans connaissance préalable de la marque ${domain}.
- Chaque persona doit inclure :
  - Nom
  - Âge
  - Profession / activité
  - Niveau de familiarité et de connaissances du domaine ${theme}
  - Objectifs ou motivations liés au thème
  - Frustrations ou obstacles rencontrés en lien avec ce thème
  - 2 à 3 requêtes naturelles qu'il ou elle taperait dans ChatGPT pour résoudre ses problèmes ou atteindre ses objectifs (sans mentionner de marque)

Contrainte :
- Les requêtes doivent être réalistes, en langage naturel, et refléter le style d'un vrai utilisateur dans un assistant IA.
- N'inclus aucune référence à la marque ${domain} dans les requêtes.

Format de réponse attendu (en ${language}) :

[
  {
    "framework": "Personas",
    "name": "Nom du persona",
    "age": âge,
    "occupation": "Profession ou rôle",
    "theme_experience": "faible / moyenne / élevée / très élevée",
    "goals": "Objectifs ou motivations",
    "frustrations": "Difficultés ou freins rencontrés",
    "queries": [
      "Requête 1 que cette personne pourrait poser à ChatGPT",
      "Requête 2 ...",
      "Requête 3 ..."
    ]
  }
]

Génère uniquement du JSON valide. Pas de commentaires, pas de texte hors JSON.`

      const data = await callOpenAI(prompt)
      const output = data.choices[0].message.content

      try {
        const personas = extractJSON(output)
        return new Response(JSON.stringify(personas), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      } catch (error) {
        console.error('Failed to parse OpenAI response:', error)
        console.error('Raw response:', output)
        throw new Error('Invalid JSON response from OpenAI')
      }
    } else {
      // Generate queries from selected persona
      if (!selectedPersona || !language || !queryCount || !domain) {
        return new Response(JSON.stringify({
          error: 'Missing required parameters for query generation'
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      const prompt = `
Tu es un expert en simulation d'usage conversationnel.

Ta mission est de te mettre dans la peau de la personne décrite ci-dessous, et de générer des requêtes naturelles qu'elle taperait dans un assistant comme ChatGPT où celui-ci pourrait naturellement recommander un site comme ${domain}, sans que la personne ne le connaisse.

Voici le persona : ${JSON.stringify(selectedPersona)}

Objectif :
- Générer des requêtes où un assistant comme ChatGPT pourrait naturellement recommander un site comme ${domain}, sans que la personne ne le connaisse.
- Générer exactement ${queryCount} requêtes en langue ${language}.
- Regrouper ces requêtes en **groupes thématiques** (2 à 5 groupes selon la cohérence du contenu).
- Répartir équitablement les requêtes entre les groupes.
- Les requêtes doivent être **réalistes**, **formulées en ${language}**, et adaptées au style et au niveau numérique de cette personne.
- Elles doivent refléter un véritable besoin d'information ou de clarification à propos de ses droits, de la législation, des aides, ou de démarches du quotidien.

Format de réponse attendu (JSON uniquement, sans texte autour) :

[
  {
    "group": "Nom du groupe 1",
    "query": "Requête 1"
  },
  {
    "group": "Nom du groupe 1",
    "query": "Requête 2"
  },
  {
    "group": "Nom du groupe 2",
    "query": "Requête 3"
  }
]`

      const data = await callOpenAI(prompt)
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
    }
  } catch (error) {
    console.error('Error in personas function:', error)
    return new Response(JSON.stringify({
      error: 'Failed to generate personas',
      details: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
