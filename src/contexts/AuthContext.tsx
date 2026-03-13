import React, { createContext, useContext, useEffect, useState } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    console.log('AuthProvider: Starting initialization');
    
    let mounted = true;
    
    // Set a timeout to prevent infinite loading
    const loadingTimeout = setTimeout(() => {
      if (mounted) {
        console.log('AuthProvider: Loading timeout reached, setting loading to false');
        setLoading(false);
      }
    }, 10000); // 10 second timeout

    const initAuth = async () => {
      try {
        // Set loading to false immediately if no Supabase config
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

        if (!supabaseUrl || !supabaseKey) {
          console.log('AuthProvider: No Supabase config, setting loading to false');
          if (mounted) {
            setLoading(false);
          }
          return;
        }

        console.log('AuthProvider: Getting session');
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (error) {
          console.error('AuthProvider: Session error:', error);
          
          // Handle invalid refresh token by clearing session
          if (error.message?.includes('Refresh Token Not Found') || 
              error.message?.includes('Invalid Refresh Token')) {
            console.log('AuthProvider: Clearing invalid session');
            await supabase.auth.signOut();
          }
        } else {
          console.log('AuthProvider: Session result:', session?.user?.id || 'no user');
        }
        
        if (mounted) {
          setUser(session?.user ?? null);
          clearTimeout(loadingTimeout);
          setLoading(false);
          console.log('AuthProvider: Loading set to false');
        }
      } catch (error) {
        console.error('AuthProvider: Init error:', error);
        if (mounted) {
          setUser(null);
          setUserProfile(null);
          clearTimeout(loadingTimeout);
          setLoading(false);
          console.log('AuthProvider: Loading set to false (error case)');
        }
      }
    };

    initAuth();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!mounted) return;
        
        console.log('AuthProvider: Auth state change:', event, session?.user?.id);
        setUser(session?.user ?? null);
        if (mounted) {
          clearTimeout(loadingTimeout);
        }
        setLoading(false);
      }
    );

    return () => {
      mounted = false;
      clearTimeout(loadingTimeout);
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      return { error };
    } catch (error) {
      console.error('Sign in error:', error);
      return { error };
    }
  };

  const signUp = async (email: string, password: string, fullName: string) => {
    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
          },
        },
      });
      return { error };
    } catch (error) {
      console.error('Sign up error:', error);
      return { error };
    }
  };

  const signOut = async () => {
    try {
      console.log('AuthContext: Starting sign out process');
      setLoading(true);
      
      // Clear local state first
      setUser(null);
      
      // Sign out from Supabase
      await supabase.auth.signOut();
      
      console.log('AuthContext: Sign out completed');
    } catch (error) {
      console.error('Sign out error:', error);
    } finally {
      setLoading(false);
    }
  };

  const value = {
    user,
    loading,
    signIn,
    signUp,
    signOut,
  };

  console.log('AuthProvider: Rendering with loading =', loading, 'user =', user?.id || 'none');

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};