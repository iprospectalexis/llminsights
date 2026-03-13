import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

console.log('Supabase config check:', {
  url: supabaseUrl ? `Set (${supabaseUrl.substring(0, 20)}...)` : 'Missing',
  key: supabaseAnonKey ? `Set (${supabaseAnonKey.substring(0, 20)}...)` : 'Missing'
});

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase environment variables');
  // Don't throw error, let the app handle it gracefully
}

export const supabase = supabaseUrl && supabaseAnonKey ? createClient<Database>(supabaseUrl, supabaseAnonKey, {
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
  auth: {
    persistSession: true,
  },
}) : null as any;

// Auth helpers
export const signUp = async (email: string, password: string, fullName: string) => {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
      },
    },
  });
  return { data, error };
};

export const signIn = async (email: string, password: string) => {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  return { data, error };
};

export const signOut = async () => {
  try {
    console.log('Supabase: Starting sign out');
    const { error } = await supabase.auth.signOut();
    
    if (error) {
      console.error('Supabase: Sign out error:', error);
      return { error };
    }
    
    console.log('Supabase: Sign out successful');
    return { error: null };
  } catch (error) {
    console.error('Supabase: Sign out exception:', error);
    return { error };
  }
};

export const getCurrentUser = async () => {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
};