import React, { useRef, useState, useEffect, useLayoutEffect, useCallback, useId } from 'react';
import { Plus, X, Monitor, Smartphone, Search, Loader2, Maximize2, ChevronDown } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { getSerpPreview } from '../lib/backendApi';
import type { SerpPreviewResult, SerpSource } from '../lib/backendApi';
import { getCountryByCode } from '../utils/countries';

const MAX_KEYWORDS = 5;
const GEO_CODES = ['US', 'BE', 'CH', 'FR', 'GB', 'DE', 'ES', 'IT', 'NL', 'CA', 'BR', 'JP'];
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

// Sur Windows, Segoe UI Emoji ne rend pas les emoji drapeaux (affiche « us » au
// lieu de 🇺🇸). On charge une police dédiée, restreinte aux indicateurs
// régionaux, qui ne s'applique donc qu'aux codepoints des drapeaux.
const FLAG_FONT_FAMILY = '"Twemoji Country Flags", ui-sans-serif, system-ui, sans-serif';
const FLAG_FONT_FACE =
  '@font-face{font-family:"Twemoji Country Flags";unicode-range:U+1F1E6-1F1FF;' +
  'src:url("https://cdn.jsdelivr.net/npm/country-flag-emoji-polyfill@0.1/dist/TwemojiCountryFlags.woff2") format("woff2");' +
  'font-display:swap}';

