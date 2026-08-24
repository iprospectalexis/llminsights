// Delta vs the previous audit, shown next to citation counts on the
// Domains / Pages tabs. The delta is computed on the SHARE of answered
// responses citing the item (percentage points), not on raw citation
// counts: a partially-collected audit (or the ×1 → ×3 Avalanche switch)
// changes absolute counts wholesale while the share stays comparable.
// Absolute numbers live in the tooltip.

export interface TrendData {
  lastCount: number;   // responses citing it in the last audit
  lastTotal: number;   // answered responses in the last audit (filters applied)
  prevCount: number;
  prevTotal: number;
  lastDate?: string;
  prevDate?: string;
}

const fmtDate = (d?: string) =>
  d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';

const pct = (n: number, total: number) => (total > 0 ? (n / total) * 100 : 0);

// Signed delta in percentage points; the sort key used by the tables.
export function trendDelta(t: TrendData): number {
  return pct(t.lastCount, t.lastTotal) - pct(t.prevCount, t.prevTotal);
}

// One point per completed audit in the loaded window (oldest -> newest).
export interface TrendPoint {
  date?: string;
  count: number;   // responses citing the item in that audit
  total: number;   // answered responses in that audit (filters applied)
  share: number;   // count/total, 0..100
}

// Tiny neutral line of the citing share across the audit window. The line is
// deliberately recessive (one gray hue, both themes) — polarity is already
// encoded by the TrendChip next to it; exact values live in the tooltip.
export function Sparkline({ series }: { series: TrendPoint[] | null | undefined }) {
  if (!series || series.length < 2) return null;
  const W = 64, H = 20, PAD = 3;
  const max = Math.max(...series.map(pt => pt.share), 1);
  const x = (i: number) => PAD + (i * (W - 2 * PAD)) / (series.length - 1);
  const y = (v: number) => H - PAD - (v / max) * (H - 2 * PAD);
  const pts = series.map((pt, i) => x(i).toFixed(1) + ',' + y(pt.share).toFixed(1)).join(' ');
  const last = series[series.length - 1];
  const title = series
    .map(pt => (pt.date ? fmtDate(pt.date) + ': ' : '') + pt.share.toFixed(1) + '% (' + pt.count + '/' + pt.total + ')')
    .join('\n');
  return (
    <svg
      width={W}
      height={H}
      viewBox={'0 0 ' + W + ' ' + H}
      role="img"
      className="text-gray-400 dark:text-gray-500 shrink-0 cursor-help"
    >
      <title>{title}</title>
      <polyline
        points={pts}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={x(series.length - 1)} cy={y(last.share)} r="2" fill="currentColor" />
    </svg>
  );
}

export function TrendChip({ trend }: { trend: TrendData | null | undefined }) {
  if (!trend) return null;
  const { lastCount, lastTotal, prevCount, prevTotal, lastDate, prevDate } = trend;

  const lastPct = pct(lastCount, lastTotal);
  const prevPct = pct(prevCount, prevTotal);
  const delta = lastPct - prevPct;

  // Collections of materially different size make the comparison shaky —
  // flag it instead of hiding it.
  const sizeWarning =
    lastTotal > 0 && prevTotal > 0 &&
    Math.abs(lastTotal - prevTotal) / Math.max(lastTotal, prevTotal) > 0.25;

  const title =
    `Last audit${lastDate ? ` (${fmtDate(lastDate)})` : ''}: in ${lastCount} of ${lastTotal} answers (${lastPct.toFixed(1)}%)\n` +
    `Previous${prevDate ? ` (${fmtDate(prevDate)})` : ''}: in ${prevCount} of ${prevTotal} answers (${prevPct.toFixed(1)}%)` +
    (sizeWarning ? '\n⚠ Collections differ in size — compare with care' : '');

  const base =
    'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[11px] font-medium cursor-help whitespace-nowrap';

  if (prevCount === 0 && lastCount > 0) {
    return (
      <span title={title} className={`${base} bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300`}>
        NEW
      </span>
    );
  }
  if (prevCount > 0 && lastCount === 0) {
    return (
      <span title={title} className={`${base} bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300`}>
        ▼ 0
      </span>
    );
  }
  if (Math.abs(delta) < 1) {
    return (
      <span title={title} className={`${base} bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400`}>
        –
      </span>
    );
  }
  const up = delta > 0;
  return (
    <span
      title={title}
      className={`${base} ${up
        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
        : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'}`}
    >
      {up ? '▲' : '▼'} {up ? '+' : ''}{delta.toFixed(delta % 1 === 0 ? 0 : 1)}pt
      {sizeWarning ? <span className="text-amber-500 ml-0.5">⚠</span> : null}
    </span>
  );
}
