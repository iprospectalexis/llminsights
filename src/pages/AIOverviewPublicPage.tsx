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
            className="group inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 via-fuchsia-500 to-pink-500 bg-[length:200%_auto] px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-fuchsia-500/40 ring-1 ring-white/20 transition-all duration-300 hover:-translate-y-0.5 hover:bg-right hover:shadow-xl hover:shadow-fuchsia-500/60 focus:outline-none focus:ring-2 focus:ring-fuchsia-400 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
          >
            <Sparkles className="w-4 h-4 transition-transform duration-300 group-hover:rotate-12 group-hover:scale-110" />
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
