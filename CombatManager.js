/**
 * CombatManager.js — Dungeon's Descent
 *
 * Owns everything that happens inside a battle scene:
 *   • Arena / boss-arena procedural generation
 *   • Player + enemy spawning
 *   • The game loop (updateGame / gameLoop)
 *   • Player movement, dash, spell casting, auto-attack
 *   • Full enemy AI (14 types) + boss AI
 *   • Hazard simulation (projectiles, flame pillars, annihilation sphere)
 *   • Damage, status effects, death, XP/gold gain
 *   • Win / death result screens
 *   • Loot pick overlay
 *   • Pause / resume
 *
 * Dependencies (imported, never circular)
 * ────────────────────────────────────────
 *   GameState   — state reads + controlled mutators
 *   DataConfig  — static data (spells, enemy configs, items)
 *   InputManager — movement poll + camera-offset push
 *
 * Outbound communication
 * ──────────────────────
 *   Fires CustomEvents on `document` when the scene needs to hand off:
 *     'combat:win'         — normal node cleared
 *     'combat:bossKill'    — boss defeated (MapManager + persist update)
 *     'combat:playerDied'  — player died
 *   MapManager / the app shell listens for these and calls backToMap() /
 *   goLobby() accordingly, preventing CombatManager from importing
 *   MapManager (which would create a circular dep).
 *
 * Public API
 * ──────────
 *   startBattle(node)     — entry point called by MapManager
 *   castSpell(slot)       — called by InputManager action handler
 *   doDash()              — called by InputManager action handler
 *   cycleTarget()         — called by InputManager action handler
 *   handleClick(wx, wy)   — called by InputManager click event
 *   togglePause()         — called by InputManager / pause button
 *   openPause() / closePause()
 *   surrender()           — pause-menu surrender button
 *
 * Read-only state exposed for RenderEngine
 * ─────────────────────────────────────────
 *   player, enemies, particles, floatingTexts,
 *   bossHazards, enemyHazards,
 *   map, rooms, isBoss,
 *   camX, camY,
 *   spellCDs, gcd, GCD, atkTimer, dashTimer, dashActive,
 *   msgs, target
 */

import * as GS          from './GameState.js';
import * as DC          from './DataConfig.js';
import * as InputManager from './InputManager.js';
import { rollItems }    from './DataConfig.js';
import * as SM          from './SoundManager.js';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

export const TILE         = 32;
const COLS                = 30;
const ROWS                = 22;
const BCOLS               = 20;  // boss arena
const BROWS               = 16;
const T                   = Object.freeze({ WALL: 0, FLOOR: 1 });
export const TARGET_RANGE = 360;
export const GCD          = 1.5;   // global cooldown in seconds
const DASH_DURATION       = 0.22;  // seconds of dash state
const DASH_CD             = 4;     // cooldown in seconds
const DASH_SPEED          = 340;   // px/s while dashing
const WALK_SPEED          = 145;   // px/s normal
const MELEE_RANGE         = 52;    // px for auto-attack
const ATK_COLLISION       = 14;    // px for enemy melee contact

// ─────────────────────────────────────────────────────────────────────────────
// MODULE-LEVEL BATTLE STATE
// (reset at the start of every startBattle() call)
// ─────────────────────────────────────────────────────────────────────────────

/** @type {number[][]} */
export let map             = [];
/** @type {Array<{x,y,w,h,cx,cy}>} */
export let rooms           = [];
/** @type {Object[]} */
export let enemies         = [];
/** @type {Object[]} */
export let particles       = [];
/** @type {Object[]} */
export let floatingTexts   = [];
/** @type {Object[]} */
export let bossHazards     = [];
/** @type {Object[]} */
export let enemyHazards    = [];

/** The live in-battle player object (deep copy of playerPersist at spawn). */
export let player          = null;
/** Currently locked-on enemy. */
export let target          = null;
/** True when the arena contains a boss. */
export let isBoss          = false;

/** Spell cooldown timers: spellId → remaining seconds. */
export let spellCDs        = {};
/** Global cooldown remaining (seconds). */
export let gcd             = 0;
/** Auto-attack cooldown remaining. */
export let atkTimer        = 0;
/** Dash cooldown remaining. */
export let dashTimer       = 0;
/** Dash active duration remaining (> 0 while mid-dash). */
export let dashActive      = 0;

/** Combat message log (newest first, capped at 4). */
export let msgs            = [];

/** Camera world-space origin. */
export let camX            = 0;
export let camY            = 0;

/** Timestamp of the last game-loop tick. */
let _lastT   = 0;

// ─────────────────────────────────────────────────────────────────────────────
// ARENA GENERATION
// ─────────────────────────────────────────────────────────────────────────────

function _buildArena() {
  isBoss = false;
  map = []; rooms = []; enemies = []; particles = [];
  floatingTexts = []; bossHazards = []; enemyHazards = [];

  for (let y = 0; y < ROWS; y++) map.push(new Array(COLS).fill(T.WALL));

  let attempts = 0;
  while (rooms.length < 6 && attempts++ < 400) {
    const rw = 5 + ~~(Math.random() * 5);
    const rh = 4 + ~~(Math.random() * 4);
    const rx = 1 + ~~(Math.random() * (COLS - rw - 2));
    const ry = 1 + ~~(Math.random() * (ROWS - rh - 2));

    if (rooms.some(r =>
      rx < r.x + r.w + 2 && rx + rw > r.x - 2 &&
      ry < r.y + r.h + 2 && ry + rh > r.y - 2
    )) continue;

    rooms.push({ x: rx, y: ry, w: rw, h: rh, cx: rx + ~~(rw / 2), cy: ry + ~~(rh / 2) });
    for (let y2 = ry; y2 < ry + rh; y2++)
      for (let x2 = rx; x2 < rx + rw; x2++)
        map[y2][x2] = T.FLOOR;
  }

  // Connect rooms with corridors
  for (let i = 1; i < rooms.length; i++) {
    let a = rooms[i - 1], b = rooms[i];
    let x = a.cx, y = a.cy;
    while (x !== b.cx) { map[y][x] = T.FLOOR; x += x < b.cx ? 1 : -1; }
    while (y !== b.cy) { map[y][x] = T.FLOOR; y += y < b.cy ? 1 : -1; }
  }
}

