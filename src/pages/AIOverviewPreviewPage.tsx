import React, { useRef, useState } from 'react';
import { Plus, X, Monitor, Smartphone, Search, Loader2 } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { getSerpPreview } from '../lib/backendApi';
import type { SerpPreviewResult, SerpSource } from '../lib/backendApi';
import { getCountryByCode } from '../utils/countries';

const MAX_KEYWORDS = 5;
const GEO_CODES = ['US', 'FR', 'GB', 'DE', 'ES', 'IT', 'NL', 'CA', 'BR', 'JP'];
// Le champ `flag` de countries.ts est une URL d'image (non affichable dans une
// <option>). On dérive l'emoji drapeau depuis le code pays (indicateurs régionaux).
const codeToFlag = (code: string) =>
  /^[A-Za-z]{2}$/.test(code)
    ? String.fromCodePoint(...[...code.toUpperCase()].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65))
    : '';
const GEO_OPTIONS = GEO_CODES.map((code) => {
  const c = getCountryByCode(code);
  return { code, name: c?.name ?? code, flag: codeToFlag(code) };
});

const INPUT_CLASS =
  'block w-full rounded-2xl border border-gray-300 dark:border-gray-500 ' +
  'bg-white dark:bg-gray-800 px-4 py-2.5 text-gray-900 dark:text-white ' +
  'placeholder-gray-500 dark:placeholder-gray-300 ' +
  'focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 transition-colors duration-200';

function SourceList({ items, emptyMsg }: { items: SerpSource[]; emptyMsg: string }) {
  if (!items || items.length === 0) {
    return <p className="text-xs italic text-gray-400 dark:text-gray-500 px-1 py-1">{emptyMsg}</p>;
  }
  return (
    <ol className="space-y-1">
      {items.map((s, i) => (
        <li
          key={`${s.url}-${i}`}
          className={`rounded-xl border ${
            s.shared
              ? 'bg-green-50 border-green-300 dark:bg-green-900/30 dark:border-green-700'
              : 'border-transparent'
          }`}
        >
          <a
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            title={s.title || s.url}
            className="block px-2.5 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl"
          >
            <span
              className={`block text-[13px] font-medium truncate ${
                s.shared ? 'text-green-800 dark:text-green-300' : 'text-gray-800 dark:text-gray-100'
              }`}
            >
              {s.source || s.host || s.url}
            </span>
            <span className="block text-[11px] text-gray-400 dark:text-gray-500 truncate">{s.host}</span>
          </a>
        </li>
      ))}
    </ol>
  );
}

