import React from 'react';
import { Brain, Heart } from 'lucide-react';

export const Footer: React.FC = () => {
  return (
    <footer className="border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 py-6 px-6">
      <div className="max-w-7xl mx-auto">
        <div className="text-center space-y-2">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Tous droits réservés.
          </p>
          <p className="text-sm text-gray-700 dark:text-gray-300 flex items-center justify-center gap-2">
            Made with
            <Brain className="w-4 h-4 text-brand-primary" />
            &
            <Heart className="w-4 h-4 text-red-500 fill-red-500" />
            by <span className="font-semibold">One Search Team</span> at <span className="font-semibold">iProspect France</span>
          </p>
        </div>
      </div>
    </footer>
  );
};
