/**
 * LobbyManager.js — Dungeon's Descent
 *
 * Owns every screen that is NOT an active battle:
 *   • Lobby (class selection, spellbook equip, skill tree)
 *   • Node map (generation, rendering, node entry routing)
 *   • Encounter overlays (random events with choices)
 *   • Shop overlay (browse, buy, leave)
 *   • Screen-transition helpers (backToMap, goLobby)
 *
 * Dependencies
 * ────────────
 *   GameState   — persist + run reads / mutators
 *   DataConfig  — ALL_SPELLS, SKILL_TIERS, getRandomEncounter, rollItems
 *
 * Outbound communication
 * ──────────────────────
 *   Calls CombatManager.startBattle(node, canvas) for combat/boss nodes.
 *   Listens for CustomEvents from CombatManager:
 *     'combat:win'         → showLootPick already handled in CombatManager;
 *                            fires 'nav:backToMap' which we catch below
 *     'nav:backToMap'      → backToMap()
 *     'nav:goLobby'        → goLobby()
 *     'combat:goldChanged' → refreshes the gold label
 *
 * Public API
 * ──────────
 *   init(canvas)         — wire DOM event listeners; call once at app start
 *   buildLobby()         — (re)render the full lobby UI
 *   goLobby()            — navigate to the lobby from anywhere
 *   backToMap()          — return to map after encounter / shop / battle
 *   startRun()           — called by "Enter Dungeon" button
 */

import * as GS   from './GameState.js';
import * as DC   from './DataConfig.js';
import * as CM   from './CombatManager.js';
import * as SM 	 from './SoundManager.js';

// ─────────────────────────────────────────────────────────────────────────────
// DOM HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** @param {string} id @returns {HTMLElement} */
const $  = id => document.getElementById(id);

/** Show a flex element, hide all others in the provided list. */
function _showOnly(showId, ...hideIds) {
  $(showId).style.display = 'flex';
  hideIds.forEach(id => { $(id).style.display = 'none'; });
}

/** Hide an element. */
function _hide(id) { $(id).style.display = 'none'; }

// ─────────────────────────────────────────────────────────────────────────────
// MODULE STATE
// ─────────────────────────────────────────────────────────────────────────────

/** @type {HTMLCanvasElement} */
let _canvas = null;

/** Per-shop item list (5 entries, each flagged sold:true/false). */
let _storeItems = [];

// ─────────────────────────────────────────────────────────────────────────────
// INITIALISE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wire up DOM button handlers and cross-module navigation events.
 * Call once at app startup, after the DOM is ready.
 *
 * @param {HTMLCanvasElement} canvas — the main game canvas
 */
export function init(canvas) {
  _canvas = canvas;

  // ── Lobby buttons ────────────────────────────────────────────────
  $('class-warrior').addEventListener('click', () => selectClass('warrior'));
  $('class-mage').addEventListener('click',    () => selectClass('mage'));
  $('start-btn').addEventListener('click',     startRun);

  // ── Encounter overlay ────────────────────────────────────────────
  $('enc-continue-btn').addEventListener('click', finishEncounter);

  // ── Shop overlay ─────────────────────────────────────────────────
  $('store-close-btn').addEventListener('click', closeStore);

  // ── Inventory overlay ────────────────────────────────────────────
  $('inv-close-btn').addEventListener('click', () => _hide('inv-overlay'));

  // ── Nav events from CombatManager ────────────────────────────────
  document.addEventListener('nav:backToMap', backToMap);
  document.addEventListener('nav:goLobby',   goLobby);
  document.addEventListener('combat:goldChanged', _refreshGoldLabel);

  // Load any saved cross-run state then render the initial lobby
  GS.load();
  buildLobby();
}

// ─────────────────────────────────────────────────────────────────────────────
// CLASS SELECTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Switch the active class and refresh the class-button UI.
 * @param {'warrior'|'mage'} cls
 */
