import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './contexts/ThemeContext';
import { ProjectProvider } from './contexts/ProjectContext';
import { AppLayout } from './components/layout/AppLayout';
import { SignInForm } from './components/auth/SignInForm';
import { SignUpForm } from './components/auth/SignUpForm';
import { ProjectsPage } from './pages/ProjectsPage';
import { ProjectDetailPage } from './pages/ProjectDetailPage';
import { ProjectOverviewPage } from './pages/ProjectOverviewPage';
import { ProjectPromptsPage } from './pages/ProjectPromptsPage';
import { ProjectPagesPage } from './pages/ProjectPagesPage';
import { ProjectDomainsPage } from './pages/ProjectDomainsPage';
import { ProjectMentionsPage } from './pages/ProjectMentionsPage';
import { ProjectInsightsPage } from './pages/ProjectInsightsPage';
import { ProjectSentimentPage } from './pages/ProjectSentimentPage';
import { ProjectSettingsPage } from './pages/ProjectSettingsPage';
import { PromptDetailPage } from './pages/PromptDetailPage';
import { DomainDetailPage } from './pages/DomainDetailPage';
import { PromptFinderPage } from './pages/PromptFinderPage';
import { GroupsPage } from './pages/GroupsPage';
import { TeamPage } from './pages/TeamPage';
import { AccountPage } from './pages/AccountPage';
import { StatusPage } from './pages/StatusPage';
import { BarometersPage } from './pages/BarometersPage';
import { TopSourcesPage } from './pages/TopSourcesPage';
import { SettingsPage } from './pages/SettingsPage';
import { CostsPage } from './pages/admin/CostsPage';
import { TicketsPage } from './pages/TicketsPage';
import ReportDetailPage from './pages/ReportDetailPage';
import './i18n';

function App() {
  return (
    <ThemeProvider>
      <ProjectProvider>
        <Router>
          <Routes>
            {/* Public routes */}
            <Route path="/signin" element={<SignInForm />} />
            <Route path="/signup" element={<SignUpForm />} />

          {/* Protected routes */}
          <Route path="/" element={<AppLayout />}>
            <Route index element={<Navigate to="/projects" replace />} />
            <Route path="prompt-finder" element={<PromptFinderPage />} />
            <Route path="projects" element={<ProjectsPage />} />
            <Route path="projects/:id" element={<ProjectDetailPage />} />
            <Route path="projects/:id/overview" element={<ProjectOverviewPage />} />
            <Route path="projects/:id/prompts" element={<ProjectPromptsPage />} />
            <Route path="projects/:id/pages" element={<ProjectPagesPage />} />
            <Route path="projects/:id/domains" element={<ProjectDomainsPage />} />
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
            <Route path="settings" element={<SettingsPage />} />
            <Route path="admin/costs" element={<CostsPage />} />
            <Route path="tickets" element={<TicketsPage />} />
          </Route>

          {/* Catch all */}
          <Route path="*" element={<Navigate to="/projects" replace />} />
        </Routes>
      </Router>
      </ProjectProvider>
    </ThemeProvider>
  );
}

export default App;