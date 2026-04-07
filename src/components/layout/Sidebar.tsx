import React, { useState, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FolderOpen,
  Users,
  Settings,
  BarChart3,
  Layers,
  Search,
  Activity,
  Telescope,
  Wrench,
  Trophy,
  ChevronDown,
  ChevronRight,
  FileText,
  Globe,
  MessageSquare,
  Lightbulb,
  SettingsIcon,
  MessageCircle,
  BadgeCheck,
  Home,
  Bell,
  PanelLeftClose,
  PanelLeftOpen,
  LayoutDashboard,
  Eye,
  X,
  DollarSign
} from 'lucide-react';
import { useProject } from '../../contexts/ProjectContext';

interface NavigationItem {
  name: string;
  href: string;
  icon: any;
  isNew?: boolean;
  children?: NavigationItem[];
}

const navigation: NavigationItem[] = [
  { name: 'Projects', href: '/projects', icon: FolderOpen },
  { name: 'Groups', href: '/groups', icon: Layers },
  { name: 'Status', href: '/status', icon: Activity },
];

interface SidebarProps {
  user: any;
  userProfile: any;
  isOpen: boolean;
  onToggleCollapse?: () => void;
  collapsed?: boolean;
  isMobile?: boolean;
  onMobileClose?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ user, userProfile, isOpen, onToggleCollapse, collapsed, isMobile, onMobileClose }) => {
  const location = useLocation();
  const { selectedProject } = useProject();
  const [isCollapsed, setIsCollapsed] = useState(isMobile ? false : (collapsed || false));

  // On mobile, sidebar is always expanded
  const effectiveCollapsed = isMobile ? false : isCollapsed;

  useEffect(() => {
    if (collapsed !== undefined) {
      setIsCollapsed(collapsed);
    }
  }, [collapsed]);
  const [expandedItems, setExpandedItems] = useState<string[]>(() => {
    const initialExpanded: string[] = [];
    navigation.forEach((item) => {
      if (item.children) {
        const hasActiveChild = item.children.some((child) =>
          location.pathname.startsWith(child.href)
        );
        if (hasActiveChild) {
          initialExpanded.push(item.name);
        }
      }
    });
    return initialExpanded;
  });

  useEffect(() => {
    navigation.forEach((item) => {
      if (item.children) {
        const hasActiveChild = item.children.some((child) =>
          location.pathname.startsWith(child.href)
        );
        if (hasActiveChild && !expandedItems.includes(item.name)) {
          setExpandedItems(prev => [...prev, item.name]);
        }
      }
    });
  }, [location.pathname]);

  const toggleExpanded = (itemName: string) => {
    if (effectiveCollapsed) {
      setIsCollapsed(false);
      setTimeout(() => {
        setExpandedItems(prev =>
          prev.includes(itemName)
            ? prev
            : [...prev, itemName]
        );
      }, 200);
    } else {
      setExpandedItems(prev =>
        prev.includes(itemName)
          ? prev.filter(name => name !== itemName)
          : [...prev, itemName]
      );
    }
  };

  if (!isOpen) return null;

  return (
    <motion.div
      initial={{ x: -20, opacity: 0 }}
      animate={{
        x: 0,
        opacity: 1,
        width: effectiveCollapsed ? '80px' : '280px'
      }}
      transition={{ duration: 0.3, ease: 'easeInOut' }}
      className="bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 h-full flex flex-col overflow-hidden"
    >
      {/* macOS-style Window Dots + Mobile close */}
      <div className="px-5 py-4 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <div className="w-3 h-3 rounded-full bg-red-500"></div>
          <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
          <div className="w-3 h-3 rounded-full bg-green-500"></div>
        </div>
        {isMobile && onMobileClose && (
          <button
            onClick={onMobileClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Logo and App Name */}
      <div className="px-5 pb-6">
        <NavLink to="/projects">
          <motion.div
            whileHover={{ scale: 1.05 }}
            className="flex items-center cursor-pointer"
          >
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br flex items-center justify-center flex-shrink-0">
              <img
                src="https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/llminsights_72.png"
                alt="LLM Insights Logo"
                className="w-8 h-8"
              />
            </div>
            <AnimatePresence>
              {!effectiveCollapsed && (
                <motion.span
                  initial={{ opacity: 0, width: 0 }}
                  animate={{ opacity: 1, width: 'auto' }}
                  exit={{ opacity: 0, width: 0 }}
                  transition={{ duration: 0.2 }}
                  className="ml-3 text-lg font-bold text-gray-900 dark:text-white overflow-hidden whitespace-nowrap"
                >
                  LLM Insights
                </motion.span>
              )}
            </AnimatePresence>
          </motion.div>
        </NavLink>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto px-3">
        {/* MAIN MENU Section */}
        <div className="mb-6">
          {!effectiveCollapsed && (
            <div className="px-3 mb-2">
              <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Main Menu
              </h3>
            </div>
          )}
          <nav className="space-y-1">
            {navigation.map((item) => {
              const isActive = item.href !== '#' && location.pathname.startsWith(item.href);
              const isExpanded = expandedItems.includes(item.name);
              const hasChildren = item.children && item.children.length > 0;

              return (
                <div key={item.name}>
                  {hasChildren ? (
                    <div>
                      <button
                        onClick={() => toggleExpanded(item.name)}
                        className={`
                          w-full flex items-center px-3 py-2.5 text-sm font-medium rounded-xl transition-all duration-200
                          ${isActive
                            ? 'bg-[rgb(243,232,255)] text-[rgb(126,34,206)] dark:bg-purple-900/30 dark:text-purple-300'
                            : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                          }
                          ${effectiveCollapsed ? 'justify-center' : ''}
                        `}
                        title={effectiveCollapsed ? item.name : ''}
                      >
                        <item.icon className={`w-5 h-5 ${effectiveCollapsed ? '' : 'mr-3'} flex-shrink-0`} />
                        <AnimatePresence>
                          {!effectiveCollapsed && (
                            <motion.span
                              initial={{ opacity: 0, width: 0 }}
                              animate={{ opacity: 1, width: 'auto' }}
                              exit={{ opacity: 0, width: 0 }}
                              transition={{ duration: 0.2 }}
                              className="overflow-hidden whitespace-nowrap"
                            >
                              {item.name}
                            </motion.span>
                          )}
                        </AnimatePresence>
                        {!effectiveCollapsed && (
                          <span className="ml-auto">
                            {isExpanded ? (
                              <ChevronDown className="w-4 h-4" />
                            ) : (
                              <ChevronRight className="w-4 h-4" />
                            )}
                          </span>
                        )}
                      </button>
                      <AnimatePresence>
                        {isExpanded && !effectiveCollapsed && item.children && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: 0.2 }}
                            className="mt-1 space-y-1 overflow-hidden"
                          >
                            {item.children.map((child) => {
                              const isChildActive = child.href !== '#' && location.pathname.startsWith(child.href);
                              return (
                                <NavLink
                                  key={child.name}
                                  to={child.href}
                                  className={`
                                    flex items-center pl-12 pr-3 py-2 text-sm font-medium rounded-xl transition-all duration-200
                                    ${isChildActive
                                      ? 'bg-[rgb(243,232,255)] text-[rgb(126,34,206)] dark:bg-purple-900/30 dark:text-purple-300'
                                      : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                                    }
                                  `}
                                >
                                  {child.name}
                                </NavLink>
                              );
                            })}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  ) : (
                    <NavLink
                      to={item.href}
                      className={`
                        flex items-center px-3 py-2.5 text-sm font-medium rounded-xl transition-all duration-200
                        ${isActive
                          ? 'bg-[rgb(243,232,255)] text-[rgb(126,34,206)] dark:bg-purple-900/30 dark:text-purple-300'
                          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                        }
                        ${effectiveCollapsed ? 'justify-center' : ''}
                      `}
                      title={effectiveCollapsed ? item.name : ''}
                    >
                      <item.icon className={`w-5 h-5 ${effectiveCollapsed ? '' : 'mr-3'} flex-shrink-0`} />
                      <AnimatePresence>
                        {!effectiveCollapsed && (
                          <motion.span
                            initial={{ opacity: 0, width: 0 }}
                            animate={{ opacity: 1, width: 'auto' }}
                            exit={{ opacity: 0, width: 0 }}
                            transition={{ duration: 0.2 }}
                            className="overflow-hidden whitespace-nowrap"
                          >
                            {item.name}
                          </motion.span>
                        )}
                      </AnimatePresence>
                    </NavLink>
                  )}
                </div>
              );
            })}
          </nav>
        </div>

        {selectedProject && (
          <div className="mb-6">
            {!effectiveCollapsed && (
              <div className="px-3 mb-2">
                <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider truncate">
                  {selectedProject.name}
                </h3>
              </div>
            )}
            <nav className="space-y-1">
              <NavLink
                to={`/projects/${selectedProject.id}/overview`}
                className={`
                  flex items-center py-2.5 text-sm font-medium rounded-xl transition-all duration-200 relative
                  ${location.pathname === `/projects/${selectedProject.id}/overview`
                    ? 'bg-[rgb(243,232,255)] text-[rgb(126,34,206)] dark:bg-purple-900/30 dark:text-purple-300'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }
                  ${effectiveCollapsed ? 'justify-center px-3' : 'pl-9 pr-3'}
                `}
                title={effectiveCollapsed ? 'Overview' : ''}
              >
                {!effectiveCollapsed && (
                  <div className="absolute left-3 top-0 bottom-0 flex items-center">
                    <div className="w-px h-full bg-gray-300 dark:bg-gray-700"></div>
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-3 h-px bg-gray-300 dark:bg-gray-700"></div>
                  </div>
                )}
                <LayoutDashboard className={`w-4 h-4 ${effectiveCollapsed ? '' : 'mr-3'} flex-shrink-0 ${!effectiveCollapsed && 'relative z-10'}`} />
                <AnimatePresence>
                  {!effectiveCollapsed && (
                    <motion.span
                      initial={{ opacity: 0, width: 0 }}
                      animate={{ opacity: 1, width: 'auto' }}
                      exit={{ opacity: 0, width: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden whitespace-nowrap"
                    >
                      Overview
                    </motion.span>
                  )}
                </AnimatePresence>
              </NavLink>
              <NavLink
                to={`/projects/${selectedProject.id}/prompts`}
                className={`
                  flex items-center py-2.5 text-sm font-medium rounded-xl transition-all duration-200 relative
                  ${location.pathname === `/projects/${selectedProject.id}/prompts`
                    ? 'bg-[rgb(243,232,255)] text-[rgb(126,34,206)] dark:bg-purple-900/30 dark:text-purple-300'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }
                  ${effectiveCollapsed ? 'justify-center px-3' : 'pl-9 pr-3'}
                `}
                title={effectiveCollapsed ? 'Prompts' : ''}
              >
                {!effectiveCollapsed && (
                  <div className="absolute left-3 top-0 bottom-0 flex items-center">
                    <div className="w-px h-full bg-gray-300 dark:bg-gray-700"></div>
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-3 h-px bg-gray-300 dark:bg-gray-700"></div>
                  </div>
                )}
                <MessageCircle className={`w-4 h-4 ${effectiveCollapsed ? '' : 'mr-3'} flex-shrink-0 ${!effectiveCollapsed && 'relative z-10'}`} />
                <AnimatePresence>
                  {!effectiveCollapsed && (
                    <motion.span
                      initial={{ opacity: 0, width: 0 }}
                      animate={{ opacity: 1, width: 'auto' }}
                      exit={{ opacity: 0, width: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden whitespace-nowrap"
                    >
                      Prompts
                    </motion.span>
                  )}
                </AnimatePresence>
              </NavLink>
              <NavLink
                to={`/projects/${selectedProject.id}/pages`}
                className={`
                  flex items-center py-2.5 text-sm font-medium rounded-xl transition-all duration-200 relative
                  ${location.pathname === `/projects/${selectedProject.id}/pages`
                    ? 'bg-[rgb(243,232,255)] text-[rgb(126,34,206)] dark:bg-purple-900/30 dark:text-purple-300'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }
                  ${effectiveCollapsed ? 'justify-center px-3' : 'pl-9 pr-3'}
                `}
                title={effectiveCollapsed ? 'Pages' : ''}
              >
                {!effectiveCollapsed && (
                  <div className="absolute left-3 top-0 bottom-0 flex items-center">
                    <div className="w-px h-full bg-gray-300 dark:bg-gray-700"></div>
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-3 h-px bg-gray-300 dark:bg-gray-700"></div>
                  </div>
                )}
                <FileText className={`w-4 h-4 ${effectiveCollapsed ? '' : 'mr-3'} flex-shrink-0 ${!effectiveCollapsed && 'relative z-10'}`} />
                <AnimatePresence>
                  {!effectiveCollapsed && (
                    <motion.span
                      initial={{ opacity: 0, width: 0 }}
                      animate={{ opacity: 1, width: 'auto' }}
                      exit={{ opacity: 0, width: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden whitespace-nowrap"
                    >
                      Pages
                    </motion.span>
                  )}
                </AnimatePresence>
              </NavLink>
              <NavLink
                to={`/projects/${selectedProject.id}/domains`}
                className={`
                  flex items-center py-2.5 text-sm font-medium rounded-xl transition-all duration-200 relative
                  ${location.pathname === `/projects/${selectedProject.id}/domains`
                    ? 'bg-[rgb(243,232,255)] text-[rgb(126,34,206)] dark:bg-purple-900/30 dark:text-purple-300'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }
                  ${effectiveCollapsed ? 'justify-center px-3' : 'pl-9 pr-3'}
                `}
                title={effectiveCollapsed ? 'Domains' : ''}
              >
                {!effectiveCollapsed && (
                  <div className="absolute left-3 top-0 bottom-0 flex items-center">
                    <div className="w-px h-full bg-gray-300 dark:bg-gray-700"></div>
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-3 h-px bg-gray-300 dark:bg-gray-700"></div>
                  </div>
                )}
                <Globe className={`w-4 h-4 ${effectiveCollapsed ? '' : 'mr-3'} flex-shrink-0 ${!effectiveCollapsed && 'relative z-10'}`} />
                <AnimatePresence>
                  {!effectiveCollapsed && (
                    <motion.span
                      initial={{ opacity: 0, width: 0 }}
                      animate={{ opacity: 1, width: 'auto' }}
                      exit={{ opacity: 0, width: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden whitespace-nowrap"
                    >
                      Domains
                    </motion.span>
                  )}
                </AnimatePresence>
              </NavLink>
              <NavLink
                to={`/projects/${selectedProject.id}/mentions`}
                className={`
                  flex items-center py-2.5 text-sm font-medium rounded-xl transition-all duration-200 relative
                  ${location.pathname === `/projects/${selectedProject.id}/mentions`
                    ? 'bg-[rgb(243,232,255)] text-[rgb(126,34,206)] dark:bg-purple-900/30 dark:text-purple-300'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }
                  ${effectiveCollapsed ? 'justify-center px-3' : 'pl-9 pr-3'}
                `}
                title={effectiveCollapsed ? 'Mentions' : ''}
              >
                {!effectiveCollapsed && (
                  <div className="absolute left-3 top-0 bottom-0 flex items-center">
                    <div className="w-px h-full bg-gray-300 dark:bg-gray-700"></div>
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-3 h-px bg-gray-300 dark:bg-gray-700"></div>
                  </div>
                )}
                <BadgeCheck className={`w-4 h-4 ${effectiveCollapsed ? '' : 'mr-3'} flex-shrink-0 ${!effectiveCollapsed && 'relative z-10'}`} />
                <AnimatePresence>
                  {!effectiveCollapsed && (
                    <motion.span
                      initial={{ opacity: 0, width: 0 }}
                      animate={{ opacity: 1, width: 'auto' }}
                      exit={{ opacity: 0, width: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden whitespace-nowrap"
                    >
                      Mentions
                    </motion.span>
                  )}
                </AnimatePresence>
              </NavLink>
              <NavLink
                to={`/projects/${selectedProject.id}/insights`}
                className={`
                  flex items-center py-2.5 text-sm font-medium rounded-xl transition-all duration-200 relative
                  ${location.pathname === `/projects/${selectedProject.id}/insights`
                    ? 'bg-[rgb(243,232,255)] text-[rgb(126,34,206)] dark:bg-purple-900/30 dark:text-purple-300'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }
                  ${effectiveCollapsed ? 'justify-center px-3' : 'pl-9 pr-3'}
                `}
                title={effectiveCollapsed ? 'Insights' : ''}
              >
                {!effectiveCollapsed && (
                  <div className="absolute left-3 top-0 bottom-0 flex items-center">
                    <div className="w-px h-full bg-gray-300 dark:bg-gray-700"></div>
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-3 h-px bg-gray-300 dark:bg-gray-700"></div>
                  </div>
                )}
                <Lightbulb className={`w-4 h-4 ${effectiveCollapsed ? '' : 'mr-3'} flex-shrink-0 ${!effectiveCollapsed && 'relative z-10'}`} />
                <AnimatePresence>
                  {!effectiveCollapsed && (
                    <motion.span
                      initial={{ opacity: 0, width: 0 }}
                      animate={{ opacity: 1, width: 'auto' }}
                      exit={{ opacity: 0, width: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden whitespace-nowrap"
                    >
                      Insights
                    </motion.span>
                  )}
                </AnimatePresence>
              </NavLink>
              <NavLink
                to={`/projects/${selectedProject.id}/settings`}
                className={`
                  flex items-center py-2.5 text-sm font-medium rounded-xl transition-all duration-200 relative
                  ${location.pathname === `/projects/${selectedProject.id}/settings`
                    ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }
                  ${effectiveCollapsed ? 'justify-center px-3' : 'pl-9 pr-3'}
                `}
                title={effectiveCollapsed ? 'Settings' : ''}
              >
                {!effectiveCollapsed && (
                  <div className="absolute left-3 top-0 bottom-0 flex items-center">
                    <div className="w-px h-full bg-gray-300 dark:bg-gray-700"></div>
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-3 h-px bg-gray-300 dark:bg-gray-700"></div>
                  </div>
                )}
                <Settings className={`w-4 h-4 ${effectiveCollapsed ? '' : 'mr-3'} flex-shrink-0 ${!effectiveCollapsed && 'relative z-10'}`} />
                <AnimatePresence>
                  {!effectiveCollapsed && (
                    <motion.span
                      initial={{ opacity: 0, width: 0 }}
                      animate={{ opacity: 1, width: 'auto' }}
                      exit={{ opacity: 0, width: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden whitespace-nowrap"
                    >
                      Settings
                    </motion.span>
                  )}
                </AnimatePresence>
              </NavLink>
            </nav>
          </div>
        )}

        {/* Tools Section */}
        <div className="mb-6">
          {!effectiveCollapsed && (
            <div className="px-3 mb-2">
              <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Tools
              </h3>
            </div>
          )}
          <nav className="space-y-1">
            <NavLink
              to="/prompt-finder"
              className={`
                flex items-center px-3 py-2.5 text-sm font-medium rounded-xl transition-all duration-200
                ${location.pathname === '/prompt-finder'
                  ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                }
                ${effectiveCollapsed ? 'justify-center' : ''}
              `}
              title={effectiveCollapsed ? 'Prompt Finder' : ''}
            >
              <Search className={`w-5 h-5 ${effectiveCollapsed ? '' : 'mr-3'} flex-shrink-0`} />
              <AnimatePresence>
                {!effectiveCollapsed && (
                  <motion.span
                    initial={{ opacity: 0, width: 0 }}
                    animate={{ opacity: 1, width: 'auto' }}
                    exit={{ opacity: 0, width: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden whitespace-nowrap"
                  >
                    Prompt Finder
                  </motion.span>
                )}
              </AnimatePresence>
            </NavLink>
            {(() => {
              const isBarometersActive = location.pathname.startsWith('/barometers');
              const isBarometersExpanded = expandedItems.includes('Barometers');

              return (
                <div>
                  <button
                    onClick={() => toggleExpanded('Barometers')}
                    className={`
                      w-full flex items-center px-3 py-2.5 text-sm font-medium rounded-xl transition-all duration-200
                      ${isBarometersActive
                        ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100'
                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                      }
                      ${effectiveCollapsed ? 'justify-center' : ''}
                    `}
                    title={effectiveCollapsed ? 'Barometers' : ''}
                  >
                    <Telescope className={`w-5 h-5 ${effectiveCollapsed ? '' : 'mr-3'} flex-shrink-0`} />
                    <AnimatePresence>
                      {!effectiveCollapsed && (
                        <>
                          <motion.span
                            initial={{ opacity: 0, width: 0 }}
                            animate={{ opacity: 1, width: 'auto' }}
                            exit={{ opacity: 0, width: 0 }}
                            transition={{ duration: 0.2 }}
                            className="overflow-hidden whitespace-nowrap"
                          >
                            Barometers
                          </motion.span>
                          <span className="ml-auto">
                            {isBarometersExpanded ? (
                              <ChevronDown className="w-4 h-4" />
                            ) : (
                              <ChevronRight className="w-4 h-4" />
                            )}
                          </span>
                        </>
                      )}
                    </AnimatePresence>
                  </button>
                  <AnimatePresence>
                    {isBarometersExpanded && !effectiveCollapsed && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2 }}
                        className="mt-1 space-y-1 overflow-hidden"
                      >
                        <NavLink
                          to="/barometers/top-sources"
                          className={`
                            flex items-center pl-12 pr-3 py-2 text-sm font-medium rounded-xl transition-all duration-200
                            ${location.pathname === '/barometers/top-sources'
                              ? 'bg-[rgb(243,232,255)] text-[rgb(126,34,206)] dark:bg-purple-900/30 dark:text-purple-300'
                              : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                            }
                          `}
                        >
                          Top Sources
                        </NavLink>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })()}
          </nav>
        </div>

        {/* Settings Section */}
        <div className="mb-6">
          {!effectiveCollapsed && (
            <div className="px-3 mb-2">
              <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Settings
              </h3>
            </div>
          )}
          <nav className="space-y-1">
            <NavLink
              to="/account"
              className={`
                flex items-center px-3 py-2.5 text-sm font-medium rounded-xl transition-all duration-200
                ${location.pathname === '/account'
                  ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                }
                ${effectiveCollapsed ? 'justify-center' : ''}
              `}
              title={effectiveCollapsed ? 'Account' : ''}
            >
              <Settings className={`w-5 h-5 ${effectiveCollapsed ? '' : 'mr-3'} flex-shrink-0`} />
              <AnimatePresence>
                {!effectiveCollapsed && (
                  <motion.span
                    initial={{ opacity: 0, width: 0 }}
                    animate={{ opacity: 1, width: 'auto' }}
                    exit={{ opacity: 0, width: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden whitespace-nowrap"
                  >
                    Account
                  </motion.span>
                )}
              </AnimatePresence>
            </NavLink>
            <NavLink
              to="/team"
              className={`
                flex items-center px-3 py-2.5 text-sm font-medium rounded-xl transition-all duration-200
                ${location.pathname === '/team'
                  ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                }
                ${effectiveCollapsed ? 'justify-center' : ''}
              `}
              title={effectiveCollapsed ? 'Team' : ''}
            >
              <Users className={`w-5 h-5 ${effectiveCollapsed ? '' : 'mr-3'} flex-shrink-0`} />
              <AnimatePresence>
                {!effectiveCollapsed && (
                  <motion.span
                    initial={{ opacity: 0, width: 0 }}
                    animate={{ opacity: 1, width: 'auto' }}
                    exit={{ opacity: 0, width: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden whitespace-nowrap"
                  >
                    Team
                  </motion.span>
                )}
              </AnimatePresence>
            </NavLink>
            {(userProfile?.role === 'admin' || userProfile?.role === 'manager') && (
              <NavLink
                to="/admin/costs"
                className={`
                  flex items-center px-3 py-2.5 text-sm font-medium rounded-xl transition-all duration-200
                  ${location.pathname.startsWith('/admin/costs')
                    ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }
                  ${effectiveCollapsed ? 'justify-center' : ''}
                `}
                title={effectiveCollapsed ? 'API Costs' : ''}
              >
                <DollarSign className={`w-5 h-5 ${effectiveCollapsed ? '' : 'mr-3'} flex-shrink-0`} />
                <AnimatePresence>
                  {!effectiveCollapsed && (
                    <motion.span
                      initial={{ opacity: 0, width: 0 }}
                      animate={{ opacity: 1, width: 'auto' }}
                      exit={{ opacity: 0, width: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden whitespace-nowrap"
                    >
                      API Costs
                    </motion.span>
                  )}
                </AnimatePresence>
              </NavLink>
            )}
            {userProfile?.role === 'admin' && (
              <NavLink
                to="/settings"
                className={`
                  flex items-center px-3 py-2.5 text-sm font-medium rounded-xl transition-all duration-200
                  ${location.pathname === '/settings'
                    ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }
                  ${effectiveCollapsed ? 'justify-center' : ''}
                `}
                title={effectiveCollapsed ? 'Settings' : ''}
              >
                <Settings className={`w-5 h-5 ${effectiveCollapsed ? '' : 'mr-3'} flex-shrink-0`} />
                <AnimatePresence>
                  {!effectiveCollapsed && (
                    <motion.span
                      initial={{ opacity: 0, width: 0 }}
                      animate={{ opacity: 1, width: 'auto' }}
                      exit={{ opacity: 0, width: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden whitespace-nowrap"
                    >
                      Settings
                    </motion.span>
                  )}
                </AnimatePresence>
              </NavLink>
            )}
            {!isMobile && (
              <button
                onClick={() => {
                  const newState = !isCollapsed;
                  setIsCollapsed(newState);
                  if (onToggleCollapse) {
                    onToggleCollapse();
                  }
                }}
                className={`
                  w-full flex items-center px-3 py-2.5 text-sm font-medium rounded-xl transition-all duration-200
                  text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800
                  ${effectiveCollapsed ? 'justify-center' : ''}
                `}
                title={effectiveCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              >
                {effectiveCollapsed ? (
                  <PanelLeftOpen className="w-5 h-5 flex-shrink-0" />
                ) : (
                  <>
                    <PanelLeftClose className="w-5 h-5 mr-3 flex-shrink-0" />
                    <motion.span
                      initial={{ opacity: 0, width: 0 }}
                      animate={{ opacity: 1, width: 'auto' }}
                      exit={{ opacity: 0, width: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden whitespace-nowrap"
                    >
                      Collapse
                    </motion.span>
                  </>
                )}
              </button>
            )}
          </nav>
        </div>
      </div>

      {/* Version Number */}
      {!effectiveCollapsed && (
        <div className="px-5 pb-4">
          <p className="text-xs text-gray-400 dark:text-gray-600 text-center">
            v1.5.2
          </p>
        </div>
      )}
    </motion.div>
  );
};