export function selectClass(cls) {
  GS.setPlayerClass(cls);
  $('class-warrior').className = 'class-btn' + (cls === 'warrior' ? ' active' : '');
  $('class-mage').className    = 'class-btn' + (cls === 'mage'    ? ' active' : '');
}

// ─────────────────────────────────────────────────────────────────────────────
// LOBBY RENDER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * (Re)render the full lobby: spellbook, hotbar slots, stat preview,
 * skill-point counter, ascension label, and skill tree.
 */
export function buildLobby() {
  _renderSpellbook();
  _renderHotbarSlots();
  _renderSkillTree();
  _renderLobbyMeta();
}

function _renderSpellbook() {
  const grid = $('spellbook-grid');
  grid.innerHTML = '';
  DC.ALL_SPELLS.forEach(sp => {
    const d       = document.createElement('div');
    const equipped = GS.persist.equippedSpells.includes(sp.id);
    d.className   = 'spell-card' + (equipped ? ' equipped' : '');
    d.innerHTML   =
      `<div class="spell-icon">${sp.icon}</div>` +
      `<div class="spell-name">${sp.name}</div>` +
      `<div class="spell-info">${sp.desc}</div>`;
    d.addEventListener('click', () => _onSpellCardClick(sp.id));
    grid.appendChild(d);
  });
}

function _renderHotbarSlots() {
  const slots = $('hotbar-slots');
  slots.innerHTML = '';
  for (let i = 0; i < 4; i++) {
    const id = GS.persist.equippedSpells[i];
    const sp = id ? DC.SPELL_BY_ID[id] : null;
    const d  = document.createElement('div');
    d.className = 'spell-card slot' + (sp ? ' filled' : '');
    if (sp) {
      d.innerHTML =
        `<div class="spell-icon">${sp.icon}</div>` +
        `<div style="font-size:10px">${i + 1}. ${sp.name}</div>`;
      // Clicking a filled slot unequips it
      d.addEventListener('click', () => {
        GS.persist.equippedSpells.splice(i, 1);
        buildLobby();
      });
    } else {
      d.innerHTML = `<div style="font-size:16px">+</div><div>${i + 1}</div>`;
    }
    slots.appendChild(d);
  }
}

function _onSpellCardClick(spellId) {
  const result = GS.toggleSpell(spellId);
  // result is true if equipped, false if unequipped — either way, redraw
  buildLobby();
  if (GS.persist.equippedSpells.length >= 4 && result) {
    // Subtle feedback: slots are full
    $('hotbar-slots').classList.add('full-flash');
    setTimeout(() => $('hotbar-slots').classList.remove('full-flash'), 300);
  }
}

function _renderSkillTree() {
  const panel = $('skilltree-panel');
  panel.innerHTML = '';

  DC.SKILL_TIERS.forEach((tier, ti) => {
    const unlocked = GS.persist.bossesDefeated >= tier.bossReq;

    // Tier header
    const hdr = document.createElement('div');
    hdr.className = 'tier-header';
    const lbl = document.createElement('span');
    lbl.className = 'tier-label ' + (unlocked ? tier.cls : 'locked');
    lbl.textContent = unlocked
      ? `${tier.label} (${tier.spCost} SP/rank)`
      : `${tier.label} — Defeat ${tier.bossReq} boss${tier.bossReq > 1 ? 'es' : ''}`;
    hdr.appendChild(lbl);
    panel.appendChild(hdr);

    // Skill nodes row
    const row = document.createElement('div');
    row.className = 'tier-row' + (unlocked ? '' : ' tier-locked');

    tier.skills.forEach((s, si) => {
      const fi     = DC.skillFlatIndex(ti, si);
      const rank   = GS.persist.skillRanks[fi];
      const maxed  = rank >= s.max;
      const canBuy = GS.persist.skillPoints >= tier.spCost && !maxed && unlocked;

      const d = document.createElement('div');
      d.className = 'sk-node' + (maxed ? ' maxed' : '');
      d.innerHTML =
        `<h4>${s.name}</h4>` +
        `<p>${s.desc}</p>` +
        `<p class="pts">` +
          `Rank ${rank}/${s.max} · ` +
          `<span style="color:${canBuy ? '#fa8' : '#666'}">${tier.spCost} SP</span>` +
          `${canBuy ? ' — click' : ''}` +
        `</p>`;

      if (canBuy) {
        d.addEventListener('click', () => {
          const res = GS.buySkillRank(ti, si);
          if (res.ok) buildLobby();
          else _flashMsg(res.reason);
        });
      }
      row.appendChild(d);
    });
    panel.appendChild(row);
  });
}

