import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../ui/Button';
import { supabase } from '../../lib/supabase';
import { User, LogOut, PanelLeftClose, PanelLeftOpen, Moon, Sun } from 'lucide-react';
import { motion } from 'framer-motion';
import { useTheme } from '../../contexts/ThemeContext';

interface NavbarProps {
  user: any;
  userProfile: any;
  onToggleCollapse: () => void;
  isCollapsed: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({ user, userProfile, onToggleCollapse, isCollapsed }) => {
  const navigate = useNavigate();
  const { isDarkMode, toggleDarkMode } = useTheme();

  const handleSignOut = async () => {
    try {
      await supabase.auth.signOut();
      navigate('/signin');
    } catch (error) {
      console.error('Sign out error:', error);
    }
  };

  return (
    <motion.nav
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="bg-white/90 dark:bg-gray-900/95 backdrop-blur-md border-b border-gray-200 dark:border-gray-600 z-30"
    >
      <div className="px-6">
        <div className="flex justify-between h-16">
          <div className="flex items-center">
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggleCollapse}
              className="p-2 mr-2"
              title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {isCollapsed ? (
                <PanelLeftOpen className="w-5 h-5" />
              ) : (
                <PanelLeftClose className="w-5 h-5" />
              )}
            </Button>
          </div>

          <div className="flex items-center space-x-4">

            {/* Dark Mode Toggle */}
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleDarkMode}
              className="p-2"
              title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            >
              {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </Button>

            <div className="flex items-center space-x-2">
              <div className="p-2 bg-gray-100 dark:bg-gray-800 rounded-xl">
                <User className="w-5 h-5 text-gray-600 dark:text-gray-300" />
              </div>
              <div className="hidden sm:block">
                <div className="text-sm font-medium text-gray-900 dark:text-white">
                  {userProfile?.full_name || user?.email}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-300 capitalize">
                  {userProfile?.role || 'client'}
                </div>
              </div>
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={handleSignOut}
              className="p-2"
            >
              <LogOut className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </div>
    </motion.nav>
  );
};