/**
 * MapManager.js — Dungeon's Descent
 *
 * Owns the entire meta-progression layer between the lobby and a battle:
 *   • Map generation (procedural node graph, columns 0–6)
 *   • Map screen rendering (SVG edges + DOM node cards)
 *   • Node entry routing  (combat → CombatManager, encounter / shop → local)
 *   • Encounter overlay   (random event titles, choice buttons, result)
 *   • Shop overlay        (5-item store, buy logic)
 *   • Screen transitions  (backToMap, goLobby)
 *
 * Relationship to LobbyManager
 * ─────────────────────────────
 * LobbyManager owns the lobby screen (class, spellbook, skill tree, start-run).
 * MapManager owns everything that happens after "Enter Dungeon" is clicked —
 * the map screen, encounters, and shop — through to the moment CombatManager
 * takes over for a battle.  The two modules do NOT import each other.
 * Navigation events ('nav:goLobby', 'nav:backToMap') on `document` are the
 * handshake between them.
 *
 * Dependencies (no circular deps)
 * ────────────────────────────────
 *   GameState    — persist reads, run reads / mutators
 *   DataConfig   — getRandomEncounter, rollItems
 *   CombatManager — startBattle()           [combat nodes only]
 *   UIManager    — setNodeTypeLabel()       [topbar label]
 *
 * Outbound events fired on `document`
 * ────────────────────────────────────
 *   'nav:goLobby'   — consumed by LobbyManager.goLobby()
 *   'nav:backToMap' — consumed internally (also by CombatManager post-win)
 *   'combat:goldChanged' — consumed by UIManager
 *
 * Public API
 * ──────────
 *   init(canvas)       — wire DOM, subscribe to events; call once at startup
 *   enterMap()         — show the map screen (called from LobbyManager.startRun)
 *   backToMap()        — return to map after encounter / shop / battle
 *   goLobby()          — navigate to lobby (resets run state)
 *   finishEncounter()  — "Continue →" button on encounter result
 *   closeStore()       — "Leave Store" button
 */

import * as GS  from './GameState.js';
import * as DC  from './DataConfig.js';
import * as CM  from './CombatManager.js';
import * as UI  from './UIManager.js';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/** Pixel X positions for each column (0 = start camp, 6 = boss). */
const COL_X = [40, 140, 240, 340, 440, 560, 700];
/** Pixel Y positions for the three row slots. */
const ROW_Y = [60, 160, 260];

const NODE_ICONS  = Object.freeze({
  start: '🏕', clear: '⚔', encounter: '?', boss: '💀', shop: '🏪',
});
const NODE_LABELS = Object.freeze({
  start: 'Camp', clear: 'Combat', encounter: 'Event', boss: 'BOSS', shop: 'Shop',
});

// ─────────────────────────────────────────────────────────────────────────────
// MODULE STATE
// ─────────────────────────────────────────────────────────────────────────────

/** @type {HTMLCanvasElement} */
let _canvas = null;

/**
 * Shop stock for the current shop node.
 * Each entry is an ItemDef + { sold: boolean }.
 * @type {Array<import('./DataConfig.js').ItemDef & { sold: boolean }>}
 */
let _storeItems = [];

// ─────────────────────────────────────────────────────────────────────────────
// DOM HELPER
// ─────────────────────────────────────────────────────────────────────────────

/** @param {string} id @returns {HTMLElement} */
const $ = id => document.getElementById(id);

function _show(id, display = 'flex') { $(id).style.display = display; }
function _hide(id)                   { $(id).style.display = 'none';  }

function _hideAll(...ids) { ids.forEach(_hide); }

// ─────────────────────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wire button handlers and subscribe to cross-module navigation events.
 * Call once after the DOM is ready.
 *
 * @param {HTMLCanvasElement} canvas — main game canvas (passed to CombatManager)
 */
