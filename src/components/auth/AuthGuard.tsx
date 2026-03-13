import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { AlertCircle } from 'lucide-react';
import { LoadingSpinner } from '../ui/LoadingSpinner';

interface AuthGuardProps {
  children: React.ReactNode;
  requireAuth?: boolean;
}

export const AuthGuard: React.FC<AuthGuardProps> = ({ 
  children, 
  requireAuth = true 
}) => {
  const { user, loading } = useAuth();
  const location = useLocation();

  console.log('AuthGuard: loading =', loading, 'user =', user?.id || 'none', 'requireAuth =', requireAuth);

  // Check if Supabase is configured
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.log('AuthGuard: No Supabase config');
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center max-w-md mx-auto p-6">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
            Database Connection Required
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            This application requires a Supabase database connection to function properly.
          </p>
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-xl p-4">
            <p className="text-sm text-blue-800 dark:text-blue-200">
              Click the "Connect to Supabase" button in the top right corner to set up your database connection.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    console.log('AuthGuard: Still loading');
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="mb-4 flex justify-center">
            <LoadingSpinner size="xl" />
          </div>
          <p className="text-gray-600 dark:text-gray-400">Loading authentication...</p>
          <p className="text-xs text-gray-500 dark:text-gray-500 mt-2">
            If this takes too long, try refreshing the page
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 px-4 py-2 bg-brand-primary text-white rounded-lg hover:bg-brand-primary/90 transition-colors"
          >
            Refresh Page
          </button>
        </div>
      </div>
    );
  }

  console.log('AuthGuard: Not loading, checking auth requirements');

  if (requireAuth && !user) {
    console.log('AuthGuard: Auth required but no user, redirecting to signin');
    return <Navigate to="/signin" state={{ from: location }} replace />;
  }

  if (!requireAuth && user) {
    console.log('AuthGuard: User exists but auth not required, redirecting to projects');
    return <Navigate to="/projects" replace />;
  }

  console.log('AuthGuard: Rendering children');
  return <>{children}</>;
};