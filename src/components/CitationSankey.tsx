// Deterministic Sankey for the Citation Funnel.
//
// recharts' Sankey (d3-style "justify" alignment) pushes every terminal node
// to the rightmost column, so "Absent in Sources" jumped to the far right and
// its ribbon crossed the Citations band. The funnel's structure is fixed and
// tiny (≤9 nodes), so we lay it out by hand: five columns at fixed depths,
// nodes stacked in a crossing-free order, ribbons as cubic bands. Terminal
// stages stay in their own column, exactly like the reference design.

export interface FunnelCounts {
  total: number;
  webSearch: number;
  noSearch: number;
  present: number;
  absent: number;
  cited: number;
  moreOnly: number;
  mainCit: number;
  supporting: number;
}

interface NodeDef { id: string; name: string; v: number; color: string; col: number }

export function CitationSankey({ f }: { f: FunnelCounts }) {
  const W = 1240;
  const H = 460;
  const PADY = 24;
  const NODEW = 12;
  const GAP = 34;
  const LABELW = 205;

  // Column slots; vertical order within a column is chosen so ribbons never
  // cross: each parent's outgoing links go to targets in top-to-bottom order.
  const defs: NodeDef[] = [
    { id: 'all',     name: `All Prompts (${f.total})`,               v: f.total,      color: '#ec4899', col: 0 },
    { id: 'ws',      name: `Web Search Enabled (${f.webSearch})`,    v: f.webSearch,  color: '#ec4899', col: 1 },
    { id: 'ns',      name: `Web Search Disabled (${f.noSearch})`,    v: f.noSearch,   color: '#6b7280', col: 1 },
    { id: 'absent',  name: `Absent in Sources (${f.absent})`,        v: f.absent,     color: '#fbbf24', col: 2 },
    { id: 'present', name: `Present in Sources (${f.present})`,      v: f.present,    color: '#f97316', col: 2 },
    { id: 'cit',     name: `Citations (${f.cited})`,                 v: f.cited,      color: '#38bdf8', col: 3 },
    { id: 'more',    name: `More / Supplemental (${f.moreOnly})`,    v: f.moreOnly,   color: '#fbbf24', col: 3 },
    { id: 'main',    name: `Main Citations (${f.mainCit})`,          v: f.mainCit,    color: '#38bdf8', col: 4 },
    { id: 'supp',    name: `Supporting Citations (${f.supporting})`, v: f.supporting, color: '#60a5fa', col: 4 },
  ].filter(n => n.v > 0);

  const linkDefs: Array<[string, string, number]> = ([
    ['all', 'ws', f.webSearch], ['all', 'ns', f.noSearch],
    ['ws', 'absent', f.absent], ['ws', 'present', f.present],
    ['present', 'cit', f.cited], ['present', 'more', f.moreOnly],
    ['cit', 'main', f.mainCit], ['cit', 'supp', f.supporting],
  ] as Array<[string, string, number]>).filter(l => l[2] > 0);

  if (f.total === 0) return null;

  const usable = H - 2 * PADY - GAP; // room for a 2-node column
  const scale = usable / f.total;
  const colX = (c: number) => 8 + c * ((W - LABELW - 8 - NODEW) / 4);

  // Stack nodes per column, vertically centered.
  const nodes = new Map<string, NodeDef & { x: number; y: number; h: number; inOff: number; outOff: number }>();
  for (let c = 0; c <= 4; c++) {
    const colNodes = defs.filter(n => n.col === c);
    if (colNodes.length === 0) continue;
    const totalH = colNodes.reduce((a, n) => a + Math.max(n.v * scale, 4), 0) + GAP * (colNodes.length - 1);
    let y = (H - totalH) / 2;
    colNodes.forEach(n => {
      const h = Math.max(n.v * scale, 4);
      nodes.set(n.id, { ...n, x: colX(c), y, h, inOff: 0, outOff: 0 });
      y += h + GAP;
    });
  }

  const ribbons = linkDefs.map(([sId, tId, v]) => {
    const s = nodes.get(sId)!;
    const t = nodes.get(tId)!;
    const h = Math.max(v * scale, 3);
    const sy = s.y + s.outOff; s.outOff += h;
    const ty = t.y + t.inOff; t.inOff += h;
    const sx = s.x + NODEW;
    const tx = t.x;
    const mx = (sx + tx) / 2;
    const path = `M ${sx} ${sy} C ${mx} ${sy} ${mx} ${ty} ${tx} ${ty}` +
                 ` L ${tx} ${ty + h} C ${mx} ${ty + h} ${mx} ${sy + h} ${sx} ${sy + h} Z`;
    return { path, s, t, v };
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" role="img">
      {ribbons.map((r, i) => (
        <path key={i} d={r.path} fill={r.s.color} opacity={0.16} className="hover:opacity-30 transition-opacity">
          <title>{`${r.s.name.replace(/ \(\d+\)$/, '')} → ${r.t.name.replace(/ \(\d+\)$/, '')}: ${r.v}`}</title>
        </path>
      ))}
      {Array.from(nodes.values()).map(n => (
        <g key={n.id}>
          <rect x={n.x} y={n.y} width={NODEW} height={n.h} rx={2} fill={n.color}>
            <title>{n.name}</title>
          </rect>
          <text
            x={n.x + NODEW + 8}
            y={n.y + n.h / 2}
            dominantBaseline="middle"
            fontSize={13}
            fontWeight={600}
            className="fill-gray-800 dark:fill-gray-100"
          >
            {n.name}
          </text>
        </g>
      ))}
    </svg>
  );
}
