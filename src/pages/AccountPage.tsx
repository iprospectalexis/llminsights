import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { supabase } from '../lib/supabase';
import { useTheme } from '../contexts/ThemeContext';
import { User, Mail, Shield, Moon, Sun, Globe, CheckCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export const AccountPage: React.FC = () => {
  const [user, setUser] = useState<any>(null);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const { isDarkMode, toggleDarkMode } = useTheme();
  const { i18n } = useTranslation();
  const [formData, setFormData] = useState({
    fullName: userProfile?.full_name || '',
    email: user?.email || '',
  });

  useEffect(() => {
    getCurrentUser();
  }, []);

  const getCurrentUser = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      setUser(session.user);

      // Fetch user profile from database
      const { data: profile, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', session.user.id)
        .single();

      if (error || !profile) {
        console.error('Error fetching profile:', error);
        // Fallback to JWT metadata
        const jwtRole = (session.user as any).app_metadata?.role || 'client';
        const profileFromSession = {
          id: session.user.id,
          email: session.user.email || '',
          full_name: session.user.user_metadata?.full_name || '',
          role: jwtRole,
          created_at: session.user.created_at,
          updated_at: session.user.updated_at
        };
        setUserProfile(profileFromSession);
        setFormData({
          fullName: profileFromSession.full_name,
          email: session.user.email || '',
        });
      } else {
        setUserProfile(profile);
        setFormData({
          fullName: profile.full_name || '',
          email: profile.email || '',
        });
      }
    }
  };

  const handleLanguageChange = (language: string) => {
    i18n.changeLanguage(language);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!user || !userProfile) return;
    
    try {
      // Update auth user metadata instead of users table to avoid RLS issues
      const { error } = await supabase.auth.updateUser({
        data: {
          full_name: formData.fullName
        }
      });

      if (error) {
        console.error('Error updating user metadata:', error);
        alert('Failed to update profile. Please try again.');
        return;
      }

      // Update local state
      setUserProfile({
        ...userProfile,
        full_name: formData.fullName,
        updated_at: new Date().toISOString()
      });

      setShowSuccessModal(true);
    } catch (error) {
      console.error('Error updating profile:', error);
      alert('Failed to update profile. Please try again.');
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
          Account Settings
        </h1>
        <p className="text-gray-600 dark:text-gray-300 mt-1">
          Manage your account preferences and profile information
        </p>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <div className="flex items-center space-x-3">
              <User className="w-5 h-5 text-brand-primary" />
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Profile Information
              </h2>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                label="Full Name"
                value={formData.fullName}
                onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                icon={<User className="w-5 h-5" />}
              />
              
              <Input
                label="Email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                icon={<Mail className="w-5 h-5" />}
                disabled
              />

              <div className="flex items-center space-x-2 p-3 bg-gray-50 dark:bg-gray-700 rounded-xl">
                <Shield className="w-5 h-5 text-brand-primary" />
                <div>
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    Role: {userProfile?.role || 'client'}
                  </div>
                  <div className="text-xs text-gray-600 dark:text-gray-300">
                    Contact an admin to change your role
                  </div>
                </div>
              </div>

              <Button variant="gradient" type="submit" className="w-full">
                Save Changes
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Theme Preferences
              </h2>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-xl">
                  <div className="flex items-center space-x-3">
                    {isDarkMode ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
                    <div>
                      <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        Dark Mode
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-300">
                        {isDarkMode ? 'Enabled' : 'Disabled'}
                      </div>
                    </div>
                  </div>
                  <Button variant="secondary" size="sm" onClick={toggleDarkMode}>
                    Toggle
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center space-x-3">
                <Globe className="w-5 h-5 text-brand-primary" />
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  Language
                </h2>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <button
                  onClick={() => handleLanguageChange('en')}
                  className={`
                    w-full text-left p-3 rounded-xl border transition-colors
                    ${i18n.language === 'en'
                      ? 'border-brand-primary bg-brand-primary/5 text-brand-primary'
                      : 'border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                    }
                  `}
                >
                  <div className="font-medium">English</div>
                  <div className="text-sm text-gray-600 dark:text-gray-300">Default language</div>
                </button>
                
                <button
                  onClick={() => handleLanguageChange('fr')}
                  className={`
                    w-full text-left p-3 rounded-xl border transition-colors
                    ${i18n.language === 'fr'
                      ? 'border-brand-primary bg-brand-primary/5 text-brand-primary'
                      : 'border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                    }
                  `}
                >
                  <div className="font-medium">Français</div>
                  <div className="text-sm text-gray-600 dark:text-gray-300">French translation</div>
                </button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Success Modal */}
      <Modal isOpen={showSuccessModal} onClose={() => setShowSuccessModal(false)} title="Success">
        <div className="p-6 text-center">
          <div className="w-16 h-16 bg-green-100 dark:bg-green-900/20 rounded-full mx-auto mb-4 flex items-center justify-center">
            <CheckCircle className="w-8 h-8 text-green-600 dark:text-green-400" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
            Profile Updated Successfully!
          </h3>
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            Your profile information has been saved.
          </p>
          <Button variant="gradient" onClick={() => setShowSuccessModal(false)}>
            Continue
          </Button>
        </div>
      </Modal>
    </div>
  );
};