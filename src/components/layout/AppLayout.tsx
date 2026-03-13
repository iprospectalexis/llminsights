import React, { useEffect, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { Navbar } from './Navbar';
import { Sidebar } from './Sidebar';
import { Footer } from './Footer';
import { supabase } from '../../lib/supabase';
import { User } from '@supabase/supabase-js';
import { Loader2 } from 'lucide-react';

export const AppLayout: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const navigate = useNavigate();

  const toggleSidebarCollapse = () => {
    setIsSidebarCollapsed(!isSidebarCollapsed);
  };
  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.user) {
        navigate('/signin');
        return;
      }

      setUser(session.user);

      // Try to fetch user profile from database
      const { data: profile, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', session.user.id)
        .single();

      if (error || !profile) {
        console.error('Error fetching profile:', error);
        // Fallback to JWT metadata if database query fails
        const jwtRole = (session.user as any).app_metadata?.role || 'client';
        setUserProfile({
          id: session.user.id,
          email: session.user.email || '',
          full_name: session.user.user_metadata?.full_name || null,
          role: jwtRole,
          created_at: session.user.created_at || new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
      } else {
        setUserProfile(profile);
      }
    } catch (error) {
      console.error('Auth check error:', error);
      navigate('/signin');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-brand-primary" />
          <p className="text-gray-600 dark:text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="flex h-screen">
        <Sidebar
          user={user}
          userProfile={userProfile}
          isOpen={isSidebarOpen}
          collapsed={isSidebarCollapsed}
          onToggleCollapse={toggleSidebarCollapse}
        />
        <div className="flex-1 flex flex-col">
          <Navbar
            user={user}
            userProfile={userProfile}
            onToggleCollapse={toggleSidebarCollapse}
            isCollapsed={isSidebarCollapsed}
          />
          <main className="flex-1 overflow-auto">
            <div className="p-6">
              <Outlet />
            </div>
            <Footer />
          </main>
        </div>
      </div>
    </div>
  );
};