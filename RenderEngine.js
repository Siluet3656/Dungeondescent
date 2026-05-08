/**
 * RenderEngine.js — Dungeon's Descent
 *
 * Owns everything drawn onto the two canvases each frame:
 *   • Tile map (floors, walls, grid lines)
 *   • Enemy hazards (bandit projectiles, flame pillars)
 *   • Boss hazards  (flame zone, annihilation sphere)
 *   • Enemies       (body, HP bar, auras, boss charge FX, target reticle)
 *   • Player        (body, facing dot, shield ring, target ring)
 *   • Particles + floating damage/heal text
 *   • Minimap       (floor tiles, enemy dots, player dot)
 *
 * Contract
 * ────────
 *   READ-ONLY.  RenderEngine never calls GameState mutators or
 *   CombatManager action functions.  It reads exported state and
 *   calls ctx.* — nothing else.
 *
 * Dependencies
 * ────────────
 *   CombatManager — all scene state (map, rooms, enemies, player, hazards,
 *                   particles, floatingTexts, camX, camY, target,
 *                   dashActive, isBoss, TILE)
 *
 * Lifecycle
 * ─────────
 *   init(mainCanvas, minimapCanvas)  — store contexts, subscribe to tick
 *   frame()                          — draw one complete frame (main + minimap)
 *
 * RenderEngine subscribes to the 'combat:tick' CustomEvent fired by
 * CombatManager after each updateGame() call.  It never owns its own
 * requestAnimationFrame loop.
 */

import * as CM from './CombatManager.js';

// ─────────────────────────────────────────────────────────────────────────────
// MODULE STATE
// ─────────────────────────────────────────────────────────────────────────────

/** @type {HTMLCanvasElement} */
let _canvas = null;
/** @type {CanvasRenderingContext2D} */
let _ctx    = null;

/** @type {HTMLCanvasElement} */
let _mm     = null;
/** @type {CanvasRenderingContext2D} */
let _mctx   = null;

/** Minimap fixed dimensions (matches HTML attribute). */
const MM_W = 80;
const MM_H = 80;

/** Tile type sentinel (mirrors CombatManager internal — kept local to avoid coupling). */
const WALL = 0;

// Minimap colour lookup for each enemy type
const MM_ENEMY_COLORS = Object.freeze({
  rat:            '#c94',
  bandit:         '#4a5',
  mage:           '#48f',
  cleric:         '#eee',
  goblin_warrior: '#8a2',
  goblin_archer:  '#6a3',
  goblin_warlord: '#b72',
  goblin_shaman:  '#4a6',
  cultist:        '#a5a',
  demon:          '#c4c',
  fiend:          '#f68',
  necromancer:    '#66c',
  zombie:         '#587',
  skeleton:       '#ccc',
});

// ─────────────────────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Store canvas contexts and subscribe to the combat frame event.
 * Call once after the DOM is ready.
 *
 * @param {HTMLCanvasElement} mainCanvas
 * @param {HTMLCanvasElement} minimapCanvas
 */