export function init(canvas) {
  _canvas = canvas;

  // Encounter "Continue →" button
  $('enc-continue-btn').addEventListener('click', finishEncounter);

  // Shop "Leave Store" button
  $('store-close-btn').addEventListener('click', closeStore);

  // Inventory close
  $('inv-close-btn').addEventListener('click', () => _hide('inv-overlay'));

  // Navigation events from CombatManager / result overlays
  document.addEventListener('nav:backToMap', backToMap);
  document.addEventListener('nav:goLobby',   goLobby);

  // Gold label refresh (shop purchase, combat gold steal, etc.)
  document.addEventListener('combat:goldChanged', _refreshGoldLabel);
}

// ─────────────────────────────────────────────────────────────────────────────
// MAP GENERATION
// ─────────────────────────────────────────────────────────────────────────────

/** Fisher-Yates shuffle (returns a new array). */
const _shuffle = a => {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = ~~(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
};

/**
 * Determine node type for a content column slot.
 * Middle node of column 3 is always a guaranteed shop.
 * @param {number} col  1–5
 * @param {number} row  0–2
 * @returns {'clear'|'encounter'|'shop'}
 */
function _typePool(col, row) {
  if (col === 3 && row === 1) return 'shop';
  const r = Math.random();
  return r < 0.12 ? 'shop' : r < 0.42 ? 'encounter' : 'clear';
}

/**
 * Generate a fresh node graph and store it in GameState.
 * Called by enterMap() at the start of each run.
 *
 * Algorithm
 * ─────────
 *   Col 0:       start camp (always row 1)
 *   Cols 1–5:    content nodes (2 or 3 rows depending on column)
 *   Col 6:       boss (always row 1)
 *   Edges:       each node connects to 1–2 adjacently-rowed nodes in the next col.
 *   Orphan fix:  after edge generation, any node with no incoming edge gets
 *                force-connected from the nearest node in the previous column.
 *
 * @returns {import('./GameState.js').MapNode[]}
 */
export function generateMap() {
  /** @type {import('./GameState.js').MapNode[]} */
  const nodes = [];

  // Start node
  nodes.push({
    id: 0, col: 0, row: 1, type: 'start',
    x: COL_X[0], y: ROW_Y[1], next: [],
  });

  let id = 1;

  /** @type {number[][]} — colNodes[c] = array of node ids at column c+1 */
  const colNodes = [];

  // Content columns 1–5
  for (let c = 1; c <= 5; c++) {
    // Cols 2 and 3 get a middle row; others get only top and bottom
    const rows = (c === 2 || c === 3) ? [0, 1, 2] : [0, 2];
    const used = [];
    rows.forEach(r => {
      nodes.push({
        id, col: c, row: r, type: _typePool(c, r),
        x: COL_X[c], y: ROW_Y[r], next: [],
      });
      used.push(id++);
    });
    colNodes.push(used);
  }

  // Boss node
  const bossId = id;
  nodes.push({
    id: bossId, col: 6, row: 1, type: 'boss',
    x: COL_X[6], y: ROW_Y[1], next: [],
  });

  // ── Edges: start → col 1 ────────────────────────────────────────
  colNodes[0].forEach(nid => nodes[0].next.push(nid));

  // ── Edges: col c → col c+1 (branching) ─────────────────────────
  for (let c = 0; c < 4; c++) {
    colNodes[c].forEach(nid => {
      const src        = nodes[nid];
      const candidates = colNodes[c + 1].filter(
        tid => Math.abs(nodes[tid].row - src.row) <= 1
      );
      const picks = _shuffle(candidates).slice(0, Math.random() < 0.4 ? 2 : 1);
      if (!picks.length) picks.push(colNodes[c + 1][0]);
      picks.forEach(t => { if (!src.next.includes(t)) src.next.push(t); });
    });
  }

  // ── Edges: col 5 → boss ─────────────────────────────────────────
  colNodes[4].forEach(nid => nodes[nid].next.push(bossId));

  // ── Orphan fix: guarantee every content node has ≥1 incoming edge ──
  for (let c = 1; c <= 5; c++) {
    colNodes[c - 1].forEach(nid => {
      const node  = nodes[nid];
      let   hasIn = false;

      if (c === 1) {
        hasIn = nodes[0].next.includes(nid);
      } else {
        for (let pc = 0; pc < c - 1 && !hasIn; pc++) {
          hasIn = colNodes[pc].some(pid => nodes[pid].next.includes(nid));
        }
      }

      if (!hasIn) {
        let bestPrev = (c === 1) ? nodes[0] : null;
        if (!bestPrev) {
          let bestDist = Infinity;
          colNodes[c - 2].forEach(pid => {
            const dist = Math.abs(nodes[pid].row - node.row);
            if (dist < bestDist) { bestDist = dist; bestPrev = nodes[pid]; }
          });
        }
        if (bestPrev && !bestPrev.next.includes(nid)) bestPrev.next.push(nid);
      }
    });
  }

  return nodes;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAP SCREEN
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Show the map screen.  Called by LobbyManager.startRun() after GS.startRun()
 * and GS.setMapNodes() have been called.
 */
export function enterMap() {
  _renderMap();
  _show('map-screen');
  _hide('lobby');
  _hide('game');
}

/**
 * (Re)render the map SVG edges and node DOM cards.
 * Pure read from GS.run.*.
 */
function _renderMap() {
  if (!GS.run) return;

  const nodes    = GS.run.mapNodes;
  const cleared  = GS.run.clearedNodes;
  const reachable = _getReachable();

  const nm  = $('node-map');
  const svg = $('map-lines');
  nm.innerHTML  = '';
  svg.innerHTML = '';

  // ── SVG edges ──────────────────────────────────────────────────
  nodes.forEach(n => n.next.forEach(nid => {
    const t    = nodes.find(x => x.id === nid);
    if (!t) return;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', n.x);   line.setAttribute('y1', n.y);
    line.setAttribute('x2', t.x);   line.setAttribute('y2', t.y);
    line.setAttribute('stroke',       cleared.has(n.id) ? '#3a5a3a' : '#2a2a3a');
    line.setAttribute('stroke-width', '2');
    svg.appendChild(line);
  }));

  // ── Node cards ─────────────────────────────────────────────────
  nodes.forEach(n => {
    const done      = cleared.has(n.id);
    const available = reachable.has(n.id);
    const stateCls  = done ? 'done' : available ? 'available' : 'locked';

    const d       = document.createElement('div');
    d.className   = `map-node ${stateCls}`;
    d.style.left  = n.x + 'px';
    d.style.top   = n.y + 'px';
    d.innerHTML   =
      `<span class="ntype">${NODE_ICONS[n.type]}</span>` +
      `<span class="nlabel">${NODE_LABELS[n.type]}</span>`;

    if (available) {
      d.addEventListener('click', () => _enterNode(n.id));
    }

    // Tooltip showing col / act info
    d.title = `${NODE_LABELS[n.type]} · Col ${n.col} · Act ${DC.actFromCol(n.col)}`;
    nm.appendChild(d);
  });
}

/**
 * Compute the set of node IDs the player can currently enter.
 * @returns {Set<number>}
 */
function _getReachable() {
  const s   = new Set();
  const cur = GS.run.currentNodeIdx;

  // Before entering any node, only the start node is reachable
  if (cur < 0) {
    s.add(0);
    return s;
  }

  // After clearing a node, its successors become reachable
  if (GS.run.clearedNodes.has(cur)) {
    const curNode = GS.run.mapNodes.find(n => n.id === cur);
    curNode?.next.forEach(nid => s.add(nid));
  }

  return s;
}

// ─────────────────────────────────────────────────────────────────────────────
// NODE ENTRY ROUTING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Called when the player clicks a reachable map node.
 * Updates GameState and routes to the correct sub-screen.
 * @param {number} id
 */
function _enterNode(id) {
  GS.setCurrentNode(id);
  const node = GS.run.mapNodes.find(n => n.id === id);
  if (!node) return;

  switch (node.type) {
    case 'encounter': _startEncounter(node); break;
    case 'shop':      _startShop(node);      break;
    case 'start':     _clearAndReturn();     break;  // start camp: instant clear
    default:          _startCombat(node);    break;  // 'clear' | 'boss'
  }
}

function _startCombat(node) {
  _hide('map-screen');
  _show('game');

  // Resize canvas to container before battle starts
  const wrap = $('canvas-wrap');
  if (wrap && _canvas) {
    _canvas.width  = wrap.clientWidth;
    _canvas.height = wrap.clientHeight;
  }

  UI.setNodeTypeLabel(node.type === 'boss' ? '★ BOSS BATTLE' : '⚔ Combat');
  CM.startBattle(node, _canvas);
}

/** Start camp node — counts as instant clear, returns to reachable successors. */
function _clearAndReturn() {
  GS.clearNode(GS.run.currentNodeIdx);
  _renderMap();
}

// ─────────────────────────────────────────────────────────────────────────────
// ENCOUNTER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Show the encounter overlay for the given node.
 * @param {import('./GameState.js').MapNode} _node
 */
function _startEncounter(_node) {
  _hide('map-screen');
  _show('game');
  _hideAll('result-overlay');
  UI.setNodeTypeLabel('? Event');

  const enc = DC.getRandomEncounter({
    onSPGain: n => GS.addPersistSP(n),
  });

  $('enc-title').textContent = enc.title;
  $('enc-desc').textContent  = enc.desc;
  _hide('enc-result');

  const cc = $('enc-choices');
  cc.innerHTML           = '';
  cc.style.display       = 'flex';
  cc.style.flexDirection = 'column';
  cc.style.gap           = '8px';

  enc.choices.forEach(ch => {
    const b       = document.createElement('button');
    b.className   = 'enc-choice';
    b.textContent = ch.text;
    b.addEventListener('click', () => {
      const res = ch.fn(GS.run.playerPersist);
      cc.style.display = 'none';
      $('enc-res-text').textContent = res || 'Done.';
      _show('enc-result');
      _refreshGoldLabel();
    });
    cc.appendChild(b);
  });

  _show('enc-overlay');
}

/**
 * "Continue →" button: close encounter, mark node cleared, return to map.
 */
export function finishEncounter() {
  _hide('enc-overlay');
  GS.clearNode(GS.run.currentNodeIdx);
  GS.save();
  backToMap();
}

// ─────────────────────────────────────────────────────────────────────────────
// SHOP
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Show the shop overlay for the given node.
 * @param {import('./GameState.js').MapNode} _node
 */
function _startShop(_node) {
  _hide('map-screen');
  _show('game');
  _hideAll('result-overlay');
  UI.setNodeTypeLabel('🏪 Shop');

  // Generate 5 distinct items from two pools
  _storeItems = DC.rollItems(3)
    .concat(DC.rollItems(3))
    .slice(0, 5)
    .map(it => ({ ...it, sold: false }));

  _renderStore();
  _show('store-overlay');
}

function _renderStore() {
  const gold = GS.run.playerPersist.gold;
  $('store-gold-display').textContent = `💰 Your gold: ${gold}g`;

  const grid = $('store-grid');
  grid.innerHTML = '';

  _storeItems.forEach((it, i) => {
    const d = document.createElement('div');
    d.className = `store-card ${it.rarity} ${it.sold ? 'sold' : 'available'}`;

    const canAfford = !it.sold && gold >= it.price;

    d.innerHTML =
      `<div style="font-size:22px">${it.icon}</div>` +
      `<div style="font-weight:bold;font-size:11px">${it.name}</div>` +
      `<div style="font-size:10px;color:#888;margin:2px 0">${it.desc}</div>` +
      `<div style="color:${it.sold ? '#555' : canAfford ? '#fc6' : '#a66'};font-size:11px">` +
        (it.sold ? 'SOLD' : `💰 ${it.price}g`) +
      `</div>`;

    if (!it.sold) d.addEventListener('click', () => _buyItem(i));
    grid.appendChild(d);
  });
}

/**
 * Attempt to purchase item at store slot `i`.
 * @param {number} i
 */
function _buyItem(i) {
  const it = _storeItems[i];
  if (!it || it.sold) return;

  if (GS.run.playerPersist.gold < it.price) {
    _flashMsg('Not enough gold!');
    return;
  }

  GS.addGold(-it.price);
  it.sold = true;
  GS.applyItem(it, null);   // null = no active battle player to mirror onto

  document.dispatchEvent(new CustomEvent('combat:goldChanged'));
  _renderStore();
}

/**
 * "Leave Store" button: close shop, mark node cleared, return to map.
 */
export function closeStore() {
  _hide('store-overlay');
  GS.clearNode(GS.run.currentNodeIdx);
  GS.save();
  backToMap();
}

// ─────────────────────────────────────────────────────────────────────────────
// SCREEN TRANSITIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Return to the map screen from any in-run overlay or post-battle state.
 * Hides all overlays, saves progress, re-renders the map.
 */
export function backToMap() {
  _hideAll(
    'result-overlay', 'loot-overlay', 'enc-overlay',
    'store-overlay',  'pause-overlay', 'inv-overlay',
  );

  GS.setRunning(false);
  GS.setBattleActive(false);
  GS.save();

  _renderMap();
  _show('map-screen');
  _hide('game');
}

/**
 * Navigate back to the lobby.
 * Ends the current run (persisted data survives), fires 'nav:goLobby' so
 * LobbyManager can rebuild the lobby UI without MapManager importing it.
 */
export function goLobby() {
  GS.setRunning(false);
  GS.setBattleActive(false);

  _hideAll(
    'result-overlay', 'pause-overlay', 'loot-overlay',
    'enc-overlay',    'store-overlay',  'inv-overlay',
  );
  _hide('game');
  _hide('map-screen');

  GS.endRun();
  GS.save();

  // LobbyManager is listening for this event
  document.dispatchEvent(new CustomEvent('nav:goLobbyReady'));
}

// ─────────────────────────────────────────────────────────────────────────────
// INVENTORY OVERLAY  (keyboard 'I' fires 'game:action' → openInventory here)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Render and show the inventory overlay.
 * Called from the app-shell InputManager action handler.
 */
export function openInventory() {
  const il    = $('inv-list');
  const items = GS.run?.playerPersist?.items || [];
  il.innerHTML = '';

  if (!items.length) {
    il.innerHTML =
      '<div style="color:#555;font-size:11px;grid-column:1/-1;' +
      'text-align:center">No items yet</div>';
  } else {
    items.forEach(it => {
      const d     = document.createElement('div');
      d.className = `inv-item ${it.rarity}`;
      d.innerHTML =
        `<div style="font-size:20px">${it.icon}</div>` +
        `<div style="font-weight:bold">${it.name}</div>` +
        `<div style="font-size:9px;color:#888;margin-top:2px">${it.desc}</div>`;
      il.appendChild(d);
    });
  }
  _show('inv-overlay');
}

// ─────────────────────────────────────────────────────────────────────────────
// GOLD LABEL
// ─────────────────────────────────────────────────────────────────────────────

function _refreshGoldLabel() {
  const g = GS.run?.playerPersist?.gold ?? 0;
  const el = $('gold-label');
  if (el) el.textContent = `${g}g`;
}

// ─────────────────────────────────────────────────────────────────────────────
// FLASH MESSAGE  (validation feedback in map / shop / encounter context)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Show a brief toast notification anchored to the bottom of the screen.
 * Re-uses the same element across calls to avoid DOM spam.
 * @param {string} msg
 */
function _flashMsg(msg) {
  let el = $('map-flash');
  if (!el) {
    el    = document.createElement('div');
    el.id = 'map-flash';
    el.style.cssText =
      'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);' +
      'background:#1a1a2a;border:1px solid #fa8;color:#fa8;' +
      'padding:6px 18px;border-radius:6px;font-size:12px;' +
      'font-family:monospace;z-index:999;pointer-events:none;' +
      'transition:opacity .3s;';
    document.body.appendChild(el);
  }
  el.textContent   = msg;
  el.style.opacity = '1';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.opacity = '0'; }, 1800);
}
