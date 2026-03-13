import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface DomainCitation {
  project_id: string;
  domain: string;
  llm: string;
  cited_count: number;
  more_count: number;
  total_citations: number;
  first_seen: string;
  last_seen: string;
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
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      throw new Error("Unauthorized");
    }

    const url = new URL(req.url);
    const projectId = url.searchParams.get("projectId");
    const llmFilter = url.searchParams.get("llm");
    const domainSearch = url.searchParams.get("domain");
    const sortBy = url.searchParams.get("sortBy") || "total_citations";
    const sortOrder = url.searchParams.get("sortOrder") || "desc";
    const page = parseInt(url.searchParams.get("page") || "1");
    const pageSize = parseInt(url.searchParams.get("pageSize") || "50");
    const offset = (page - 1) * pageSize;

    const validSortColumns = ["domain", "llm", "cited_count", "more_count", "total_citations", "first_seen", "last_seen"];
    const validSortOrder = ["asc", "desc"];

    const finalSortBy = validSortColumns.includes(sortBy) ? sortBy : "total_citations";
    const finalSortOrder = validSortOrder.includes(sortOrder.toLowerCase()) ? sortOrder.toUpperCase() : "DESC";

    console.log('Request params:', { projectId, llmFilter, domainSearch, sortBy, sortOrder, page, pageSize });

    // Get accessible project IDs for the user
    const { data: accessibleProjects, error: projectsError } = await supabase
      .from("project_members")
      .select("project_id")
      .eq("user_id", user.id);

    if (projectsError) {
      console.error('Error fetching accessible projects:', projectsError);
      throw new Error("Failed to fetch accessible projects");
    }

    const accessibleProjectIds = accessibleProjects?.map(p => p.project_id) || [];
    console.log('User accessible projects:', accessibleProjectIds.length);

    if (accessibleProjectIds.length === 0) {
      // User has no accessible projects, return empty result
      return new Response(
        JSON.stringify({
          data: [],
          pagination: {
            page,
            pageSize,
            total: 0,
            totalPages: 0,
          },
        }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    let data: any[] = [];
    let count: number = 0;
    let error: any = null;

    if (projectId) {
      // Verify user has access to this specific project
      if (!accessibleProjectIds.includes(projectId)) {
        throw new Error("Unauthorized: No access to this project");
      }

      // Query for specific project
      let query = supabase
        .from("domain_citations_mv" as any)
        .select("*", { count: "exact" })
        .eq("project_id", projectId);

      if (llmFilter && llmFilter !== 'all') {
        query = query.eq("llm", llmFilter);
      }

      if (domainSearch) {
        query = query.ilike("domain", `%${domainSearch}%`);
      }

      query = query
        .order(finalSortBy, { ascending: finalSortOrder === "ASC" })
        .order("domain", { ascending: true })
        .range(offset, offset + pageSize - 1);

      const result = await query;
      data = result.data || [];
      count = result.count || 0;
      error = result.error;
    } else {
      // Aggregate across ALL accessible projects (global view)
      // Fetch ALL rows for accessible projects in batches
      const batchSize = 1000;
      let allData: any[] = [];
      let currentPage = 0;
      let hasMore = true;
      let queryError: any = null;

      while (hasMore && !queryError) {
        let query = supabase
          .from("domain_citations_mv" as any)
          .select("*")
          .in("project_id", accessibleProjectIds)
          .range(currentPage * batchSize, (currentPage + 1) * batchSize - 1);

        if (llmFilter && llmFilter !== 'all') {
          query = query.eq("llm", llmFilter);
        }

        if (domainSearch) {
          query = query.ilike("domain", `%${domainSearch}%`);
        }

        const { data: batchData, error: batchError } = await query;

        if (batchError) {
          queryError = batchError;
          break;
        }

        if (batchData && batchData.length > 0) {
          allData = allData.concat(batchData);
          currentPage++;
          hasMore = batchData.length === batchSize;
        } else {
          hasMore = false;
        }
      }

      error = queryError;

      console.log('Query result - data count:', allData?.length || 0);
      console.log('Query error:', queryError);

      if (!error && allData) {
        // Aggregate data across all projects
        // If llm filter is provided, group by domain+llm
        // If no llm filter, group by domain only (aggregate across all LLMs)
        const aggregated = new Map<string, any>();

        for (const row of allData) {
          const key = llmFilter && llmFilter !== 'all'
            ? `${row.domain}||${row.llm}`
            : row.domain;

          if (!aggregated.has(key)) {
            aggregated.set(key, {
              domain: row.domain,
              llm: llmFilter && llmFilter !== 'all' ? row.llm : 'all',
              cited_count: 0,
              more_count: 0,
              total_citations: 0,
              first_seen: row.first_seen,
              last_seen: row.last_seen,
            });
          }

          const agg = aggregated.get(key);
          agg.cited_count += row.cited_count || 0;
          agg.more_count += row.more_count || 0;
          agg.total_citations += row.total_citations || 0;

          // Update first_seen and last_seen
          if (row.first_seen && (!agg.first_seen || row.first_seen < agg.first_seen)) {
            agg.first_seen = row.first_seen;
          }
          if (row.last_seen && (!agg.last_seen || row.last_seen > agg.last_seen)) {
            agg.last_seen = row.last_seen;
          }
        }

        // Convert to array and sort
        let aggregatedArray = Array.from(aggregated.values());

        // Sort
        aggregatedArray.sort((a, b) => {
          const aVal = a[finalSortBy];
          const bVal = b[finalSortBy];

          if (typeof aVal === 'string' && typeof bVal === 'string') {
            return finalSortOrder === 'ASC'
              ? aVal.localeCompare(bVal)
              : bVal.localeCompare(aVal);
          }

          return finalSortOrder === 'ASC'
            ? (aVal || 0) - (bVal || 0)
            : (bVal || 0) - (aVal || 0);
        });

        // Set count and paginate
        count = aggregatedArray.length;
        data = aggregatedArray.slice(offset, offset + pageSize);
        console.log('Aggregated array length:', aggregatedArray.length);
        console.log('Paginated data length:', data.length);
      }
    }

    console.log('Final data length:', data.length);
    console.log('Final count:', count);
    console.log('Final error:', error);

    if (error) {
      throw error;
    }

    return new Response(
      JSON.stringify({
        data: data || [],
        pagination: {
          page,
          pageSize,
          total: count || 0,
          totalPages: Math.ceil((count || 0) / pageSize),
        },
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error("Error fetching domain citations:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Internal server error"
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
