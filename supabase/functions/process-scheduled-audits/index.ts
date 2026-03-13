import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.56.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface Project {
  id: string;
  name: string;
  schedule_frequency: string;
  schedule_time: string;
  schedule_day_of_week?: number;
  schedule_day_of_month?: number;
  schedule_timezone: string;
  last_scheduled_audit_at?: string;
  next_scheduled_audit_at?: string;
}

function calculateNextScheduledRun(project: Project): Date {
  const now = new Date();
  const timezone = project.schedule_timezone || 'UTC';

  const [hours, minutes] = project.schedule_time.split(':').map(Number);

  let nextRun = new Date(now);
  nextRun.setHours(hours, minutes, 0, 0);

  switch (project.schedule_frequency) {
    case 'daily':
      if (nextRun <= now) {
        nextRun.setDate(nextRun.getDate() + 1);
      }
      break;

    case 'weekly':
      const targetDay = project.schedule_day_of_week ?? 1;
      const currentDay = nextRun.getDay();
      let daysToAdd = targetDay - currentDay;

      if (daysToAdd < 0 || (daysToAdd === 0 && nextRun <= now)) {
        daysToAdd += 7;
      }

      nextRun.setDate(nextRun.getDate() + daysToAdd);
      break;

    case 'monthly':
      const targetDate = project.schedule_day_of_month ?? 1;
      nextRun.setDate(targetDate);

      if (nextRun <= now) {
        nextRun.setMonth(nextRun.getMonth() + 1);
      }

      const lastDayOfMonth = new Date(nextRun.getFullYear(), nextRun.getMonth() + 1, 0).getDate();
      if (targetDate > lastDayOfMonth) {
        nextRun.setDate(lastDayOfMonth);
      }
      break;

    default:
      nextRun.setDate(nextRun.getDate() + 1);
  }

  return nextRun;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const now = new Date().toISOString();

    const { data: projects, error: projectsError } = await supabase
      .from("projects")
      .select("id, name, schedule_frequency, schedule_time, schedule_day_of_week, schedule_day_of_month, schedule_timezone, last_scheduled_audit_at, next_scheduled_audit_at")
      .eq("scheduled_audits_enabled", true)
      .lte("next_scheduled_audit_at", now);

    if (projectsError) {
      console.error("Error fetching scheduled projects:", projectsError);
      throw projectsError;
    }

    if (!projects || projects.length === 0) {
      console.log("No scheduled audits to process");
      return new Response(
        JSON.stringify({ message: "No scheduled audits to process", processed: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Found ${projects.length} projects with scheduled audits due`);

    const results = [];

    for (const project of projects) {
      try {
        const { data: runningAudits, error: auditsError } = await supabase
          .from("audits")
          .select("id")
          .eq("project_id", project.id)
          .in("status", ["pending", "running"])
          .limit(1);

        if (auditsError) {
          console.error(`Error checking running audits for project ${project.id}:`, auditsError);
          results.push({ project_id: project.id, success: false, error: "Failed to check running audits" });
          continue;
        }

        if (runningAudits && runningAudits.length > 0) {
          console.log(`Project ${project.id} already has a running audit, skipping`);
          results.push({ project_id: project.id, success: false, error: "Audit already running" });
          continue;
        }

        const runAuditResponse = await fetch(`${supabaseUrl}/functions/v1/run-audit`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({
            projectId: project.id,
            isScheduled: true,
          }),
        });

        if (!runAuditResponse.ok) {
          const errorText = await runAuditResponse.text();
          console.error(`Failed to start audit for project ${project.id}:`, errorText);
          results.push({ project_id: project.id, success: false, error: errorText });
          continue;
        }

        const auditResult = await runAuditResponse.json();
        console.log(`Successfully started scheduled audit for project ${project.id}:`, auditResult.audit_id);

        const nextRun = calculateNextScheduledRun(project as Project);

        const { error: updateError } = await supabase
          .from("projects")
          .update({
            last_scheduled_audit_at: now,
            next_scheduled_audit_at: nextRun.toISOString(),
          })
          .eq("id", project.id);

        if (updateError) {
          console.error(`Error updating project ${project.id} timestamps:`, updateError);
        }

        results.push({
          project_id: project.id,
          success: true,
          audit_id: auditResult.audit_id,
          next_run: nextRun.toISOString(),
        });

      } catch (error) {
        console.error(`Error processing project ${project.id}:`, error);
        results.push({ project_id: project.id, success: false, error: String(error) });
      }
    }

    const successCount = results.filter(r => r.success).length;

    return new Response(
      JSON.stringify({
        message: `Processed ${projects.length} scheduled audits`,
        processed: projects.length,
        succeeded: successCount,
        failed: projects.length - successCount,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error in process-scheduled-audits:", error);
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
