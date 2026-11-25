import { DIM } from './elements.js';

/** Cytoscape stylesheet built from the CSS theme variables (no hardcoded colors). */
export function canvasStyle(relationshipTypes) {
  const css = getComputedStyle(document.documentElement);
  const v = (name) => css.getPropertyValue(`--${name}`).trim();
  // Cytoscape rejects quoted font names in its stylesheet.
  const mono = v('font-mono').replace(/['"]/g, '');
  const health = (h) => ({ selector: `node[health = "${h}"]`, style: { 'border-color': v(h) } });

  return [
    {
      selector: 'node',
      style: {
        shape: 'round-rectangle',
        width: DIM.width,
        'background-color': v('surface'),
        'border-width': 1,
        'border-color': v('border'),
        color: v('text'),
        'font-family': mono,
        'font-size': 11,
        label: 'data(label)',
        'text-wrap': 'wrap',
        'text-max-width': DIM.width - 20,
        'text-valign': 'center',
        'text-halign': 'center',
        'min-zoomed-font-size': 6,
      },
    },
    {
      selector: 'node.single',
      style: { height: DIM.single, 'border-width': 2, 'background-color': v('surface-2'), 'line-height': 1.5 },
    },
    {
      selector: 'node.compound',
      style: {
        'background-color': v('surface'),
        'background-opacity': 0.92,
        'border-width': 2,
        padding: 0,
        label: '',
        'compound-sizing-wrt-labels': 'exclude',
      },
    },
    {
      selector: 'node.header',
      style: {
        height: DIM.header,
        'background-color': v('surface-2'),
        'border-width': 0,
        'font-size': 11,
        'line-height': 1.5,
        'font-weight': 600,
      },
    },
    {
      selector: 'node.member',
      style: {
        height: DIM.row - 2,
        width: DIM.width - 12,
        'background-opacity': 0,
        'border-width': 0,
        'text-halign': 'center',
        'text-justification': 'left',
        color: v('text-2'),
        'font-size': 11,
      },
    },
    health('good'), health('warning'), health('bad'), health('unreviewed'),
    { selector: 'node.member[health = "warning"]', style: { color: v('warning') } },
    { selector: 'node.member[health = "bad"]', style: { color: v('bad') } },
    { selector: 'node.impl-planned', style: { 'border-style': 'dashed' } },
    { selector: 'node.promoted', style: { 'background-color': v('surface') } },
    { selector: 'node.impl-broken', style: { 'border-style': 'double', 'border-width': 3 } },
    { selector: 'node.member:selected', style: { 'background-opacity': 1, 'background-color': v('surface-2'), color: v('text') } },
    { selector: 'node:selected', style: { 'overlay-color': v('accent'), 'overlay-opacity': 0.12, 'overlay-padding': 3 } },
    { selector: 'node.compound:selected', style: { 'overlay-opacity': 0 } },
    { selector: '.connect-source', style: { 'overlay-color': v('accent'), 'overlay-opacity': 0.3, 'overlay-padding': 4 } },
    { selector: '.dim', style: { opacity: 0.22 } },
    { selector: '.match', style: { 'overlay-color': v('warning'), 'overlay-opacity': 0.25, 'overlay-padding': 4 } },

    {
      selector: 'edge',
      style: {
        width: 1.5,
        'curve-style': 'bezier',
        'target-arrow-shape': 'triangle',
        'arrow-scale': 0.9,
        label: 'data(label)',
        'font-family': mono,
        'font-size': 9,
        color: v('text-2'),
        'text-background-color': v('bg'),
        'text-background-opacity': 0.85,
        'text-background-padding': 2,
        'text-rotation': 'autorotate',
        'min-zoomed-font-size': 7,
      },
    },
    ...relationshipTypes.map((t) => ({
      selector: `edge.rel-${t}`,
      style: { 'line-color': v(`rel-${t}`), 'target-arrow-color': v(`rel-${t}`) },
    })),
    { selector: 'edge.rel-inherits', style: { 'target-arrow-shape': 'triangle', 'target-arrow-fill': 'hollow', 'arrow-scale': 1.3 } },
    { selector: 'edge.rel-implements', style: { 'line-style': 'dashed', 'target-arrow-fill': 'hollow', 'arrow-scale': 1.3 } },
    { selector: 'edge.rel-depends_on', style: { 'line-style': 'dashed' } },
    { selector: 'edge.rel-signal', style: { 'line-style': 'dotted', width: 2 } },
    { selector: 'edge.rel-references', style: { width: 1 } },
    { selector: 'edge:selected', style: { width: 3, 'overlay-color': v('accent'), 'overlay-opacity': 0.15 } },
    { selector: 'edge.ghost', style: { events: 'no', 'line-style': 'dashed', 'line-color': v('accent'), 'target-arrow-color': v('accent'), label: '' } },
    { selector: 'node.ghost', style: { events: 'no', width: 1, height: 1, opacity: 0, label: '' } },
  ];
}
