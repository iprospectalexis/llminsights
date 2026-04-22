// Unified brand colour scheme for all charts across the app.
// Keep in sync with the (historical) copy in ProjectDetailPage.tsx lines 50–68.
// Colours are deliberately distinct enough for 6–10 brands on a single chart.
export const BRAND_COLOR_SCHEME = [
  '#f72585', // rose
  '#b5179e', // fandango
  '#7209b7', // grape
  '#a163e8', // amethyst
  '#1ed0d9', // robin-egg-blue
  '#3a0ca3', // zaffre
  '#d0bd3c', // old-gold
  '#4361ee', // neon-blue
  '#e8672b', // persimmon
  '#4df07e', // spring-green
];

// Gold — reserved for the client's own brand so it always stands out visually,
// regardless of the competitor palette above.
export const OWN_BRAND_COLOR = '#f59e0b';

// Deterministic: same brand gets the same colour across every chart on a page.
// Sort alphabetically to keep order stable across re-renders, then modulo into
// the palette.
export function getBrandColor(brandName: string, allBrands: string[]): string {
  const sorted = [...allBrands].sort();
  const idx = sorted.indexOf(brandName);
  return idx !== -1
    ? BRAND_COLOR_SCHEME[idx % BRAND_COLOR_SCHEME.length]
    : BRAND_COLOR_SCHEME[0];
}
