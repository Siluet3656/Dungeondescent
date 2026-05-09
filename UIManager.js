/**
 * UIManager.js — Dungeon's Descent
 *
 * Owns every piece of DOM outside the canvas that changes at runtime:
 *   • Bottom HUD (HP/MP/XP bars, stat text, GCD bar)
 *   • Spell hotbar cooldown overlays and ready/oncooldown classes
 *   • Dash / auto-attack cooldown overlays
 *   • Target frame (name, HP bar)
 *   • Topbar labels (level, gold, SP, node type)
 *   • Combat message log
 *
 * Contract
 * ────────
 *   READ-ONLY.  UIManager never calls GameState mutators or CombatManager
 *   action functions.  It reads exported state and writes DOM — nothing else.
 *
 * Dependencies
 * ────────────
 *   GameState    — persist.equippedSpells (spell ids)
 *   DataConfig   — SPELL_BY_ID (for cd max values, icons)
 *   CombatManager — player, target, enemies, spellCDs, gcd, GCD,
 *                   atkTimer, dashTimer, dashActive, msgs  (read-only)
 *
 * Lifecycle
 * ─────────
 *   init()         — cache element references once at startup
 *   tick()         — call once per rendered frame (inside combat:tick handler)
 *   resetHUD()     — zero out bars on battle start
 *
 * The module is intentionally free of setInterval / rAF.
 * RenderEngine (or the app-shell) drives tick() on every combat frame via
 * the 'combat:tick' CustomEvent so UIManager stays in sync without running
 * its own loop.
 */

import * as GS  from './GameState.js';
import * as DC  from './DataConfig.js';
import * as CM  from './CombatManager.js';

// ─────────────────────────────────────────────────────────────────────────────
// ELEMENT CACHE
// Queried once in init() so tick() never calls getElementById in the hot path.
// ─────────────────────────────────────────────────────────────────────────────

const EL = /** @type {Record<string,HTMLElement>} */ ({});

/** @type {HTMLElement[]} — hotbar ability divs, indices 0–3 */
const AB = [];
/** @type {HTMLElement[]} — cd-overlay divs for slots 0–3 */
const CD = [];
/** @type {HTMLElement[]} — cd text spans for slots 0–3 */
const CDT = [];
/** @type {HTMLElement[]} — mana cost text spans for slots 0–3 */
const MPCOST = [];

// ─────────────────────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cache all element references and subscribe to CombatManager events.
 * Call once, after the DOM is ready.
 */
export function init() {
  const ids = [
    'hp-fill', 'mp-fill', 'xp-fill',
    'hp-txt',  'mp-txt',  'xp-txt',
    'gcd-fill',
    'level-label', 'gold-label', 'sp-label', 'node-type-label',
    'target-frame', 'tname', 'thp-fill', 'thp-txt',
    'msgbox',
    'cd-dash', 'cdtxt-dash',
    'cd-auto', 'cdtxt-auto',
    'shield-label',
  ];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) EL[id] = el;
  });

  // Hotbar slots — built by LobbyManager.buildHotbar() before each battle,
  // so we query lazily inside tick() the first time they're needed.
  // Pre-cache if they already exist (e.g. after a reload without navigation).
  _cacheHotbarEls();

  // Subscribe to combat tick
  document.addEventListener('combat:tick', tick);

  // Subscribe to gold changes fired during encounter / shop / mid-battle loot
  document.addEventListener('combat:goldChanged', _updateGoldLabel);
}

