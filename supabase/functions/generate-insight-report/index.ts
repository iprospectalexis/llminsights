import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  let reportId: string | undefined;

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const requestData = await req.json();
    reportId = requestData.reportId;
    const { projectId, reportType, targetBrand, targetLlm, reportLanguage, groupId, customCompetitors } = requestData;

    console.log('Generating insight report:', { reportId, projectId, reportType, targetBrand, targetLlm, reportLanguage, groupId, customCompetitors });

    // Update status to running
    await supabase
      .from('insight_reports')
      .update({ status: 'running' })
      .eq('id', reportId);

    // Fetch project data
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .single();

    if (projectError) throw projectError;

    // First, fetch audits for the project
    const { data: audits, error: auditsError } = await supabase
      .from('audits')
      .select('id')
      .eq('project_id', projectId);

    if (auditsError) throw auditsError;

    const auditIds = audits?.map(a => a.id) || [];

    if (auditIds.length === 0) {
      throw new Error('No audits found for this project');
    }

    // Fetch only the most recent audit to reduce data
    const { data: recentAudit, error: recentAuditError } = await supabase
      .from('audits')
      .select('id')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (recentAuditError) throw recentAuditError;

    // Fetch all llm_responses with prompts for the most recent audit and target LLM
    let responsesQuery = supabase
      .from('llm_responses')
      .select('id, audit_id, llm, answer_text, answer_competitors, created_at, prompt_id, prompts(prompt_text, prompt_group)')
      .eq('audit_id', recentAudit.id)
      .eq('llm', targetLlm)
      .order('created_at', { ascending: false });

    const { data: allResponses, error: responsesError } = await responsesQuery;

    if (responsesError) throw responsesError;

    // Filter responses by group if groupId is provided
    let llmResponses = allResponses;
    if (groupId && groupId !== '') {
      llmResponses = allResponses?.filter(r => r.prompts?.prompt_group === groupId) || [];
      console.log(`Filtered responses by group ${groupId}: ${llmResponses.length} responses`);
    }

    // Fetch citations for these audits
    const { data: citations, error: citationsError } = await supabase
      .from('citations')
      .select(`
        *,
        prompts (*),
        audits (*)
      `)
      .in('audit_id', auditIds)
      .order('checked_at', { ascending: false })
      .limit(5000);

    if (citationsError) throw citationsError;

    // Generate report based on type
    let reportContent: any = {};

    switch (reportType) {
      case 'brand_strengths':
        reportContent = await generateBrandStrengthsReport(
          project,
          llmResponses,
          citations,
          targetBrand,
          targetLlm,
          reportLanguage,
          customCompetitors
        );
        break;
      case 'content_audit':
        reportContent = await generateContentAuditReport(
          project,
          llmResponses,
          citations,
          targetBrand,
          targetLlm,
          reportLanguage
        );
        break;
      case 'offsite_visibility':
        reportContent = await generateOffsiteVisibilityReport(
          project,
          llmResponses,
          citations,
          targetBrand,
          targetLlm,
          reportLanguage
        );
        break;
      default:
        throw new Error(`Unknown report type: ${reportType}`);
    }

    // Update report with generated content
    const { error: updateError } = await supabase
      .from('insight_reports')
      .update({
        status: 'completed',
        report_content: reportContent,
        completed_at: new Date().toISOString(),
      })
      .eq('id', reportId);

    if (updateError) throw updateError;

    return new Response(
      JSON.stringify({ success: true, reportId }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error) {
    console.error('Error generating report:', error);

    // Try to update report status to failed if we have a reportId
    if (reportId) {
      try {
        const supabase = createClient(
          Deno.env.get('SUPABASE_URL') ?? '',
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        );

        await supabase
          .from('insight_reports')
          .update({
            status: 'failed',
            error_message: error.message
          })
          .eq('id', reportId);
      } catch (updateError) {
        console.error('Error updating report status:', updateError);
      }
    }

    return new Response(
      JSON.stringify({
        error: error.message,
        details: error.stack
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  }
});

async function generateBrandStrengthsReport(
  project: any,
  llmResponses: any[],
  citations: any[],
  targetBrand: string,
  targetLlm: string,
  language: string,
  customCompetitors?: string[]
): Promise<any> {
  if (llmResponses.length === 0) {
    throw new Error(`No responses found for LLM: ${targetLlm}`);
  }

  // Build prompt-answer pairs
  const promptAnswerPairs = llmResponses.map(r => ({
    prompt_id: r.prompt_id,
    prompt_text: r.prompts?.prompt_text || '',
    llm: r.llm,
    audit_id: r.audit_id,
    answer_text: r.answer_text,
    answer_competitors: r.answer_competitors || []
  }));

  // Extract unique competitors from answer_competitors
  const competitorsSet = new Set<string>();

  // If custom competitors are provided, use them
  if (customCompetitors && customCompetitors.length > 0) {
    customCompetitors.forEach(comp => competitorsSet.add(comp));
    console.log('Using custom competitors:', customCompetitors);
  } else {
    // Otherwise extract from responses
    llmResponses.forEach(r => {
      if (r.answer_competitors && Array.isArray(r.answer_competitors)) {
        r.answer_competitors.forEach((comp: string) => competitorsSet.add(comp));
      }
    });
  }

  const competitors = Array.from(competitorsSet);

  const auditDate = new Date(llmResponses[0].created_at).toISOString().split('T')[0];

  // Calculate approximate token count (rough estimate: 1 token ≈ 4 characters for English/French text)
  const allResponsesText = promptAnswerPairs.map(p => p.answer_text).join(' ');
  const approximateTokenCount = Math.ceil(allResponsesText.length / 4);

  // Build the prompt for OpenAI
  const prompt = `RÔLE : Vous êtes un Analyste Senior en Intelligence Compétitive et Visibilité de Marque. Votre mission est d'analyser un ensemble de réponses générées par un modèle de langage ${targetLlm} concernant une marque cible ${targetBrand} et ses concurrents afin de produire un rapport stratégique structuré.

OBJECTIF : Produire une analyse qui identifie les forces et les faiblesses de la Marque Cible par rapport à ses Marques Concurrentes, en se basant sur la perception véhiculée par l'IA.

DONNÉES D'ENTRÉE :
- Target Brand: ${targetBrand}
- Target LLM: ${targetLlm}
- Report Language: ${language}
- Competitors: ${competitors.join(', ')}
- Nombre de réponses analysées: ${promptAnswerPairs.length}
- Tokens analysés: ${approximateTokenCount.toLocaleString()}

PROMPT-ANSWER PAIRS:
${JSON.stringify(promptAnswerPairs, null, 2)}

STRUCTURE DU RAPPORT (OBLIGATOIRE):

Le rapport doit être rédigé dans la Langue du Rapport spécifiée (${language}), sans emojis, au format JSON structuré.

Le rapport JSON doit contenir exactement 3 sections:

1. executiveSummary (string): Un paragraphe concis et professionnel (3-5 phrases) qui résume les forces et faiblesses principales de ${targetBrand}. Style direct et factuel.

2. brandStrengthsWeaknesses (object):
   {
     "strengths": [
       { "category": "string", "description": "string" },
       ...
     ],
     "weaknesses": [
       { "category": "string", "description": "string" },
       ...
     ]
   }
   - Identifier 4-6 forces et 4-6 faiblesses
   - Catégories possibles: Coverage, Quality, Trust, Innovation, Service, Price, etc.
   - Description: Une phrase concise et factuelle

3. competitorsAssessment (array): Pour chaque concurrent, une évaluation concise:
   [
     {
       "brand": "Competitor Name",
       "strengths": "Une phrase décrivant leurs forces principales",
       "weaknesses": "Une phrase décrivant leurs faiblesses principales"
     },
     ...
   ]

METADATA À INCLURE:
{
  "tokensAnalyzed": ${approximateTokenCount},
  "responsesAnalyzed": ${promptAnswerPairs.length},
  "auditDate": "${auditDate}",
  "targetBrand": "${targetBrand}",
  "targetLlm": "${targetLlm}",
  "language": "${language}"
}

FORMAT DE SORTIE:
Retournez UNIQUEMENT un objet JSON valide avec cette structure exacte:
{
  "metadata": { ... },
  "executiveSummary": "...",
  "brandStrengthsWeaknesses": { ... },
  "competitorsAssessment": [ ... ]
}

IMPORTANT: Ne retournez PAS de markdown (\`\`\`json), PAS de texte explicatif, UNIQUEMENT le JSON brut.`;

  // Call OpenAI API
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.7,
      max_tokens: 16384
    })
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('OpenAI API Error:', error);
    throw new Error(`OpenAI API Error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  let reportContent = data.choices[0].message.content;

  // Clean up any markdown artifacts
  reportContent = reportContent
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  // Parse JSON
  let reportJson;
  try {
    reportJson = JSON.parse(reportContent);
  } catch (e) {
    console.error('Failed to parse JSON from OpenAI:', reportContent);
    throw new Error('OpenAI returned invalid JSON');
  }

  return reportJson;
}

async function generateContentAuditReport(
  project: any,
  llmResponses: any[],
  citations: any[],
  targetBrand: string,
  targetLlm: string,
  language: string
): Promise<any> {
  return {
    summary: `Content audit for ${targetBrand} on ${targetLlm}`,
    contentGaps: [
      'Missing coverage in trending topics',
      'Outdated information on key pages',
    ],
    opportunities: [
      'Create content for high-traffic keywords',
      'Update existing pages with fresh data',
    ],
    topPerformingContent: citations
      .filter(c => c.llm === targetLlm)
      .slice(0, 10)
      .map(c => ({
        url: c.page_url,
        mentions: 1,
        sentiment: c.sentiment_score,
      })),
  };
}

async function generateOffsiteVisibilityReport(
  project: any,
  llmResponses: any[],
  citations: any[],
  targetBrand: string,
  targetLlm: string,
  language: string
): Promise<any> {
  const brandMentions = llmResponses.filter(r =>
    r.answer_text?.toLowerCase().includes(targetBrand.toLowerCase())
  );

  return {
    summary: `Off-site visibility analysis for ${targetBrand}`,
    totalMentions: brandMentions.length,
    platforms: [
      { name: targetLlm, mentions: brandMentions.filter(r => r.llm === targetLlm).length },
    ],
    topReferringSites: citations
      .filter(c => c.llm === targetLlm)
      .reduce((acc: any[], curr) => {
        const existing = acc.find(a => a.domain === curr.domain);
        if (existing) {
          existing.count++;
        } else {
          acc.push({ domain: curr.domain, count: 1 });
        }
        return acc;
      }, [])
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
  };
}
