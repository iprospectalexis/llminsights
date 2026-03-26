import React from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { Button } from '../ui/Button';
import { Globe, Calendar, Users, Play, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { getCountryByCode } from '../../utils/countries';

interface ProjectGroup {
  id: string;
  name: string;
  color: string;
}

interface Project {
  id: string;
  name: string;
  domain: string;
  country: string;
  created_at: string;
  _groups?: ProjectGroup[];
  _metrics?: {
    prompts: number;
    mentionRate: number;
    citationRate: number;
  };
}

interface ProjectCardProps {
  project: Project;
  onRunAudit: (projectId: string) => void;
  onViewProject: (projectId: string) => void;
  onDelete: (projectId: string) => void;
}

export const ProjectCard: React.FC<ProjectCardProps> = ({
  project,
  onRunAudit,
  onViewProject,
  onDelete,
}) => {
  const countryInfo = getCountryByCode(project.country);
  const groups = project._groups || [];

  return (
    <motion.div
      whileHover={{ y: -4 }}
      transition={{ duration: 0.2 }}
      className="h-full group"
    >
      <Card className="h-full border-gray-200/50 dark:border-gray-700/50 bg-gradient-to-br from-white via-white to-gray-50/30 dark:from-gray-800 dark:via-gray-800 dark:to-gray-900/30 backdrop-blur-sm hover:shadow-2xl hover:shadow-gray-200/40 dark:hover:shadow-gray-900/40 transition-all duration-300">
        <CardHeader className="pb-4">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-3">
                <div className="relative">
                  <div className="absolute inset-0 bg-gradient-to-br from-brand-primary/20 to-brand-secondary/20 rounded-xl blur-md opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                  <div className="relative w-12 h-12 bg-gradient-to-br from-white to-gray-50 dark:from-gray-700 dark:to-gray-800 rounded-xl border border-gray-200 dark:border-gray-600 flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform duration-300">
                    <img
                      src={`https://www.google.com/s2/favicons?domain=${project.domain}&sz=64`}
                      alt={`${project.domain} favicon`}
                      className="w-7 h-7"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement;
                        target.style.display = 'none';
                        const globeIcon = target.nextElementSibling as HTMLElement;
                        if (globeIcon) globeIcon.style.display = 'flex';
                      }}
                    />
                    <Globe className="w-7 h-7 text-gray-400" style={{ display: 'none' }} />
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <h3
                    className="text-lg font-bold text-gray-900 dark:text-gray-100 cursor-pointer hover:text-brand-primary transition-colors truncate"
                    onClick={() => onViewProject(project.id)}
                  >
                    {project.name}
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400 truncate">
                    {project.domain}
                  </p>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(project.id);
                  }}
                  className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-all duration-200 opacity-0 group-hover:opacity-100"
                  title="Delete project"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

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

              {/* Group badges */}
              {groups.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2.5">
                  {groups.map(g => (
                    <span
                      key={g.id}
                      className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border"
                      style={{
                        backgroundColor: `${g.color}15`,
                        borderColor: `${g.color}40`,
                        color: g.color,
                      }}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: g.color }}
                      />
                      {g.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="relative overflow-hidden bg-gradient-to-br from-emerald-50 to-emerald-100/50 dark:from-emerald-900/20 dark:to-emerald-800/10 rounded-2xl p-4 border border-emerald-200/50 dark:border-emerald-800/30">
                <div className="absolute top-0 right-0 w-20 h-20 bg-emerald-400/10 rounded-full -mr-10 -mt-10" />
                <div className="relative">
                  <div className="text-3xl font-bold bg-gradient-to-br from-emerald-600 to-emerald-700 dark:from-emerald-400 dark:to-emerald-500 bg-clip-text text-transparent">
                    {project._metrics?.mentionRate || 0}%
                  </div>
                  <div className="text-xs font-medium text-emerald-700 dark:text-emerald-400 mt-1">
                    Mention Rate
                  </div>
                </div>
              </div>
              <div className="relative overflow-hidden bg-gradient-to-br from-blue-50 to-blue-100/50 dark:from-blue-900/20 dark:to-blue-800/10 rounded-2xl p-4 border border-blue-200/50 dark:border-blue-800/30">
                <div className="absolute top-0 right-0 w-20 h-20 bg-blue-400/10 rounded-full -mr-10 -mt-10" />
                <div className="relative">
                  <div className="text-3xl font-bold bg-gradient-to-br from-blue-600 to-blue-700 dark:from-blue-400 dark:to-blue-500 bg-clip-text text-transparent">
                    {project._metrics?.citationRate || 0}%
                  </div>
                  <div className="text-xs font-medium text-blue-700 dark:text-blue-400 mt-1">
                    Citation Rate
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                variant="gradient"
                size="sm"
                onClick={() => onRunAudit(project.id)}
                className="flex-1 shadow-md hover:shadow-lg transition-shadow duration-200"
              >
                <Play className="w-4 h-4 mr-2" />
                Run Audit
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onViewProject(project.id)}
                className="flex-1 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 border-0"
              >
                View Details
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
};
