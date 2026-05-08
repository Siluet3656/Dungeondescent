/**
 * GameState.js — Dungeon's Descent
 *
 * The single source of truth for all mutable game state.
 * No rendering, no DOM access, no game logic — only data and
 * controlled mutators that keep state internally consistent.
 *
 * Two state layers
 * ────────────────
 *  PERSIST  — survives across runs (skill ranks, bosses defeated, ascension).
 *             Stored on the `persist` export and optionally serialised to
 *             localStorage via save() / load().
 *
 *  RUN      — created fresh at the start of each run (playerPersist, map,
 *             cleared nodes). Stored on the `run` export; null between runs.
 *
 *  BATTLE   — created fresh at the start of each battle (player, enemies,
 *             timers). Managed by CombatManager; GameState only holds the
 *             flags that other modules need to read (running, battleActive).
 *
 * Consumers
 * ─────────
 *  LobbyManager   — reads persist.*, calls startRun()
 *  MapManager     — reads/writes run.*, calls enterNode() / clearNode()
 *  CombatManager  — reads run.playerPersist, writes player stats back via
 *                   syncPlayerToRun() and commitXP() / commitGold()
 *  UIManager      — reads everything, writes nothing
 *  RenderEngine   — reads everything, writes nothing
 */

import {
  SKILL_TIERS,
  SKILL_COUNT,
  skillFlatIndex,
  CLASS_BASE_STATS,
} from './DataConfig.js';

// ─────────────────────────────────────────────────────────────────────────────
// PERSIST STATE  (cross-run progression)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} PersistState
 * @property {number}   skillPoints    — unspent skill points available in lobby
 * @property {number[]} skillRanks     — flat rank array, length == SKILL_COUNT
 * @property {number}   bossesDefeated — unlocks skill tiers, incremented on boss kill
 * @property {number}   ascension      — difficulty multiplier tier (0–3)
 * @property {'warrior'|'mage'} playerClass
 * @property {string[]} equippedSpells — spell ids in hotbar slots 0–3
 */

/** @type {PersistState} */
export const persist = {
  skillPoints:    0,
  skillRanks:     new Array(SKILL_COUNT).fill(0),
  bossesDefeated: 0,
  ascension:      0,
  playerClass:    'warrior',
  equippedSpells: ['fireball', 'heal', 'arcane', 'frostbolt'],
};

// ─────────────────────────────────────────────────────────────────────────────
// RUN STATE  (one run from lobby → boss)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} PlayerStats
 * @property {number} power
 * @property {number} magic
 * @property {number} maxHp
 * @property {number} maxMp
 * @property {number} hpRegen
 * @property {number} mpRegen
 * @property {number} atkSpd
 * @property {number} [maxMp]
 */

/**
 * @typedef {Object} PlayerPersist
 * @property {number}       level
 * @property {number}       xp
 * @property {number}       xpNext
 * @property {number}       gold
 * @property {number}       skillPoints   — in-run SP (copied back to persist on gain)
 * @property {PlayerStats}  stats         — current effective stats (items applied)
 * @property {number}       hp            — current HP
 * @property {number}       mp            — current MP
 * @property {number}       shield        — current shield HP
 * @property {import('./DataConfig.js').ItemDef[]} items
 * @property {number}       slowFactor
 * @property {number}       dmgOutMult
 * @property {number}       dmgInMult
 * @property {number}       curseTimer
 * @property {number}       burnTimer
 * @property {number}       poisonTimer
 */

/**
 * @typedef {Object} MapNode
 * @property {number}   id
 * @property {number}   col
 * @property {number}   row
 * @property {'start'|'clear'|'encounter'|'shop'|'boss'} type
 * @property {number}   x      — pixel position on map canvas
 * @property {number}   y
 * @property {number[]} next   — ids of reachable successor nodes
 */

/**
 * @typedef {Object} RunState
 * @property {PlayerPersist} playerPersist
 * @property {MapNode[]}     mapNodes
 * @property {Set<number>}   clearedNodes
 * @property {number}        currentNodeIdx  — -1 before first node
 */

