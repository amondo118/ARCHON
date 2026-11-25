import cytoscape from '/vendor/cytoscape/cytoscape.esm.min.mjs';
import { buildElements, autoPlace, rowOffset, rootHeight, DIM } from './elements.js';
import { canvasStyle } from './style.js';

/**
 * Architecture canvas controller. Owns the Cytoscape instance; knows nothing
 * about the API. Data comes in through `getData()`, user intent goes out
 * through callbacks.
 *
 * callbacks: onSelect(objId|null), onEdgeTap(relIds), onConnect(sourceId, targetId),
 *            onMove([[objId, {x,y}]]), onAutoPlace([[objId, {x,y}]]), onToggleCollapse(objId),
 *            onContextMenu(objId, renderedPos)
 */
export function createCanvas(container, { getData, relationshipTypes, ...cb }) {
  const cy = cytoscape({
    container,
    style: canvasStyle(relationshipTypes),
    minZoom: 0.1,
    maxZoom: 3,
    boxSelectionEnabled: true, // shift + drag
    selectionType: 'single',
  });

  let signature = '';
  let repOf = () => null;
  let roots = [];
  let connectFrom = null;
  let dragGroup = null;

  const objIdOf = (ele) => ele.data('objId');
  const rootIdOf = (node) => (node.isParent() ? node.id() : node.data('parent') ?? node.id());
  const anchorOf = (rootId) => {
    const hdr = cy.getElementById(`hdr:${rootId}`);
    const n = hdr.nonempty() ? hdr : cy.getElementById(rootId);
    return { x: Math.round(n.position('x')), y: Math.round(n.position('y')) };
  };

  // ---------------------------------------------------------------- sync
  function sync() {
    const data = getData();
    let built = buildElements(data);
    const placed = autoPlace(built.roots);
    if (placed.length) {
      cb.onAutoPlace(placed); // persists and updates data.positions
      built = buildElements(getData());
    }
    repOf = built.repOf;
    roots = built.roots;

    const sig = built.nodes.map((n) => `${n.data.id}>${n.data.parent ?? ''}`).join(',');
    cy.batch(() => {
      if (sig !== signature) {
        cy.elements().remove();
        cy.add(built.nodes);
      } else {
        for (const n of built.nodes) {
          const ele = cy.getElementById(n.data.id);
          ele.data(n.data);
          ele.classes(n.classes);
          if (n.position && !ele.grabbed()) ele.position(n.position);
        }
        cy.edges().remove();
      }
      cy.add(built.edges);
    });
    signature = sig;
  }

  // ---------------------------------------------------------------- selection
  function select(objId) {
    cy.elements(':selected').unselect();
    if (!objId) return;
    const rep = repOf(objId);
    if (!rep) return;
    const node = cy.getElementById(rep);
    const target = node.isParent() ? cy.getElementById(`hdr:${rep}`) : node;
    target.select();
  }

  function focus(objId) {
    const rep = repOf(objId);
    if (!rep) return false;
    const node = cy.getElementById(rep);
    cy.animate({ center: { eles: node }, zoom: Math.max(cy.zoom(), 0.9) }, { duration: 250 });
    return true;
  }

  // ---------------------------------------------------------------- events
  cy.on('tap', 'node', (e) => {
    const node = e.target;
    if (node.hasClass('ghost')) return;
    if (node.isParent()) {
      // Clicking the card background selects the card's object.
      cy.getElementById(`hdr:${node.id()}`).select();
    }
    const id = objIdOf(node);
    if (connectFrom) return finishConnect(id);
    cb.onSelect(id);
  });
  cy.on('tap', 'edge', (e) => {
    if (e.target.hasClass('ghost')) return;
    if (!connectFrom) cb.onEdgeTap(e.target.data('relIds'));
  });
  cy.on('tap', (e) => {
    if (e.target === cy) {
      if (connectFrom) return cancelConnect();
      cb.onSelect(null);
    }
  });
  cy.on('dbltap', 'node', (e) => {
    const root = rootIdOf(e.target);
    if (e.target.data('kind') === 'member') return; // double-click on a row: just select
    cb.onToggleCollapse(root);
  });
  cy.on('cxttap', 'node', (e) => {
    if (e.target.hasClass('ghost')) return;
    cb.onContextMenu(objIdOf(e.target), e.renderedPosition, rootIdOf(e.target));
  });

  // Dragging any row of a card moves the whole card.
  cy.on('grab', 'node', (e) => {
    const node = e.target;
    const parent = node.parent();
    if (parent.nonempty()) {
      dragGroup = { grabbed: node.id(), start: new Map(parent.children().map((c) => [c.id(), { ...c.position() }])) };
    }
  });
  cy.on('drag', 'node', (e) => {
    const node = e.target;
    if (!dragGroup || node.id() !== dragGroup.grabbed) return;
    const s = dragGroup.start.get(node.id());
    const dx = node.position('x') - s.x;
    const dy = node.position('y') - s.y;
    node.parent().children().forEach((c) => {
      if (c.id() === node.id()) return;
      const p = dragGroup.start.get(c.id());
      c.position({ x: p.x + dx, y: p.y + dy });
    });
  });
  let moved = new Set();
  cy.on('dragfree', 'node', (e) => {
    dragGroup = null;
    moved.add(rootIdOf(e.target));
    queueMicrotask(() => {
      if (!moved.size) return;
      const entries = [...moved].filter((id) => cy.getElementById(id).nonempty()).map((id) => [id, anchorOf(id)]);
      moved = new Set();
      cb.onMove(entries);
    });
  });

  // ---------------------------------------------------------------- connect mode
  let modeListener = null;
  function setConnectMode(on, onModeChange) {
    modeListener = onModeChange ?? modeListener;
    if (!on) return cancelConnect();
    connectFrom = connectFrom ?? 'pending';
    modeListener?.(true, null);
  }
  function startConnectFrom(objId) {
    cancelConnect(false);
    beginConnect(objId);
  }
  function beginConnect(objId) {
    connectFrom = objId;
    const rep = repOf(objId);
    const src = cy.getElementById(rep);
    src.addClass('connect-source');
    const ghost = cy.add({ group: 'nodes', data: { id: '__ghost' }, classes: 'ghost', position: { ...src.position() } });
    ghost.ungrabify();
    cy.add({ group: 'edges', data: { id: '__ghostEdge', source: rep, target: '__ghost' }, classes: 'ghost' });
    modeListener?.(true, objId);
  }
  function finishConnect(targetId) {
    if (connectFrom === 'pending') return beginConnect(targetId);
    const source = connectFrom;
    cancelConnect();
    if (source && targetId && source !== targetId) cb.onConnect(source, targetId);
  }
  function cancelConnect(notify = true) {
    connectFrom = null;
    cy.remove('#__ghost, #__ghostEdge');
    cy.$('.connect-source').removeClass('connect-source');
    if (notify) modeListener?.(false, null);
  }
  cy.on('mousemove', (e) => {
    if (connectFrom && connectFrom !== 'pending') cy.getElementById('__ghost').position(e.position);
  });

  // ---------------------------------------------------------------- search highlight
  function highlight(predicate) {
    cy.batch(() => {
      cy.elements().removeClass('dim match');
      if (!predicate) return;
      const hits = cy.nodes().filter((n) => n.data('objId') && predicate(n.data('objId')));
      cy.elements().not(hits).not(hits.parents()).addClass('dim');
      hits.addClass('match');
    });
  }

  // ---------------------------------------------------------------- layout
  /**
   * Arrange root cards with a force layout computed on a headless copy, so
   * each card moves as a unit (children keep their stacked rows).
   */
  function autoLayout() {
    const headless = cytoscape({
      headless: true,
      styleEnabled: true,
      style: [{ selector: 'node', style: { width: 'data(w)', height: 'data(h)' } }],
      elements: [
        ...roots.map((r) => ({ data: { id: r.id, w: DIM.width, h: rootHeight(r.rows) } })),
        ...cy.edges().not('.ghost').map((e) => ({ data: { id: e.id(), source: e.source().data('parent') ?? e.source().id(), target: e.target().data('parent') ?? e.target().id() } }))
          .filter((e) => e.data.source !== e.data.target),
      ],
    });
    const hasEdges = headless.edges().nonempty();
    headless.layout(hasEdges
      ? { name: 'cose', animate: false, nodeRepulsion: () => 400000, idealEdgeLength: () => 140, nodeOverlap: 40, padding: 40, randomize: false }
      : { name: 'grid', avoidOverlap: true, avoidOverlapPadding: 60 }).run();
    const entries = roots.map((r) => {
      const c = headless.getElementById(r.id).position();
      const h = rootHeight(r.rows);
      // Convert box center to anchor (header center for cards).
      const y = r.rows ? c.y - h / 2 + DIM.header / 2 : c.y;
      return [r.id, { x: Math.round(c.x), y: Math.round(y) }];
    });
    headless.destroy();
    cb.onMove(entries);
    sync();
    cy.fit(undefined, 40);
  }

  return {
    cy,
    sync,
    select,
    focus,
    highlight,
    autoLayout,
    setConnectMode,
    startConnectFrom,
    cancelConnect,
    fit: () => cy.fit(undefined, 40),
    zoomBy: (f) => cy.zoom({ level: cy.zoom() * f, renderedPosition: { x: container.clientWidth / 2, y: container.clientHeight / 2 } }),
    rowOffset,
    destroy: () => cy.destroy(),
  };
}
