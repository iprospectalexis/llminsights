import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Button } from '../components/ui/Button';
import { Card, CardContent, CardHeader } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { ProjectCard } from '../components/projects/ProjectCard';
import { CreateProjectModal } from '../components/projects/CreateProjectModal';
import { RunAuditModal } from '../components/audit/RunAuditModal';
import { AuditProgressToast } from '../components/audit/AuditProgressToast';
import { supabase } from '../lib/supabase';
import { Plus, Search, ListFilter as Filter, X, Calendar, Users, Globe, AlertTriangle, CheckCircle, XCircle, LayoutGrid, List, Play, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { getCountryByCode } from '../utils/countries';
import { useProject } from '../contexts/ProjectContext';

const LLM_ICONS = {
  searchgpt: 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/SearchGPT.PNG',
  perplexity: 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/Perplexity.png',
  gemini: 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/Gemini.png',
  'google-ai-overview': 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/google_ai_overview.png',
  'google-ai-mode': 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/google_ai_mode.png',
  'bing-copilot': 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/bing_copilot.png',
  'grok': 'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/Grok-icon.png',
};

export const ProjectsPage: React.FC = () => {
  const navigate = useNavigate();
  const { setSelectedProject } = useProject();
  const [projects, setProjects] = useState<any[]>([]);
  const [filteredProjects, setFilteredProjects] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedGroup, setSelectedGroup] = useState('');
  const [selectedCountry, setSelectedCountry] = useState('');
  const [dateRange, setDateRange] = useState('all');
  const [showFilters, setShowFilters] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showRunAuditModal, setShowRunAuditModal] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [runningAudits, setRunningAudits] = useState<string[]>([]);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<any>(null);
  const [deletingProject, setDeletingProject] = useState(false);
  const [resultModalOpen, setResultModalOpen] = useState(false);
  const [resultMessage, setResultMessage] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    setSelectedProject(null);
    fetchProjects();
  }, []);

  useEffect(() => {
    applyFilters();
  }, [projects, searchTerm, selectedGroup, selectedCountry, dateRange]);

  const applyFilters = () => {
    let filtered = [...projects];

    // Apply search filter
    if (searchTerm) {
      filtered = filtered.filter(project =>
        project.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        project.domain.toLowerCase().includes(searchTerm.toLowerCase()) ||
        project.group?.name.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    // Apply group filter
    if (selectedGroup) {
      filtered = filtered.filter(project => project.group_id === selectedGroup);
    }

    // Apply country filter
    if (selectedCountry) {
      filtered = filtered.filter(project => project.country === selectedCountry);
    }

    // Apply date range filter
    if (dateRange !== 'all') {
      const now = new Date();
      const cutoffDate = new Date();
      
      switch (dateRange) {
        case '7d':
          cutoffDate.setDate(now.getDate() - 7);
          break;
        case '30d':
          cutoffDate.setDate(now.getDate() - 30);
          break;
        case '90d':
          cutoffDate.setDate(now.getDate() - 90);
          break;
      }
      
      filtered = filtered.filter(project => 
        new Date(project.created_at) >= cutoffDate
      );
    }

    setFilteredProjects(filtered);
  };

  const fetchProjects = async () => {
    if (!supabase) {
      console.error('Supabase client not initialized');
      setLoading(false);
      return;
    }

    console.log('ProjectsPage: Starting to fetch projects');
    setLoading(true);
    try {
      // Get current user
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        console.log('ProjectsPage: No user session found');
        setLoading(false);
        return;
      }

      console.log('ProjectsPage: Fetching projects for user:', session.user.email);

      // Fetch all projects with precomputed metrics
      // RLS policies will automatically filter based on user's role and project membership
      const { data: projectsData, error: projectsError } = await supabase
        .from('projects')
        .select(`
          *,
          groups (
            id,
            name,
            color
          ),
          project_metrics (
            mention_rate,
            citation_rate,
            total_prompts
          )
        `)
        .order('created_at', { ascending: false });

      if (projectsError) {
        console.error('❌ ProjectsPage: Supabase error:', projectsError);
        setProjects([]);
        setLoading(false);
        return;
      }
      console.log('✅ ProjectsPage: Projects data:', projectsData);

      // Map projects with precomputed metrics
      // Supabase returns related data as arrays, so we need to handle both array and single object
      const projectsWithMetrics = (projectsData || []).map(project => {
        let metrics = null;

        // Handle different possible formats from Supabase
        if (project.project_metrics) {
          if (Array.isArray(project.project_metrics)) {
            // If it's an array, take the first element
            metrics = project.project_metrics.length > 0 ? project.project_metrics[0] : null;
          } else {
            // If it's already an object, use it directly
            metrics = project.project_metrics;
          }
        }

        const finalMetrics = {
          prompts: metrics?.total_prompts ?? 0,
          mentionRate: metrics?.mention_rate ?? 0,
          citationRate: metrics?.citation_rate ?? 0
        };

        console.log(`🔍 Project "${project.name}":`, {
          raw: project.project_metrics,
          parsed: metrics,
          final: finalMetrics
        });

        return {
          ...project,
          _metrics: finalMetrics
        };
      });

      console.log('✅ ProjectsPage: Projects with metrics:', projectsWithMetrics);
      setProjects(projectsWithMetrics);
    } catch (error) {
      console.error('Error fetching projects:', error);
      setProjects([]);
    }
    console.log('ProjectsPage: Setting loading to false');
    setLoading(false);
  };

  const getUniqueCountries = () => {
    const countries = [...new Set(projects.map(p => p.country))];
    return countries.sort();
  };

  const clearAllFilters = () => {
    setSearchTerm('');
    setSelectedGroup('');
    setSelectedCountry('');
    setDateRange('all');
  };

  const hasActiveFilters = () => {
    return searchTerm || selectedGroup || selectedCountry || dateRange !== 'all';
  };
  const handleRunAudit = (projectId: string) => {
    setSelectedProjectId(projectId);
    setShowRunAuditModal(true);
  };

  const handleViewProject = (projectId: string) => {
    navigate(`/projects/${projectId}/overview`);
  };

  const handleAuditStarted = (auditId: string) => {
    console.log('Audit started with ID:', auditId);
    setRunningAudits(prev => [...prev, auditId]);
    setShowRunAuditModal(false);
  };

  const handleAuditCompleted = (auditId: string) => {
    console.log('Audit completed with ID:', auditId);
    setRunningAudits(prev => prev.filter(id => id !== auditId));
    // Refresh projects to show updated data
    fetchProjects();
  };

  const confirmDeleteProject = (projectId: string) => {
    const project = projects.find(p => p.id === projectId);
    if (project) {
      setProjectToDelete(project);
      setDeleteModalOpen(true);
    }
  };

  const handleDeleteProject = async () => {
    if (!projectToDelete) return;

    setDeletingProject(true);
    setDeleteModalOpen(false);

    try {
      // Delete project (cascade will handle related data)
      const { error: deleteError } = await supabase
        .from('projects')
        .delete()
        .eq('id', projectToDelete.id);

      if (deleteError) throw deleteError;

      // Refresh projects list
      await fetchProjects();

      setResultMessage({
        type: 'success',
        message: `Project "${projectToDelete.name}" and all its associated data have been deleted successfully.`
      });
      setResultModalOpen(true);
    } catch (error) {
      console.error('Error deleting project:', error);
      setResultMessage({
        type: 'error',
        message: 'Failed to delete project. Please try again.'
      });
      setResultModalOpen(true);
    } finally {
      setDeletingProject(false);
      setProjectToDelete(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="mb-4 flex justify-center">
            <LoadingSpinner size="lg" />
          </div>
          <p className="text-gray-600 dark:text-gray-400">Loading projects...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6"
      >
        <div>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-gray-900 via-gray-800 to-gray-900 dark:from-gray-100 dark:via-white dark:to-gray-100 bg-clip-text text-transparent">
            Projects
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-2 text-lg">
            Track your brand visibility across AI platforms
          </p>
        </div>

        <Button
          variant="gradient"
          onClick={() => setShowCreateModal(true)}
          className="shrink-0 shadow-lg shadow-brand-primary/20 hover:shadow-xl hover:shadow-brand-primary/30 transition-all duration-300"
        >
          <Plus className="w-5 h-5 mr-2" />
          Create Project
        </Button>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-gradient-to-br from-white/80 via-white/60 to-white/80 dark:from-gray-800/80 dark:via-gray-800/60 dark:to-gray-800/80 backdrop-blur-xl rounded-3xl border border-gray-200/50 dark:border-gray-700/50 p-6 shadow-xl shadow-gray-200/20 dark:shadow-gray-900/30"
      >
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search projects, domains, or groups..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-12 pr-4 py-3.5 bg-white/90 dark:bg-gray-900/50 border border-gray-200/60 dark:border-gray-600/60 rounded-2xl text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-primary/40 focus:border-brand-primary/60 transition-all duration-300 shadow-sm"
            />
          </div>

          <div className="flex items-center space-x-3">
            <div className="flex items-center bg-white/90 dark:bg-gray-900/50 border border-gray-200/60 dark:border-gray-600/60 rounded-xl p-1">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-2 rounded-lg transition-all duration-200 ${
                  viewMode === 'grid'
                    ? 'bg-brand-primary text-white shadow-sm'
                    : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
                title="Grid view"
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-2 rounded-lg transition-all duration-200 ${
                  viewMode === 'list'
                    ? 'bg-brand-primary text-white shadow-sm'
                    : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
                title="List view"
              >
                <List className="w-4 h-4" />
              </button>
            </div>
            {searchTerm && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSearchTerm('')}
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <X className="w-4 h-4 mr-1" />
                Clear
              </Button>
            )}
          </div>
        </div>

        {searchTerm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-4 pt-4 border-t border-gray-200/50 dark:border-gray-700/50"
          >
            <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {filteredProjects.length === 1
                ? `Found 1 project`
                : `Found ${filteredProjects.length} projects`
              }
            </div>
          </motion.div>
        )}
      </motion.div>

      {filteredProjects.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center py-20"
        >
          <div className="relative w-32 h-32 mx-auto mb-8">
            <div className="absolute inset-0 bg-gradient-to-r from-brand-primary to-brand-secondary rounded-3xl blur-xl opacity-30 animate-pulse" />
            <div className="relative w-32 h-32 bg-gradient-to-br from-brand-primary to-brand-secondary rounded-3xl flex items-center justify-center shadow-2xl shadow-brand-primary/30">
              <Plus className="w-16 h-16 text-white" />
            </div>
          </div>
          <h3 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-3">
            No projects yet
          </h3>
          <p className="text-gray-600 dark:text-gray-400 mb-8 max-w-md mx-auto text-lg">
            Create your first project to start tracking brand visibility across AI platforms
          </p>
          <Button
            variant="gradient"
            onClick={() => setShowCreateModal(true)}
            className="shadow-lg shadow-brand-primary/20 hover:shadow-xl hover:shadow-brand-primary/30 transition-all duration-300"
          >
            <Plus className="w-5 h-5 mr-2" />
            Create Your First Project
          </Button>
        </motion.div>
      ) : viewMode === 'grid' ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
        >
          {filteredProjects.map((project, index) => (
            <motion.div
              key={project.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
            >
              <ProjectCard
                project={project}
                onRunAudit={handleRunAudit}
                onViewProject={handleViewProject}
                onDelete={confirmDeleteProject}
              />
            </motion.div>
          ))}
        </motion.div>
      ) : (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="space-y-4"
        >
          {filteredProjects.map((project, index) => {
            const countryInfo = getCountryByCode(project.country);
            return (
              <motion.div
                key={project.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.03 }}
                whileHover={{ y: -2 }}
                className="group"
              >
                <div className="bg-gradient-to-br from-white via-white to-gray-50/30 dark:from-gray-800 dark:via-gray-800 dark:to-gray-900/30 backdrop-blur-sm border border-gray-200/50 dark:border-gray-700/50 rounded-2xl p-6 hover:shadow-2xl hover:shadow-gray-200/40 dark:hover:shadow-gray-900/40 transition-all duration-300">
                  <div className="flex items-center justify-between gap-6">
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                      <div className="relative flex-shrink-0">
                        <div className="absolute inset-0 bg-gradient-to-br from-brand-primary/20 to-brand-secondary/20 rounded-xl blur-md opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                        <div className="relative w-14 h-14 bg-gradient-to-br from-white to-gray-50 dark:from-gray-700 dark:to-gray-800 rounded-xl border border-gray-200 dark:border-gray-600 flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform duration-300">
                          <img
                            src={`https://www.google.com/s2/favicons?domain=${project.domain}&sz=64`}
                            alt={`${project.domain} favicon`}
                            className="w-8 h-8"
                            onError={(e) => {
                              const target = e.target as HTMLImageElement;
                              target.style.display = 'none';
                              const globeIcon = target.nextElementSibling as HTMLElement;
                              if (globeIcon) globeIcon.style.display = 'flex';
                            }}
                          />
                          <Globe className="w-8 h-8 text-gray-400" style={{ display: 'none' }} />
                        </div>
                      </div>

                      <div className="flex-1 min-w-0">
                        <h3
                          className="text-xl font-bold text-gray-900 dark:text-gray-100 cursor-pointer hover:text-brand-primary transition-colors truncate mb-1"
                          onClick={() => handleViewProject(project.id)}
                        >
                          {project.name}
                        </h3>
                        <p className="text-sm text-gray-600 dark:text-gray-400 truncate mb-2">
                          {project.domain}
                        </p>
                        <div className="flex items-center gap-3 text-xs text-gray-600 dark:text-gray-400">
                          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-gray-100/80 dark:bg-gray-700/50 rounded-lg">
                            <Calendar className="w-3.5 h-3.5" />
                            <span>{format(new Date(project.created_at), 'MMM d, yyyy')}</span>
                          </div>
                          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-gray-100/80 dark:bg-gray-700/50 rounded-lg">
                            <Users className="w-3.5 h-3.5" />
                            <span>{project._metrics?.prompts || 0} prompts</span>
                          </div>
                          {countryInfo && (
                            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-gray-100/80 dark:bg-gray-700/50 rounded-lg">
                              <img
                                src={countryInfo.flag}
                                alt={countryInfo.name}
                                className="w-4 h-3 object-cover rounded-sm"
                                title={countryInfo.name}
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="flex gap-3">
                        <div className="relative overflow-hidden bg-gradient-to-br from-emerald-50 to-emerald-100/50 dark:from-emerald-900/20 dark:to-emerald-800/10 rounded-xl px-4 py-3 border border-emerald-200/50 dark:border-emerald-800/30 min-w-[100px]">
                          <div className="absolute top-0 right-0 w-16 h-16 bg-emerald-400/10 rounded-full -mr-8 -mt-8" />
                          <div className="relative text-center">
                            <div className="text-2xl font-bold bg-gradient-to-br from-emerald-600 to-emerald-700 dark:from-emerald-400 dark:to-emerald-500 bg-clip-text text-transparent">
                              {project._metrics?.mentionRate || 0}%
                            </div>
                            <div className="text-xs font-medium text-emerald-700 dark:text-emerald-400 mt-0.5">
                              Mention Rate
                            </div>
                          </div>
                        </div>
                        <div className="relative overflow-hidden bg-gradient-to-br from-blue-50 to-blue-100/50 dark:from-blue-900/20 dark:to-blue-800/10 rounded-xl px-4 py-3 border border-blue-200/50 dark:border-blue-800/30 min-w-[100px]">
                          <div className="absolute top-0 right-0 w-16 h-16 bg-blue-400/10 rounded-full -mr-8 -mt-8" />
                          <div className="relative text-center">
                            <div className="text-2xl font-bold bg-gradient-to-br from-blue-600 to-blue-700 dark:from-blue-400 dark:to-blue-500 bg-clip-text text-transparent">
                              {project._metrics?.citationRate || 0}%
                            </div>
                            <div className="text-xs font-medium text-blue-700 dark:text-blue-400 mt-0.5">
                              Citation Rate
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <Button
                          variant="gradient"
                          size="sm"
                          onClick={() => handleRunAudit(project.id)}
                          className="shadow-md hover:shadow-lg transition-shadow duration-200"
                        >
                          <Play className="w-4 h-4 mr-2" />
                          Run Audit
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleViewProject(project.id)}
                          className="bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 border-0"
                        >
                          View Details
                        </Button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            confirmDeleteProject(project.id);
                          }}
                          className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-all duration-200 opacity-0 group-hover:opacity-100"
                          title="Delete project"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      )}

      <CreateProjectModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={fetchProjects}
      />

      <RunAuditModal
        isOpen={showRunAuditModal}
        onClose={() => setShowRunAuditModal(false)}
        projectId={selectedProjectId}
        onAuditStarted={handleAuditStarted}
      />

      {runningAudits.map(auditId => (
        <AuditProgressToast
          key={auditId}
          auditId={auditId}
          onCompleted={() => handleAuditCompleted(auditId)}
          onClose={() => handleAuditCompleted(auditId)}
        />
      ))}

      <Modal
        isOpen={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        title="Delete Project"
      >
        <div className="p-6 space-y-6">
          <div className="flex items-start space-x-4">
            <div className="flex-shrink-0 w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/20 flex items-center justify-center">
              <AlertTriangle className="w-6 h-6 text-red-600 dark:text-red-500" />
            </div>
            <div className="flex-1">
              <p className="text-gray-900 dark:text-gray-100 mb-4 text-base">
                Are you sure you want to delete this project?
              </p>
              {projectToDelete && (
                <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-xl space-y-2 mb-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Project</span>
                    <span className="text-sm text-gray-900 dark:text-gray-100">{projectToDelete.name}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Domain</span>
                    <span className="text-sm text-gray-900 dark:text-gray-100">{projectToDelete.domain}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Prompts</span>
                    <span className="text-sm text-gray-900 dark:text-gray-100">{projectToDelete._metrics?.prompts || 0}</span>
                  </div>
                </div>
              )}
              <div className="bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 rounded-xl p-4">
                <p className="text-sm text-red-700 dark:text-red-400">
                  <span className="font-semibold">Warning:</span> This action cannot be undone. All project data including audits, prompts, brands, responses, and citations will be permanently deleted.
                </p>
              </div>
            </div>
          </div>
          <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200 dark:border-gray-700">
            <Button
              variant="outline"
              onClick={() => setDeleteModalOpen(false)}
              disabled={deletingProject}
            >
              Cancel
            </Button>
            <Button
              onClick={handleDeleteProject}
              disabled={deletingProject}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {deletingProject ? 'Deleting...' : 'Delete Project'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={resultModalOpen}
        onClose={() => setResultModalOpen(false)}
        title={resultMessage?.type === 'success' ? 'Success' : 'Error'}
      >
        <div className="p-6 space-y-6">
          <div className="flex items-start space-x-4">
            <div className={`flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center ${
              resultMessage?.type === 'success'
                ? 'bg-green-100 dark:bg-green-900/20'
                : 'bg-red-100 dark:bg-red-900/20'
            }`}>
              {resultMessage?.type === 'success' ? (
                <CheckCircle className="w-6 h-6 text-green-600 dark:text-green-500" />
              ) : (
                <XCircle className="w-6 h-6 text-red-600 dark:text-red-500" />
              )}
            </div>
            <p className="text-gray-900 dark:text-gray-100 flex-1 pt-2">
              {resultMessage?.message}
            </p>
          </div>
          <div className="flex justify-end pt-4 border-t border-gray-200 dark:border-gray-700">
            <Button onClick={() => setResultModalOpen(false)}>
              Close
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};