export function init(mainCanvas, minimapCanvas) {
  _canvas = mainCanvas;
  _ctx    = mainCanvas.getContext('2d');
  _mm     = minimapCanvas;
  _mctx   = minimapCanvas.getContext('2d');

  document.addEventListener('combat:tick', frame);
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC FRAME ENTRY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Draw one complete frame onto both canvases.
 * Called automatically on every 'combat:tick' event.
 * Safe to call manually (e.g. from tests or a pause-screen refresh).
 */
export function frame() {
  if (!CM.player) return;

  // Match canvas size to its container every frame — handles window resize.
  const wrap = document.getElementById('canvas-wrap');
  if (wrap) {
    _canvas.width  = wrap.clientWidth;
    _canvas.height = wrap.clientHeight;
  }

  _ctx.clearRect(0, 0, _canvas.width, _canvas.height);
  _ctx.save();
  _ctx.translate(-CM.camX, -CM.camY);

  _drawTiles();
  _drawEnemyHazards();
  _drawBossHazards();
  _drawEnemies();
  _drawPlayer();
  _drawParticles();
  _drawFloatingTexts();

  _ctx.restore();

  _drawMinimap();
}

// ─────────────────────────────────────────────────────────────────────────────
// TILE MAP
// ─────────────────────────────────────────────────────────────────────────────

function _drawTiles() {
  const T    = CM.TILE;
  const cols = CM.isBoss ? 20 : 30;   // BCOLS / COLS — kept local
  const rows = CM.isBoss ? 16 : 22;   // BROWS / ROWS
  const ctx  = _ctx;
  const map  = CM.map;

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (map[y][x] === WALL) {
        // Outer wall tile
        ctx.fillStyle = '#151520';
        ctx.fillRect(x * T, y * T, T, T);
        // Inner bevel
        ctx.fillStyle = '#0e0e18';
        ctx.fillRect(x * T + 1, y * T + 1, T - 2, T - 2);
      } else {
        // Floor tile
        ctx.fillStyle = '#222035';
        ctx.fillRect(x * T, y * T, T, T);
        // Subtle grid line
        ctx.strokeStyle = '#1a1830';
        ctx.lineWidth   = 0.5;
        ctx.strokeRect(x * T, y * T, T, T);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ENEMY HAZARDS
// ─────────────────────────────────────────────────────────────────────────────

function _drawEnemyHazards() {
  const ctx = _ctx;
  const now = Date.now();

  CM.enemyHazards.forEach(h => {
    switch (h.type) {

      case 'flamePillarWarn': {
        const pulse = 0.5 + 0.5 * Math.sin(now * 0.014);
        ctx.save();
        ctx.globalAlpha = 0.35 + 0.3 * pulse;
        ctx.fillStyle   = '#f60';
        ctx.beginPath();
        ctx.arc(h.x, h.y, h.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fa0';
        ctx.lineWidth   = 2;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
        break;
      }

      case 'flamePillarBurst': {
        ctx.save();
        ctx.globalAlpha = h.life / 0.45;
        ctx.fillStyle   = '#ff4';
        ctx.beginPath();
        ctx.arc(h.x, h.y, h.radius * 1.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        break;
      }

      case 'banditProj': {
        ctx.save();
        ctx.fillStyle   = h.color;
        ctx.shadowBlur  = 6;
        ctx.shadowColor = h.color;
        ctx.beginPath();
        ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        break;
      }
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// BOSS HAZARDS
// ─────────────────────────────────────────────────────────────────────────────

function _drawBossHazards() {
  const ctx = _ctx;
  const now = Date.now();

  CM.bossHazards.forEach(h => {
    switch (h.type) {

      case 'flameZoneTelegraph': {
        const frac  = 1 - h.timer / h.maxTimer;
        const curR  = h.radius * frac;
        const pulse = 0.5 + 0.5 * Math.sin(now * 0.015);
        ctx.save();
        ctx.strokeStyle = `rgba(255,80,0,${0.5 + 0.4 * pulse})`;
        ctx.lineWidth   = 3 + 3 * pulse;
        ctx.beginPath();
        ctx.arc(h.x, h.y, curR, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 0.1 * frac;
        ctx.fillStyle   = '#f42';
        ctx.beginPath();
        ctx.arc(h.x, h.y, curR, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        break;
      }

      case 'flameZone': {
        const fr = h.life / h.maxLife;
        ctx.save();
        // Outer fire zone
        ctx.globalAlpha = 0.35 * fr;
        ctx.fillStyle   = '#f42';
        ctx.beginPath();
        ctx.arc(h.x, h.y, h.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#f84';
        ctx.lineWidth   = 2;
        ctx.stroke();
        // Inner hot core
        ctx.globalAlpha = 0.18 * fr;
        ctx.fillStyle   = '#ff6';
        ctx.beginPath();
        ctx.arc(h.x, h.y, h.radius * 0.55, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        break;
      }

      case 'flamePillarWarn': {
        // Boss version — slightly different colour than enemy version
        const pulse = 0.5 + 0.5 * Math.sin(now * 0.012);
        ctx.save();
        ctx.globalAlpha = 0.4 + 0.3 * pulse;
        ctx.fillStyle   = '#fa0';
        ctx.beginPath();
        ctx.arc(h.x, h.y, h.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ff4';
        ctx.lineWidth   = 2;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
        break;
      }

      case 'flamePillarBurst': {
        ctx.save();
        ctx.globalAlpha = h.life / 0.45;
        ctx.fillStyle   = '#ff4';
        ctx.beginPath();
        // Boss burst is slightly larger than enemy version
        ctx.arc(h.x, h.y, h.radius * 1.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        break;
      }

      case 'annihSphere': {
        const pulse = 0.7 + 0.3 * Math.sin(now * 0.009);
        const grad  = ctx.createRadialGradient(
          h.x, h.y, 0,
          h.x, h.y, h.radius * 2.5 * pulse
        );
        grad.addColorStop(0, 'rgba(200,80,255,.6)');
        grad.addColorStop(1, 'rgba(200,80,255,0)');
        ctx.save();
        // Outer glow halo
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(h.x, h.y, h.radius * 2.5 * pulse, 0, Math.PI * 2);
        ctx.fill();
        // Solid core
        ctx.fillStyle = '#d060ff';
        ctx.beginPath();
        ctx.arc(h.x, h.y, h.radius * pulse, 0, Math.PI * 2);
        ctx.fill();
        // Bright rim
        ctx.strokeStyle = '#fff';
        ctx.lineWidth   = 2;
        ctx.stroke();
        ctx.restore();
        break;
      }
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// ENEMIES
// ─────────────────────────────────────────────────────────────────────────────

function _drawEnemies() {
  const ctx     = _ctx;
  const target  = CM.target;
  const enemies = CM.enemies;

  enemies.forEach(e => {
    // ── Cleric heal pulse ────────────────────────────────────────
    if (e.type === 'cleric' && e.healAnim > 0) {
      const frac = e.healAnim / 0.6;
      ctx.save();
      ctx.globalAlpha = frac * 0.45;
      ctx.strokeStyle = '#4fa';
      ctx.lineWidth   = 2 + frac * 2;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.healRange * (0.5 + 0.5 * frac), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = frac * 0.25;
      ctx.fillStyle   = '#4fa';
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.size + 10 * (1 - frac * 0.5), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // ── Target reticle ───────────────────────────────────────────
    if (e === target) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,.6)';
      ctx.lineWidth   = 2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.size + 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // ── Boss charge wind-up ──────────────────────────────────────
    if (e.boss && e.bossAttack === 'charge') {
      const fr = 1 - e.bossChargeTimer / 2.5;
      ctx.save();
      ctx.globalAlpha = 0.35 * fr;
      ctx.fillStyle   = '#c0f';
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.size * 2 + 20 * fr, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // ── Body ─────────────────────────────────────────────────────
    ctx.fillStyle = e.slow > 0 ? '#558' : e.color;
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.size, 0, Math.PI * 2);
    ctx.fill();

    if (e.boss) {
      ctx.strokeStyle = '#f88';
      ctx.lineWidth   = 2;
      ctx.stroke();
    }

    // ── HP bar ───────────────────────────────────────────────────
    // Stagger bars so they don't overlap when enemies cluster
    const overlap = enemies.filter(
      en => en !== e &&
            Math.abs(en.x - e.x) < 20 &&
            Math.abs(en.y - e.y) < 20
    ).length;

    const bw = e.boss ? 60 : 26;
    const bx = e.x - bw / 2;
    const by = e.y - e.size - 8 - overlap * 7;

    ctx.fillStyle = '#300';
    ctx.fillRect(bx, by, bw, 3);

    const hpFrac  = Math.max(0, e.hp / e.maxHp);
    ctx.fillStyle = e.type === 'cleric' ? '#6cf'
                  : hpFrac > 0.5        ? '#4a4'
                  :                       '#a44';
    ctx.fillRect(bx, by, bw * hpFrac, 3);

    // Boss label above bar
    if (e.boss) {
      ctx.fillStyle  = '#f88';
      ctx.font       = '9px monospace';
      ctx.textAlign  = 'center';
      ctx.fillText('BOSS', e.x, by - 2);
      ctx.textAlign  = 'left';
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// PLAYER
// ─────────────────────────────────────────────────────────────────────────────

function _drawPlayer() {
  const ctx    = _ctx;
  const p      = CM.player;
  const dashing = CM.dashActive > 0;

  // Body
  ctx.fillStyle = dashing ? '#aef' : '#6af';
  ctx.beginPath();
  ctx.arc(p.x, p.y, 11, 0, Math.PI * 2);
  ctx.fill();

  // Shield ring — thicker and brighter when shield is active
  ctx.strokeStyle = (p.shield || 0) > 0 ? '#8cf' : '#adf';
  ctx.lineWidth   = (p.shield || 0) > 0 ? 3     : 1.5;
  ctx.stroke();

  // Facing dot
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(
    p.x + p.facing.x * 7,
    p.y + p.facing.y * 7,
    3, 0, Math.PI * 2
  );
  ctx.fill();

  // Melee range indicator (faint ring when a target is locked)
  if (CM.target) {
    ctx.strokeStyle = 'rgba(255,200,80,.1)';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 52, 0, Math.PI * 2);
    ctx.stroke();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PARTICLES
// ─────────────────────────────────────────────────────────────────────────────

function _drawParticles() {
  const ctx = _ctx;
  CM.particles.forEach(p => {
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle   = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// FLOATING TEXTS
// ─────────────────────────────────────────────────────────────────────────────

function _drawFloatingTexts() {
  const ctx = _ctx;
  ctx.font = 'bold 12px monospace';
  CM.floatingTexts.forEach(f => {
    ctx.globalAlpha = Math.max(0, f.life);
    ctx.fillStyle   = f.color;
    ctx.fillText(f.text, f.x, f.y);
  });
  ctx.globalAlpha = 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// MINIMAP
// ─────────────────────────────────────────────────────────────────────────────

function _drawMinimap() {
  const mctx  = _mctx;
  const T     = CM.TILE;
  const cols  = CM.isBoss ? 20 : 30;
  const rows  = CM.isBoss ? 16 : 22;
  const sx    = MM_W / cols;
  const sy    = MM_H / rows;
  const map   = CM.map;
  const FLOOR = 1;

  mctx.clearRect(0, 0, MM_W, MM_H);

  // Floor tiles
  mctx.fillStyle = '#333';
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (map[y][x] === FLOOR) {
        mctx.fillRect(x * sx, y * sy, sx, sy);
      }
    }
  }

  // Enemy dots
  CM.enemies.forEach(e => {
    mctx.fillStyle = e === CM.target
      ? '#ff4'
      : e.boss
        ? '#f44'
        : (MM_ENEMY_COLORS[e.type] || '#a22');
    mctx.fillRect(
      e.x / T * sx - 1,
      e.y / T * sy - 1,
      2, 2
    );
  });

  // Player dot
  if (CM.player) {
    mctx.fillStyle = '#6af';
    mctx.fillRect(
      CM.player.x / T * sx - 1.5,
      CM.player.y / T * sy - 1.5,
      3, 3
    );
  }
}