function _renderLobbyMeta() {
  $('lobby-sp').textContent =
    `Skill Points: ${GS.persist.skillPoints}`;
  $('lobby-tier-info').textContent =
    `Bosses defeated: ${GS.persist.bossesDefeated} · ` +
    `Tiers unlocked: ${Math.min(4, GS.persist.bossesDefeated + 1)}/4`;
  $('ascension-lvl').textContent =
    GS.persist.ascension;

  // Keep class buttons in sync (e.g. after a load)
  $('class-warrior').className =
    'class-btn' + (GS.persist.playerClass === 'warrior' ? ' active' : '');
  $('class-mage').className =
    'class-btn' + (GS.persist.playerClass === 'mage'    ? ' active' : '');
}

// ─────────────────────────────────────────────────────────────────────────────
// RUN LIFECYCLE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * "Enter Dungeon" button handler.
 * Validates spell loadout, initialises GameState run, generates the map,
 * and navigates to the map screen.
 */
export function startRun() {
  if (GS.persist.equippedSpells.length === 0) {
    _flashMsg('Equip at least one spell!');
    return;
  }

  SM.unlockAudio();
  GS.startRun();

  // Generate map and store it in GameState
  const nodes = _generateMap();
  GS.setMapNodes(nodes);

  _hide('lobby');
  renderMap();
}

// ─────────────────────────────────────────────────────────────────────────────
// MAP GENERATION
// ─────────────────────────────────────────────────────────────────────────────