export const AIOverviewPreviewPage: React.FC = () => {
  const [keywords, setKeywords] = useState<string[]>(['']);
  const [geo, setGeo] = useState('US');
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState<SerpPreviewResult[]>([]);
  const [activeTab, setActiveTab] = useState(0);
  const [viewed, setViewed] = useState<Set<number>>(new Set([0]));
  const [resultDevice, setResultDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<number | null>(null);

  const updateKeyword = (i: number, v: string) =>
    setKeywords((ks) => ks.map((k, idx) => (idx === i ? v : k)));
  const addKeyword = () =>
    setKeywords((ks) => (ks.length < MAX_KEYWORDS ? [...ks, ''] : ks));
  const removeKeyword = (i: number) =>
    setKeywords((ks) => (ks.length > 1 ? ks.filter((_, idx) => idx !== i) : ks));

  const activateTab = (i: number) => {
    setActiveTab(i);
    setViewed((prev) => new Set(prev).add(i));
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const seen = new Set<string>();
    const kws = keywords
      .map((k) => k.trim())
      .filter((k) => {
        const low = k.toLowerCase();
        if (!k || seen.has(low)) return false;
        seen.add(low);
        return true;
      })
      .slice(0, MAX_KEYWORDS);

    if (kws.length === 0) {
      setError('Veuillez saisir au moins un mot-clé.');
      return;
    }

    setLoading(true);
    setResults([]);
    setActiveTab(0);
    setViewed(new Set([0]));
    setResultDevice(device);

    const t0 = performance.now();
    setElapsed(0);
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(
      () => setElapsed(Math.round((performance.now() - t0) / 1000)),
      1000,
    );

    try {
      const data = await getSerpPreview({ keywords: kws, geo, device });
      setResults(data.results || []);
      setActiveTab(0);
      setViewed(new Set([0]));
    } catch (err) {
      setError('Impossible de récupérer les résultats Google pour le moment. Réessayez.');
    } finally {
      setLoading(false);
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  };

  const cardClass =
    'bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm';

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">AI Overview Preview</h1>
        <div className="mt-1 space-y-1 text-sm text-gray-500 dark:text-gray-400">
          <p>
            Les AI Overview vont bientôt débarquer en France. Testez dès maintenant si vous êtes
            cités/mentionnés.
          </p>
          <p>
            Entrez vos requêtes et nous allons requêter les résultats de Google depuis les pays où
            les AI Overview sont déjà présents.
          </p>
        </div>
      </div>

      {/* Formulaire */}
      <form onSubmit={onSubmit} className={`${cardClass} p-5 space-y-4`}>
        <div className="flex flex-col lg:flex-row gap-4 lg:items-start">
          {/* Mots-clés */}
          <div className="flex-1 min-w-0">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-100 mb-1.5">
              Mots-clés <span className="text-xs text-gray-400">(jusqu'à {MAX_KEYWORDS})</span>
            </label>
            <div className="space-y-2">
              {keywords.map((kw, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={kw}
                    onChange={(e) => updateKeyword(i, e.target.value)}
                    placeholder="Saisissez un mot-clé…"
                    className={INPUT_CLASS}
                  />
                  {keywords.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeKeyword(i)}
                      title="Retirer"
                      aria-label="Retirer ce mot-clé"
                      className="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-xl border border-gray-300 dark:border-gray-600 text-gray-500 hover:text-red-600 hover:border-red-400 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addKeyword}
              disabled={keywords.length >= MAX_KEYWORDS}
              title="Ajouter un mot-clé"
              aria-label="Ajouter un mot-clé"
              className="mt-2 w-9 h-9 flex items-center justify-center rounded-xl border border-dashed border-gray-300 dark:border-gray-600 text-brand-primary hover:bg-brand-primary/5 disabled:opacity-40 disabled:cursor-default transition-colors"
            >
              <Plus className="w-5 h-5" />
            </button>
          </div>

          {/* Pays */}
          <div className="lg:w-56">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-100 mb-1.5">
              Pays
            </label>
            <select
              value={geo}
              onChange={(e) => setGeo(e.target.value)}
              className={INPUT_CLASS}
            >
              {GEO_OPTIONS.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.flag} {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Appareil */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-100 mb-1.5">
              Appareil
            </label>
            <div className="inline-flex rounded-2xl border border-gray-300 dark:border-gray-600 overflow-hidden">
              <button
                type="button"
                onClick={() => setDevice('desktop')}
                title="Ordinateur"
                aria-label="Ordinateur"
                className={`px-4 py-2.5 ${
                  device === 'desktop'
                    ? 'bg-brand-primary text-white'
                    : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-300'
                }`}
              >
                <Monitor className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => setDevice('mobile')}
                title="Mobile"
                aria-label="Mobile"
                className={`px-4 py-2.5 border-l border-gray-300 dark:border-gray-600 ${
                  device === 'mobile'
                    ? 'bg-brand-primary text-white'
                    : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-300'
                }`}
              >
                <Smartphone className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Analyser */}
          <div className="lg:self-start lg:pt-7">
            <Button type="submit" variant="primary" loading={loading} className="w-full lg:w-auto">
              Analyser
            </Button>
          </div>
        </div>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      </form>

      {/* Résultats */}
      <div className={`${cardClass} relative overflow-hidden min-h-[70vh]`}>
        {/* Placeholder */}
        {results.length === 0 && !loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-gray-400 dark:text-gray-500">
            <Search className="w-10 h-10" />
            <p className="text-sm">Lancez une analyse pour afficher les résultats Google ici.</p>
          </div>
        )}

        {/* Onglets + panneaux */}
        {results.length > 0 && (
          <>
            <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 overflow-x-auto px-2">
              {results.map((r, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => activateTab(i)}
                  title={r.ok ? r.keyword : `${r.keyword} — erreur`}
                  className={`px-4 py-3 text-sm whitespace-nowrap max-w-[220px] truncate border-b-2 -mb-px transition-colors ${
                    i === activeTab
                      ? 'border-brand-primary text-brand-primary font-semibold'
                      : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
                  } ${!r.ok ? 'text-red-600 dark:text-red-400' : ''}`}
                >
                  {r.keyword}
                </button>
              ))}
            </div>

            {results.map((r, i) => {
              const aioTitle =
                r.aio_sources.length > 0
                  ? `${r.aio_sources.length} page${r.aio_sources.length > 1 ? 's' : ''} citée${
                      r.aio_sources.length > 1 ? 's' : ''
                    } dans AI Overview`
                  : "Sources de l'AI Overview";
              return (
                <div key={i} className={i === activeTab ? 'flex h-[70vh]' : 'hidden'}>
                  {/* Colonne SERP */}
                  <div
                    className={`flex-1 min-w-0 h-full bg-white ${
                      resultDevice === 'mobile' ? 'flex justify-center py-4 bg-gray-100 dark:bg-gray-900' : ''
                    }`}
                  >
                    {r.ok ? (
                      <iframe
                        title={`Résultats Google — ${r.keyword}`}
                        srcDoc={viewed.has(i) ? r.html : undefined}
                        referrerPolicy="no-referrer"
                        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
                        className={
                          resultDevice === 'mobile'
                            ? 'w-[420px] max-w-full h-full border border-gray-200 rounded-xl bg-white'
                            : 'w-full h-full border-0 bg-white'
                        }
                      />
                    ) : (
                      <div className="flex items-center justify-center h-full p-6 text-center text-sm text-red-600 dark:text-red-400">
                        {r.error || 'Erreur lors de la récupération.'}
                      </div>
                    )}
                  </div>

                  {/* Colonne Sources */}
                  <aside className="w-80 flex-shrink-0 h-full overflow-y-auto border-l border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-4">
                    <p className="flex items-start gap-1.5 text-xs leading-snug text-gray-500 dark:text-gray-400 mb-4">
                      <span className="mt-0.5 w-3 h-3 flex-shrink-0 rounded-[3px] bg-green-50 border border-green-300 dark:bg-green-900/30 dark:border-green-700" />
                      URL présent à la fois dans l'AI Overview et en 1ère page organique Google
                    </p>

                    <h3 className="text-xs font-bold uppercase tracking-wide text-gray-700 dark:text-gray-200 mb-2">
                      {aioTitle}
                    </h3>
                    <SourceList items={r.aio_sources} emptyMsg="Aucun AI Overview pour cette requête." />

                    <h3 className="text-xs font-bold uppercase tracking-wide text-gray-700 dark:text-gray-200 mt-5 mb-2">
                      Résultats organiques
                    </h3>
                    <SourceList items={r.organic_sources} emptyMsg="Aucun résultat organique." />
                  </aside>
                </div>
              );
            })}
          </>
        )}

        {/* Overlay de chargement */}
        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-white/90 dark:bg-gray-800/90 text-gray-500 dark:text-gray-300">
            <Loader2 className="w-9 h-9 animate-spin text-brand-primary" />
            <p className="text-sm">Analyse en cours… récupération des résultats Google{elapsed ? ` (${elapsed}s)` : ''}</p>
            <p className="text-xs opacity-70">Cela peut prendre quelques secondes.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default AIOverviewPreviewPage;
