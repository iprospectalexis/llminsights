import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface RequestBody {
  statusFilter?: string;
  page?: number;
  pageSize?: number;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    let statusFilter: string | undefined;
    let page = 0;
    let pageSize = 50;
    if (req.method === "POST") {
      const body: RequestBody = await req.json();
      statusFilter = body.statusFilter;
      page = body.page ?? 0;
      pageSize = body.pageSize ?? 50;
    }

    // Get user profile to check permissions
    const { data: userProfile } = await supabase
      .from("users")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    const isManagerOrAdmin = userProfile?.role === "manager" || userProfile?.role === "admin";

    // Get user's project memberships if not manager/admin
    let memberProjectIds: string[] = [];
    if (!isManagerOrAdmin) {
      const { data: memberships } = await supabase
        .from("project_members")
        .select("project_id")
        .eq("user_id", user.id);
      memberProjectIds = memberships?.map(m => m.project_id) || [];
    }

    // Build base query
    let query = supabase
      .from("audits")
      .select(`
        id,
        project_id,
        llms,
        status,
        current_step,
        progress,
        pipeline_state,
        responses_expected,
        responses_received,
        competitors_processed,
        competitors_total,
        sentiment_processed,
        sentiment_total,
        error_message,
        last_activity_at,
        started_at,
        finished_at,
        processing_started_at,
        created_at,
        run_by,
        projects (
          id,
          name,
          domain,
          created_by
        )
      `)
      .order("created_at", { ascending: false });

    if (statusFilter && statusFilter !== "all") {
      query = query.eq("status", statusFilter);
    }

    let auditsData;
    let totalFilteredCount = 0;

    if (isManagerOrAdmin) {
      // For admins/managers: fetch with pagination at DB level
      const { data, error: auditsError } = await query
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (auditsError) {
        console.error("Error fetching audits:", auditsError);
        throw auditsError;
      }

      auditsData = data || [];

      // Get total count for pagination
      const { count } = await supabase
        .from("audits")
        .select("id", { count: "exact", head: true })
        .eq("status", statusFilter && statusFilter !== "all" ? statusFilter : "status");

      totalFilteredCount = count || 0;
    } else {
      // For regular users: fetch larger set and filter in application
      const { data, error: auditsError } = await query.limit(1000);

      if (auditsError) {
        console.error("Error fetching audits:", auditsError);
        throw auditsError;
      }

      // Filter to only audits for projects user owns or is member of
      const memberProjectIdSet = new Set(memberProjectIds);
      const filteredAudits = (data || []).filter(audit =>
        audit.projects !== null &&
        (audit.projects.created_by === user.id || memberProjectIdSet.has(audit.project_id))
      );

      totalFilteredCount = filteredAudits.length;

      // Apply pagination after filtering
      const startIdx = page * pageSize;
      const endIdx = startIdx + pageSize;
      auditsData = filteredAudits.slice(startIdx, endIdx);
    }

    const auditIds = auditsData.map(a => a.id);

    // Optimized: Fetch all required data in parallel instead of sequentially
    const [metricsResult, auditJobIdsResult] = await Promise.all([
      // Fetch metrics
      supabase
        .from("audit_metrics_mv")
        .select("*")
        .in("audit_id", auditIds),

      // Fetch job_ids - get distinct job_id per audit
      auditIds.length > 0
        ? supabase
            .from("llm_responses")
            .select("audit_id, job_id")
            .in("audit_id", auditIds)
            .not("job_id", "is", null)
        : Promise.resolve({ data: null, error: null })
    ]);

    if (metricsResult.error) {
      console.error("Error fetching metrics:", metricsResult.error);
    }

    const metricsMap = new Map();
    (metricsResult.data || []).forEach((metric: any) => {
      metricsMap.set(metric.audit_id, metric);
    });

    // Get unique job_ids and fetch webhook logs only if needed
    const jobIds = [...new Set((auditJobIdsResult.data || []).map((r: any) => r.job_id).filter(Boolean))];

    let webhookLogs: any[] = [];
    if (jobIds.length > 0) {
      const { data } = await supabase
        .from("webhook_logs")
        .select("job_id, payload, created_at")
        .eq("event", "job.completed")
        .in("job_id", jobIds);
      webhookLogs = data || [];
    }

    // Map job_id to webhook payload
    const webhookMap = new Map();
    webhookLogs.forEach((log: any) => {
      webhookMap.set(log.job_id, log.payload);
    });

    // Map audit_id to job_id
    const auditToJobId = new Map();
    (auditJobIdsResult.data || []).forEach((r: any) => {
      if (!auditToJobId.has(r.audit_id)) {
        auditToJobId.set(r.audit_id, r.job_id);
      }
    });

    const auditsWithMetrics = auditsData.map(audit => {
      const metrics = metricsMap.get(audit.id);
      const jobId = auditToJobId.get(audit.id);
      const webhookPayload = jobId ? webhookMap.get(jobId) : null;

      return {
        ...audit,
        total_prompts: metrics?.total_prompts || 0,
        responses_sent: metrics?.responses_sent || 0,
        responses_received: metrics?.responses_received || 0,
        competitors_found: metrics?.competitors_found || 0,
        sentiment_analyzed: metrics?.sentiment_analyzed || 0,
        citation_stats: metrics?.citation_stats || {},
        webhook_data: webhookPayload || null,
      };
    });

    return new Response(
      JSON.stringify({
        audits: auditsWithMetrics,
        pagination: {
          page,
          pageSize,
          totalCount: totalFilteredCount,
          totalPages: Math.ceil(totalFilteredCount / pageSize)
        }
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error in get-audits-with-metrics:", error);
    return new Response(
      JSON.stringify({
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error"
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});