import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { supabase } from '../lib/supabase';
import { Plus, CreditCard as Edit, Trash2, Users, Calendar, FolderOpen, MessageSquare, Play, Mail, User, Shield, Settings, Eye, UserPlus, Crown, UserCheck, Key } from 'lucide-react';
import { format } from 'date-fns';

interface UserWithStats {
  id: string;
  email: string;
  full_name: string | null;
  role: 'admin' | 'manager' | 'client';
  created_at: string;
  updated_at: string;
  projects_count: number;
  prompts_count: number;
  audits_count: number;
  last_activity: string | null;
  accessible_projects?: string[];
  can_run_audits?: boolean;
}

interface Project {
  id: string;
  name: string;
  domain: string;
  group_id?: string;
}

interface Group {
  id: string;
  name: string;
  color: string;
}

export const TeamPage: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [currentUserProfile, setCurrentUserProfile] = useState<any>(null);
  const [users, setUsers] = useState<UserWithStats[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showProjectAccessModal, setShowProjectAccessModal] = useState(false);
  const [showResetPasswordModal, setShowResetPasswordModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserWithStats | null>(null);
  
  // Form states
  const [createForm, setCreateForm] = useState({
    email: '',
    password: '',
    fullName: '',
    role: 'client' as 'admin' | 'manager' | 'client',
    selectedProjects: [] as string[],
    selectedGroups: [] as string[]
  });
  const [editForm, setEditForm] = useState({
    fullName: '',
    role: 'client' as 'admin' | 'manager' | 'client'
  });
  const [resetPasswordForm, setResetPasswordForm] = useState({
    newPassword: ''
  });
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    getCurrentUser();
  }, []);

  useEffect(() => {
    if (currentUserProfile) {
      fetchUsers();
      fetchProjects();
      fetchGroups();
    }
  }, [currentUserProfile]);

  const getCurrentUser = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      setCurrentUser(session.user);

      // Fetch user profile from database to get actual role
      const { data: profile, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', session.user.id)
        .single();

      if (error || !profile) {
        console.error('Error fetching current user profile:', error);
        // Fallback to JWT metadata
        const jwtRole = (session.user as any).app_metadata?.role || 'client';
        const fallbackProfile = {
          id: session.user.id,
          email: session.user.email || '',
          full_name: session.user.user_metadata?.full_name || null,
          role: jwtRole,
          created_at: session.user.created_at,
          updated_at: session.user.updated_at || session.user.created_at
        };
        setCurrentUserProfile(fallbackProfile);
      } else {
        setCurrentUserProfile(profile);
      }
    }
  };

  const fetchProjects = async () => {
    const { data } = await supabase
      .from('projects')
      .select('id, name, domain, group_id')
      .order('name');

    setProjects(data || []);
  };

  const fetchGroups = async () => {
    const { data } = await supabase
      .from('groups')
      .select('id, name, color')
      .order('name');

    setGroups(data || []);
  };

  const fetchUsers = async () => {
    if (!currentUserProfile) {
      console.log('⏳ TeamPage: Waiting for current user profile...');
      return;
    }

    setLoading(true);
    try {
      console.log('🔍 TeamPage: Starting to fetch users...');
      
      // Check if current user is manager/admin
      const isManager = currentUserProfile.role === 'manager' || currentUserProfile.role === 'admin';
      console.log('👤 TeamPage: Current user role:', currentUserProfile.role, 'Is manager:', isManager);
      
      let usersData;
      
      if (!isManager) {
        console.log('🚫 TeamPage: Non-privileged user, showing only own profile');
        // For non-managers, only show their own profile to avoid RLS issues
        usersData = [currentUserProfile];
      } else {
        console.log('👑 TeamPage: Manager user, fetching all users');
        // For managers, try to fetch all users
        const { data, error: usersError } = await supabase
          .from('users')
          .select('*, can_run_audits')
          .order('created_at', { ascending: false });

        if (usersError) {
          console.error('❌ TeamPage: Error fetching users:', usersError);
          // Fallback to showing only current user profile
          usersData = [currentUserProfile];
        } else {
          usersData = data;
        }
      }
      
      if (!usersData || usersData.length === 0) {
        console.log('⚠️ TeamPage: No users data available');
        setUsers([]);
        return;
      }
      
      console.log('✅ TeamPage: Raw users data received:', usersData?.length, 'users');
      console.log('📧 TeamPage: User emails:', usersData?.map(u => u.email));
      console.log('🔑 TeamPage: User roles:', usersData?.map(u => ({ email: u.email, role: u.role })));

      // Get statistics for each user
      const usersWithStats = await Promise.all(
        (usersData || []).map(async (userData) => {
          console.log('⚙️ TeamPage: Processing user:', userData.email, 'Role:', userData.role, 'ID:', userData.id);
          
          // Get projects count (projects created by user)
          const { count: projectsCount } = await supabase
            .from('projects')
            .select('*', { count: 'exact', head: true })
            .eq('created_by', userData.id);

          console.log(`📊 User ${userData.email}: owns ${projectsCount} projects`);
          // Get projects user has access to (including as member)
          const { data: memberProjects } = await supabase
            .from('project_members')
            .select('project_id')
            .eq('user_id', userData.id);

          const memberProjectIds = memberProjects?.map(pm => pm.project_id) || [];
          const ownProjectIds = await getProjectIds(userData.id);
          const allProjectIds = [...new Set([...ownProjectIds, ...memberProjectIds])];

          console.log(`🔗 User ${userData.email}: member of ${memberProjectIds.length} projects, total access: ${allProjectIds.length}`);
          // Get prompts count for all accessible projects
          let promptsCount = 0;
          
          if (allProjectIds.length > 0) {
            const { count } = await supabase
              .from('prompts')
              .select('*', { count: 'exact', head: true })
              .in('project_id', allProjectIds);
            promptsCount = count || 0;
          }

          // Get audits count
          const { count: auditsCount } = await supabase
            .from('audits')
            .select('*', { count: 'exact', head: true })
            .eq('run_by', userData.id);

          // Get last activity (most recent audit or project creation)
          const { data: lastActivity } = await supabase
            .from('audits')
            .select('created_at')
            .eq('run_by', userData.id)
            .order('created_at', { ascending: false })
            .limit(1);

          const userWithStats = {
            ...userData,
            projects_count: allProjectIds.length,
            prompts_count: promptsCount,
            audits_count: auditsCount || 0,
            last_activity: lastActivity?.[0]?.created_at || userData.updated_at,
            accessible_projects: allProjectIds,
          };
          
          console.log(`✅ User ${userData.email} processed:`, {
            projects: userWithStats.projects_count,
            prompts: userWithStats.prompts_count,
            audits: userWithStats.audits_count,
            role: userWithStats.role
          });
          
          return userWithStats;
        })
      );

      console.log('🎯 TeamPage: Final users with stats:', usersWithStats.length, 'users processed');
      console.log('👑 TeamPage: Managers:', usersWithStats.filter(u => u.role === 'manager' || u.role === 'admin').length);
      console.log('👤 TeamPage: Clients:', usersWithStats.filter(u => u.role === 'client').length);
      console.log('📋 TeamPage: All processed users:', usersWithStats.map(u => ({ 
        email: u.email, 
        role: u.role, 
        id: u.id 
      })));
      
      setUsers(usersWithStats);
      console.log('💾 TeamPage: Users state updated with', usersWithStats.length, 'users');
    } catch (error) {
      console.error('💥 TeamPage: Critical error fetching users:', error);
      // Fallback to showing only current user profile
      setUsers(currentUserProfile ? [{ ...currentUserProfile, projects_count: 0, prompts_count: 0, audits_count: 0, last_activity: currentUserProfile.updated_at, accessible_projects: [] }] : []);
    } finally {
      setLoading(false);
    }
    console.log('🏁 TeamPage: fetchUsers completed');
  };

  const getProjectIds = async (userId: string): Promise<string[]> => {
    const { data } = await supabase
      .from('projects')
      .select('id')
      .eq('created_by', userId);
    
    return data?.map(p => p.id) || [];
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      console.log('🚀 Creating user with data:', createForm);
      
      const { data, error } = await supabase.functions.invoke('create-user', {
        body: {
          email: createForm.email,
          password: createForm.password,
          fullName: createForm.fullName,
          role: createForm.role
        }
      });

      if (error) {
        console.error('❌ Error from create-user function:', error);
        console.error('❌ Full error details:', JSON.stringify(error, null, 2));

        // Handle specific error types
        let errorMessage = 'User creation service is not properly configured.';

        if (error.name === 'FunctionsHttpError') {
          // Try to get more specific error information
          if (error.context?.body) {
            try {
              const errorBody = typeof error.context.body === 'string'
                ? JSON.parse(error.context.body)
                : error.context.body;

              console.log('📋 Error response body:', errorBody);

              if (errorBody.code === 'MISSING_SUPABASE_URL') {
                errorMessage = 'Configuration Error: Please configure SUPABASE_URL in your Supabase Dashboard → Edge Functions → Settings.';
              } else if (errorBody.code === 'MISSING_SERVICE_KEY') {
                errorMessage = 'Configuration Error: Please configure SUPABASE_SERVICE_ROLE_KEY in your Supabase Dashboard → Edge Functions → Settings.';
              } else if (errorBody.code === 'INVALID_SUPABASE_URL') {
                errorMessage = 'Configuration Error: SUPABASE_URL format is invalid. It should be like https://your-project-ref.supabase.co';
              } else if (errorBody.code === 'INVALID_SERVICE_KEY') {
                errorMessage = 'Configuration Error: SUPABASE_SERVICE_ROLE_KEY format is invalid. Make sure you copied the service_role key (not anon key).';
              } else if (errorBody.error) {
                errorMessage = errorBody.error;
              } else {
                errorMessage = 'Edge Function configuration is incomplete. Please check your Supabase Edge Functions environment variables.';
              }
            } catch (parseError) {
              console.error('Failed to parse error body:', parseError);
              errorMessage = 'Edge Function is not responding correctly. Please check your Supabase Edge Functions configuration.';
            }
          }
          throw new Error(errorMessage);
        } else if (error.message?.includes('duplicate key')) {
          throw new Error('A user with this email already exists.');
        } else if (error.message?.includes('invalid email')) {
          throw new Error('Please enter a valid email address.');
        } else {
          throw new Error(error.message || 'Failed to create user. Please try again.');
        }
      }
      if (!data || !data.success) {
        console.error('❌ User creation failed - no success response:', data);
        throw new Error('User creation failed. Please try again.');
      }

      console.log('✅ User created successfully:', data);

      const newUserId = data.user.id;
      console.log('👤 New user ID:', newUserId);
      console.log('📋 Selected projects:', createForm.selectedProjects);
      console.log('📦 Selected groups:', createForm.selectedGroups);

      // Assign projects directly
      if (createForm.selectedProjects.length > 0) {
        console.log('➡️ Assigning', createForm.selectedProjects.length, 'projects directly...');
        const projectAssignments = createForm.selectedProjects.map(projectId => ({
          project_id: projectId,
          user_id: newUserId,
          role: 'viewer'
        }));

        console.log('📝 Project assignments to insert:', projectAssignments);
        const { data: insertedProjects, error: projectError } = await supabase
          .from('project_members')
          .insert(projectAssignments)
          .select();

        if (projectError) {
          console.error('❌ Error assigning projects:', projectError);
          alert(`Warning: Failed to assign some projects. Error: ${projectError.message}`);
        } else {
          console.log('✅ Projects assigned successfully:', insertedProjects);
        }
      }

      // Assign projects from selected groups
      if (createForm.selectedGroups.length > 0) {
        const groupProjects = projects.filter(p =>
          p.group_id && createForm.selectedGroups.includes(p.group_id)
        );

        console.log('➡️ Found', groupProjects.length, 'projects in selected groups');

        if (groupProjects.length > 0) {
          const groupProjectAssignments = groupProjects.map(project => ({
            project_id: project.id,
            user_id: newUserId,
            role: 'viewer'
          }));

          console.log('📝 Group project assignments to insert:', groupProjectAssignments);
          const { data: insertedGroupProjects, error: groupProjectError } = await supabase
            .from('project_members')
            .insert(groupProjectAssignments)
            .select();

          if (groupProjectError) {
            console.error('❌ Error assigning group projects:', groupProjectError);
            alert(`Warning: Failed to assign group projects. Error: ${groupProjectError.message}`);
          } else {
            console.log('✅ Group projects assigned successfully:', insertedGroupProjects);
          }
        }
      }

      setCreateForm({
        email: '',
        password: '',
        fullName: '',
        role: 'client',
        selectedProjects: [],
        selectedGroups: []
      });
      setShowCreateModal(false);
      
      console.log('⏳ Waiting 2 seconds before refreshing user list...');
      // Wait longer for the database to update, then refresh
      setTimeout(() => {
        console.log('🔄 Refreshing user list after user creation...');
        fetchUsers();
      }, 2000);
    } catch (error) {
      console.error('💥 Error creating user:', error);
      alert(`Failed to create user: ${error.message}`);
    }
    setSubmitting(false);
  };

  const handleEditUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;

    setSubmitting(true);

    try {
      // Role changes MUST go through the update-user-role Edge Function so
      // auth.users.app_metadata.role and refresh tokens are kept in sync.
      // Updating public.users directly would silently desync the JWT and
      // produce empty widgets for the edited user (the Valentine bug).
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      const { data, error } = await supabase.functions.invoke('update-user-role', {
        body: {
          userId: selectedUser.id,
          role: editForm.role,
          fullName: editForm.fullName,
        },
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Failed to update user');

      setShowEditModal(false);
      setSelectedUser(null);
      fetchUsers();
    } catch (error: any) {
      console.error('Error updating user:', error);
      alert(`Failed to update user: ${error?.message || 'Please try again.'}`);
    }
    setSubmitting(false);
  };

  const handleDeleteUser = async () => {
    if (!selectedUser) return;

    setSubmitting(true);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      const { data, error } = await supabase.functions.invoke('delete-user', {
        body: {
          userId: selectedUser.id
        },
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Failed to delete user');

      alert('User deleted successfully!');
      setShowDeleteModal(false);
      setSelectedUser(null);
      fetchUsers();
    } catch (error) {
      console.error('Error deleting user:', error);
      alert(`Failed to delete user: ${error.message}`);
    }
    setSubmitting(false);
  };

  const handleManageProjectAccess = async () => {
    if (!selectedUser) return;
    
    setSubmitting(true);

    try {
      // Remove existing project memberships
      await supabase
        .from('project_members')
        .delete()
        .eq('user_id', selectedUser.id);

      // Add new project memberships
      if (selectedProjects.length > 0) {
        const memberships = selectedProjects.map(projectId => ({
          project_id: projectId,
          user_id: selectedUser.id,
          role: 'client'
        }));

        const { error } = await supabase
          .from('project_members')
          .insert(memberships);

        if (error) throw error;
      }

      setShowProjectAccessModal(false);
      setSelectedUser(null);
      setSelectedProjects([]);
      fetchUsers();
    } catch (error) {
      console.error('Error managing project access:', error);
      alert('Failed to update project access. Please try again.');
    }
    setSubmitting(false);
  };

  const openEditModal = (user: UserWithStats) => {
    setSelectedUser(user);
    setEditForm({
      fullName: user.full_name || '',
      role: user.role
    });
    setShowEditModal(true);
  };

  const openDeleteModal = (user: UserWithStats) => {
    setSelectedUser(user);
    setShowDeleteModal(true);
  };

  const openProjectAccessModal = (user: UserWithStats) => {
    setSelectedUser(user);
    setSelectedProjects(user.accessible_projects || []);
    setShowProjectAccessModal(true);
  };

  const openResetPasswordModal = (user: UserWithStats) => {
    setSelectedUser(user);
    setResetPasswordForm({ newPassword: '' });
    setShowResetPasswordModal(true);
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;

    setSubmitting(true);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      const { data, error } = await supabase.functions.invoke('reset-user-password', {
        body: {
          userId: selectedUser.id,
          newPassword: resetPasswordForm.newPassword
        },
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Failed to reset password');

      alert('Password reset successfully!');
      setShowResetPasswordModal(false);
      setSelectedUser(null);
      setResetPasswordForm({ newPassword: '' });
    } catch (error) {
      console.error('Error resetting password:', error);
      alert(`Failed to reset password: ${error.message}`);
    }
    setSubmitting(false);
  };

  const handleToggleCanRunAudits = async (user: UserWithStats, newValue: boolean) => {
    try {
      const { error } = await supabase
        .from('users')
        .update({ can_run_audits: newValue })
        .eq('id', user.id);

      if (error) throw error;

      fetchUsers();
    } catch (error) {
      console.error('Error updating can_run_audits:', error);
      alert('Failed to update audit permission. Please try again.');
    }
  };

  const filteredUsers = users.filter(userData =>
    userData.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    userData.full_name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  console.log('🎨 TeamPage: Rendering with', users.length, 'total users');
  console.log('🔍 TeamPage: Filtered users:', filteredUsers.length);
  console.log('🔍 TeamPage: Search term:', searchTerm);
  
  const managers = filteredUsers.filter(user => user.role === 'manager' || user.role === 'admin');
  const clients = filteredUsers.filter(user => user.role === 'client');

  console.log('👑 TeamPage: Rendering managers:', managers.length, 'clients:', clients.length);
  console.log('👑 TeamPage: Manager details:', managers.map(m => ({ email: m.email, role: m.role })));
  console.log('👤 TeamPage: Client details:', clients.map(c => ({ email: c.email, role: c.role })));

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'admin': return 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400';
      case 'manager': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400';
      case 'client': return 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400';
      default: return 'bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-400';
    }
  };

  const isManager = currentUserProfile?.role === 'manager' || currentUserProfile?.role === 'admin';
  const isAdmin = currentUserProfile?.role === 'admin';

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-brand-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-600 dark:text-gray-400">Loading team...</p>
        </div>
      </div>
    );
  }

  // Show message when no users are loaded due to RLS issues
  if (users.length === 0) {
    return (
      <div className="space-y-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
        >
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
              Team Management
            </h1>
            <p className="text-gray-600 dark:text-gray-300 mt-1">
              Manage team members, roles, and project access
            </p>
          </div>
        </motion.div>

        <Card>
          <CardContent className="p-12 text-center">
            <Users className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
              Team Management Temporarily Unavailable
            </h3>
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              There's a configuration issue with the user permissions system that needs to be resolved.
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-500">
              Please contact your system administrator to fix the Row Level Security policies on the users table.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 md:space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
      >
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
            Team Management
          </h1>
          <p className="text-gray-600 dark:text-gray-300 mt-1">
            Manage team members, roles, and project access
          </p>
        </div>
        
        {isManager && (
          <Button
            variant="gradient"
            onClick={() => setShowCreateModal(true)}
          >
            <UserPlus className="w-4 h-4 mr-2" />
            Create User
          </Button>
        )}
      </motion.div>

      {/* Search */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-white/70 dark:bg-gray-800/70 backdrop-blur-md rounded-3xl border border-gray-200/50 dark:border-gray-700/50 p-6 shadow-sm"
      >
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Input
              placeholder="Search users by email or name..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-4"
            />
          </div>
          
          <div className="flex items-center space-x-3">
            <div className="text-sm text-gray-600 dark:text-gray-400">
              {managers.length} manager{managers.length !== 1 ? 's' : ''}, {clients.length} client{clients.length !== 1 ? 's' : ''}
            </div>
          </div>
        </div>
      </motion.div>

      {/* Managers Section */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
      >
        <div className="flex items-center space-x-3 mb-4">
          <Crown className="w-5 h-5 text-blue-600" />
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            Managers ({managers.length})
          </h2>
        </div>
        
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-blue-50 dark:bg-blue-900/20">
                  <tr>
                    <th className="px-6 py-4 text-left text-xs font-medium text-blue-700 dark:text-blue-300 uppercase tracking-wider">
                      Manager
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-medium text-blue-700 dark:text-blue-300 uppercase tracking-wider">
                      Projects
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-medium text-blue-700 dark:text-blue-300 uppercase tracking-wider">
                      Audits
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-medium text-blue-700 dark:text-blue-300 uppercase tracking-wider">
                      Last Activity
                    </th>
                    {isManager && (
                      <th className="px-6 py-4 text-left text-xs font-medium text-blue-700 dark:text-blue-300 uppercase tracking-wider">
                        Actions
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {managers.map((userData, index) => (
                    <motion.tr
                      key={userData.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.05 }}
                      className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                    >
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="w-10 h-10 bg-gradient-to-r from-blue-500 to-blue-600 rounded-full flex items-center justify-center">
                            <Crown className="w-5 h-5 text-white" />
                          </div>
                          <div className="ml-4">
                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                              {userData.full_name || 'No name'}
                            </div>
                            <div className="text-sm text-gray-500 dark:text-gray-400">
                              {userData.email}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center text-sm text-gray-900 dark:text-gray-100">
                          <FolderOpen className="w-4 h-4 mr-2 text-gray-400" />
                          {userData.projects_count}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center text-sm text-gray-900 dark:text-gray-100">
                          <Play className="w-4 h-4 mr-2 text-gray-400" />
                          {userData.audits_count}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center text-sm text-gray-500 dark:text-gray-400">
                          <Calendar className="w-4 h-4 mr-2" />
                          {userData.last_activity 
                            ? format(new Date(userData.last_activity), 'MMM d, yyyy')
                            : 'Never'
                          }
                        </div>
                      </td>
                      {isManager && (
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center space-x-2">
                            {isAdmin && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => openEditModal(userData)}
                                title="Edit User"
                              >
                                <Edit className="w-4 h-4" />
                              </Button>
                            )}
                            {isAdmin && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => openResetPasswordModal(userData)}
                                title="Reset Password"
                                className="text-orange-600 hover:text-orange-700"
                              >
                                <Key className="w-4 h-4" />
                              </Button>
                            )}
                            {isAdmin && userData.id !== currentUser?.id && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => openDeleteModal(userData)}
                                className="text-red-600 hover:text-red-700"
                                title="Delete User"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            )}
                          </div>
                        </td>
                      )}
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Clients Section */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
      >
        <div className="flex items-center space-x-3 mb-4">
          <UserCheck className="w-5 h-5 text-green-600" />
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            Clients ({clients.length})
          </h2>
        </div>
        
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-green-50 dark:bg-green-900/20">
                  <tr>
                    <th className="px-6 py-4 text-left text-xs font-medium text-green-700 dark:text-green-300 uppercase tracking-wider">
                      Client
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-medium text-green-700 dark:text-green-300 uppercase tracking-wider">
                      Project Access
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-medium text-green-700 dark:text-green-300 uppercase tracking-wider">
                      Audits
                    </th>
                    {isManager && (
                      <th className="px-6 py-4 text-left text-xs font-medium text-green-700 dark:text-green-300 uppercase tracking-wider">
                        Can Run Audits
                      </th>
                    )}
                    <th className="px-6 py-4 text-left text-xs font-medium text-green-700 dark:text-green-300 uppercase tracking-wider">
                      Last Activity
                    </th>
                    {isManager && (
                      <th className="px-6 py-4 text-left text-xs font-medium text-green-700 dark:text-green-300 uppercase tracking-wider">
                        Actions
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {clients.map((userData, index) => (
                    <motion.tr
                      key={userData.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.05 }}
                      className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                    >
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="w-10 h-10 bg-gradient-to-r from-green-500 to-green-600 rounded-full flex items-center justify-center">
                            <User className="w-5 h-5 text-white" />
                          </div>
                          <div className="ml-4">
                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                              {userData.full_name || 'No name'}
                            </div>
                            <div className="text-sm text-gray-500 dark:text-gray-400">
                              {userData.email}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center text-sm text-gray-900 dark:text-gray-100">
                          <FolderOpen className="w-4 h-4 mr-2 text-gray-400" />
                          {userData.projects_count} projects
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center text-sm text-gray-900 dark:text-gray-100">
                          <Play className="w-4 h-4 mr-2 text-gray-400" />
                          {userData.audits_count}
                        </div>
                      </td>
                      {isManager && (
                        <td className="px-6 py-4 whitespace-nowrap">
                          <button
                            onClick={() => handleToggleCanRunAudits(userData, !userData.can_run_audits)}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                              userData.can_run_audits
                                ? 'bg-blue-600'
                                : 'bg-gray-300 dark:bg-gray-600'
                            }`}
                            title={userData.can_run_audits ? 'Disable run audit' : 'Enable run audit'}
                          >
                            <span
                              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                userData.can_run_audits ? 'translate-x-6' : 'translate-x-1'
                              }`}
                            />
                          </button>
                        </td>
                      )}
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center text-sm text-gray-500 dark:text-gray-400">
                          <Calendar className="w-4 h-4 mr-2" />
                          {userData.last_activity
                            ? format(new Date(userData.last_activity), 'MMM d, yyyy')
                            : 'Never'
                          }
                        </div>
                      </td>
                      {isManager && (
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center space-x-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openProjectAccessModal(userData)}
                              title="Manage Project Access"
                            >
                              <Eye className="w-4 h-4" />
                            </Button>
                            {isAdmin && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => openEditModal(userData)}
                                title="Edit User"
                              >
                                <Edit className="w-4 h-4" />
                              </Button>
                            )}
                            {isAdmin && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => openResetPasswordModal(userData)}
                                title="Reset Password"
                                className="text-orange-600 hover:text-orange-700"
                              >
                                <Key className="w-4 h-4" />
                              </Button>
                            )}
                            {isAdmin && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => openDeleteModal(userData)}
                                className="text-red-600 hover:text-red-700"
                                title="Delete User"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            )}
                          </div>
                        </td>
                      )}
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Create User Modal */}
      <Modal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} title="Create New User">
        <form onSubmit={handleCreateUser} className="p-6 space-y-4">
          <Input
            label="Email"
            type="email"
            value={createForm.email}
            onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
            required
          />
          
          <Input
            label="Password"
            type="password"
            value={createForm.password}
            onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
            required
            minLength={8}
          />
          
          <Input
            label="Full Name"
            value={createForm.fullName}
            onChange={(e) => setCreateForm({ ...createForm, fullName: e.target.value })}
            required
          />
          
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Role
            </label>
            <select
              value={createForm.role}
              onChange={(e) => setCreateForm({ ...createForm, role: e.target.value as 'admin' | 'manager' | 'client' })}
              className="block w-full rounded-2xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2.5 text-gray-900 dark:text-gray-100"
            >
              <option value="client">Client</option>
              <option value="manager">Manager</option>
              {isAdmin && <option value="admin">Admin</option>}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Project Access (Select individual projects)
            </label>
            <div className="max-h-48 overflow-y-auto border border-gray-300 dark:border-gray-600 rounded-2xl p-3 space-y-2 bg-gray-50 dark:bg-gray-800">
              {projects.map(project => (
                <label key={project.id} className="flex items-center space-x-2 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 p-2 rounded-lg">
                  <input
                    type="checkbox"
                    checked={createForm.selectedProjects.includes(project.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setCreateForm({
                          ...createForm,
                          selectedProjects: [...createForm.selectedProjects, project.id]
                        });
                      } else {
                        setCreateForm({
                          ...createForm,
                          selectedProjects: createForm.selectedProjects.filter(id => id !== project.id)
                        });
                      }
                    }}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">{project.name}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Group Access (All projects in selected groups)
            </label>
            <div className="max-h-48 overflow-y-auto border border-gray-300 dark:border-gray-600 rounded-2xl p-3 space-y-2 bg-gray-50 dark:bg-gray-800">
              {groups.map(group => (
                <label key={group.id} className="flex items-center space-x-2 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 p-2 rounded-lg">
                  <input
                    type="checkbox"
                    checked={createForm.selectedGroups.includes(group.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setCreateForm({
                          ...createForm,
                          selectedGroups: [...createForm.selectedGroups, group.id]
                        });
                      } else {
                        setCreateForm({
                          ...createForm,
                          selectedGroups: createForm.selectedGroups.filter(id => id !== group.id)
                        });
                      }
                    }}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <div className="flex items-center space-x-2">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: group.color }}
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">{group.name}</span>
                    <span className="text-xs text-gray-500">
                      ({projects.filter(p => p.group_id === group.id).length} projects)
                    </span>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200 dark:border-gray-700">
            <Button variant="secondary" onClick={() => setShowCreateModal(false)}>
              Cancel
            </Button>
            <Button variant="gradient" type="submit" loading={submitting}>
              Create User
            </Button>
          </div>
        </form>
      </Modal>

      {/* Edit User Modal */}
      <Modal isOpen={showEditModal} onClose={() => setShowEditModal(false)} title="Edit User">
        <form onSubmit={handleEditUser} className="p-6 space-y-4">
          <Input
            label="Full Name"
            value={editForm.fullName}
            onChange={(e) => setEditForm({ ...editForm, fullName: e.target.value })}
            required
          />
          
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Role
            </label>
            <select
              value={editForm.role}
              onChange={(e) => setEditForm({ ...editForm, role: e.target.value as 'admin' | 'manager' | 'client' })}
              className="block w-full rounded-2xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2.5 text-gray-900 dark:text-gray-100"
            >
              <option value="client">Client</option>
              <option value="manager">Manager</option>
              {isAdmin && <option value="admin">Admin</option>}
            </select>
          </div>

          <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200 dark:border-gray-700">
            <Button variant="secondary" onClick={() => setShowEditModal(false)}>
              Cancel
            </Button>
            <Button variant="gradient" type="submit" loading={submitting}>
              Save Changes
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete User Modal */}
      <Modal isOpen={showDeleteModal} onClose={() => setShowDeleteModal(false)} title="Delete User">
        <div className="p-6">
          <div className="text-center">
            <div className="w-12 h-12 bg-red-100 rounded-full mx-auto mb-4 flex items-center justify-center">
              <Trash2 className="w-6 h-6 text-red-600" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
              Delete User
            </h3>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              Are you sure you want to delete <strong>{selectedUser?.full_name || selectedUser?.email}</strong>? 
              This action cannot be undone.
            </p>
            <div className="flex justify-center space-x-3">
              <Button variant="secondary" onClick={() => setShowDeleteModal(false)}>
                Cancel
              </Button>
              <Button 
                variant="secondary" 
                onClick={handleDeleteUser} 
                loading={submitting}
                className="bg-red-600 text-white hover:bg-red-700"
              >
                Delete User
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Project Access Modal */}
      <Modal isOpen={showProjectAccessModal} onClose={() => setShowProjectAccessModal(false)} title="Manage Project Access">
        <div className="p-6 space-y-4">
          <div className="mb-4">
            <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Grant access to projects for {selectedUser?.full_name || selectedUser?.email}
            </h4>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Select which projects this user can view and use in Prompt Finder
            </p>
          </div>
          
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {projects.map(project => (
              <label
                key={project.id}
                className="flex items-center p-3 rounded-xl border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selectedProjects.includes(project.id)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedProjects([...selectedProjects, project.id]);
                    } else {
                      setSelectedProjects(selectedProjects.filter(id => id !== project.id));
                    }
                  }}
                  className="w-4 h-4 text-brand-primary border-gray-300 rounded focus:ring-brand-primary"
                />
                <div className="ml-3">
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {project.name}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {project.domain}
                  </div>
                </div>
              </label>
            ))}
          </div>

          <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200 dark:border-gray-700">
            <Button variant="secondary" onClick={() => setShowProjectAccessModal(false)}>
              Cancel
            </Button>
            <Button variant="gradient" onClick={handleManageProjectAccess} loading={submitting}>
              Save Access Rights
            </Button>
          </div>
        </div>
      </Modal>

      {/* Reset Password Modal */}
      <Modal isOpen={showResetPasswordModal} onClose={() => setShowResetPasswordModal(false)} title="Reset User Password">
        <form onSubmit={handleResetPassword} className="p-6 space-y-4">
          <div className="mb-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Resetting password for <strong>{selectedUser?.full_name || selectedUser?.email}</strong>
            </p>
          </div>

          <Input
            label="New Password"
            type="password"
            value={resetPasswordForm.newPassword}
            onChange={(e) => setResetPasswordForm({ newPassword: e.target.value })}
            required
            minLength={8}
            placeholder="Enter new password (min 8 characters)"
          />

          <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200 dark:border-gray-700">
            <Button variant="secondary" onClick={() => setShowResetPasswordModal(false)}>
              Cancel
            </Button>
            <Button variant="gradient" type="submit" loading={submitting}>
              Reset Password
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};