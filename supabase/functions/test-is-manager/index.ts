import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get user from JWT
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    
    if (userError || !user) {
      throw new Error('Invalid token');
    }

    // Create a client with the user's token (not service role) to test RLS
    const userSupabase = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    // Test 1: Get user role from users table
    const { data: userData, error: userDataError } = await supabase
      .from('users')
      .select('id, email, role')
      .eq('id', user.id)
      .single();

    // Test 2: Get projects count with service role (bypasses RLS)
    const { count: projectsCountServiceRole, error: projectsErrorServiceRole } = await supabase
      .from('projects')
      .select('*', { count: 'exact', head: true });

    // Test 3: Get projects count with user token (respects RLS)
    const { data: projectsData, count: projectsCountUser, error: projectsErrorUser } = await userSupabase
      .from('projects')
      .select('*, groups(id, name, color)', { count: 'exact' })
      .order('created_at', { ascending: false });

    // Test 4: Get project_members for this user
    const { data: membershipData, error: membershipError } = await userSupabase
      .from('project_members')
      .select('project_id, role')
      .eq('user_id', user.id);

    return new Response(
      JSON.stringify({
        user: {
          id: user.id,
          email: user.email,
        },
        userData,
        userDataError: userDataError?.message,
        projectsCountServiceRole,
        projectsErrorServiceRole: projectsErrorServiceRole?.message,
        projectsCountUser,
        projectsErrorUser: projectsErrorUser?.message,
        projectsDataSample: projectsData?.slice(0, 3),
        membershipData,
        membershipError: membershipError?.message,
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  }
});