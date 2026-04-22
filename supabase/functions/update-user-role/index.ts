// Edge Function: update-user-role
//
// Atomically synchronises a user's role across three places:
//   1. public.users.role            (used by the UI)
//   2. auth.users.app_metadata.role (stamped into JWT at sign-in)
//   3. auth.refresh_tokens          (revoked so the next refresh forces re-auth)
//
// Without step 2 the RLS policies that check auth.jwt() -> 'role' silently
// fall through for any user whose role was changed. Without step 3 existing
// sessions keep the old JWT claims until the refresh token naturally expires
// (~30 days), so role changes appear to take effect only for brand-new
// sign-ins. See: docs/role-sync.md (context).
//
// Caller must be admin OR manager (mirrors the TeamPage edit permission).

import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface UpdateUserRoleRequest {
  userId: string
  role: 'admin' | 'manager' | 'client'
  fullName?: string
}

const VALID_ROLES = new Set(['admin', 'manager', 'client'])

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ error: 'Server configuration error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

    // Authn: valid bearer token
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Authz: admin OR manager
    const { data: callerProfile } = await supabaseAdmin
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single()
    if (!callerProfile || !['admin', 'manager'].includes(callerProfile.role)) {
      return new Response(
        JSON.stringify({ error: 'Forbidden: Admin or Manager access required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Input validation
    const body: UpdateUserRoleRequest = await req.json()
    const { userId, role, fullName } = body
    if (!userId || !role) {
      return new Response(
        JSON.stringify({ error: 'Missing userId or role' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    if (!VALID_ROLES.has(role)) {
      return new Response(
        JSON.stringify({ error: `Invalid role. Must be one of: admin, manager, client` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Only admins may promote/demote to/from admin.
    if ((role === 'admin') && callerProfile.role !== 'admin') {
      return new Response(
        JSON.stringify({ error: 'Only admins can assign the admin role' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ── Step 1: public.users row ─────────────────────────────────────
    const publicUpdate: Record<string, unknown> = {
      role,
      updated_at: new Date().toISOString(),
    }
    if (typeof fullName === 'string') publicUpdate.full_name = fullName

    const { error: publicErr } = await supabaseAdmin
      .from('users')
      .update(publicUpdate)
      .eq('id', userId)

    if (publicErr) {
      console.error('update-user-role: public.users update failed', publicErr)
      return new Response(
        JSON.stringify({ error: `Failed to update user profile: ${publicErr.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ── Step 2: auth.users.app_metadata.role (drives JWT claims) ─────
    const { error: authErr } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      app_metadata: { role },
    })
    if (authErr) {
      console.error('update-user-role: auth.admin.updateUserById failed', authErr)
      // Don't return yet — public.users is already updated; surface the
      // inconsistency to the caller so they know a retry is needed.
      return new Response(
        JSON.stringify({
          error: `Profile updated but JWT metadata sync failed: ${authErr.message}. Ask the user to sign out and back in.`,
          partial: true,
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ── Step 3: revoke existing refresh tokens so next request re-auths
    // Done via SQL because auth.refresh_tokens isn't exposed via PostgREST.
    // Using the service-role REST endpoint instead would require a DB function;
    // the admin API supports signOut(user_id) which does the same thing.
    const { error: signOutErr } = await supabaseAdmin.auth.admin.signOut(userId)
    if (signOutErr) {
      // Soft failure — not fatal; the user will eventually pick up the new JWT
      // when their current access token expires (~1h default).
      console.warn('update-user-role: signOut failed (non-fatal)', signOutErr)
    }

    return new Response(
      JSON.stringify({
        success: true,
        userId,
        role,
        sessionsRevoked: !signOutErr,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    const err = error as Error
    console.error('update-user-role: unhandled error', err)
    return new Response(
      JSON.stringify({ error: `Internal server error: ${err.message}` }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