function _buildBossArena() {
  isBoss = true;
  map = []; rooms = []; enemies = []; particles = [];
  floatingTexts = []; bossHazards = []; enemyHazards = [];

  for (let y = 0; y < BROWS; y++) map.push(new Array(BCOLS).fill(T.WALL));
  for (let y = 2; y < BROWS - 2; y++)
    for (let x = 2; x < BCOLS - 2; x++)
      map[y][x] = T.FLOOR;

  // Corner pillars
  [[4, 3], [BCOLS - 6, 3], [4, BROWS - 5], [BCOLS - 6, BROWS - 5]]
    .forEach(([px, py]) => {
      for (let dy = 0; dy < 2; dy++)
        for (let dx = 0; dx < 2; dx++)
          map[py + dy][px + dx] = T.WALL;
    });

  rooms.push({ x: 2, y: 2, w: BCOLS - 4, h: BROWS - 4, cx: ~~(BCOLS / 2), cy: ~~(BROWS / 2) });
}

// ─────────────────────────────────────────────────────────────────────────────
// TILE / COLLISION HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function _cols()  { return isBoss ? BCOLS : COLS; }
function _rows()  { return isBoss ? BROWS : ROWS; }

export function tileAt(wx, wy) {
  const tx = ~~(wx / TILE), ty = ~~(wy / TILE);
  if (tx < 0 || ty < 0 || tx >= _cols() || ty >= _rows()) return T.WALL;
  return map[ty][tx];
}

function _isFloor(wx, wy) { return tileAt(wx, wy) === T.FLOOR; }

export function canMove(x, y, r = 10) {
  return _isFloor(x - r, y - r) && _isFloor(x + r, y - r) &&
         _isFloor(x - r, y + r) && _isFloor(x + r, y + r);
}

// ─────────────────────────────────────────────────────────────────────────────
// PATHFINDING (A*)
// ─────────────────────────────────────────────────────────────────────────────

function _aStar(sx, sy, gx, gy) {
  const C = _cols(), R = _rows();
  const tx0 = ~~(sx / TILE), ty0 = ~~(sy / TILE);
  const tx1 = ~~(gx / TILE), ty1 = ~~(gy / TILE);
  if (tx0 === tx1 && ty0 === ty1) return null;

  const key   = (x, y) => y * C + x;
  const h     = (x, y) => Math.abs(x - tx1) + Math.abs(y - ty1);
  const DIRS  = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const open  = [{ x: tx0, y: ty0, g: 0, f: h(tx0, ty0), parent: null }];
  const closed = new Set();
  const gScore = { [key(tx0, ty0)]: 0 };
  let iters = 0;

  while (open.length && iters++ < 400) {
    open.sort((a, b) => a.f - b.f);
    const cur = open.shift();
    const ck  = key(cur.x, cur.y);
    if (closed.has(ck)) continue;
    closed.add(ck);

    if (cur.x === tx1 && cur.y === ty1) {
      const path = [];
      let node = cur;
      while (node) { path.unshift({ x: node.x, y: node.y }); node = node.parent; }
      return path;
    }

    for (const [dx, dy] of DIRS) {
      const nx = cur.x + dx, ny = cur.y + dy;
      if (nx < 0 || ny < 0 || nx >= C || ny >= R) continue;
      if (map[ny][nx] !== T.FLOOR) continue;
      const nk = key(nx, ny);
      if (closed.has(nk)) continue;
      const ng = cur.g + 1;
      if (ng < (gScore[nk] ?? Infinity)) {
        gScore[nk] = ng;
        open.push({ x: nx, y: ny, g: ng, f: ng + h(nx, ny), parent: cur });
      }
    }
  }
  return null;
}

function _getNextWaypoint(e, targetX, targetY) {
  const now = performance.now();
  if (!e._path ||
      now - e._pathTime > 500 ||
      e._pathGoalX !== ~~(targetX / TILE) ||
      e._pathGoalY !== ~~(targetY / TILE)) {
    e._path      = _aStar(e.x, e.y, targetX, targetY);
    e._pathTime  = now;
    e._pathGoalX = ~~(targetX / TILE);
    e._pathGoalY = ~~(targetY / TILE);
    e._pathIdx   = 1;
  }
  if (!e._path || e._path.length < 2) return null;
  if (e._pathIdx >= e._path.length) e._pathIdx = e._path.length - 1;
  const wp = e._path[e._pathIdx];
  const wpX = wp.x * TILE + TILE / 2, wpY = wp.y * TILE + TILE / 2;
  if (Math.hypot(e.x - wpX, e.y - wpY) < TILE * 0.6)
    e._pathIdx = Math.min(e._pathIdx + 1, e._path.length - 1);
  return e._path[e._pathIdx];
}

function _moveAlongPath(e, targetX, targetY, speed, dt) {
  const wp = _getNextWaypoint(e, targetX, targetY);
  const tx = wp ? wp.x * TILE + TILE / 2 : targetX;
  const ty = wp ? wp.y * TILE + TILE / 2 : targetY;
  const dx = tx - e.x, dy = ty - e.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) return;
  const spd = speed * 45 * (e.slow > 0 ? 0.4 : 1) * dt / dist;
  const nx = e.x + dx * spd, ny = e.y + dy * spd;
  if (canMove(nx, e.y, 5)) e.x = nx; else e._path = null;
  if (canMove(e.x, ny, 5)) e.y = ny; else e._path = null;
}