/** @type {RunState|null} */
export let run = null;

// ─────────────────────────────────────────────────────────────────────────────
// BATTLE FLAGS  (read by UI / input handlers; written by CombatManager)
// ─────────────────────────────────────────────────────────────────────────────

export const battle = {
  /** True while the game loop is ticking. */
  running:      false,
  /** True while a battle scene is active (including when paused). */
  battleActive: false,
  /** True while the pause overlay is shown. */
  paused:       false,
};

// ─────────────────────────────────────────────────────────────────────────────
// PERSIST MUTATORS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Select a player class. Validates the value.
 * @param {'warrior'|'mage'} cls
 */
export function setPlayerClass(cls) {
  if (!CLASS_BASE_STATS[cls]) throw new Error(`Unknown class: ${cls}`);
  persist.playerClass = cls;
}

/**
 * Toggle a spell in the equipped hotbar (max 4 slots).
 * @param {string} spellId
 * @returns {boolean} true if the spell is now equipped, false if unequipped
 */
export function toggleSpell(spellId) {
  const idx = persist.equippedSpells.indexOf(spellId);
  if (idx >= 0) {
    persist.equippedSpells.splice(idx, 1);
    return false;
  }
  if (persist.equippedSpells.length < 4) {
    persist.equippedSpells.push(spellId);
    return true;
  }
  return false; // slots full — caller should show a warning
}

/**
 * Attempt to purchase one rank of a skill node.
 * Validates tier unlock, rank cap, and SP balance.
 *
 * @param {number} tierIndex  — 0-based
 * @param {number} skillIndex — 0-based within tier
 * @returns {{ ok: boolean, reason?: string }}
 */
export function buySkillRank(tierIndex, skillIndex) {
  const tier = SKILL_TIERS[tierIndex];
  if (!tier) return { ok: false, reason: 'Invalid tier' };

  if (persist.bossesDefeated < tier.bossReq) {
    return { ok: false, reason: `Need ${tier.bossReq} boss${tier.bossReq > 1 ? 'es' : ''} defeated` };
  }

  const fi    = skillFlatIndex(tierIndex, skillIndex);
  const node  = tier.skills[skillIndex];
  const rank  = persist.skillRanks[fi];

  if (rank >= node.max) return { ok: false, reason: 'Already maxed' };
  if (persist.skillPoints < tier.spCost) return { ok: false, reason: 'Not enough SP' };

  persist.skillPoints        -= tier.spCost;
  persist.skillRanks[fi]     += 1;
  return { ok: true };
}

/**
 * Award persistent skill points (called by encounter rewards and level-ups).
 * Also keeps run.playerPersist.skillPoints in sync if a run is active.
 * @param {number} amount
 */
export function addPersistSP(amount) {
  persist.skillPoints += amount;
  if (run) run.playerPersist.skillPoints = (run.playerPersist.skillPoints || 0) + amount;
}

/**
 * Record a boss kill. Increments counter and (optionally) ascension on re-clear.
 */
export function recordBossKill() {
  persist.bossesDefeated += 1;
}

/**
 * Increment ascension tier (max 3).
 * @returns {number} new ascension level
 */
export function incrementAscension() {
  persist.ascension = Math.min(3, persist.ascension + 1);
  return persist.ascension;
}

// ─────────────────────────────────────────────────────────────────────────────
// RUN LIFECYCLE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the initial playerPersist from the current class + skill tree state.
 * Called by LobbyManager when the player enters the dungeon.
 *
 * @returns {PlayerPersist}
 */
function buildPlayerPersist() {
  // Start from class base stats
  const stats = { ...CLASS_BASE_STATS[persist.playerClass] };

  // Apply skill-tree bonuses
  SKILL_TIERS.forEach((tier, ti) => {
    tier.skills.forEach((node, si) => {
      const rank = persist.skillRanks[skillFlatIndex(ti, si)];
      if (rank > 0) stats[node.stat] = (stats[node.stat] || 0) + node.val * rank;
    });
  });

  return {
    level:       1,
    xp:          0,
    xpNext:      100,
    gold:        0,
    skillPoints: 0,
    stats,
    hp:          stats.maxHp,
    mp:          stats.maxMp,
    shield:      0,
    items:       [],
    slowFactor:  1,
    dmgOutMult:  1,
    dmgInMult:   1,
    curseTimer:  0,
    burnTimer:   0,
    poisonTimer: 0,
  };
}

