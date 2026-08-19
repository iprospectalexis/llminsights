import React from 'react';
import { Search, Map as MapIcon, ShoppingBag, Megaphone, Star, Link2 } from 'lucide-react';
import { parseAnswerChunks } from '../../lib/answerChunks';

// Schematic reproduction of the rich result blocks a ChatGPT/SearchGPT
// answer contained: shopping product cards, place (map) cards, the ad block,
// typed fan-out queries and the three source tiers
// (links_attached ⊆ search_sources; search_sources_more = "More").

const domainOf = (url?: string | null): string => {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

const Favicon = ({ url, size = 16 }: { url?: string | null; size?: number }) => {
  const d = domainOf(url);
  if (!d) return null;
  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${d}&sz=32`}
      alt=""
      className="rounded flex-shrink-0"
      style={{ width: size, height: size }}
      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
    />
  );
};

const parseQueryList = (raw: unknown): string[] => {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (t.startsWith('[')) {
      try {
        const p = JSON.parse(t);
        if (Array.isArray(p)) return p.map(String).filter(Boolean);
      } catch { /* plain string */ }
    }
    return t ? [t] : [];
  }
  return [];
};

const SectionTitle = ({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) => (
  <h4 className="font-medium text-gray-900 dark:text-gray-100 mb-2 flex items-center gap-2">
    {icon}
    {children}
  </h4>
);

export function ResponseRichResults({ response }: { response: any }) {
  const shopping: any[] = Array.isArray(response.shopping) ? response.shopping : [];
  const mapPlaces: any[] = Array.isArray(response.map_places) ? response.map_places : [];
  const businesses: any[] = Array.isArray(response.business_locations) ? response.business_locations : [];
  const ads = response.ads && typeof response.ads === 'object' ? response.ads : null;
  const linksAttached: any[] = Array.isArray(response.links_attached) ? response.links_attached : [];
  const searchSources: any[] = Array.isArray(response.search_sources) ? response.search_sources : [];
  const sourcesMore: any[] = Array.isArray(response.search_sources_more) ? response.search_sources_more : [];
  const webQueries = parseQueryList(response.web_search_query);
  const mapQueries = parseQueryList(response.map_search_queries);

  const bizByName = new Map<string, any>();
  businesses.forEach(b => { if (b?.name) bizByName.set(String(b.name).toLowerCase(), b); });

  const chunks = parseAnswerChunks(response.answer_text, linksAttached);
  const chunkPreviewFor = (url: string): string => {
    const texts = chunks.filter(c => c.urls.includes(url) && c.text).map(c => c.text);
    if (texts.length === 0) return '';
    const joined = texts.join('\n---\n');
    return joined.length > 600 ? joined.slice(0, 600) + '…' : joined;
  };

  const linkUrls = new Set(linksAttached.map(l => l?.url).filter(Boolean));
  const consulted = searchSources.filter(s => s?.url && !linkUrls.has(s.url));

  const hasQueries = webQueries.length > 0 || mapQueries.length > 0;
  const hasSources = linksAttached.length > 0 || consulted.length > 0 || sourcesMore.length > 0;
  const hasAnything = shopping.length > 0 || mapPlaces.length > 0 || businesses.length > 0
    || ads || hasQueries || hasSources;
  if (!hasAnything) return null;

  return (
    <>
      {/* Typed fan-out queries */}
      {hasQueries && (
        <div>
          <SectionTitle icon={<Search className="w-4 h-4 text-gray-500" />}>
            Web search queries
          </SectionTitle>
          <div className="flex flex-wrap gap-2">
            {webQueries.map((q, i) => (
              <span key={`w${i}`} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800/40">
                <Search className="w-3 h-3" /> {q}
              </span>
            ))}
            {mapQueries.map((q, i) => (
              <span key={`m${i}`} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/40" title="Map search query">
                <MapIcon className="w-3 h-3" /> {q}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Shopping cards */}
      {shopping.length > 0 && (
        <div>
          <SectionTitle icon={<ShoppingBag className="w-4 h-4 text-gray-500" />}>
            Shopping results <span className="text-xs font-normal text-gray-500">({shopping.length})</span>
          </SectionTitle>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {shopping.map((p, i) => (
              <a
                key={i}
                href={p.link || undefined}
                target="_blank"
                rel="noopener noreferrer"
                className="block bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl p-3 hover:border-brand-primary transition-colors"
              >
                {p.image && (
                  <img src={p.image} alt={p.title || ''} className="w-full h-24 object-contain mb-2" />
                )}
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100 line-clamp-2">{p.title}</div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{p.price}</span>
                  {p.tag && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">{p.tag}</span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 mt-1 text-xs text-gray-500 dark:text-gray-400">
                  <Favicon url={p.link} size={12} />
                  {p.merchants || domainOf(p.link)}
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Place / map cards */}
      {(mapPlaces.length > 0 || businesses.length > 0) && (
        <div>
          <SectionTitle icon={<MapIcon className="w-4 h-4 text-gray-500" />}>
            Places (map results) <span className="text-xs font-normal text-gray-500">({mapPlaces.length || businesses.length})</span>
          </SectionTitle>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {(mapPlaces.length > 0 ? mapPlaces : businesses).map((place, i) => {
              const biz = mapPlaces.length > 0
                ? bizByName.get(String(place?.name || '').toLowerCase())
                : place;
              const img = biz?.image_url;
              const website = place?.website_url || biz?.website_url;
              return (
                <div key={i} className="flex gap-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl p-3">
                  {img && <img src={img} alt="" className="w-16 h-16 rounded-lg object-cover flex-shrink-0" />}
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                      {place?.position ? `${place.position}. ` : ''}{place?.name}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {place?.category || (Array.isArray(biz?.categories) ? biz.categories.join(', ') : '')}
                    </div>
                    {(place?.rating ?? biz?.rating) != null && (
                      <div className="flex items-center gap-1 text-xs text-gray-700 dark:text-gray-300 mt-0.5">
                        <Star className="w-3 h-3 text-amber-500 fill-amber-500" />
                        {place?.rating ?? biz?.rating}
                        <span className="text-gray-400">({place?.review_count ?? biz?.review_count ?? 0})</span>
                      </div>
                    )}
                    {biz?.address && (
                      <div className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">{biz.address}</div>
                    )}
                    {website && (
                      <a href={website} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-primary hover:underline inline-flex items-center gap-1 mt-0.5">
                        <Favicon url={website} size={12} /> {domainOf(website)}
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Ad block */}
      {ads && (
        <div>
          <SectionTitle icon={<Megaphone className="w-4 h-4 text-amber-500" />}>
            Sponsored <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 font-semibold uppercase">Ad</span>
          </SectionTitle>
          <div className="bg-amber-50/50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/40 rounded-xl p-3">
            {(ads.name || ads.url) && (
              <div className="flex items-center gap-2 mb-2">
                {ads.favicon_url && <img src={ads.favicon_url} alt="" className="w-4 h-4 rounded" />}
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{ads.name || domainOf(ads.url)}</span>
                {ads.url && (
                  <a href={ads.url} target="_blank" rel="noopener noreferrer" className="text-xs text-gray-500 hover:underline">
                    {domainOf(ads.url)}
                  </a>
                )}
              </div>
            )}
            {Array.isArray(ads.carousel_cards) && ads.carousel_cards.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {ads.carousel_cards.map((card: any, i: number) => (
                  <a
                    key={i}
                    href={card.target_url || undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex gap-2 bg-white dark:bg-gray-800 rounded-lg p-2 border border-amber-100 dark:border-amber-900/40 hover:border-amber-300 transition-colors"
                  >
                    {card.image_url && <img src={card.image_url} alt="" className="w-14 h-14 rounded object-cover flex-shrink-0" />}
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-gray-900 dark:text-gray-100 line-clamp-1">{card.title}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2">{card.body}</div>
                      <div className="text-[10px] text-gray-400">{domainOf(card.target_url)}</div>
                    </div>
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Source tiers */}
      {hasSources && (
        <div>
          <SectionTitle icon={<Link2 className="w-4 h-4 text-gray-500" />}>
            Sources
          </SectionTitle>
          <div className="space-y-3">
            {linksAttached.length > 0 && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5">
                  Used in answer ({linksAttached.length})
                </div>
                <div className="space-y-1">
                  {linksAttached.map((l, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm" title={chunkPreviewFor(l.url) || undefined}>
                      <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-brand-primary/10 text-brand-primary text-[10px] font-semibold flex-shrink-0">
                        {l.position ?? i + 1}
                      </span>
                      <Favicon url={l.url} size={14} />
                      <a href={l.url} target="_blank" rel="noopener noreferrer" className="text-brand-primary hover:underline truncate">
                        {l.text || l.title || domainOf(l.url)}
                      </a>
                      <span className="text-xs text-gray-400 flex-shrink-0">{domainOf(l.url)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {consulted.length > 0 && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5">
                  Consulted ({consulted.length})
                </div>
                <div className="space-y-1">
                  {consulted.map((s, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      <Favicon url={s.url} size={14} />
                      <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-gray-700 dark:text-gray-300 hover:text-brand-primary hover:underline truncate">
                        {s.title || domainOf(s.url)}
                      </a>
                      <span className="text-xs text-gray-400 flex-shrink-0">{domainOf(s.url)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {sourcesMore.length > 0 && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5">
                  More sources ({sourcesMore.length})
                </div>
                <div className="space-y-1.5">
                  {sourcesMore.map((s, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <span className="mt-0.5"><Favicon url={s.url} size={14} /></span>
                      <div className="min-w-0">
                        <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-gray-700 dark:text-gray-300 hover:text-brand-primary hover:underline block truncate">
                          {s.title || domainOf(s.url)}
                        </a>
                        {s.snippet && (
                          <div className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2">{s.snippet}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