// Clé d'URL normalisée (hôte sans www + chemin, sans ?query/#fragment/slash
// final) pour apparier une même PAGE entre organique et AI Overview.
function normUrl(u: string): string {
  if (!u) return '';
  try {
    const url = new URL(u);
    return url.hostname.toLowerCase().replace(/^www\./, '') + url.pathname.replace(/\/+$/, '');
  } catch {
    return u.toLowerCase().replace(/[?#].*$/, '').replace(/\/+$/, '');
  }
}

function SourceItems({
  items,
  emptyMsg,
  col,
  shared,
}: {
  items: SerpSource[];
  emptyMsg: string;
  col: 'org' | 'aio';
  shared: Set<string>;
}) {
  // Organique surligné en vert, AI Overview en rose.
  const sharedBox =
    col === 'aio'
      ? 'bg-pink-50 border-pink-300 dark:bg-pink-900/30 dark:border-pink-700'
      : 'bg-green-50 border-green-300 dark:bg-green-900/30 dark:border-green-700';
  const sharedText =
    col === 'aio'
      ? 'text-pink-800 dark:text-pink-300'
      : 'text-green-800 dark:text-green-300';
  if (!items || items.length === 0) {
    return <p className="text-xs italic text-gray-400 dark:text-gray-500 px-1 py-1">{emptyMsg}</p>;
  }
  return (
    <ol className="space-y-1">
      {items.map((s, i) => {
        const urlKey = normUrl(s.url);
        const isShared = !!urlKey && shared.has(urlKey);
        return (
          <li
            key={`${s.url}-${i}`}
            data-col={col}
            data-key={urlKey}
            className={`rounded-xl border ${isShared ? sharedBox : 'border-transparent'}`}
          >
            <a
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              title={s.title || s.url}
              className="block px-2 py-1.5 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <span
                className={`block text-[12px] font-medium truncate ${
                  isShared ? sharedText : 'text-gray-800 dark:text-gray-100'
                }`}
              >
                {s.title || s.source || s.host || s.url}
              </span>
              <span className="block text-[10px] text-gray-400 dark:text-gray-500 truncate">{s.host}</span>
            </a>
          </li>
        );
      })}
    </ol>
  );
}

// Colonne « Sources » : organique (gauche) et AI Overview (droite) côte à côte,
// avec des flèches SVG reliant une même PAGE (URL) de l'organique vers sa
// citation dans l'AI Overview. Le SVG vit dans le conteneur scrollable,
// donc il défile avec le contenu et reste aligné.
function SourcesPanel({
  aioSources,
  organicSources,
  aioTitle,
}: {
  aioSources: SerpSource[];
  organicSources: SerpSource[];
  aioTitle: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const uid = useId().replace(/:/g, '');
  const [lines, setLines] = useState<{ x1: number; y1: number; x2: number; y2: number }[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const aioKeys = new Set(aioSources.map((s) => normUrl(s.url)).filter(Boolean));
  const shared = new Set(organicSources.map((s) => normUrl(s.url)).filter((k) => k && aioKeys.has(k)));
  const sharedKey = [...shared].sort().join('\n');

  const recompute = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const wr = wrap.getBoundingClientRect();
    if (wr.width === 0 || wr.height === 0) return;
    const esc = (h: string) =>
      window.CSS && CSS.escape ? CSS.escape(h) : h.replace(/["\\]/g, '\\$&');
    const next: { x1: number; y1: number; x2: number; y2: number }[] = [];
    sharedKey
      .split('\n')
      .filter(Boolean)
      .forEach((k) => {
        const org = wrap.querySelector<HTMLElement>(`[data-col="org"][data-key="${esc(k)}"]`);
        const aio = wrap.querySelector<HTMLElement>(`[data-col="aio"][data-key="${esc(k)}"]`);
        if (!org || !aio) return;
        const o = org.getBoundingClientRect();
        const a = aio.getBoundingClientRect();
        next.push({
          x1: o.right - wr.left,
          y1: o.top - wr.top + o.height / 2,
          x2: a.left - wr.left,
          y2: a.top - wr.top + a.height / 2,
        });
      });
    setLines((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    const w = wrap.offsetWidth;
    const h = wrap.offsetHeight;
    setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
  }, [sharedKey]);

  useLayoutEffect(() => {
    recompute();
  }, [recompute, aioSources, organicSources]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => recompute());
    ro.observe(wrap);
    window.addEventListener('resize', recompute);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', recompute);
    };
  }, [recompute]);

  return (
    <div className="p-4">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
        Résultats organiques <span className="font-normal text-gray-400">vs</span> Citations AIO
      </h2>
      <p className="text-xs leading-snug text-gray-500 dark:text-gray-400 mb-3">
        Une flèche relie une source présente en organique (
        <span className="font-medium text-green-600 dark:text-green-400">vert</span>) et citée dans
        l'AI Overview (<span className="font-medium text-pink-600 dark:text-pink-400">rose</span>).
      </p>

      <div ref={wrapRef} className="relative">
        <svg
          width={size.w}
          height={size.h}
          viewBox={`0 0 ${size.w} ${size.h}`}
          className="pointer-events-none absolute inset-0 z-10"
          style={{ overflow: 'visible' }}
        >
          <defs>
            <marker
              id={`arw-${uid}`}
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L10,5 L0,10 z" fill="#ec4899" />
            </marker>
            {lines.map((l, i) => (
              <linearGradient
                key={i}
                id={`grad-${uid}-${i}`}
                gradientUnits="userSpaceOnUse"
                x1={l.x1}
                y1={l.y1}
                x2={l.x2}
                y2={l.y2}
              >
                <stop offset="0%" stopColor="#22c55e" />
                <stop offset="100%" stopColor="#ec4899" />
              </linearGradient>
            ))}
          </defs>
          {lines.map((l, i) => {
            const dx = Math.max(14, Math.abs(l.x2 - l.x1) * 0.6);
            return (
              <path
                key={i}
                d={`M ${l.x1} ${l.y1} C ${l.x1 + dx} ${l.y1}, ${l.x2 - dx} ${l.y2}, ${l.x2} ${l.y2}`}
                fill="none"
                stroke={`url(#grad-${uid}-${i})`}
                strokeWidth={1.5}
                strokeOpacity={0.85}
                markerEnd={`url(#arw-${uid})`}
              />
            );
          })}
        </svg>

        <div className="grid grid-cols-2 gap-x-8">
          <div className="min-w-0">
            <h3 className="text-[11px] font-bold uppercase tracking-wide text-gray-700 dark:text-gray-200 mb-2">
              Résultats organiques
            </h3>
            <SourceItems items={organicSources} emptyMsg="Aucun résultat organique." col="org" shared={shared} />
          </div>
          <div className="min-w-0">
            <h3 className="text-[11px] font-bold uppercase tracking-wide text-gray-700 dark:text-gray-200 mb-2">
              {aioTitle}
            </h3>
            <SourceItems items={aioSources} emptyMsg="Aucun AI Overview pour cette requête." col="aio" shared={shared} />
          </div>
        </div>
      </div>
    </div>
  );
}

// Dropdown pays custom : le <select> natif ignore les web-fonts sous Windows
// (les drapeaux emoji y restent « us »). Ici les drapeaux sont des <span> avec
// la police Twemoji Country Flags → rendus correctement partout.
function CountrySelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (code: string) => void;
  options: { code: string; name: string; flag: string }[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const selected = options.find((o) => o.code === value) || options[0];
  const triggerClass =
    'w-full rounded-2xl border border-gray-300 dark:border-gray-500 bg-white dark:bg-gray-800 ' +
    'px-4 py-2.5 text-gray-900 dark:text-white flex items-center gap-2 text-left ' +
    'focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 transition-colors duration-200';

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open} className={triggerClass}>
        <span style={{ fontFamily: FLAG_FONT_FAMILY }} className="text-lg leading-none">
          {selected.flag}
        </span>
        <span className="flex-1 truncate">{selected.name}</span>
        <ChevronDown className={`w-4 h-4 flex-shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <ul
          role="listbox"
          className="absolute z-30 mt-1 w-full max-h-72 overflow-auto rounded-2xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-lg py-1"
        >
          {options.map((o) => (
            <li key={o.code}>
              <button
                type="button"
                role="option"
                aria-selected={o.code === value}
                onClick={() => {
                  onChange(o.code);
                  setOpen(false);
                }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                  o.code === value
                    ? 'bg-brand-primary/10 text-brand-primary'
                    : 'text-gray-800 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                <span style={{ fontFamily: FLAG_FONT_FAMILY }} className="text-lg leading-none">
                  {o.flag}
                </span>
                <span className="truncate">{o.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export const AIOverviewPreviewPage: React.FC = () => {
  const [rows, setRows] = useState<{ kw: string; geo: string }[]>([{ kw: '', geo: 'US' }]);
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState<SerpPreviewResult[]>([]);
  const [activeTab, setActiveTab] = useState(0);
  const [viewed, setViewed] = useState<Set<number>>(new Set([0]));
  const [resultDevice, setResultDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [resultGeos, setResultGeos] = useState<string[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<number | null>(null);
  // Index du mot-clé affiché en plein écran (null = aucun).
  const [fullscreen, setFullscreen] = useState<number | null>(null);

  // Fermer le plein écran avec la touche Échap.
  useEffect(() => {
    if (fullscreen === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  const updateKw = (i: number, v: string) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, kw: v } : r)));
  const updateGeo = (i: number, v: string) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, geo: v } : r)));
  const addRow = () =>
    setRows((rs) => (rs.length < MAX_KEYWORDS ? [...rs, { kw: '', geo: rs[rs.length - 1]?.geo || 'US' }] : rs));
  const removeRow = (i: number) =>
    setRows((rs) => (rs.length > 1 ? rs.filter((_, idx) => idx !== i) : rs));

  const activateTab = (i: number) => {
    setActiveTab(i);
    setViewed((prev) => new Set(prev).add(i));
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    // Doublons autorisés ; chaque ligne a son propre pays.
    const queries = rows
      .map((r) => ({ keyword: r.kw.trim(), geo: r.geo }))
      .filter((q) => q.keyword.length > 0)
      .slice(0, MAX_KEYWORDS);

    if (queries.length === 0) {
      setError('Veuillez saisir au moins un mot-clé.');
      return;
    }

    setLoading(true);
    setResults([]);
    setActiveTab(0);
    setViewed(new Set([0]));
    setResultDevice(device);
    setResultGeos(queries.map((q) => q.geo));
    setFullscreen(null);

    const t0 = performance.now();
    setElapsed(0);
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(
      () => setElapsed(Math.round((performance.now() - t0) / 1000)),
      1000,
    );

    try {
      const data = await getSerpPreview({ queries, device });
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
  const fsResult = fullscreen !== null ? results[fullscreen] : undefined;
  const fsGeo = fullscreen !== null ? resultGeos[fullscreen] || '' : '';

  return (
    <>
    <style>{FLAG_FONT_FACE}</style>
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
          {/* Mots-clés + pays (un pays par mot-clé) */}
          <div className="flex-1 min-w-0">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-100 mb-1.5">
              Mots-clés &amp; pays <span className="text-xs text-gray-400">(jusqu'à {MAX_KEYWORDS})</span>
            </label>
            <div className="space-y-2">
              {rows.map((r, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={r.kw}
                    onChange={(e) => updateKw(i, e.target.value)}
                    placeholder="Saisissez un mot-clé…"
                    className={INPUT_CLASS}
                  />
                  <div className="w-44 flex-shrink-0">
                    <CountrySelect value={r.geo} onChange={(v) => updateGeo(i, v)} options={GEO_OPTIONS} />
                  </div>
                  {rows.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeRow(i)}
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
              onClick={addRow}
              disabled={rows.length >= MAX_KEYWORDS}
              title="Ajouter un mot-clé"
              aria-label="Ajouter un mot-clé"
              className="mt-2 w-9 h-9 flex items-center justify-center rounded-xl border border-dashed border-gray-300 dark:border-gray-600 text-brand-primary hover:bg-brand-primary/5 disabled:opacity-40 disabled:cursor-default transition-colors"
            >
              <Plus className="w-5 h-5" />
            </button>
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
                  <span style={{ fontFamily: FLAG_FONT_FAMILY }} className="mr-1.5">
                    {codeToFlag(resultGeos[i] || '')}
                  </span>
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
                    className={`relative flex-1 min-w-0 h-full bg-white ${
                      resultDevice === 'mobile' ? 'flex justify-center py-4 bg-gray-100 dark:bg-gray-900' : ''
                    }`}
                  >
                    {r.ok && (
                      <button
                        type="button"
                        onClick={() => setFullscreen(i)}
                        title="Afficher en plein écran"
                        aria-label="Afficher les résultats en plein écran"
                        className="absolute top-2 right-2 z-10 w-9 h-9 flex items-center justify-center rounded-lg bg-white/90 dark:bg-gray-800/90 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 shadow-sm hover:text-brand-primary transition-colors"
                      >
                        <Maximize2 className="w-4 h-4" />
                      </button>
                    )}
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

                  {/* Colonne Sources : organique -> AI Overview reliés par des flèches */}
                  <aside className="w-[420px] flex-shrink-0 h-full overflow-y-auto border-l border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40">
                    <SourcesPanel
                      aioSources={r.aio_sources}
                      organicSources={r.organic_sources}
                      aioTitle={aioTitle}
                    />
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

    {/* Plein écran : superposition couvrant tout le viewport */}
    {fsResult?.ok && (
      <div className="fixed inset-0 z-50 flex flex-col bg-white dark:bg-gray-900">
        <div className="flex items-center justify-between gap-3 px-4 h-12 flex-shrink-0 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
          <div className="flex items-center gap-2 min-w-0">
            <Search className="w-4 h-4 text-gray-400 flex-shrink-0" />
            <span className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">
              {fsResult.keyword}
            </span>
            <span className="hidden sm:inline text-xs text-gray-400 flex-shrink-0">
              · <span style={{ fontFamily: FLAG_FONT_FAMILY }}>{codeToFlag(fsGeo)}</span>{' '}
              {resultDevice === 'mobile' ? 'Mobile' : 'Ordinateur'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setFullscreen(null)}
            title="Fermer (Échap)"
            aria-label="Fermer le plein écran"
            className="flex items-center gap-1.5 px-3 h-9 flex-shrink-0 rounded-lg border border-gray-300 dark:border-gray-600 text-sm text-gray-600 dark:text-gray-300 hover:text-red-600 hover:border-red-400 transition-colors"
          >
            <X className="w-4 h-4" />
            Fermer
          </button>
        </div>
        <div
          className={`flex-1 min-h-0 bg-white ${
            resultDevice === 'mobile' ? 'flex justify-center py-4 bg-gray-100 dark:bg-gray-900' : ''
          }`}
        >
          <iframe
            title={`Résultats Google plein écran — ${fsResult.keyword}`}
            srcDoc={fsResult.html}
            referrerPolicy="no-referrer"
            sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
            className={
              resultDevice === 'mobile'
                ? 'w-[420px] max-w-full h-full border border-gray-200 rounded-xl bg-white'
                : 'w-full h-full border-0 bg-white'
            }
          />
        </div>
      </div>
    )}
    </>
  );
};

export default AIOverviewPreviewPage;
