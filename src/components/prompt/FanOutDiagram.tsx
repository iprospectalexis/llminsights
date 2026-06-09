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
const PAD_Y = 18;
const SEED_X = 8;
const SEED_W = 236;
const SEED_LINE_H = 16;     // line height for wrapped seed text
const SEED_TOP_PAD = 30;    // room for the "PROMPT" label above seed lines
const SEED_BOT_PAD = 16;
const BRANCH_X = 300;       // x of the branch dots
const LABEL_X = 314;        // x where branch labels start
const COUNT_X = VIEW_W - 12; // right-aligned count
const BR_LINE_H = 16;       // line height for wrapped branch labels
const BR_ROW_PAD = 14;      // vertical padding inside a branch row
const MIN_ROW_H = 30;
const SEED_WRAP = 26;       // chars per seed line
const BRANCH_WRAP = 72;     // chars per branch line

// Branch colour gradient (top → bottom). Rendered as a single vertical
// SVG gradient in user space, so each curve picks up the colour at its
// vertical position — the fan sweeps the full spectrum.
const PALETTE = [
  '#f72585', // neon pink
  '#b5179e', // raspberry plum
  '#7209b7', // indigo bloom
  '#560bad', // ultrasonic blue
  '#480ca8', // true azure
  '#3a0ca3', // vivid royal
  '#3f37c9', // bright indigo
  '#4361ee', // electric sapphire
  '#4895ef', // blue energy
  '#4cc9f0', // sky aqua
];
const GRADIENT_ID = 'fanoutGradient';

/** Greedy word-wrap into lines of at most `maxChars`. No truncation. */
function wrapText(text: string, maxChars: number): string[] {
  const words = (text || '—').trim().split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > maxChars && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : ['—'];
}

/**
 * Fan-out diagram: a seed query on the left branching to a ranked list of
 * related queries on the right. Branch thickness + colour scale with each
 * query's frequency / position, so the dominant searches read at a glance.
 *
 * Full text is shown — both the prompt and every branch label wrap onto as
 * many lines as needed (no truncation); the node and rows grow to fit.
 */
export const FanOutDiagram: React.FC<Props> = ({ seed, items, className = '' }) => {
  const data = useMemo(
    () => [...items].sort((a, b) => b.count - a.count),
    [items],
  );

  // Pre-compute wrapped seed lines + node height.
  const seedLines = useMemo(() => wrapText(seed, SEED_WRAP), [seed]);
  const seedNodeH = SEED_TOP_PAD + seedLines.length * SEED_LINE_H + SEED_BOT_PAD;

  // Lay out branches top-to-bottom with per-row heights based on wrapping.
  const layout = useMemo(() => {
    let y = PAD_Y;
    const rows = data.map(d => {
      const lines = wrapText(d.label, BRANCH_WRAP);
      const h = Math.max(MIN_ROW_H, lines.length * BR_LINE_H + BR_ROW_PAD);
      const top = y;
      const centerY = y + h / 2;
      y += h;
      return { ...d, lines, centerY };
    });
    return { rows, bottom: y };
  }, [data]);

  if (data.length === 0) return null;

  const maxCount = Math.max(...data.map(d => d.count), 1);
  const height = Math.max(seedNodeH + PAD_Y * 2, layout.bottom + PAD_Y);
  const seedY = height / 2;
  const seedRightX = SEED_X + SEED_W;
  const seedTopY = seedY - seedNodeH / 2;

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
        <defs>
          <linearGradient
            id={GRADIENT_ID}
            gradientUnits="userSpaceOnUse"
            x1="0"
            y1={PAD_Y}
            x2="0"
            y2={height - PAD_Y}
          >
            {PALETTE.map((c, i) => (
              <stop key={c} offset={`${(i / (PALETTE.length - 1)) * 100}%`} stopColor={c} />
            ))}
          </linearGradient>
        </defs>

        {/* branches (drawn first, behind the dots/labels) */}
        {layout.rows.map((d, i) => {
          const ratio = d.count / maxCount;
          const strokeW = 0.75 + ratio * 2.25;
          const opacity = 0.55 + ratio * 0.45;
          const c1x = seedRightX + 40;
          const c2x = BRANCH_X - 60;
          const path = `M ${seedRightX} ${seedY} C ${c1x} ${seedY}, ${c2x} ${d.centerY}, ${BRANCH_X} ${d.centerY}`;
          return (
            <path
              key={`p-${i}`}
              d={path}
              fill="none"
              stroke={`url(#${GRADIENT_ID})`}
              strokeWidth={strokeW}
              strokeOpacity={opacity}
              strokeLinecap="round"
            />
          );
        })}

        {/* seed (prompt) node */}
        <rect
          x={SEED_X}
          y={seedTopY}
          width={SEED_W}
          height={seedNodeH}
          rx={16}
          fill="#560bad"
        />
        <text
          x={SEED_X + SEED_W / 2}
          y={seedTopY + 18}
          textAnchor="middle"
          className="fill-purple-200"
          style={{ fontSize: 10, letterSpacing: 1.5, fontWeight: 600 }}
        >
          PROMPT
        </text>
        {seedLines.map((line, li) => (
          <text
            key={`s-${li}`}
            x={SEED_X + SEED_W / 2}
            y={seedTopY + SEED_TOP_PAD + 6 + li * SEED_LINE_H}
            textAnchor="middle"
            className="fill-white"
            style={{ fontSize: 13, fontWeight: 600 }}
          >
            {line}
          </text>
        ))}

        {/* branch dots + labels + counts */}
        {layout.rows.map((d, i) => {
          const ratio = d.count / maxCount;
          const firstLineY = d.centerY - ((d.lines.length - 1) * BR_LINE_H) / 2;
          return (
            <g key={`g-${i}`}>
              <title>{`${d.label} — ${d.count}`}</title>
              <circle
                cx={BRANCH_X}
                cy={d.centerY}
                r={4}
                fill={`url(#${GRADIENT_ID})`}
                fillOpacity={0.6 + ratio * 0.4}
              />
              {d.lines.map((line, li) => (
                <text
                  key={`l-${i}-${li}`}
                  x={LABEL_X}
                  y={firstLineY + li * BR_LINE_H}
                  dominantBaseline="middle"
                  fill="currentColor"
                  style={{ fontSize: 13, fontWeight: i === 0 ? 600 : 400 }}
                >
                  {line}
                </text>
              ))}
              <text
                x={COUNT_X}
                y={d.centerY}
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