export function hasLOS(ax, ay, bx, by) {
  const steps = ~~(Math.hypot(bx - ax, by - ay) / TILE * 2) + 2;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (!_isFloor(ax + (bx - ax) * t, ay + (by - ay) * t)) return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// SPAWN
// ─────────────────────────────────────────────────────────────────────────────

function _spawnPlayer() {
  const r = rooms[0];
  const pp = GS.run.playerPersist;
  player = {
    ...pp,
    x:           r.cx * TILE + TILE / 2,
    y:           r.cy * TILE + TILE / 2,
    facing:      { x: 1, y: 0 },
    invincible:  0,
    stats:       { ...pp.stats },
    // Reset transient combat modifiers so carry-over from persist is clean
    slowFactor:  1,
    dmgOutMult:  1,
    dmgInMult:   1,
    curseTimer:  0,
    burnTimer:   0,
    poisonTimer: 0,
  };
}

function _spawnPlayerBoss() {
  const r = rooms[0];
  const pp = GS.run.playerPersist;
  player = {
    ...pp,
    x:           (r.x + 1) * TILE + TILE / 2,
    y:           (r.y + 1) * TILE + TILE / 2,
    facing:      { x: 1, y: 0 },
    invincible:  0,
    stats:       { ...pp.stats },
    slowFactor:  1,
    dmgOutMult:  1,
    dmgInMult:   1,
    curseTimer:  0,
    burnTimer:   0,
    poisonTimer: 0,
  };
}

function _mkEnemy(x, y, type, scale) {
  const base = DC.ENEMY_CONFIGS[type];
  if (!base) {
    console.warn(`CombatManager: unknown enemy type "${type}"`);
    return null;
  }
  const cfg = DC.scaleEnemy(base, scale, GS.persist.ascension);
  return {
    type,
    x, y,
    boss:         false,
    aggro:        false,
    atkTimer:     0,
    slow:         0,
    wanderAngle:  Math.random() * Math.PI * 2,
    wanderTimer:  0,
    _path:        null,
    _pathTime:    0,
    _pathGoalX:   0,
    _pathGoalY:   0,
    _pathIdx:     0,
    auraDmgMult:      1,
    auraDmgReduction: 1,
    ...cfg,
  };
}

function _mkBoss(scale) {
  const hp = ~~(300 * scale);
  return {
    type:             'boss',
    boss:             true,
    name:             'BOSS',
    color:            '#b33',
    size:             22,
    x:                ~~(BCOLS / 2) * TILE + TILE / 2,
    y:                ~~(BROWS / 2) * TILE + TILE / 2,
    hp,
    maxHp:            hp,
    spd:              0,
    dmg:              ~~(12 * scale),
    atkRate:          1.8,
    atkTimer:         0,
    aggroRange:       999,
    aggro:            true,
    slow:             0,
    xp:               200,
    gold:             ~~(48 * scale * 0.64),
    bossTimer:        4,
    bossAttack:       null,
    bossChargeTimer:  0,
    _path:            null,
    _pathTime:        0,
    auraDmgMult:      1,
    auraDmgReduction: 1,
  };
}

function _spawnNormal(scale, act) {
  const pool = DC.ACT_ENEMIES[act] || DC.ACT_ENEMIES[1];
  rooms.slice(1).forEach(r => {
    const baseCount = 2 + ~~(Math.random() * 3);
    const extra     = GS.persist.ascension >= 1 ? 5 * GS.persist.ascension : 0;
    for (let j = 0; j < baseCount + extra; j++) {
      const type = pool[~~(Math.random() * pool.length)];
      const e    = _mkEnemy(
        (r.x + 1 + Math.random() * (r.w - 2)) * TILE,
        (r.y + 1 + Math.random() * (r.h - 2)) * TILE,
        type, scale
      );
      if (e) enemies.push(e);
    }
  });
}

function _scaleFromCurrentNode() {
  const nodeId = GS.run.currentNodeIdx;
  const node   = GS.run.mapNodes.find(n => n.id === nodeId);
  return 1 + (node?.col || 1) * 0.2;
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC ENTRY — startBattle
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Transition from the map screen into a battle scene.
 * Called by MapManager when the player enters a combat or boss node.
 *
 * @param {{ id: number, col: number, type: string }} node
 * @param {HTMLCanvasElement} canvas — main game canvas (for resize)
 */
export function startBattle(node, canvas) {
  // Resize canvas to current container dimensions
  _resizeCanvas(canvas);

  const scale = 1 + (node.col || 1) * 0.2;

  if (node.type === 'boss') {
    _buildBossArena();
    enemies.push(_mkBoss(scale));
    _spawnPlayerBoss();
  } else {
    _buildArena();
    _spawnNormal(scale, DC.actFromCol(node.col));
    _spawnPlayer();
  }

  // Reset per-battle timers and state
  target     = null;
  spellCDs   = {};
  gcd        = 0;
  atkTimer   = 0;
  dashTimer  = 0;
  dashActive = 0;
  msgs       = [];

  GS.setRunning(true);
  GS.setBattleActive(true);
  GS.setPaused(false);

  _lastT = performance.now();
  requestAnimationFrame(_gameLoop);
}

// ─────────────────────────────────────────────────────────────────────────────
// GAME LOOP
// ─────────────────────────────────────────────────────────────────────────────

function _gameLoop(ts) {
  if (!GS.battle.running) return;
  const dt = Math.min((ts - _lastT) / 1000, 0.05);
  _lastT = ts;
  updateGame(dt);
  // Notify RenderEngine via event (decoupled — no direct import)
  document.dispatchEvent(new CustomEvent('combat:tick'));
  requestAnimationFrame(_gameLoop);
}

/**
 * Core per-frame update. Exported so tests can drive it directly.
 * @param {number} dt — delta time in seconds
 */
export function updateGame(dt) {
  _updatePlayer(dt);
  _tickCooldowns(dt);
  _tickStatusEffects(dt);
  _updateTargetTracking();
  tryAutoAttack();
  _updateEnemies(dt);
  _updateEnemyHazards(dt);
  _updateBossHazards(dt);
  _updateParticles(dt);

  // Camera follows player
  const wrap = document.getElementById('canvas-wrap');
  if (wrap) {
    camX = player.x - wrap.clientWidth  / 2;
    camY = player.y - wrap.clientHeight / 2;
    InputManager.setCameraOffset(camX, camY);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PLAYER UPDATE
// ─────────────────────────────────────────────────────────────────────────────

function _updatePlayer(dt) {
  const { x: dx, y: dy } = InputManager.movement();
  const speed = dashActive > 0 ? DASH_SPEED : WALK_SPEED;
  const factor = player.slowFactor || 1;

  if (dx !== 0 || dy !== 0) player.facing = { x: dx, y: dy };

  const nx = player.x + dx * speed * factor * dt;
  const ny = player.y + dy * speed * factor * dt;
  if (canMove(nx, player.y)) player.x = nx;
  if (canMove(player.x, ny)) player.y = ny;

  if (dashActive > 0) dashActive  = Math.max(0, dashActive  - dt);
  if (dashTimer  > 0) dashTimer   = Math.max(0, dashTimer   - dt);
  if (player.invincible > 0) player.invincible -= dt;

  // Face locked target
  if (target && enemies.includes(target)) {
    const tdx = target.x - player.x, tdy = target.y - player.y;
    const tl  = Math.hypot(tdx, tdy);
    if (tl > 0) player.facing = { x: tdx / tl, y: tdy / tl };
  }

  // HP/MP regen
  player.hp = Math.min(player.stats.maxHp, player.hp + (player.stats.hpRegen || 0) * dt);
  player.mp = Math.min(player.stats.maxMp, player.mp + (player.stats.mpRegen || 0) * dt);
}

function _tickCooldowns(dt) {
  if (gcd > 0) gcd = Math.max(0, gcd - dt);
  if (atkTimer > 0) atkTimer = Math.max(0, atkTimer - dt);
  GS.persist.equippedSpells.forEach(id => {
    if (id && spellCDs[id] > 0) spellCDs[id] = Math.max(0, spellCDs[id] - dt);
  });
}

function _tickStatusEffects(dt) {
  // Slow duration
  if ((player.slowDuration || 0) > 0) {
    player.slowDuration -= dt;
    if (player.slowDuration <= 0) { player.slowFactor = 1; player.slowDuration = 0; }
  }
  // Damage-out debuff
  if ((player.dmgOutDuration || 0) > 0) {
    player.dmgOutDuration -= dt;
    if (player.dmgOutDuration <= 0) { player.dmgOutMult = 1; player.dmgOutDuration = 0; }
  }
  // Damage-in debuff
  if ((player.dmgInDuration || 0) > 0) {
    player.dmgInDuration -= dt;
    if (player.dmgInDuration <= 0) { player.dmgInMult = 1; player.dmgInDuration = 0; }
  }
  // Curse (kills player after timer expires)
  if (player.curseTimer > 0) {
    player.curseTimer -= dt;
    if (player.curseTimer <= 0) {
      player.hp = 0;
      _triggerDeath();
      return;
    }
  }
  // Burn DoT
  if (player.burnTimer > 0) {
    player.burnTimer -= dt;
    player.hp -= (player.burnDps || 4) * dt;
    if (player.hp <= 0) { player.hp = 0; _triggerDeath(); return; }
  }
  // Poison DoT
  if (player.poisonTimer > 0) {
    player.poisonTimer -= dt;
    player.hp -= (player.poisonDps || 3) * dt;
    if (player.hp <= 0) { player.hp = 0; _triggerDeath(); return; }
  }
}

function _updateTargetTracking() {
  if (!target) return;
  if (!enemies.includes(target) ||
      Math.hypot(target.x - player.x, target.y - player.y) > TARGET_RANGE ||
      !hasLOS(player.x, player.y, target.x, target.y)) {
    target = null;
  }
}

function _updateParticles(dt) {
  particles = particles.filter(p => {
    p.x  += p.vx;
    p.y  += p.vy;
    p.vy += 0.04;
    p.life -= dt * 2;
    return p.life > 0;
  });
  floatingTexts = floatingTexts.filter(f => {
    f.y    += f.dy;
    f.life -= dt;
    return f.life > 0;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// TARGETING
// ─────────────────────────────────────────────────────────────────────────────

function _autoTarget() {
  const alive = enemies.filter(e => e.hp > 0);
  if (!alive.length) { target = null; return; }
  let best = null, bd = Infinity;
  alive.forEach(e => {
    const d = Math.hypot(e.x - player.x, e.y - player.y);
    if (d <= TARGET_RANGE && hasLOS(player.x, player.y, e.x, e.y) && d < bd) {
      bd = d; best = e;
    }
  });
  target = best;
}

export function cycleTarget() {
  const alive = enemies.filter(e => e.hp > 0);
  if (!alive.length) { target = null; return; }
  if (!target || !alive.includes(target)) { _autoTarget(); return; }
  const visible = alive.filter(e =>
    Math.hypot(e.x - player.x, e.y - player.y) <= TARGET_RANGE &&
    hasLOS(player.x, player.y, e.x, e.y)
  );
  if (!visible.length) { target = null; return; }
  target = visible[(visible.indexOf(target) + 1) % visible.length];
}

/**
 * Handle a canvas click converted to world-space by InputManager.
 * @param {number} wx
 * @param {number} wy
 */
export function handleClick(wx, wy) {
  let best = null, bd = Infinity;
  enemies.forEach(en => {
    const d = Math.hypot(en.x - wx, en.y - wy);
    if (d < 36 &&
        Math.hypot(en.x - player.x, en.y - player.y) <= TARGET_RANGE &&
        hasLOS(player.x, player.y, en.x, en.y) &&
        d < bd) {
      bd = d; best = en;
    }
  });
  target = best;
}

// ─────────────────────────────────────────────────────────────────────────────
// COMBAT ACTIONS
// ─────────────────────────────────────────────────────────────────────────────

export function doDash() {
  if (dashTimer > 0) return;
  dashActive        = DASH_DURATION;
  dashTimer         = DASH_CD;
  player.invincible = 0.3;
  _addMsg('Dash!');
}

/**
 * Cast the spell in the given hotbar slot (0–3).
 * @param {number} slot
 */
export function castSpell(slot) {
  if (gcd > 0)      { _addMsg('GCD!'); return; }
  const id = GS.persist.equippedSpells[slot];
  if (!id) return;
  const sp = DC.SPELL_BY_ID[id];
  if (!sp) return;

  if ((spellCDs[id] || 0) > 0) { _addMsg(`${sp.name}: ${spellCDs[id].toFixed(1)}s`); return; }
  if (player.mp < sp.mpCost)   { _addMsg('Not enough mana!'); return; }

  player.mp        = Math.max(0, player.mp - sp.mpCost);
  gcd              = GCD;
  spellCDs[id]     = sp.cd;

  // Heal
  if (sp.type === 'heal') {
    const h = ~~(20 + player.stats.magic * sp.healMult);
    player.hp = Math.min(player.stats.maxHp, player.hp + h);
    _spawnFT(player.x, player.y, '#4d8', `+${h}`);
    _addMsg(`${sp.name}: +${h}`);
    return;
  }

  // Shield
  if (sp.type === 'shield') {
    player.shield = (player.shield || 0) + sp.shieldAmt;
    _spawnFT(player.x, player.y, '#8cf', `🛡+${sp.shieldAmt}`);
    _addMsg(sp.name);
    return;
  }

  // Damage / drain
  const tgts = sp.aoe
    ? [...enemies]
    : (target && hasLOS(player.x, player.y, target.x, target.y) ? [target] : []);

  if (!tgts.length) { _addMsg('No target in sight!'); return; }

  tgts.forEach(e => {
    if (!hasLOS(player.x, player.y, e.x, e.y)) return;
    const dmg = ~~((10 + player.stats.magic * sp.dmgMult) * (Math.random() * 0.2 + 0.9));
    _dealDmg(e, dmg * player.dmgOutMult, sp.id === 'frostbolt' ? '#8cf' : '#f84');
    if (sp.slow) e.slow = sp.slow;
    if (sp.type === 'drain') {
      const leech = ~~(dmg * 0.5);
      player.hp = Math.min(player.stats.maxHp, player.hp + leech);
      _spawnFT(player.x, player.y, '#c88', `+${leech}`);
    }
  });
  _addMsg(`${sp.name}→${tgts.length}`);
}

export function tryAutoAttack() {
  if (!target || !enemies.includes(target) || atkTimer > 0) return;
  if (Math.hypot(target.x - player.x, target.y - player.y) > MELEE_RANGE) return;
  if (!hasLOS(player.x, player.y, target.x, target.y)) return;
  atkTimer         = player.stats.atkSpd || 1;
  const dmg        = (8 + (player.stats.power || 5) * 2) * player.dmgOutMult;
  _dealDmg(target, dmg, '#fa6');
}

// ─────────────────────────────────────────────────────────────────────────────
// DAMAGE SYSTEM
// ─────────────────────────────────────────────────────────────────────────────

function _dealDmg(e, dmg, color) {
  dmg     *= (e.auraDmgReduction || 1);
  e.hp    -= dmg;
  e.aggro  = true;
  _spawnFT(e.x, e.y, color, `-${~~dmg}`);
  // Play hit sound
  SM.play('hit');
  if (e.hp <= 0) _killEnemy(e);
}

function _killEnemy(e) {
  // Skeleton undying proc
  if (e.type === 'skeleton' && !e.undyingProc) {
    if (Math.random() < (e.undyingChance || 0.4)) {
      e.hp           = 1;
      e.undyingProc  = true;
      _spawnFT(e.x, e.y, '#fff', 'Undying!');
      return;
    }
  }

  // XP and gold are committed through GameState so persist stays in sync
  const goldEarned = Math.floor(e.gold);
  GS.addGold(goldEarned);
  player.gold = GS.run.playerPersist.gold; // keep local copy current

  const { levelsGained, newLevel } = GS.addXP(e.xp);
  // Mirror level data back onto the live player object
  player.xp          = GS.run.playerPersist.xp;
  player.xpNext      = GS.run.playerPersist.xpNext;
  player.level       = GS.run.playerPersist.level;
  player.skillPoints = GS.run.playerPersist.skillPoints;
  if (levelsGained > 0) {
    player.hp = Math.min(player.stats.maxHp, player.hp + 15 * levelsGained);
    _addMsg(`Level Up! Lv.${newLevel} +${levelsGained} SP`);
  }

  _spawnFT(e.x, e.y, '#fc6', `+${goldEarned}g`);
  enemies = enemies.filter(x => x !== e);
  if (target === e || !target || !enemies.includes(target)) _autoTarget();
  document.dispatchEvent(new CustomEvent('combat:goldChanged'));

  if (enemies.length === 0) setTimeout(() => _onCombatWin(), 400);
}

function _applyDmgToPlayer(dmg, attacker = null) {
  if (player.invincible > 0) return;
  dmg = Math.ceil(dmg) * (player.dmgInMult || 1);

  // Shield absorbs first
  if (player.shield > 0) {
    const absorbed = Math.min(player.shield, dmg);
    player.shield -= absorbed;
    dmg           -= absorbed;
  }

  if (dmg > 0) {
    player.hp -= dmg;
    _spawnFT(player.x, player.y, '#f44', `-${~~dmg}`);

    // Ascension 3: random on-hit debuffs
    if (GS.persist.ascension >= 3 && attacker?.aggro !== undefined) {
      const r = Math.random();
      if      (r < 0.20) { player.slowFactor = 0.6; player.slowDuration = 4; _addMsg('Slowed!'); }
      else if (r < 0.35) { player.dmgOutMult = 0.6; player.dmgOutDuration = 4; _addMsg('Weakened!'); }
      else if (r < 0.50) { player.dmgInMult  = 1.4; player.dmgInDuration  = 4; _addMsg('Vulnerable!'); }
      else if (r < 0.51) { player.curseTimer = 30;  _addMsg('CURSED (dies in 30s)'); }
    }

    if (attacker) {
      if (attacker.goldSteal && player.gold > 0) {
        const stolen = Math.min(attacker.goldSteal, player.gold);
        player.gold -= stolen;
        GS.addGold(-stolen);
        _addMsg(`Stolen ${stolen}g!`);
        document.dispatchEvent(new CustomEvent('combat:goldChanged'));
      }
      if (attacker.slowOnHit)    { player.slowFactor = 0.6; player.slowDuration = attacker.slowOnHit; }
      if (attacker.burnDps)      { player.burnTimer  = attacker.burnDur; player.burnDps  = attacker.burnDps;  }
      if (attacker.poisonDps)    { player.poisonTimer= attacker.poisonDur; player.poisonDps= attacker.poisonDps; }
      if (attacker.stealHpMp)    {
        player.hp -= attacker.stealHpMp;
        player.mp -= attacker.stealHpMp;
        attacker.hp = Math.min(attacker.maxHp, attacker.hp + attacker.stealHpMp);
      }
      if (attacker.debuffDmgOut) { player.dmgOutMult = attacker.debuffDmgOut; player.dmgOutDuration = 5; }
    }
  }

  if (player.hp <= 0) { player.hp = 0; _triggerDeath(); }
}

// ─────────────────────────────────────────────────────────────────────────────
// WIN / DEATH / LOOT
// ─────────────────────────────────────────────────────────────────────────────

function _onCombatWin() {
  GS.setRunning(false);
  GS.setBattleActive(false);
  GS.syncPlayerToRun(player);
  GS.clearNode(GS.run.currentNodeIdx);
  GS.save();

  const node = GS.run.mapNodes.find(n => n.id === GS.run.currentNodeIdx);
  if (node?.type === 'boss') {
    GS.recordBossKill();
    document.dispatchEvent(new CustomEvent('combat:bossKill'));
    _showFinalResult();
  } else {
    document.dispatchEvent(new CustomEvent('combat:win'));
    _showLootPick();
  }
}

function _triggerDeath() {
  GS.setRunning(false);
  GS.setBattleActive(false);
  document.dispatchEvent(new CustomEvent('combat:playerDied'));
  _showDeathResult();
}

function _showFinalResult() {
  const rb = document.getElementById('res-btns');
  rb.innerHTML = '';

  const lobbyBtn = document.createElement('button');
  lobbyBtn.className   = 'rbtn';
  lobbyBtn.textContent = 'Return to Lobby';
  lobbyBtn.onclick     = () => document.dispatchEvent(new CustomEvent('nav:goLobby'));
  rb.appendChild(lobbyBtn);

  if (GS.persist.ascension < 3) {
    const ascBtn = document.createElement('button');
    ascBtn.className   = 'rbtn';
    ascBtn.textContent = 'Ascend (next difficulty)';
    ascBtn.onclick     = () => {
      GS.incrementAscension();
      document.dispatchEvent(new CustomEvent('nav:goLobby'));
    };
    rb.appendChild(ascBtn);
  }

  document.getElementById('res-title').textContent = '⚔ DUNGEON CLEARED!';
  document.getElementById('res-title').style.color = '#fa8';
  document.getElementById('res-desc').textContent  =
    `Boss defeated! Tier ${Math.min(4, GS.persist.bossesDefeated + 1)} unlocked.\n` +
    `Lv.${player.level} · ${player.gold} gold`;
  document.getElementById('result-overlay').style.display = 'flex';
}

function _showDeathResult() {
  const rb = document.getElementById('res-btns');
  rb.innerHTML = '';
  const btn = document.createElement('button');
  btn.className   = 'rbtn danger';
  btn.textContent = 'Return to Lobby';
  btn.onclick     = () => document.dispatchEvent(new CustomEvent('nav:goLobby'));
  rb.appendChild(btn);

  document.getElementById('res-title').textContent = 'You Died';
  document.getElementById('res-title').style.color = '#f44';
  document.getElementById('res-desc').textContent  =
    `Defeated in battle.\nLevel ${player.level} · ${player.gold} gold`;
  document.getElementById('result-overlay').style.display = 'flex';
}

function _showLootPick() {
  const lg = document.getElementById('loot-grid');
  lg.innerHTML = '';
  rollItems(3).forEach(it => {
    const d = document.createElement('div');
    d.className = `loot-card ${it.rarity}`;
    d.innerHTML =
      `<div style="font-size:22px">${it.icon}</div>` +
      `<div style="font-weight:bold;font-size:11px">${it.name}</div>` +
      `<div style="font-size:10px;color:#888">${it.desc}</div>` +
      `<div style="font-size:9px;text-transform:uppercase;margin-top:2px">${it.rarity}</div>`;
    d.onclick = () => {
      GS.applyItem(it, null);
      document.getElementById('loot-overlay').style.display = 'none';
      document.dispatchEvent(new CustomEvent('nav:backToMap'));
    };
    lg.appendChild(d);
  });
  document.getElementById('loot-overlay').style.display = 'flex';
}

// ─────────────────────────────────────────────────────────────────────────────
// PAUSE
// ─────────────────────────────────────────────────────────────────────────────

export function openPause() {
  if (!GS.battle.battleActive) return;
  GS.setRunning(false);
  GS.setPaused(true);
  document.getElementById('pause-overlay').style.display = 'flex';
}

export function closePause() {
  document.getElementById('pause-overlay').style.display = 'none';
  GS.setPaused(false);
  if (GS.battle.battleActive) {
    GS.setRunning(true);
    _lastT = performance.now();
    requestAnimationFrame(_gameLoop);
  }
}

export function togglePause() {
  if (GS.battle.paused) closePause(); else openPause();
}

export function surrender() {
  GS.setRunning(false);
  GS.setBattleActive(false);
  GS.setPaused(false);
  document.getElementById('pause-overlay').style.display = 'none';
  document.dispatchEvent(new CustomEvent('nav:goLobby'));
}

// ─────────────────────────────────────────────────────────────────────────────
// ENEMY AI
// ─────────────────────────────────────────────────────────────────────────────

function _updateEnemies(dt) {
  // Reset per-frame aura multipliers
  enemies.forEach(e => { e.auraDmgMult = 1; e.auraDmgReduction = 1; });

  // Goblin Warlord — damage aura
  enemies.filter(e => e.type === 'goblin_warlord' && e.hp > 0).forEach(w => {
    enemies.forEach(ally => {
      if (ally === w) return;
      if (Math.hypot(ally.x - w.x, ally.y - w.y) <= w.auraRange)
        ally.auraDmgMult = Math.max(ally.auraDmgMult, w.auraDmgBuff || 1.2);
    });
  });

  // Goblin Shaman — defense aura
  enemies.filter(e => e.type === 'goblin_shaman' && e.hp > 0).forEach(s => {
    enemies.forEach(ally => {
      if (ally === s) return;
      if (Math.hypot(ally.x - s.x, ally.y - s.y) <= s.auraRange)
        ally.auraDmgReduction = Math.min(ally.auraDmgReduction, s.auraDefBuff || 0.8);
    });
  });

  enemies.forEach(e => {
    if (e.slow > 0) e.slow = Math.max(0, e.slow - dt);

    const edx  = player.x - e.x, edy = player.y - e.y;
    const dist = Math.hypot(edx, edy);

    if (!e.boss && !e.aggro && dist < e.aggroRange * TILE && hasLOS(e.x, e.y, player.x, player.y))
      e.aggro = true;

    if (e.boss) { _updateBoss(e, dt, dist); return; }
    if (!e.aggro) return;

    switch (e.type) {
      case 'rat':            _aiRat(e, dt, dist, edx, edy);           break;
      case 'bandit':         _aiBandit(e, dt, dist, edx, edy);        break;
      case 'mage':           _aiMage(e, dt, dist, edx, edy);          break;
      case 'cleric':         _aiCleric(e, dt, dist, edx, edy);        break;
      case 'goblin_warrior': _aiMelee(e, dt, dist, edx, edy);         break;
      case 'goblin_archer':  _aiBandit(e, dt, dist, edx, edy);        break;
      case 'goblin_warlord': _aiMelee(e, dt, dist, edx, edy);         break;
      case 'goblin_shaman':  _aiShaman(e, dt, dist, edx, edy);        break;
      case 'cultist':        _aiCultist(e, dt, dist, edx, edy);       break;
      case 'demon':          _aiBandit(e, dt, dist, edx, edy);        break;
      case 'fiend':          _aiMelee(e, dt, dist, edx, edy);         break;
      case 'necromancer':    _aiNecromancer(e, dt, dist, edx, edy);   break;
      case 'zombie':         _aiRat(e, dt, dist, edx, edy);           break;
      case 'skeleton':       _aiRat(e, dt, dist, edx, edy);           break;
    }
  });
}

// ── AI implementations ──────────────────────────────────────────────────────

function _aiRat(e, dt, dist, edx, edy) {
  e.wanderTimer -= dt;
  if (e.wanderTimer <= 0) {
    e.wanderAngle = (Math.random() - 0.5) * 1.0;
    e.wanderTimer = 0.5 + Math.random() * 0.8;
  }
  const baseAngle = Math.atan2(edy, edx) + e.wanderAngle;
  _moveAlongPath(e,
    player.x + Math.cos(baseAngle) * TILE * 0.5,
    player.y + Math.sin(baseAngle) * TILE * 0.5,
    e.spd, dt);
  e.atkTimer = Math.max(0, e.atkTimer - dt);
  if (dist < ATK_COLLISION && e.atkTimer <= 0 && player.invincible <= 0) {
    e.atkTimer = e.atkRate;
    _applyDmgToPlayer(e.dmg, e);
  }
}

function _aiMelee(e, dt, dist, edx, edy) {
  _moveAlongPath(e, player.x, player.y, e.spd, dt);
  e.atkTimer = Math.max(0, e.atkTimer - dt);
  if (dist < ATK_COLLISION && e.atkTimer <= 0 && player.invincible <= 0) {
    e.atkTimer = e.atkRate;
    _applyDmgToPlayer(e.dmg, e);
  }
}

function _aiBandit(e, dt, dist, edx, edy) {
  e.atkTimer  = Math.max(0, e.atkTimer - dt);
  e.projTimer = Math.max(0, (e.projTimer || 0) - dt);
  const meleeRange = e.projRange * 0.38;

  if (dist < meleeRange) {
    _moveAlongPath(e, player.x, player.y, e.spd, dt);
    if (dist < 16 && e.atkTimer <= 0 && player.invincible <= 0) {
      e.atkTimer = e.atkRate;
      _applyDmgToPlayer(e.dmg, e);
    }
  } else if (dist < e.projRange && hasLOS(e.x, e.y, player.x, player.y)) {
    // Strafe perpendicular
    const perp = { x: -(edy / dist) * TILE * 3, y: (edx / dist) * TILE * 3 };
    _moveAlongPath(e, e.x + perp.x, e.y + perp.y, e.spd * 0.5, dt);
    if (e.projTimer <= 0) {
      e.projTimer = e.projRate;
      enemyHazards.push({
        type: 'banditProj', x: e.x, y: e.y,
        vx: edx / dist * 180, vy: edy / dist * 180,
        r: 5, life: 3, dmg: e.dmg, color: '#6f6', src: e,
      });
    }
  } else {
    _moveAlongPath(e, player.x, player.y, e.spd, dt);
  }
}

function _aiMage(e, dt, dist, edx, edy) {
  if (dist < 3 * TILE) {
    const nx = e.x - edx / dist * e.spd * 45 * dt;
    const ny = e.y - edy / dist * e.spd * 45 * dt;
    if (canMove(nx, e.y, 5)) e.x = nx;
    if (canMove(e.x, ny, 5)) e.y = ny;
  } else if (dist > 5 * TILE) {
    _moveAlongPath(e, player.x, player.y, e.spd, dt);
  }
  e.castTimer = Math.max(0, (e.castTimer || 0) - dt);
  if (e.castTimer <= 0 && dist < 6 * TILE && hasLOS(e.x, e.y, player.x, player.y)) {
    e.castTimer = e.castRate;
    enemyHazards.push({
      type: 'flamePillarWarn',
      x: player.x, y: player.y,
      radius: 36, timer: 1.4,
      dmg: ~~(18 * _scaleFromCurrentNode()),
    });
  }
}

function _aiCleric(e, dt, dist, edx, edy) {
  if (dist < 3 * TILE) {
    const nx = e.x - edx / dist * e.spd * 45 * dt;
    const ny = e.y - edy / dist * e.spd * 45 * dt;
    if (canMove(nx, e.y, 5)) e.x = nx;
    if (canMove(e.x, ny, 5)) e.y = ny;
  }
  e.healTimer = Math.max(0, (e.healTimer || 0) - dt);
  if (e.healTimer <= 0) {
    e.healTimer = e.healRate;
    let healed = false;
    enemies.forEach(ally => {
      if (ally === e || ally.boss) return;
      if (Math.hypot(ally.x - e.x, ally.y - e.y) < e.healRange) {
        const h = ~~(ally.maxHp * 0.15);
        ally.hp = Math.min(ally.maxHp, ally.hp + h);
        _spawnFT(ally.x, ally.y, '#4fa', `+${h}`);
        healed = true;
      }
    });
    if (healed) e.healAnim = 0.6;
  }
  if (e.healAnim > 0) e.healAnim = Math.max(0, e.healAnim - dt);
}

function _aiShaman(e, dt, dist, edx, edy) {
  if (dist < 3 * TILE) {
    const nx = e.x - edx / dist * e.spd * 45 * dt;
    const ny = e.y - edy / dist * e.spd * 45 * dt;
    if (canMove(nx, e.y, 5)) e.x = nx;
    if (canMove(e.x, ny, 5)) e.y = ny;
  }
  e.castTimer = Math.max(0, (e.castTimer || 0) - dt);
  if (e.castTimer <= 0 && dist < 6 * TILE && hasLOS(e.x, e.y, player.x, player.y)) {
    e.castTimer = e.castRate;
    enemyHazards.push({
      type: 'flamePillarWarn',
      x: player.x, y: player.y,
      radius: 30, timer: 1.2,
      dmg: e.dmg || 18,
    });
  }
}

function _aiCultist(e, dt, dist, edx, edy) {
  _moveAlongPath(e, player.x, player.y, e.spd, dt);
  e.summonTimer = (e.summonTimer || 0) - dt;
  if (e.summonTimer <= 0 && dist < 5 * TILE) {
    const free = !enemies.some(en => en.type === 'demon' && en !== e);
    if (free) {
      e.summonTimer = e.summonRate;
      const sc   = _scaleFromCurrentNode();
      const dmon = _mkEnemy(
        player.x + (Math.random() * 80 - 40),
        player.y + (Math.random() * 80 - 40),
        'demon', sc
      );
      if (dmon) enemies.push(dmon);
    }
  }
}

function _aiNecromancer(e, dt, dist, edx, edy) {
  _moveAlongPath(e, player.x, player.y, e.spd, dt);
  e.castTimer = (e.castTimer || 0) - dt;
  if (e.castTimer <= 0 && dist < 5 * TILE && hasLOS(e.x, e.y, player.x, player.y)) {
    e.castTimer = e.castRate;
    if (Math.random() < 0.5) {
      player.dmgOutMult    = 0.7;
      player.dmgOutDuration = 5;
      _addMsg('Weakened!');
    } else {
      const sc        = _scaleFromCurrentNode();
      const spawnType = Math.random() < 0.5 ? 'zombie' : 'skeleton';
      const spawned   = _mkEnemy(
        player.x + (Math.random() * 60 - 30),
        player.y + (Math.random() * 60 - 30),
        spawnType, sc
      );
      if (spawned) enemies.push(spawned);
    }
  }
}

// ── Boss AI ─────────────────────────────────────────────────────────────────

function _updateBoss(e, dt, dist) {
  e.bossTimer -= dt;
  e.atkTimer   = Math.max(0, e.atkTimer - dt);

  if (dist < 30 && e.atkTimer <= 0 && player.invincible <= 0) {
    e.atkTimer = e.atkRate;
    _applyDmgToPlayer(e.dmg);
  }

  if (e.bossAttack === 'charge') {
    e.bossChargeTimer -= dt;
    if (e.bossChargeTimer <= 0) {
      e.bossAttack = null;
      bossHazards.push({ type: 'annihSphere', x: e.x, y: e.y, speed: 55, radius: 18, life: 20 });
      _addMsg('💀 Sphere launched!');
    }
  } else if (e.bossTimer <= 0) {
    _bossDoAttack(e);
  }
}

function _bossDoAttack(boss) {
  const r = Math.random();
  if (r < 0.35) {
    _addMsg('⚠ Flame Zone!');
    bossHazards.push({
      type: 'flameZoneTelegraph',
      x: boss.x, y: boss.y,
      radius: 115, timer: 1.2, maxTimer: 1.2,
    });
  } else if (r < 0.70) {
    _addMsg('⚠ Flame Pillar!');
    bossHazards.push({
      type: 'flamePillarWarn',
      x: player.x, y: player.y,
      radius: 38, timer: 1.5, dmg: 45,
    });
  } else {
    _addMsg('⚠ ANNIHILATION charging!');
    boss.bossAttack       = 'charge';
    boss.bossChargeTimer  = 2.5;
  }
  boss.bossTimer = 3 + Math.random() * 2;
}

// ─────────────────────────────────────────────────────────────────────────────
// HAZARD SIMULATION
// ─────────────────────────────────────────────────────────────────────────────

function _updateEnemyHazards(dt) {
  const rem = [];
  enemyHazards.forEach((h, hi) => {
    switch (h.type) {
      case 'banditProj': {
        h.x    += h.vx * dt;
        h.y    += h.vy * dt;
        h.life -= dt;
        if (tileAt(h.x, h.y) === T.WALL) { rem.push(hi); break; }
        if (Math.hypot(player.x - h.x, player.y - h.y) < 14 && player.invincible <= 0) {
          _applyDmgToPlayer(h.dmg, h.src);
          _spawnBurst(h.x, h.y, '#6f6', 6);
          rem.push(hi); break;
        }
        if (h.life <= 0) rem.push(hi);
        break;
      }
      case 'flamePillarWarn': {
        h.timer -= dt;
        if (h.timer <= 0) {
          enemyHazards.push({ type: 'flamePillarBurst', x: h.x, y: h.y, radius: h.radius, life: 0.45 });
          if (Math.hypot(player.x - h.x, player.y - h.y) < h.radius + 10 && player.invincible <= 0) {
            _applyDmgToPlayer(h.dmg);
            _addMsg('🔥 Pillar hit!');
          }
          rem.push(hi);
        }
        break;
      }
      case 'flamePillarBurst': {
        h.life -= dt;
        if (h.life <= 0) rem.push(hi);
        break;
      }
    }
  });
  for (let i = rem.length - 1; i >= 0; i--) enemyHazards.splice(rem[i], 1);
}

function _updateBossHazards(dt) {
  const rem = [];
  bossHazards.forEach((h, hi) => {
    switch (h.type) {
      case 'flameZoneTelegraph': {
        h.timer -= dt;
        if (h.timer <= 0) {
          bossHazards.push({
            type: 'flameZone', x: h.x, y: h.y,
            radius: h.radius, dmgPerSec: 18, life: 4, maxLife: 4,
          });
          rem.push(hi);
        }
        break;
      }
      case 'flameZone': {
        h.life -= dt;
        if (Math.hypot(player.x - h.x, player.y - h.y) < h.radius && player.invincible <= 0)
          _applyDmgToPlayer(h.dmgPerSec * dt);
        if (h.life <= 0) rem.push(hi);
        break;
      }
      case 'flamePillarWarn': {
        h.timer -= dt;
        if (h.timer <= 0) {
          bossHazards.push({ type: 'flamePillarBurst', x: h.x, y: h.y, radius: 38, life: 0.45 });
          if (Math.hypot(player.x - h.x, player.y - h.y) < 48 && player.invincible <= 0) {
            _applyDmgToPlayer(h.dmg || 45);
            _addMsg('🔥 Pillar hit!');
          }
          rem.push(hi);
        }
        break;
      }
      case 'flamePillarBurst': {
        h.life -= dt;
        if (h.life <= 0) rem.push(hi);
        break;
      }
      case 'annihSphere': {
        const sdx = player.x - h.x, sdy = player.y - h.y;
        const sl  = Math.hypot(sdx, sdy);
        if (sl > 0) { h.x += sdx / sl * h.speed * dt; h.y += sdy / sl * h.speed * dt; }
        if (Math.hypot(player.x - h.x, player.y - h.y) < h.radius + 12) {
          _applyDmgToPlayer(120);
          _addMsg('💥 ANNIHILATION!');
          _spawnBurst(h.x, h.y, '#c0f', 20);
          rem.push(hi);
        } else if (tileAt(h.x, h.y) === T.WALL) {
          _spawnBurst(h.x, h.y, '#c0f', 15);
          rem.push(hi);
        } else {
          h.life -= dt;
          if (h.life <= 0) rem.push(hi);
        }
        break;
      }
    }
  });
  for (let i = rem.length - 1; i >= 0; i--) bossHazards.splice(rem[i], 1);
}

// ─────────────────────────────────────────────────────────────────────────────
// VFX HELPERS
// ─────────────────────────────────────────────────────────────────────────────

export function spawnFT(x, y, color, text) { _spawnFT(x, y, color, text); }

function _spawnFT(x, y, color, text) {
  floatingTexts.push({ x: x + (Math.random() * 14 - 7), y, dy: -1.1, text, color, life: 1 });
  for (let i = 0; i < 3; i++) {
    const a = Math.random() * Math.PI * 2;
    particles.push({ x, y, vx: Math.cos(a) * 2, vy: Math.sin(a) * 2 - 1, color, life: 0.5, r: 3 });
  }
}

export function spawnBurst(x, y, color, n) { _spawnBurst(x, y, color, n); }

function _spawnBurst(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 4;
    particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, color, life: 0.8, r: 4 + Math.random() * 4 });
  }
}

function _addMsg(t) { msgs = [t, ...msgs.slice(0, 3)]; }

// ─────────────────────────────────────────────────────────────────────────────
// CANVAS RESIZE
// ─────────────────────────────────────────────────────────────────────────────

function _resizeCanvas(canvas) {
  const wrap = document.getElementById('canvas-wrap');
  if (wrap) { canvas.width = wrap.clientWidth; canvas.height = wrap.clientHeight; }
}
