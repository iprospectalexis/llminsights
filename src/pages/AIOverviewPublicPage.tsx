import React from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { AIOverviewPreviewPage } from './AIOverviewPreviewPage';

const LOGO_URL =
  'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/llminsights_72.png';

/**
 * Page publique (sans connexion) de l'outil AI Overview Preview.
 * N'affiche que le header minimal (logo à gauche, bouton Sign in à droite),
 * puis la page. Route : /ai-overview-preview (hors AppLayout).
 */
export const AIOverviewPublicPage: React.FC = () => (
  <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
    <header className="h-16 flex items-center justify-between px-6 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
      <div className="flex items-center">
        <img src={LOGO_URL} alt="LLM Insights" className="w-8 h-8" />
        <span className="ml-3 text-lg font-bold text-gray-900 dark:text-white">LLM Insights</span>
      </div>
      <Link to="/signin">
        <Button variant="primary" size="md">
          Sign in
        </Button>
      </Link>
    </header>

    <main>
      <AIOverviewPreviewPage />
    </main>
  </div>
);

export default AIOverviewPublicPage;
