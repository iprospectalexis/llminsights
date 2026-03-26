import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { supabase } from '../lib/supabase';
import { Plus, Palette, Folder } from 'lucide-react';

export const GroupsPage: React.FC = () => {
  const [user, setUser] = useState<any>(null);
  const [groups, setGroups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    color: '#6366f1',
  });

  useEffect(() => {
    getCurrentUser();
    fetchGroups();
  }, []);

  const getCurrentUser = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    setUser(session?.user || null);
  };

  const fetchGroups = async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        setGroups([]);
        setLoading(false);
        return;
      }

      // Fetch all groups - RLS policies will automatically filter based on user's role
      // - Admins/Managers see all groups (via is_manager() function)
      // - Group creators see their own groups
      const { data, error } = await supabase
        .from('groups')
        .select(`
          *,
          project_groups (
            project_id,
            projects (
              id,
              name
            )
          )
        `)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching groups:', error);
        throw error;
      }

      // Flatten project_groups join into a simple projects array, then deduplicate groups by name
      const groupMap = new Map<string, any>();
      for (const g of (data || [])) {
        // Extract projects from junction table
        const projects = (g.project_groups || [])
          .map((pg: any) => pg.projects)
          .filter(Boolean);

        const key = g.name.toLowerCase().trim();
        if (groupMap.has(key)) {
          // Merge projects into existing entry
          const existing = groupMap.get(key);
          const existingIds = new Set((existing.projects || []).map((p: any) => p.id));
          for (const p of projects) {
            if (!existingIds.has(p.id)) {
              existing.projects.push(p);
            }
          }
          if (!existing._allGroupIds) existing._allGroupIds = [existing.id];
          existing._allGroupIds.push(g.id);
        } else {
          groupMap.set(key, { ...g, projects: [...projects] });
        }
      }
      const unique = Array.from(groupMap.values());
      setGroups(unique);
    } catch (error) {
      console.error('Error fetching groups:', error);
      setGroups([]);
    }
    setLoading(false);
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    try {
      const { error } = await supabase
        .from('groups')
        .insert({
          name: formData.name,
          color: formData.color,
          created_by: user.id,
        });

      if (error) throw error;

      setFormData({ name: '', color: '#6366f1' });
      setShowCreateModal(false);
      fetchGroups();
    } catch (error) {
      console.error('Error creating group:', error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-brand-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-600 dark:text-gray-400">Loading groups...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 md:space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
      >
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
            Groups
          </h1>
          <p className="text-gray-600 dark:text-gray-300 mt-1">
            Organize your projects into groups
          </p>
        </div>
        
        <Button
          variant="gradient"
          onClick={() => setShowCreateModal(true)}
        >
          <Plus className="w-4 h-4 mr-2" />
          Create Group
        </Button>
      </motion.div>

      {groups.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center py-12"
        >
          <div className="w-24 h-24 bg-gradient-to-r from-brand-primary to-brand-secondary rounded-full mx-auto mb-6 flex items-center justify-center">
            <Folder className="w-12 h-12 text-white" />
          </div>
          <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
            No groups yet
          </h3>
          <p className="text-gray-600 dark:text-gray-300 mb-6 max-w-md mx-auto">
            Create groups to organize your projects by team, department, or any other criteria
          </p>
          <Button variant="gradient" onClick={() => setShowCreateModal(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Create Your First Group
          </Button>
        </motion.div>
      ) : (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6"
        >
          {groups.map((group, index) => (
            <motion.div
              key={group.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
            >
              <Card>
                <CardHeader>
                  <div className="flex items-center space-x-3">
                    <div
                      className="w-4 h-4 rounded-full"
                      style={{ backgroundColor: group.color }}
                    />
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                      {group.name}
                    </h3>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="text-sm text-gray-600 dark:text-gray-400">
                      {group.projects?.length || 0} projects
                    </div>
                    
                    {group.projects?.length > 0 && (
                      <div className="space-y-2">
                        {group.projects.slice(0, 3).map((project: any) => (
                          <Link
                            key={project.id}
                            to={`/projects/${project.id}`}
                            className="block text-sm text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-700 px-3 py-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors cursor-pointer"
                          >
                            {project.name}
                          </Link>
                        ))}
                        {group.projects.length > 3 && (
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            +{group.projects.length - 3} more
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      )}

      <Modal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} title="Create Group">
        <form onSubmit={handleCreateGroup} className="p-6 space-y-4">
          <Input
            label="Group Name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            required
          />
          
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Color
            </label>
            <div className="flex items-center space-x-3">
              <input
                type="color"
                value={formData.color}
                onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                className="w-12 h-12 rounded-2xl border border-gray-300 dark:border-gray-600"
              />
              <Input
                value={formData.color}
                onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                className="flex-1"
              />
            </div>
          </div>

          <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200 dark:border-gray-700">
            <Button variant="secondary" onClick={() => setShowCreateModal(false)}>
              Cancel
            </Button>
            <Button variant="gradient" type="submit">
              Create Group
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};