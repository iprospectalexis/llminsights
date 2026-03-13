import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

interface CreateUserRequest {
  email: string
  password: string
  fullName: string
  role: 'admin' | 'manager' | 'client'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    console.log('🚀 create-user function called')

    // Get environment variables (automatically available in Supabase Edge Functions)
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    console.log('✅ Initializing Supabase client')

    // Initialize Supabase client with service role key for admin operations
    const supabaseClient = createClient(
      supabaseUrl,
      supabaseServiceKey
    )

    console.log('✅ Supabase client initialized')

    const { email, password, fullName, role }: CreateUserRequest = await req.json()
    
    console.log('📝 Request data:', { email, fullName, role, hasPassword: !!password })

    if (!email || !password || !fullName || !role) {
      console.error('❌ Missing required parameters')
      return new Response(
        JSON.stringify({ 
          error: 'Missing required parameters: email, password, fullName, and role are all required',
          code: 'MISSING_PARAMETERS'
        }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    console.log('🔐 Attempting to create auth user with Supabase Admin API...')

    // Create user using admin API with role in app_metadata
    const { data: authData, error: authError } = await supabaseClient.auth.admin.createUser({
      email,
      password,
      user_metadata: {
        full_name: fullName,
      },
      app_metadata: {
        role: role,
      },
      email_confirm: true, // Auto-confirm email
    })

    if (authError) {
      console.error('❌ Error creating auth user:', authError)
      console.error('❌ Auth error details:', JSON.stringify(authError, null, 2))
      return new Response(
        JSON.stringify({ 
          error: `Failed to create authentication user: ${authError.message}`,
          code: 'AUTH_ERROR',
          details: authError
        }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    if (!authData.user) {
      console.error('❌ No user data returned from auth creation')
      return new Response(
        JSON.stringify({ 
          error: 'Authentication user was not created - no user data returned',
          code: 'NO_USER_DATA'
        }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    console.log('✅ Auth user created:', authData.user.id)
    console.log('👤 Updating user profile with correct role...')

    // The trigger already created the profile, so we just need to update it with the correct role
    // Use upsert to handle both cases (if trigger worked or not)
    const profileUpsertData = {
      id: authData.user.id,
      email: authData.user.email!,
      full_name: fullName,
      role: role,
    }
    console.log('📝 Profile data to upsert:', profileUpsertData)

    // Upsert user profile in users table (update if exists, insert if not)
    const { data: profileData, error: profileError } = await supabaseClient
      .from('users')
      .upsert(profileUpsertData, { onConflict: 'id' })
      .select()

    if (profileError) {
      console.error('❌ Error creating user profile:', profileError)
      console.error('❌ Profile error details:', JSON.stringify(profileError, null, 2))
      
      // Check if it's an RLS policy issue
      if (profileError.code === '42501' || profileError.message?.includes('policy')) {
        console.error('🚫 RLS policy issue detected - check users table policies')
      }
      
      // If profile creation fails, clean up the auth user
      try {
        console.log('🧹 Cleaning up auth user due to profile creation failure')
        await supabaseClient.auth.admin.deleteUser(authData.user.id)
      } catch (cleanupError) {
        console.error('Error cleaning up auth user:', cleanupError)
      }
      
      return new Response(
        JSON.stringify({ 
          error: `Failed to create user profile: ${profileError.message}`,
          code: 'PROFILE_ERROR',
          details: profileError
        }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    console.log('✅ User profile created successfully:', profileData)
    console.log('✅ Complete user creation successful for:', authData.user.id)
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        user: {
          id: authData.user.id,
          email: authData.user.email,
          full_name: fullName,
          role: role
        }
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    console.error('💥 Critical error in create-user function:', error)
    console.error('💥 Error stack:', error.stack)
    console.error('💥 Error name:', error.name)
    console.error('💥 Error message:', error.message)
    return new Response(
      JSON.stringify({ 
        error: `Internal server error: ${error.message}`,
        code: 'INTERNAL_ERROR',
        details: error.message 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})