/**
 * Initialise a fresh run. Wipes any previous run state.
 * MapManager calls generateMap() separately and sets run.mapNodes.
 */
export function startRun() {
  run = {
    playerPersist:  buildPlayerPersist(),
    mapNodes:       [],
    clearedNodes:   new Set(),
    currentNodeIdx: -1,
  };
  battle.running      = false;
  battle.battleActive = false;
  battle.paused       = false;
}

/**
 * Tear down run state. Called on lobby return (death, surrender, post-boss).
 * Persisted cross-run data is NOT reset.
 */
export function endRun() {
  run   = null;
  battle.running      = false;
  battle.battleActive = false;
  battle.paused       = false;
}

// ─────────────────────────────────────────────────────────────────────────────
// RUN MUTATORS  (map navigation)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Set the active map node. CombatManager / MapManager call this on node entry.
 * @param {number} nodeId
 */
export function setCurrentNode(nodeId) {
  assertRun();
  run.currentNodeIdx = nodeId;
}

/**
 * Mark a node as cleared so successor nodes become reachable.
 * @param {number} nodeId
 */
export function clearNode(nodeId) {
  assertRun();
  run.clearedNodes.add(nodeId);
}

/**
 * Replace the map node list (called by MapManager after generation).
 * @param {MapNode[]} nodes
 */
export function setMapNodes(nodes) {
  assertRun();
  run.mapNodes = nodes;
}

// ─────────────────────────────────────────────────────────────────────────────
// RUN MUTATORS  (player economy — called by CombatManager / MapManager)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Add gold to the in-run player. Clamps at 0 (can't go negative).
 * @param {number} delta — may be negative (shop purchase, gold steal)
 */
export function addGold(delta) {
  assertRun();
  run.playerPersist.gold = Math.max(0, run.playerPersist.gold + delta);
}

/**
 * Award XP and handle level-ups.
 * Fires a level-up for each threshold crossed in a single call.
 *
 * @param {number} amount
 * @returns {{ levelsGained: number, newLevel: number, spGained: number }}
 */
export function addXP(amount) {
  assertRun();
  const p = run.playerPersist;
  p.xp += amount;

  let levelsGained = 0;
  while (p.xp >= p.xpNext) {
    p.xp     -= p.xpNext;
    p.level  += 1;
    p.xpNext  = Math.floor(p.xpNext * 1.4);
    p.skillPoints = (p.skillPoints || 0) + 1;
    addPersistSP(1);           // keep persist.skillPoints in sync
    p.hp = Math.min(p.stats.maxHp, p.hp + 15); // partial heal on level-up
    levelsGained++;
  }

  return { levelsGained, newLevel: p.level, spGained: levelsGained };
}

/**
 * Apply an item's stat bonus to the run's playerPersist (and optionally to a
 * live battle player object).
 *
 * @param {import('./DataConfig.js').ItemDef} item
 * @param {Object|null} [livePlayer] — the in-battle player object, if present
 */
