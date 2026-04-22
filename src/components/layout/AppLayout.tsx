import React, { useEffect, useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
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
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  // Set when the JWT's app_metadata.role disagrees with public.users.role
  // AND a refreshSession() didn't heal it. The banner tells the user to
  // sign in again so their server-side role propagates into a fresh JWT.
  const [staleSessionBanner, setStaleSessionBanner] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  // Close mobile menu on route change
  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location.pathname]);

  const toggleSidebarCollapse = () => {
    setIsSidebarCollapsed(!isSidebarCollapsed);
  };

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      let { data: { session } } = await supabase.auth.getSession();

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

      // ── Stale-JWT self-heal ────────────────────────────────────────
      // If the session's JWT role disagrees with the role in public.users,
      // the user's browser is carrying an outdated claim set (typical cause:
      // their role was changed while they were signed in). refreshSession()
      // re-issues a JWT from the latest auth.users.raw_app_meta_data; if
      // that still doesn't match, auth.users itself is stale and only a
      // fresh sign-in will fix it (Layer 2 now handles this on write, but
      // pre-existing sessions from before the fix shipped need this).
      if (profile?.role) {
        const currentJwtRole = (session.user as any).app_metadata?.role ?? null;
        if (currentJwtRole !== profile.role) {
          const { data: refreshed } = await supabase.auth.refreshSession();
          session = refreshed?.session ?? session;
          const newJwtRole = (refreshed?.session?.user as any)?.app_metadata?.role ?? null;
          if (newJwtRole !== profile.role) {
            setStaleSessionBanner(
              `Your session is out of date (role in token: ${newJwtRole ?? 'none'}, expected: ${profile.role}). ` +
              `Sign out and back in to refresh your access.`
            );
          } else if (refreshed?.session?.user) {
            // Refresh picked up the right claims — update the in-page user
            // so the sidebar / navbar reflect the new role immediately.
            setUser(refreshed.session.user);
          }
        }
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
        {/* Desktop sidebar — hidden on mobile */}
        <div className="hidden md:block">
          <Sidebar
            user={user}
            userProfile={userProfile}
            isOpen={isSidebarOpen}
            collapsed={isSidebarCollapsed}
            onToggleCollapse={toggleSidebarCollapse}
          />
        </div>

        {/* Mobile sidebar overlay */}
        {isMobileMenuOpen && (
          <>
            <div
              className="fixed inset-0 bg-black/50 z-40 md:hidden"
              onClick={() => setIsMobileMenuOpen(false)}
            />
            <div className="fixed inset-y-0 left-0 z-50 md:hidden">
              <Sidebar
                user={user}
                userProfile={userProfile}
                isOpen={true}
                collapsed={false}
                onToggleCollapse={toggleSidebarCollapse}
                isMobile={true}
                onMobileClose={() => setIsMobileMenuOpen(false)}
              />
            </div>
          </>
        )}

        <div className="flex-1 flex flex-col min-w-0">
          <Navbar
            user={user}
            userProfile={userProfile}
            onToggleCollapse={toggleSidebarCollapse}
            isCollapsed={isSidebarCollapsed}
            onMobileMenuToggle={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          />
          <main className="flex-1 overflow-auto">
            {staleSessionBanner && (
              <div className="bg-amber-50 dark:bg-amber-900/30 border-b border-amber-200 dark:border-amber-700/50 text-amber-900 dark:text-amber-200 px-4 py-3 flex items-center justify-between gap-3">
                <div className="text-sm">{staleSessionBanner}</div>
                <button
                  onClick={async () => {
                    await supabase.auth.signOut();
                    navigate('/signin');
                  }}
                  className="text-xs font-medium px-3 py-1 rounded-lg bg-amber-600 text-white hover:bg-amber-700 flex-shrink-0"
                >
                  Sign out
                </button>
              </div>
            )}
            <div className="p-3 md:p-6">
              <Outlet />
            </div>
            <Footer />
          </main>
        </div>
      </div>
    </div>
  );
};
