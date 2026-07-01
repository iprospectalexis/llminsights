import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { AIOverviewPreviewPage } from './AIOverviewPreviewPage';
import { GeoStrategyModal } from '../components/GeoStrategyModal';

const LOGO_URL =
  'https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/llminsights_72.png';

/**
 * Page publique (sans connexion) de l'outil AI Overview Preview.
 * Header minimal : logo à gauche ; à droite un CTA « Votre stratégie GEO »
 * (ouvre la modale de contact) et le bouton Sign in. Route : /aio-preview.
 */
export const AIOverviewPublicPage: React.FC = () => {
  const [geoOpen, setGeoOpen] = useState(false);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="h-16 flex items-center justify-between px-6 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <div className="flex items-center">
          <img src={LOGO_URL} alt="LLM Insights" className="w-8 h-8" />
          <span className="ml-3 text-lg font-bold text-gray-900 dark:text-white">LLM Insights</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setGeoOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-brand-primary to-fuchsia-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
          >
            <Sparkles className="w-4 h-4" />
            <span className="hidden sm:inline">Votre stratégie GEO</span>
            <span className="sm:hidden">Stratégie GEO</span>
          </button>
          <Link to="/signin">
            <Button variant="primary" size="md">
              Sign in
            </Button>
          </Link>
        </div>
      </header>

      <main>
        <AIOverviewPreviewPage />
      </main>

      <GeoStrategyModal open={geoOpen} onClose={() => setGeoOpen(false)} />
    </div>
  );
};

export default AIOverviewPublicPage;