/** Attempt to cache hotbar elements; safe to call multiple times. */
function _cacheHotbarEls() {
  for (let i = 0; i < 4; i++) {
    AB[i]     = document.getElementById(`ab${i}`)      || AB[i];
    CD[i]     = document.getElementById(`cd${i}`)      || CD[i];
    CDT[i]    = document.getElementById(`cdtxt${i}`)   || CDT[i];
    MPCOST[i] = document.getElementById(`mpcost${i}`)  || MPCOST[i];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RESET
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Zero out all bars and hide the target frame.
 * Call from CombatManager right before startBattle() starts the loop.
 */
export function resetHUD() {
  _cacheHotbarEls();

  _setBarWidth('hp-fill', 0);
  _setBarWidth('mp-fill', 0);
  _setBarWidth('xp-fill', 0);
  _setText('hp-txt', '');
  _setText('mp-txt', '');
  _setText('xp-txt', '');
  _setBarWidth('gcd-fill', 0);

  for (let i = 0; i < 4; i++) {
    _setBarHeight(CD[i],  0);
    _setText(CDT[i], '');
    _setText(MPCOST[i], '');
    if (AB[i]) AB[i].className = 'ability ready';
  }
  _setBarHeight(EL['cd-dash'], 0);
  _setText(EL['cdtxt-dash'], '');
  _setBarHeight(EL['cd-auto'], 0);

  if (EL['target-frame']) EL['target-frame'].style.display = 'none';
  if (EL['msgbox'])       EL['msgbox'].textContent = '';
}

// ─────────────────────────────────────────────────────────────────────────────
// TICK  (called every combat frame via 'combat:tick' event)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Update all HUD elements from the current CombatManager / GameState state.
 * Pure DOM writes — no reads from GameState mutators.
 */
export function tick() {
  const p = CM.player;
  if (!p) return;

  _updateResourceBars(p);
  _updateTopbarLabels(p);
  _updateSpellCooldowns();
  _updateDashCooldown();
  _updateAutoAttackCooldown();
  _updateTargetFrame();
  _updateMsgBox();
  _updateStatusTints(p);
}

// ─────────────────────────────────────────────────────────────────────────────
// PRIVATE UPDATE FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

function _updateResourceBars(p) {
  const hpPct  = p.stats.maxHp > 0 ? (p.hp / p.stats.maxHp)   * 100 : 0;
  const mpPct  = p.stats.maxMp > 0 ? (p.mp / p.stats.maxMp)   * 100 : 0;
  const xpPct  = p.xpNext      > 0 ? (p.xp / p.xpNext)        * 100 : 0;
  const gcdPct = CM.GCD         > 0 ? (CM.gcd / CM.GCD)        * 100 : 0;

  _setBarWidth('hp-fill', hpPct);
  _setBarWidth('mp-fill', mpPct);
  _setBarWidth('xp-fill', xpPct);
  _setBarWidth('gcd-fill', gcdPct);

  _setText('hp-txt', `${Math.ceil(Math.max(0, p.hp))}/${p.stats.maxHp}`);
  _setText('mp-txt', `${Math.ceil(Math.max(0, p.mp))}/${p.stats.maxMp}`);
  _setText('xp-txt', `${Math.floor(p.xp)}/${p.xpNext}`);

  // Shield label (optional element — only present in some layouts)
  if (EL['shield-label']) {
    EL['shield-label'].textContent =
      p.shield > 0 ? `🛡 ${Math.ceil(p.shield)}` : '';
    EL['shield-label'].style.display = p.shield > 0 ? 'inline' : 'none';
  }

  // Colour-shift HP bar based on percentage
  const hpFill = EL['hp-fill'];
  if (hpFill) {
    hpFill.style.background =
      hpPct > 50 ? '#4a4' :
      hpPct > 25 ? '#a84' :
                   '#c44';
  }
}

function _updateTopbarLabels(p) {
  _setText('level-label', `Lv.${p.level}`);
  _setText('sp-label',    `${p.skillPoints || 0} SP`);

  // Gold is kept on the run's playerPersist (source of truth); the live
  // player mirrors it after each kill/purchase but we read GS for safety.
  const gold = GS.run?.playerPersist?.gold ?? p.gold ?? 0;
  _setText('gold-label', `${gold}g`);
}

function _updateGoldLabel() {
  const gold = GS.run?.playerPersist?.gold ?? 0;
  _setText('gold-label', `${gold}g`);
}

function _updateSpellCooldowns() {
  // Lazy-cache in case buildHotbar ran after init()
  _cacheHotbarEls();

  const spells = GS.persist.equippedSpells;
  const p = CM.player;
  for (let i = 0; i < 4; i++) {
    const id  = spells[i];
    const sp  = id ? DC.SPELL_BY_ID[id] : null;
    const cd  = (sp && CM.spellCDs[id]) || 0;
    const mcd = sp ? sp.cd : 1;
    const pct = cd > 0 ? (cd / mcd) * 100 : 0;

    _setBarHeight(CD[i],  pct);
    _setText(CDT[i], cd > 0 ? cd.toFixed(1) : '');

    // Mana cost display and usability check
    if (sp && MPCOST[i]) {
      const mpCost = sp.mpCost || 0;
      const canAfford = p && p.mp >= mpCost;
      MPCOST[i].textContent = mpCost > 0 ? `${mpCost}mp` : '';
      MPCOST[i].className = 'mpcost ' + (canAfford ? 'enough' : 'notenough');
    } else if (MPCOST[i]) {
      MPCOST[i].textContent = '';
      MPCOST[i].className = 'mpcost';
    }

    // Determine ability state: on cooldown, unusable (no spell), or ready
    if (AB[i]) {
      let className = 'ability ';
      if (CM.gcd > 0 || cd > 0) {
        className += 'oncooldown';
      } else if (!sp) {
        className += 'unusable';
      } else if (p && p.mp < (sp.mpCost || 0)) {
        className += 'unusable';
      } else {
        className += 'ready';
      }
      AB[i].className = className;
    }
  }
}

function _updateDashCooldown() {
  const DASH_CD  = 4;
  const pct      = CM.dashTimer > 0 ? (CM.dashTimer / DASH_CD) * 100 : 0;
  _setBarHeight(EL['cd-dash'],   pct);
  _setText(EL['cdtxt-dash'], CM.dashTimer > 0 ? CM.dashTimer.toFixed(1) : '');
}

function _updateAutoAttackCooldown() {
  // atkSpd is the full cooldown set on the player stat; default 1s.
  const maxAtk = CM.player?.stats?.atkSpd || 1;
  const pct    = CM.atkTimer > 0 ? (CM.atkTimer / maxAtk) * 100 : 0;
  _setBarHeight(EL['cd-auto'], pct);
}

function _updateTargetFrame() {
  const tf = EL['target-frame'];
  if (!tf) return;

  const tgt = CM.target;
  if (tgt && CM.enemies.includes(tgt)) {
    tf.style.display = 'block';
    _setText('tname', (tgt.boss ? '[BOSS] ' : '') + tgt.name);
    _setBarWidth('thp-fill', Math.max(0, (tgt.hp / tgt.maxHp) * 100));
    _setText('thp-txt', `${Math.ceil(Math.max(0, tgt.hp))} / ${tgt.maxHp}`);
  } else {
    tf.style.display = 'none';
  }
}

function _updateMsgBox() {
  const el = EL['msgbox'];
  if (!el) return;
  el.textContent = CM.msgs.slice(0, 4).join('\n');
}

/**
 * Apply CSS class tints to the player dot area (via a data-attr on #topbar)
 * so status effects are visible at a glance without canvas writes.
 *
 * This does NOT do canvas drawing — that lives in RenderEngine.
 * We abuse dataset on topbar as a lightweight status bus for CSS.
 *
 * @param {Object} p — live player object from CombatManager
 */
function _updateStatusTints(p) {
  const topbar = document.getElementById('topbar');
  if (!topbar) return;

  const statuses = [];
  if ((p.burnTimer   || 0) > 0) statuses.push('burn');
  if ((p.poisonTimer || 0) > 0) statuses.push('poison');
  if ((p.curseTimer  || 0) > 0) statuses.push('curse');
  if ((p.slowFactor  || 1) < 1) statuses.push('slow');
  if ((p.dmgInMult   || 1) > 1) statuses.push('vulnerable');
  if ((p.dmgOutMult  || 1) < 1) statuses.push('weakened');

  topbar.dataset.status = statuses.join(' ');

  // Update (or create) the inline status text next to gold/SP
  let statusEl = document.getElementById('status-tray');
  if (!statusEl) {
    statusEl    = document.createElement('span');
    statusEl.id = 'status-tray';
    statusEl.style.cssText =
      'font-size:10px;letter-spacing:1px;margin-left:4px;';
    topbar.appendChild(statusEl);
    EL['status-tray'] = statusEl;
  }

  // Build compact icon string
  const icons = {
    burn:       { icon: '🔥', color: '#f84' },
    poison:     { icon: '☠', color: '#6a6' },
    curse:      { icon: '💀', color: '#c4c' },
    slow:       { icon: '🐢', color: '#88f' },
    vulnerable: { icon: '💢', color: '#f44' },
    weakened:   { icon: '⬇', color: '#fa8' },
  };

  if (statuses.length) {
    statusEl.innerHTML = statuses
      .map(s => `<span style="color:${icons[s].color}">${icons[s].icon}</span>`)
      .join(' ');
  } else {
    statusEl.innerHTML = '';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC TOPBAR HELPERS  (called from LobbyManager on node entry)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Set the node-type label in the topbar.
 * @param {string} text
 */
export function setNodeTypeLabel(text) {
  _setText('node-type-label', text);
}

/**
 * Update the floor/node label (left-most topbar item).
 * @param {string} text
 */
export function setFloorLabel(text) {
  _setText('floor-label', text);
}

// ─────────────────────────────────────────────────────────────────────────────
// DOM WRITE HELPERS
// These are the only functions that touch the DOM so the rest of the module
// stays readable and the hot path stays allocation-free.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Set the width% of a cached bar-fill element.
 * @param {string|HTMLElement} ref — element id string or element reference
 * @param {number} pct — 0..100
 */
function _setBarWidth(ref, pct) {
  const el = typeof ref === 'string' ? EL[ref] : ref;
  if (el) el.style.width = Math.min(100, Math.max(0, pct)).toFixed(1) + '%';
}

/**
 * Set the height% of a cooldown-overlay element.
 * @param {HTMLElement|undefined} el
 * @param {number} pct — 0..100
 */
function _setBarHeight(el, pct) {
  if (el) el.style.height = Math.min(100, Math.max(0, pct)).toFixed(1) + '%';
}

/**
 * Set textContent of a cached element (no-op if not found).
 * @param {string|HTMLElement} ref
 * @param {string} text
 */
function _setText(ref, text) {
  const el = typeof ref === 'string' ? EL[ref] : ref;
  if (el) el.textContent = text;
}
