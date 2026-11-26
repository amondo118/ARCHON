import cytoscape from '/vendor/cytoscape/cytoscape.esm.min.mjs';
import { buildElements, autoPlace, rowOffset, rootHeight, DIM } from './elements.js';
import { canvasStyle } from './style.js';

/**
 * Architecture canvas controller. Owns the Cytoscape instance; knows nothing
 * about the API. Data comes in through `getData()`, user intent goes out
 * through callbacks.
 *
 * callbacks: onSelectionChange(objIds, primaryId), onEdgeTap(relIds), onConnect(sourceId, targetId),
 *            onMove([[objId, {x,y}]]), onAutoPlace([[objId, {x,y}]]), onToggleCollapse(objId),
 *            onContextMenu(objId, renderedPos)
 */
export function createCanvas(container, { getData, relationshipTypes, ...cb }) {
  const cy = cytoscape({
    container,
    style: canvasStyle(relationshipTypes),
    minZoom: 0.1,
    maxZoom: 3,
    boxSelectionEnabled: true, // shift + drag on the background
    selectionType: 'single', // Shift/Ctrl/Cmd + click adds to the selection
  });

  let signature = '';
  let repOf = () => null;
  let roots = [];
  let connectFrom = null;
  let dragGroup = null;
  let applyingSelection = false;
  let lastTapped = null;

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
      cy.nodes('.compound').unselectify(); // cards are selected through their header row
    });
    signature = sig;
    updatePorts();
  }

  // ---------------------------------------------------------------- ports
  /**
   * Edges touching a member row attach to a dot on the row's left or right
   * side, whichever faces the other end of the edge.
   */
  function updatePorts() {
    cy.batch(() => {
      const sides = new Map(); // member node id -> Set('l'|'r')
      cy.edges().not('.ghost').forEach((e) => {
        const s = e.source();
        const t = e.target();
        e.removeClass('src-l src-r tgt-l tgt-r');
        if (s.data('kind') === 'member') {
          const side = t.position('x') >= s.position('x') ? 'r' : 'l';
          e.addClass(`src-${side}`);
          if (!sides.has(s.id())) sides.set(s.id(), new Set());
          sides.get(s.id()).add(side);
        }
        if (t.data('kind') === 'member') {
          const side = s.position('x') >= t.position('x') ? 'r' : 'l';
          e.addClass(`tgt-${side}`);
          if (!sides.has(t.id())) sides.set(t.id(), new Set());
          sides.get(t.id()).add(side);
        }
      });
      cy.nodes('.member').forEach((n) => {
        n.removeClass('ports-l ports-r ports-lr');
        const set = sides.get(n.id());
        if (set) n.addClass(`ports-${set.has('l') ? 'l' : ''}${set.has('r') ? 'r' : ''}`);
      });
    });
  }
  let portFrame = 0;
  const schedulePorts = () => {
    if (!portFrame) portFrame = requestAnimationFrame(() => { portFrame = 0; updatePorts(); });
  };

  // ---------------------------------------------------------------- selection
  /** Mirror the store's selection on the canvas (without echoing it back). */
  function select(objIds) {
    applyingSelection = true;
    cy.batch(() => {
      cy.elements(':selected').unselect();
      for (const id of objIds ?? []) {
        const rep = repOf(id);
        if (!rep) continue;
        const node = cy.getElementById(rep);
        // Visible rows select themselves; hidden members select their card.
        const exact = cy.getElementById(id);
        const target = exact.nonempty() && !exact.isParent() ? exact
          : node.isParent() ? cy.getElementById(`hdr:${rep}`) : node;
        target.select();
      }
    });
    applyingSelection = false;
  }

  const selectedObjIds = () => [...new Set(cy.nodes(':selected').map((n) => n.data('objId')).filter(Boolean))];
  let selectionQueued = false;
  cy.on('select unselect', () => {
    if (applyingSelection || selectionQueued) return;
    selectionQueued = true;
    queueMicrotask(() => {
      selectionQueued = false;
      const ids = selectedObjIds();
      cb.onSelectionChange(ids, ids.includes(lastTapped) ? lastTapped : null);
    });
  });

  function focus(objId) {
    const rep = repOf(objId);
    if (!rep) return false;
    const node = cy.getElementById(rep);
    cy.animate({ center: { eles: node }, zoom: Math.max(cy.zoom(), 0.9) }, { duration: 250 });
    return true;
  }

  // ---------------------------------------------------------------- events
  const additive = (e) => {
    const o = e.originalEvent;
    return Boolean(o && (o.shiftKey || o.ctrlKey || o.metaKey));
  };
  // Cytoscape's own dbltap fires for two quick clicks on *different* nodes,
  // which made fast multi-selection collapse cards. Detect it ourselves.
  let prevTap = { id: null, t: 0 };
  cy.on('tap', 'node', (e) => {
    const node = e.target;
    if (node.hasClass('ghost')) return;
    const id = objIdOf(node);
    if (connectFrom) return finishConnect(id);
    const now = e.timeStamp || Date.now();
    const isDouble = prevTap.id === node.id() && now - prevTap.t < 350 && !additive(e);
    prevTap = isDouble ? { id: null, t: 0 } : { id: node.id(), t: now };
    if (isDouble && node.data('kind') !== 'member') cb.onToggleCollapse(rootIdOf(node));
    lastTapped = id;
    if (node.isParent()) {
      // Clicking the card background selects the card (via its header row).
      const hdr = cy.getElementById(`hdr:${node.id()}`);
      if (!additive(e)) cy.elements(':selected').not(hdr).unselect();
      if (additive(e) && hdr.selected()) hdr.unselect(); else hdr.select();
    }
  });
  cy.on('tap', 'edge', (e) => {
    if (e.target.hasClass('ghost')) return;
    if (!connectFrom) cb.onEdgeTap(e.target.data('relIds'));
  });
  cy.on('tap', (e) => {
    if (e.target === cy) {
      if (connectFrom) cancelConnect();
    }
  });
  cy.on('cxttap', 'node', (e) => {
    if (e.target.hasClass('ghost')) return;
    cb.onContextMenu(objIdOf(e.target), e.renderedPosition, rootIdOf(e.target));
  });

  // Dragging moves whole cards: every row of the grabbed card, plus every other
  // selected card or node when the grabbed one is part of the selection.
  const rootNodes = (rootId) => {
    const n = cy.getElementById(rootId);
    return n.isParent() ? n.children() : n;
  };
  cy.on('grab', 'node', (e) => {
    const node = e.target;
    if (node.hasClass('ghost')) return;
    const grabbedRoot = rootIdOf(node);
    const rootIds = new Set([grabbedRoot]);
    const grabbedSelected = node.selected() || cy.getElementById(`hdr:${grabbedRoot}`).selected();
    if (grabbedSelected) cy.nodes(':selected').forEach((n) => rootIds.add(rootIdOf(n)));
    const start = new Map();
    for (const r of rootIds) rootNodes(r).forEach((n) => start.set(n.id(), { ...n.position() }));
    // A grabbed compound moves its own children; don't fight Cytoscape over them.
    if (node.isParent()) node.children().forEach((c) => start.delete(c.id()));
    dragGroup = { grabbed: node.id(), origin: { ...node.position() }, start, rootIds };
  });
  cy.on('drag', 'node', (e) => {
    const node = e.target;
    if (!dragGroup || node.id() !== dragGroup.grabbed) return;
    const dx = node.position('x') - dragGroup.origin.x;
    const dy = node.position('y') - dragGroup.origin.y;
    for (const [id, p] of dragGroup.start) {
      if (id !== node.id()) cy.getElementById(id).position({ x: p.x + dx, y: p.y + dy });
    }
    schedulePorts();
  });
  let moved = new Set();
  cy.on('dragfree', 'node', (e) => {
    if (dragGroup) {
      dragGroup.rootIds.forEach((r) => moved.add(r));
      dragGroup = null;
    } else {
      moved.add(rootIdOf(e.target));
    }
    queueMicrotask(() => {
      if (!moved.size) return;
      const entries = [...moved].filter((id) => cy.getElementById(id).nonempty()).map((id) => [id, anchorOf(id)]);
      moved = new Set();
      updatePorts();
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
