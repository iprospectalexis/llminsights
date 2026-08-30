import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { ThemeProvider } from './contexts/ThemeContext';
import { ProjectProvider } from './contexts/ProjectContext';
import { DashboardFiltersProvider } from './contexts/DashboardFiltersContext';
import { AppLayout } from './components/layout/AppLayout';
import { SignInForm } from './components/auth/SignInForm';
import { SignUpForm } from './components/auth/SignUpForm';
import { ProjectsPage } from './pages/ProjectsPage';
import { ProjectDetailPage } from './pages/ProjectDetailPage';
import { ProjectVisibilityPage } from './pages/ProjectVisibilityPage';
import { ProjectOverviewPage } from './pages/ProjectOverviewPage';
import { ProjectPromptsPage } from './pages/ProjectPromptsPage';
import { ProjectCompetitorsPage } from './pages/ProjectCompetitorsPage';
import { ProjectPagesPage } from './pages/ProjectPagesPage';
import { ProjectDomainsPage } from './pages/ProjectDomainsPage';
import { ProjectAdsPage } from './pages/ProjectAdsPage';
import { ProjectCitationFunnelPage } from './pages/ProjectCitationFunnelPage';
import { ProjectMentionsPage } from './pages/ProjectMentionsPage';
import { ProjectInsightsPage } from './pages/ProjectInsightsPage';
import { ProjectSentimentPage } from './pages/ProjectSentimentPage';
import { ProjectSettingsPage } from './pages/ProjectSettingsPage';
import { PromptDetailPage } from './pages/PromptDetailPage';
import { DomainDetailPage } from './pages/DomainDetailPage';
import { PromptFinderPage } from './pages/PromptFinderPage';
import { AIOverviewPreviewPage } from './pages/AIOverviewPreviewPage';
import { GroupsPage } from './pages/GroupsPage';
import { TeamPage } from './pages/TeamPage';
import { AccountPage } from './pages/AccountPage';
import { StatusPage } from './pages/StatusPage';
import { BarometersPage } from './pages/BarometersPage';
import { BarometerAdsPage } from './pages/BarometerAdsPage';
import { TopSourcesPage } from './pages/TopSourcesPage';
import { SettingsPage } from './pages/SettingsPage';
import { CostsPage } from './pages/admin/CostsPage';
import { TicketsPage } from './pages/TicketsPage';
import ReportDetailPage from './pages/ReportDetailPage';
import { AIOverviewPublicPage } from './pages/AIOverviewPublicPage';
import './i18n';

// The in-page tab bar is gone — every dashboard is its own route from
// the sidebar. The bare project URL (and legacy ?tab= links/bookmarks)
// land on the matching dashboard route, keeping the filter params.
const PROJECT_DASHBOARD_SLUGS = new Set([
  'overview', 'visibility', 'prompts', 'pages', 'domains', 'ads',
  'citation-funnel', 'mentions', 'insights', 'sentiment', 'settings',
]);

const ProjectIndexRedirect = () => {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const params = new URLSearchParams(searchParams);
  const tab = params.get('tab') || 'overview';
  params.delete('tab');
  const slug = PROJECT_DASHBOARD_SLUGS.has(tab) ? tab : 'overview';
  const qs = params.toString();
  return <Navigate to={`/projects/${id}/${slug}${qs ? `?${qs}` : ''}`} replace />;
};

function App() {
  return (
    <ThemeProvider>
      <ProjectProvider>
        <Router>
          {/* DashboardFiltersProvider needs to live inside the Router
              so it can use useSearchParams / useParams to hydrate from
              the URL and namespace localStorage by projectId. */}
          <DashboardFiltersProvider>
          <Routes>
            {/* Public routes */}
            <Route path="/signin" element={<SignInForm />} />
            <Route path="/signup" element={<SignUpForm />} />
            {/* Outil public (sans connexion) : header minimal + page */}
            <Route path="/aio-preview" element={<AIOverviewPublicPage />} />

          {/* Protected routes */}
          <Route path="/" element={<AppLayout />}>
            <Route index element={<Navigate to="/projects" replace />} />
            <Route path="prompt-finder" element={<PromptFinderPage />} />
            <Route path="ai-overview" element={<AIOverviewPreviewPage />} />
            <Route path="projects" element={<ProjectsPage />} />
            <Route path="projects/:id" element={<ProjectIndexRedirect />} />
            <Route path="projects/:id/overview" element={<ProjectOverviewPage />} />
            <Route path="projects/:id/visibility" element={<ProjectVisibilityPage />} />
            <Route path="projects/:id/prompts" element={<ProjectPromptsPage />} />
            <Route path="projects/:id/competitors" element={<ProjectCompetitorsPage />} />
            <Route path="projects/:id/pages" element={<ProjectPagesPage />} />
            <Route path="projects/:id/domains" element={<ProjectDomainsPage />} />
            <Route path="projects/:id/ads" element={<ProjectAdsPage />} />
            <Route path="projects/:id/citation-funnel" element={<ProjectCitationFunnelPage />} />
            <Route path="projects/:id/mentions" element={<ProjectMentionsPage />} />
            <Route path="projects/:id/sentiment" element={<ProjectSentimentPage />} />
            <Route path="projects/:id/insights" element={<ProjectInsightsPage />} />
            <Route path="projects/:id/settings" element={<ProjectSettingsPage />} />
            <Route path="projects/:projectId/prompts/:promptId" element={<PromptDetailPage />} />
            <Route path="projects/:projectId/domains/:domain" element={<DomainDetailPage />} />
            <Route path="reports/:reportId" element={<ReportDetailPage />} />
            <Route path="groups" element={<GroupsPage />} />
            <Route path="team" element={<TeamPage />} />
            <Route path="account" element={<AccountPage />} />
            <Route path="status" element={<StatusPage />} />
            <Route path="barometers" element={<BarometersPage />} />
            <Route path="barometers/top-sources" element={<TopSourcesPage />} />
            <Route path="barometers/ads" element={<BarometerAdsPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="admin/costs" element={<CostsPage />} />
            <Route path="tickets" element={<TicketsPage />} />
          </Route>

          {/* Catch all */}
          <Route path="*" element={<Navigate to="/projects" replace />} />
        </Routes>
          </DashboardFiltersProvider>
      </Router>
      </ProjectProvider>
    </ThemeProvider>
  );
}

export default App;