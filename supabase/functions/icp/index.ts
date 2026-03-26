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
    const { domain, theme, language, selectedIcp, customIcp, queryCount } = await req.json()

    // If no selectedIcp, generate ICP profiles
    if (!selectedIcp && !customIcp) {
      if (!domain || !theme || !language) {
        return new Response(JSON.stringify({
          error: 'Missing required parameters for ICP generation'
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      const prompt = `
Tu es un expert en marketing stratégique spécialisé dans la création de profils de clients idéaux (ICP – Ideal Customer Profile).

Ta mission est de générer 3 profils complets de clients idéaux pour un produit spécifique de la marque suivante :

- Marque : ${domain}
- Produit ou thème : ${theme}
- Langue : ${language}

Pour chaque profil, tu dois construire un **profil réaliste** de client susceptible d'être très intéressé par ce produit/service. Pour cela, définis :

1. **Nom** : un nom fictif pour ce profil client
2. **Secteur d'activité** : activité professionnelle du client idéal (ou s'il s'agit d'un particulier, son mode de vie)
3. **Taille de l'entité** : s'il s'agit d'un usage personnel, indique la taille du foyer ou du contexte d'utilisation
4. **Budget ou besoin spécifique** : capacité d'achat ou contrainte économique
5. **Défis ou problèmes rencontrés** : raisons pour lesquelles cette personne veut ou doit changer de produit/service
6. **Objectifs à atteindre** : ce qu'elle espère améliorer en optant pour un produit/service comme celui proposé

Ensuite, pour chaque profil, génère 3 **requêtes naturelles** que ce profil pourrait taper dans ChatGPT pour l'aider dans sa décision d'achat, **sans mentionner ${domain}**. Ces requêtes doivent être réalistes et proches des besoins ou hésitations du client.

Format attendu (JSON valide uniquement) :

[
  {
    "framework": "ICP",
    "name": "Nom du profil",
    "sector": "Secteur ou style de vie",
    "entity_size": "Taille du foyer ou de l'entreprise",
    "budget": "Budget ou contrainte",
    "challenges": "Problèmes rencontrés",
    "objectives": "Objectifs recherchés",
    "queries": [
      "Requête 1",
      "Requête 2",
      "Requête 3"
    ]
  }
]

Génère uniquement du JSON valide. Pas de commentaires, pas de texte hors JSON.`

      const data = await callOpenAI(prompt)
      const output = data.choices[0].message.content

      try {
        const icpProfiles = extractJSON(output)
        return new Response(JSON.stringify(icpProfiles), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      } catch (error) {
        console.error('Failed to parse OpenAI response:', error)
        console.error('Raw response:', output)
        throw new Error('Invalid JSON response from OpenAI')
      }
    } else {
      const profile = selectedIcp || customIcp
      if (!profile || !language || !queryCount || !domain) {
        return new Response(JSON.stringify({
          error: 'Missing required parameters for query generation'
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      let prompt: string

      if (customIcp && customIcp.description) {
        // Custom ICP description provided
        prompt = `
Tu es un expert en marketing stratégique et en génération de requêtes pour les LLM.

Ta mission est de générer des requêtes naturelles qu'un client idéal pourrait taper dans ChatGPT lorsqu'il recherche un produit ou service comme celui proposé par ${domain}, sans mentionner directement cette marque.

Voici la description du profil client idéal :
${customIcp.description}

Objectif :
- Générer exactement ${queryCount} requêtes en langue ${language} que ce client idéal pourrait taper dans ChatGPT.
- Regrouper ces requêtes en **groupes thématiques** (2 à 5 groupes selon la cohérence du contenu).
- Répartir équitablement les requêtes entre les groupes.
- Les requêtes doivent être **réalistes**, **formulées en ${language}**, et adaptées au profil décrit.
- Elles doivent refléter un véritable besoin d'information ou de clarification en lien avec le thème ${theme}.

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
      } else {
        // Use the selected ICP profile
        prompt = `
Tu es un expert en marketing stratégique et en génération de requêtes pour les LLM.

Ta mission est de te mettre dans la peau du profil client idéal décrit ci-dessous, et de générer des requêtes naturelles qu'il taperait dans ChatGPT lorsqu'il recherche un produit ou service comme celui proposé par ${domain}, sans mentionner directement cette marque.

Voici le profil client idéal : ${JSON.stringify(profile)}

Objectif :
- Générer exactement ${queryCount} requêtes en langue ${language} que ce client idéal pourrait taper dans ChatGPT.
- Regrouper ces requêtes en **groupes thématiques** (2 à 5 groupes selon la cohérence du contenu).
- Répartir équitablement les requêtes entre les groupes.
- Les requêtes doivent être **réalistes**, **formulées en ${language}**, et adaptées au profil décrit.
- Elles doivent refléter un véritable besoin d'information ou de clarification en lien avec le thème ${theme}.

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
      }

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
    console.error('Error in ICP function:', error)
    return new Response(JSON.stringify({
      error: 'Failed to generate ICP profiles or queries',
      details: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})