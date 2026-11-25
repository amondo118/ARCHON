/**
 * Pure translation of architecture data into Cytoscape elements.
 *
 * Hybrid representation rules:
 *  - "Root" nodes are top-level objects plus promoted children (a child with
 *    its own canvas position).
 *  - An expanded root with children is a compound node: a header row plus one
 *    row per (non-promoted) child, stacked under the stored anchor position.
 *  - A collapsed root, or one without children, is a single summary node.
 *  - A relationship whose endpoint is hidden is drawn to the nearest visible
 *    ancestor; parallel edges of the same type are merged with a count.
 */
export const DIM = { width: 230, header: 40, row: 24, rowGap: 6, single: 54 };

const GLYPH = { method: 'ƒ', property: '◇', signal: '⚡', event: '◆', function: 'ƒ' };
const FLAG = { warning: ' [!]', bad: ' [x]' };

export function rowOffset(i) {
  return DIM.header / 2 + DIM.rowGap + DIM.row / 2 + i * DIM.row;
}

/** Height of a root's box, used for auto placement and layout. */
export function rootHeight(rowCount) {
  return rowCount ? DIM.header + DIM.rowGap * 2 + rowCount * DIM.row : DIM.single;
}

export function buildElements({ objects, relationships, positions, moduleIds, hiddenRelTypes }) {
  const childrenOf = new Map();
  for (const o of objects.values()) {
    if (!o.parent_id) continue;
    if (!childrenOf.has(o.parent_id)) childrenOf.set(o.parent_id, []);
    childrenOf.get(o.parent_id).push(o);
  }
  for (const list of childrenOf.values()) list.sort((a, b) => a.sort_order - b.sort_order);

  const inScope = (o) => !moduleIds || moduleIds.has(o.module_id);
  const isRoot = (o) => inScope(o) && (!o.parent_id || positions.has(o.id));

  const nodes = [];
  const roots = []; // { id, anchor, rows }
  const visible = new Set();

  for (const o of objects.values()) {
    if (!isRoot(o)) continue;
    const kids = (childrenOf.get(o.id) ?? []).filter((k) => !positions.has(k.id));
    const pos = positions.get(o.id);
    const expanded = kids.length > 0 && !pos?.collapsed;
    const anchor = pos ? { x: pos.x, y: pos.y } : null;
    const promoted = Boolean(o.parent_id);
    roots.push({ id: o.id, anchor, rows: expanded ? kids.length : 0 });
    visible.add(o.id);

    const allKids = childrenOf.get(o.id)?.length ?? 0;
    const status = `${o.type} · ${o.health_status.toUpperCase()}`;
    if (expanded) {
      nodes.push({ data: { id: o.id, objId: o.id, kind: 'compound', health: o.health_status }, classes: 'compound' });
      nodes.push({
        data: { id: `hdr:${o.id}`, parent: o.id, objId: o.id, kind: 'header', health: o.health_status,
          label: `${o.name}\n${status}` },
        position: anchor ? { ...anchor } : undefined,
        classes: `header ${promoted ? 'promoted' : ''}`,
      });
      kids.forEach((k, i) => {
        visible.add(k.id);
        nodes.push({
          data: { id: k.id, parent: o.id, objId: k.id, kind: 'member', health: k.health_status,
            label: `${GLYPH[k.type] ?? '▣'} ${k.name}${FLAG[k.health_status] ?? ''}` },
          position: anchor ? { x: anchor.x, y: anchor.y + rowOffset(i) } : undefined,
          classes: `member impl-${k.implementation_status}`,
        });
      });
    } else {
      const summary = allKids ? ` · ${allKids} member${allKids === 1 ? '' : 's'}` : '';
      nodes.push({
        data: { id: o.id, objId: o.id, kind: 'single', health: o.health_status,
          label: `${promoted ? '↳ ' : ''}${o.name}${FLAG[o.health_status] ?? ''}\n${status}${summary}` },
        position: anchor ? { ...anchor } : undefined,
        classes: `single ${promoted ? 'promoted' : ''} impl-${o.implementation_status}`,
      });
    }
  }

  const repOf = (id) => {
    for (let o = objects.get(id); o; o = objects.get(o.parent_id)) if (visible.has(o.id)) return o.id;
    return null;
  };

  const merged = new Map();
  for (const r of relationships.values()) {
    if (hiddenRelTypes?.has(r.type)) continue;
    const s = repOf(r.source_id);
    const t = repOf(r.target_id);
    if (!s || !t || s === t) continue;
    const key = `${s}|${t}|${r.type}`;
    const e = merged.get(key);
    if (e) e.relIds.push(r.id);
    else merged.set(key, { s, t, type: r.type, relIds: [r.id] });
  }
  const edges = [...merged.entries()].map(([key, e]) => ({
    data: {
      id: `e:${key}`, source: e.s, target: e.t, type: e.type, relIds: e.relIds,
      label: e.relIds.length > 1 ? `${e.type.replace('_', ' ')} ×${e.relIds.length}` : e.type.replace('_', ' '),
    },
    classes: `rel-${e.type}`,
  }));

  return { nodes, edges, roots, repOf };
}

/** Packs unplaced roots into columns below everything already placed. */
export function autoPlace(roots) {
  const placed = roots.filter((r) => r.anchor);
  const unplaced = roots.filter((r) => !r.anchor);
  if (!unplaced.length) return [];
  let baseY = 0;
  let minX = 0;
  if (placed.length) {
    baseY = Math.max(...placed.map((r) => r.anchor.y + rootHeight(r.rows))) + 120;
    minX = Math.min(...placed.map((r) => r.anchor.x));
  }
  const cols = Math.max(1, Math.ceil(Math.sqrt(unplaced.length * 1.5)));
  const heights = new Array(cols).fill(0);
  return unplaced.map((r) => {
    const c = heights.indexOf(Math.min(...heights));
    const anchor = { x: minX + c * (DIM.width + 90), y: baseY + heights[c] };
    heights[c] += rootHeight(r.rows) + 70;
    r.anchor = anchor;
    return [r.id, anchor];
  });
}
