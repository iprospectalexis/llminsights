import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.56.1";

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

    if (!supabaseServiceKey) {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY not found in environment");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Update system_settings with the service role key
    const { error: updateError } = await supabase
      .from("system_settings")
      .update({
        value: supabaseServiceKey,
        updated_at: new Date().toISOString(),
      })
      .eq("key", "service_role_key");

    if (updateError) {
      throw updateError;
    }

    // Verify the configuration
    const { data: settings, error: fetchError } = await supabase
      .from("system_settings")
      .select("key, updated_at")
      .in("key", ["supabase_url", "service_role_key"]);

    if (fetchError) {
      throw fetchError;
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Scheduled audits configured successfully",
        settings: settings,
        note: "The cron job will now process scheduled audits every minute",
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error: any) {
    console.error("Error configuring scheduled audits:", error);
    return new Response(
      JSON.stringify({
        error: error.message || "Failed to configure scheduled audits",
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }
});