const _COL_X  = [40, 140, 240, 340, 440, 560, 700];
const _ROW_Y  = [60, 160, 260];
const _shuffle = a => {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = ~~(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
};

/**
 * Generate a fresh node map (pure function — does not touch GameState).
 * @returns {import('./GameState.js').MapNode[]}
 */
function _generateMap() {
  const nodes = [];
  nodes.push({ id: 0, col: 0, row: 1, type: 'start', x: _COL_X[0], y: _ROW_Y[1], next: [] });

  let id = 1;
  const colNodes = [];

  const _typePool = (col, row) => {
    if (col === 3 && row === 1) return 'shop';
    const rng = Math.random();
    return rng < 0.12 ? 'shop' : rng < 0.42 ? 'encounter' : 'clear';
  };

  // Build content columns 1–5
  for (let c = 1; c <= 5; c++) {
    const rows = (c === 2 || c === 3) ? [0, 1, 2] : [0, 2];
    const used = [];
    rows.forEach(r => {
      nodes.push({ id, col: c, row: r, type: _typePool(c, r), x: _COL_X[c], y: _ROW_Y[r], next: [] });
      used.push(id++);
    });
    colNodes.push(used);
  }

  // Boss node
  const bossId = id;
  nodes.push({ id: bossId, col: 6, row: 1, type: 'boss', x: _COL_X[6], y: _ROW_Y[1], next: [] });

  // Connect start → col 1
  colNodes[0].forEach(nid => nodes[0].next.push(nid));

  // Connect col c → col c+1 (with branching)
  for (let c = 0; c < 4; c++) {
    colNodes[c].forEach(nid => {
      const src        = nodes[nid];
      const candidates = colNodes[c + 1].filter(tid => Math.abs(nodes[tid].row - src.row) <= 1);
      const picks      = _shuffle(candidates).slice(0, Math.random() < 0.4 ? 2 : 1);
      if (!picks.length) picks.push(colNodes[c + 1][0]);
      picks.forEach(t => { if (!src.next.includes(t)) src.next.push(t); });
    });
  }

  // Connect col 5 → boss
  colNodes[4].forEach(nid => nodes[nid].next.push(bossId));

  // Guarantee every content node has at least one incoming edge
  for (let c = 1; c <= 5; c++) {
    colNodes[c - 1].forEach(nid => {
      const node   = nodes[nid];
      let   hasIn  = false;

      if (c === 1) {
        hasIn = nodes[0].next.includes(nid);
      } else {
        for (let pc = 0; pc < c - 1 && !hasIn; pc++) {
          hasIn = colNodes[pc].some(pid => nodes[pid].next.includes(nid));
        }
      }

      if (!hasIn) {
        // Force-connect from closest node in the previous column
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
// MAP RENDER & NAVIGATION
// ─────────────────────────────────────────────────────────────────────────────

const _NODE_ICONS  = { start: '🏕', clear: '⚔', encounter: '?', boss: '💀', shop: '🏪' };
const _NODE_LABELS = { start: 'Camp', clear: 'Combat', encounter: 'Event', boss: 'BOSS', shop: 'Shop' };

/**
 * Render the node map and show the map screen.
 * Reads from GS.run.mapNodes and GS.run.clearedNodes.
 */
export function renderMap() {
  const nodes        = GS.run.mapNodes;
  const cleared      = GS.run.clearedNodes;
  const reachable    = _getReachable();

  const nm  = $('node-map');
  const svg = $('map-lines');
  nm.innerHTML  = '';
  svg.innerHTML = '';

  // Draw edges
  nodes.forEach(n => n.next.forEach(nid => {
    const t    = nodes.find(x => x.id === nid);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', n.x);  line.setAttribute('y1', n.y);
    line.setAttribute('x2', t.x);  line.setAttribute('y2', t.y);
    line.setAttribute('stroke', cleared.has(n.id) ? '#3a5a3a' : '#2a2a3a');
    line.setAttribute('stroke-width', '2');
    svg.appendChild(line);
  }));

  // Draw nodes
  nodes.forEach(n => {
    const done      = cleared.has(n.id);
    const available = reachable.has(n.id);
    const cls       = 'map-node ' + (done ? 'done' : available ? 'available' : 'locked');

    const d       = document.createElement('div');
    d.className   = cls;
    d.style.left  = n.x + 'px';
    d.style.top   = n.y + 'px';
    d.innerHTML   =
      `<span class="ntype">${_NODE_ICONS[n.type]}</span>` +
      `<span class="nlabel">${_NODE_LABELS[n.type]}</span>`;

    if (available) d.addEventListener('click', () => _enterNode(n.id));
    nm.appendChild(d);
  });

  _showOnly('map-screen', 'game', 'lobby');
}

/**
 * Compute which node IDs are currently reachable for the player.
 * @returns {Set<number>}
 */
function _getReachable() {
  const s       = new Set();
  const cur     = GS.run.currentNodeIdx;
  const cleared = GS.run.clearedNodes;

  if (cur < 0) {
    s.add(0); // only start node reachable at run start
    return s;
  }
  if (cleared.has(cur)) {
    const curNode = GS.run.mapNodes.find(n => n.id === cur);
    curNode?.next.forEach(nid => s.add(nid));
  }
  return s;
}

/**
 * Enter a map node — routes to the appropriate handler.
 * @param {number} id
 */
function _enterNode(id) {
  GS.setCurrentNode(id);
  const node = GS.run.mapNodes.find(n => n.id === id);
  if (!node) return;

  if      (node.type === 'encounter') _startEncounter(node);
  else if (node.type === 'shop')      _startShop(node);
  else                                _startCombat(node);  // 'clear' | 'boss'
}

function _startCombat(node) {
  $('node-type-label').textContent = node.type === 'boss' ? '★ BOSS BATTLE' : '⚔ Combat';
  _showOnly('game', 'map-screen', 'lobby');
  // Resize canvas before handing off
  const wrap = $('canvas-wrap');
  if (wrap) { _canvas.width = wrap.clientWidth; _canvas.height = wrap.clientHeight; }
  CM.startBattle(node, _canvas);
}

// ─────────────────────────────────────────────────────────────────────────────
// ENCOUNTER
// ─────────────────────────────────────────────────────────────────────────────

function _startEncounter(node) {
  _showOnly('game', 'map-screen', 'lobby');
  _hide('result-overlay');

  const enc = DC.getRandomEncounter({
    onSPGain: n => GS.addPersistSP(n),
  });

  $('enc-title').textContent = enc.title;
  $('enc-desc').textContent  = enc.desc;
  _hide('enc-result');

  const cc = $('enc-choices');
  cc.innerHTML = '';
  cc.style.display       = 'flex';
  cc.style.flexDirection = 'column';
  cc.style.gap           = '8px';

  enc.choices.forEach(ch => {
    const b   = document.createElement('button');
    b.className   = 'enc-choice';
    b.textContent = ch.text;
    b.addEventListener('click', () => {
      const res = ch.fn(GS.run.playerPersist);
      cc.style.display = 'none';
      $('enc-res-text').textContent  = res || 'Done.';
      $('enc-result').style.display  = 'flex';
      _refreshGoldLabel();
    });
    cc.appendChild(b);
  });

  $('enc-overlay').style.display = 'flex';
}

/**
 * "Continue →" button on the encounter result screen.
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

function _startShop(_node) {
  _showOnly('game', 'map-screen', 'lobby');
  _hide('result-overlay');

  // 5 distinct items drawn from two rolls
  _storeItems = DC.rollItems(3)
    .concat(DC.rollItems(3))
    .slice(0, 5)
    .map(it => ({ ...it, sold: false }));

  _renderStore();
  $('store-overlay').style.display = 'flex';
}

function _renderStore() {
  $('store-gold-display').textContent =
    `💰 Your gold: ${GS.run.playerPersist.gold}g`;

  const grid = $('store-grid');
  grid.innerHTML = '';

  _storeItems.forEach((it, i) => {
    const d = document.createElement('div');
    d.className =
      `store-card ${it.rarity} ${it.sold ? 'sold' : 'available'}`;
    d.innerHTML =
      `<div style="font-size:22px">${it.icon}</div>` +
      `<div style="font-weight:bold;font-size:11px">${it.name}</div>` +
      `<div style="font-size:10px;color:#888;margin:2px 0">${it.desc}</div>` +
      `<div style="color:${it.sold ? '#555' : '#fc6'};font-size:11px">` +
        `${it.sold ? 'SOLD' : '💰 ' + it.price + 'g'}` +
      `</div>`;

    if (!it.sold) d.addEventListener('click', () => _buyItem(i));
    grid.appendChild(d);
  });
}

function _buyItem(i) {
  const it = _storeItems[i];
  if (!it || it.sold) return;
  if (GS.run.playerPersist.gold < it.price) {
    _flashMsg('Not enough gold!');
    return;
  }
  GS.addGold(-it.price);
  it.sold = true;
  GS.applyItem(it, null);   // null = no live battle player
  _renderStore();
  _refreshGoldLabel();
}

/**
 * "Leave Store" button handler.
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
 * Return to the map from any non-lobby overlay (post-battle, encounter, shop).
 * Hides all overlays, syncs save, re-renders map.
 */
export function backToMap() {
  ['result-overlay', 'loot-overlay', 'enc-overlay',
   'store-overlay',  'pause-overlay'].forEach(_hide);

  GS.save();
  renderMap();
}

/**
 * Navigate back to the lobby from anywhere.
 * Resets run state and rebuilds the full lobby UI.
 */
export function goLobby() {
  GS.setRunning(false);
  GS.setBattleActive(false);

  ['result-overlay', 'pause-overlay', 'loot-overlay',
   'enc-overlay',    'store-overlay'].forEach(_hide);
  _hide('game');
  _hide('map-screen');

  GS.endRun();    // wipes run state; does NOT touch persist
  GS.save();

  $('lobby').style.display = 'flex';
  buildLobby();
}

// ─────────────────────────────────────────────────────────────────────────────
// INVENTORY OVERLAY  (opened from InputManager 'openInventory' action)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Render and show the inventory overlay.
 * Called by the app-shell action handler for the 'openInventory' event.
 */
export function openInventory() {
  const il    = $('inv-list');
  const items = GS.run?.playerPersist?.items || [];
  il.innerHTML = '';

  if (!items.length) {
    il.innerHTML =
      '<div style="color:#555;font-size:11px;grid-column:1/-1;text-align:center">' +
      'No items yet</div>';
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

  $('inv-overlay').style.display = 'flex';
}

// ─────────────────────────────────────────────────────────────────────────────
// HOTBAR BUILD  (called by CombatManager / RenderEngine before battle starts)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the in-battle hotbar DOM from the currently equipped spells.
 * Also called after a spell loadout change in the lobby for live preview.
 *
 * @param {function(number): void} onSpellClick — castSpell(slot) from CombatManager
 */
export function buildHotbar(onSpellClick) {
  const hb = $('hotbar-game');
  hb.innerHTML = '';

  for (let i = 0; i < 4; i++) {
    const id = GS.persist.equippedSpells[i];
    const sp = id ? DC.SPELL_BY_ID[id] : null;
    const d  = document.createElement('div');
    d.className = 'ability';
    d.id        = `ab${i}`;
    d.addEventListener('click', () => onSpellClick(i));
    d.innerHTML =
      `<span class="key">${i + 1}</span>` +
      `<span class="icon">${sp ? sp.icon : '—'}</span>` +
      `<span class="aname">${sp ? sp.name : ''}</span>` +
      `<span class="mpcost" id="mpcost${i}"></span>` +
      `<span class="cdtxt" id="cdtxt${i}"></span>` +
      `<div class="cd-overlay" id="cd${i}" style="height:0%"></div>`;
    hb.appendChild(d);
  }

  // Dash and auto-attack slots (no onclick — driven by InputManager / CombatManager)
  [
    { key: 'SPC', icon: '💨', name: 'Dash', id: 'dash' },
    {             icon: '⚔',  name: 'Auto', id: 'auto' },
  ].forEach(ab => {
    const d = document.createElement('div');
    d.className = 'ability';
    d.innerHTML =
      (ab.key ? `<span class="key">${ab.key}</span>` : '') +
      `<span class="icon">${ab.icon}</span>` +
      `<span class="aname">${ab.name}</span>` +
      `<span class="cdtxt" id="cdtxt-${ab.id}"></span>` +
      `<div class="cd-overlay" id="cd-${ab.id}" style="height:0%"></div>`;
    hb.appendChild(d);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GOLD LABEL
// ─────────────────────────────────────────────────────────────────────────────

function _refreshGoldLabel() {
  const g = GS.run?.playerPersist?.gold ?? 0;
  $('gold-label').textContent = g + 'g';
}

// ─────────────────────────────────────────────────────────────────────────────
// SMALL UI HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Flash a brief status message in the lobby.
 * Used for validation feedback (spell slots full, not enough SP, etc.).
 * @param {string} msg
 */
function _flashMsg(msg) {
  let el = $('lobby-flash');
  if (!el) {
    el    = document.createElement('div');
    el.id = 'lobby-flash';
    el.style.cssText =
      'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);' +
      'background:#1a1a2a;border:1px solid #fa8;color:#fa8;' +
      'padding:6px 18px;border-radius:6px;font-size:12px;' +
      'font-family:monospace;z-index:999;pointer-events:none;' +
      'transition:opacity .3s';
    document.body.appendChild(el);
  }
  el.textContent    = msg;
  el.style.opacity  = '1';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.opacity = '0'; }, 1800);
}
