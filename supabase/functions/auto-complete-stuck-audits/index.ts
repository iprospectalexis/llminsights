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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Call the auto_complete_audits function
    const { data, error } = await supabase.rpc('auto_complete_audits');

    if (error) {
      console.error('Error auto-completing audits:', error);
      throw error;
    }

    const completedAudits = data || [];
    const completedCount = completedAudits.filter((a: any) => a.new_status === 'completed').length;
    const failedCount = completedAudits.filter((a: any) => a.new_status === 'failed').length;

    console.log(`Auto-completed ${completedCount} audits, marked ${failedCount} as failed`);

    return new Response(
      JSON.stringify({
        success: true,
        completed: completedCount,
        failed: failedCount,
        details: completedAudits,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error('Error in auto-complete-stuck-audits:', error);
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