import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    // Create Supabase client with service role
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Queue recent and running audits for refresh (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data: recentAudits } = await supabase
      .from("audits")
      .select("id, status")
      .or(`status.eq.running,created_at.gte.${sevenDaysAgo.toISOString()}`)
      .limit(100);

    if (recentAudits && recentAudits.length > 0) {
      // Queue these audits for refresh
      await supabase
        .from("audit_metrics_refresh_queue")
        .upsert(
          recentAudits.map(audit => ({
            audit_id: audit.id,
            queued_at: new Date().toISOString()
          })),
          { onConflict: 'audit_id' }
        );

      // Refresh queued metrics
      const { error } = await supabase.rpc("refresh_queued_audit_metrics");

      if (error) {
        console.error("Error refreshing audit metrics:", error);
        throw error;
      }
    }

    // Also refresh domain citations materialized view
    console.log("Refreshing domain citations materialized view...");
    const { error: domainError } = await supabase.rpc("refresh_domain_citations_mv");

    if (domainError) {
      console.error("Error refreshing domain citations:", domainError);
      // Don't throw - this is not critical
    } else {
      console.log("Domain citations materialized view refreshed successfully");
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Audit metrics and domain citations refreshed successfully",
        audits_refreshed: recentAudits?.length || 0
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error in refresh-audit-metrics:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to refresh audit metrics",
        message: error instanceof Error ? error.message : "Unknown error"
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});