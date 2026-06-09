import React, { useMemo } from 'react';

export interface FanOutItem {
  label: string;
  count: number;
}

interface Props {
  /** The seed query shown in the left node — the prompt text. */
  seed: string;
  /** Branch queries (e.g. web-search queries), each with a frequency count. */
  items: FanOutItem[];
  className?: string;
}

// ── geometry (viewBox units; the SVG scales to container width) ──────
const VIEW_W = 900;
const ROW_H = 30;
const PAD_Y = 18;
const SEED_X = 8;
const SEED_W = 236;
const SEED_H = 78;
const BRANCH_X = 300;     // x of the branch dots
const LABEL_X = 314;      // x where branch labels start
const COUNT_X = VIEW_W - 12; // right-aligned count
const LABEL_MAX_CHARS = 60;

function wrapText(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > maxChars && cur) {
      lines.push(cur);
      cur = w;
      if (lines.length === maxLines - 1) break;
    } else {
      cur = next;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  // If we truncated, add an ellipsis to the last line.
  const consumed = lines.join(' ').length;
  if (consumed < text.trim().length) {
    lines[lines.length - 1] = `${lines[lines.length - 1]}…`;
  }
  return lines;
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * Fan-out diagram: a seed query on the left branching to a ranked list of
 * related queries on the right. Branch thickness + opacity scale with each
 * query's frequency, so the dominant searches read at a glance.
 *
 * Pure SVG with `fill/stroke="currentColor"` so it inherits text colour and
 * respects dark mode via Tailwind text utilities on the wrapper.
 */
export const FanOutDiagram: React.FC<Props> = ({ seed, items, className = '' }) => {
  const data = useMemo(
    () => [...items].sort((a, b) => b.count - a.count),
    [items],
  );

  if (data.length === 0) return null;

  const maxCount = Math.max(...data.map(d => d.count), 1);
  const height = Math.max(SEED_H + PAD_Y * 2, PAD_Y * 2 + data.length * ROW_H);
  const seedY = height / 2;
  const seedRightX = SEED_X + SEED_W;
  const seedLines = wrapText(seed || '—', 26, 3);

  return (
    <div className={`w-full overflow-x-auto text-gray-700 dark:text-gray-200 ${className}`}>
      <svg
        viewBox={`0 0 ${VIEW_W} ${height}`}
        width="100%"
        height={height}
        preserveAspectRatio="xMinYMid meet"
        role="img"
        aria-label="Fan-out diagram of search queries"
        style={{ minWidth: 640 }}
      >
        {/* branches (drawn first, behind the dots/labels) */}
        {data.map((d, i) => {
          const y = PAD_Y + i * ROW_H + ROW_H / 2;
          const ratio = d.count / maxCount;
          const strokeW = 1.5 + ratio * 4.5;
          const opacity = 0.22 + ratio * 0.78;
          const c1x = seedRightX + 40;
          const c2x = BRANCH_X - 60;
          const path = `M ${seedRightX} ${seedY} C ${c1x} ${seedY}, ${c2x} ${y}, ${BRANCH_X} ${y}`;
          return (
            <path
              key={`p-${i}`}
              d={path}
              fill="none"
              stroke="currentColor"
              strokeWidth={strokeW}
              strokeOpacity={opacity}
              strokeLinecap="round"
            />
          );
        })}

        {/* seed node */}
        <rect
          x={SEED_X}
          y={seedY - SEED_H / 2}
          width={SEED_W}
          height={SEED_H}
          rx={16}
          className="fill-gray-800 dark:fill-gray-900"
        />
        <text
          x={SEED_X + SEED_W / 2}
          y={seedY - SEED_H / 2 + 20}
          textAnchor="middle"
          className="fill-gray-400"
          style={{ fontSize: 10, letterSpacing: 1.5, fontWeight: 600 }}
        >
          SEED QUERY
        </text>
        {seedLines.map((line, li) => (
          <text
            key={`s-${li}`}
            x={SEED_X + SEED_W / 2}
            y={seedY - SEED_H / 2 + 38 + li * 15}
            textAnchor="middle"
            className="fill-white"
            style={{ fontSize: 13, fontWeight: 600 }}
          >
            {line}
          </text>
        ))}

        {/* branch dots + labels + counts */}
        {data.map((d, i) => {
          const y = PAD_Y + i * ROW_H + ROW_H / 2;
          const ratio = d.count / maxCount;
          return (
            <g key={`g-${i}`}>
              <title>{`${d.label} — ${d.count}`}</title>
              <circle
                cx={BRANCH_X}
                cy={y}
                r={4}
                fill="currentColor"
                fillOpacity={0.3 + ratio * 0.7}
              />
              <text
                x={LABEL_X}
                y={y}
                dominantBaseline="middle"
                fill="currentColor"
                style={{ fontSize: 13, fontWeight: i === 0 ? 600 : 400 }}
              >
                {truncate(d.label, LABEL_MAX_CHARS)}
              </text>
              <text
                x={COUNT_X}
                y={y}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-gray-500 dark:fill-gray-400"
                style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums' }}
              >
                {d.count}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};