export function applyItem(item, livePlayer = null) {
  assertRun();
  const p = run.playerPersist;

  // Record item in inventory
  p.items = p.items || [];
  p.items.push({ ...item });

  // Apply stat bonus to persist
  p.stats[item.stat] = (p.stats[item.stat] || 0) + item.val;

  // HP items: also restore the stat delta to current HP
  if (item.stat === 'maxHp') {
    p.hp = Math.min(p.stats.maxHp, p.hp + item.val);
  }

  // Mirror onto the live battle player so the effect is immediate
  if (livePlayer) {
    livePlayer.stats[item.stat] = (livePlayer.stats[item.stat] || 0) + item.val;
    if (item.stat === 'maxHp') {
      livePlayer.hp = Math.min(livePlayer.stats.maxHp, livePlayer.hp + item.val);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BATTLE FLAG MUTATORS  (called exclusively by CombatManager)
// ─────────────────────────────────────────────────────────────────────────────

/** @param {boolean} val */
export function setRunning(val)      { battle.running      = val; }
/** @param {boolean} val */
export function setBattleActive(val) { battle.battleActive = val; }
/** @param {boolean} val */
export function setPaused(val)       { battle.paused       = val; }

// ─────────────────────────────────────────────────────────────────────────────
// SYNC  — called by CombatManager at battle end to flush live state back
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Copy the live in-battle player's mutable state back to run.playerPersist.
 * Called by CombatManager before transitioning away from a battle scene
 * (win, death, surrender).
 *
 * @param {Object} livePlayer — the in-battle player object
 */
export function syncPlayerToRun(livePlayer) {
  assertRun();
  if (!livePlayer) return;
  const p = run.playerPersist;

  p.hp           = Math.max(1, livePlayer.hp);
  p.mp           = livePlayer.mp;
  p.shield       = livePlayer.shield || 0;
  p.level        = livePlayer.level;
  p.xp           = livePlayer.xp;
  p.xpNext       = livePlayer.xpNext;
  p.gold         = livePlayer.gold;
  p.skillPoints  = livePlayer.skillPoints || 0;
  p.stats        = { ...livePlayer.stats };
}

// ─────────────────────────────────────────────────────────────────────────────
// PERSISTENCE  (localStorage)
// ─────────────────────────────────────────────────────────────────────────────

const SAVE_KEY = 'dd_persist_v1';

/**
 * Serialise persist state to localStorage.
 * Only cross-run data is saved; run and battle state are intentionally
 * excluded (a browser refresh always returns to the lobby).
 */
export function save() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      skillPoints:    persist.skillPoints,
      skillRanks:     persist.skillRanks,
      bossesDefeated: persist.bossesDefeated,
      ascension:      persist.ascension,
      playerClass:    persist.playerClass,
      equippedSpells: persist.equippedSpells,
    }));
  } catch (e) {
    console.warn('GameState.save() failed:', e);
  }
}

/**
 * Load persist state from localStorage.
 * Silently ignored if no save exists or data is corrupt.
 * Call once at app start before rendering the lobby.
 */
export function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);

    if (typeof data.skillPoints    === 'number') persist.skillPoints    = data.skillPoints;
    if (typeof data.bossesDefeated === 'number') persist.bossesDefeated = data.bossesDefeated;
    if (typeof data.ascension      === 'number') persist.ascension      = Math.min(3, data.ascension);
    if (data.playerClass in CLASS_BASE_STATS)    persist.playerClass    = data.playerClass;

    if (Array.isArray(data.skillRanks) && data.skillRanks.length === SKILL_COUNT) {
      persist.skillRanks = data.skillRanks.map(r => (typeof r === 'number' ? r : 0));
    }

    if (Array.isArray(data.equippedSpells)) {
      // Accept up to 4 string entries; ignore anything else
      persist.equippedSpells = data.equippedSpells
        .filter(s => typeof s === 'string')
        .slice(0, 4);
    }
  } catch (e) {
    console.warn('GameState.load() failed — starting fresh:', e);
  }
}

/**
 * Wipe the localStorage save and reset persist state to defaults.
 * Useful for a "New Game" button.
 */
export function resetPersist() {
  try { localStorage.removeItem(SAVE_KEY); } catch (_) { /* ignore */ }
  persist.skillPoints    = 0;
  persist.skillRanks     = new Array(SKILL_COUNT).fill(0);
  persist.bossesDefeated = 0;
  persist.ascension      = 0;
  persist.playerClass    = 'warrior';
  persist.equippedSpells = ['fireball', 'heal', 'arcane', 'frostbolt'];
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Throw a clear error if a run-scoped mutator is called outside of a run. */
function assertRun() {
  if (!run) throw new Error('GameState: no active run. Call startRun() first.');
}
