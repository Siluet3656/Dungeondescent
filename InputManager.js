/**
 * InputManager.js — Dungeon's Descent
 *
 * Centralises all keyboard and mouse input.
 * No DOM manipulation, no game logic — only input capture and dispatch.
 *
 * Usage
 * ─────
 *  1. Call InputManager.init(canvas) once at app start.
 *  2. Poll movement with InputManager.movement() each game-loop tick.
 *  3. Listen for action events on `document`:
 *       document.addEventListener('game:action', e => { ... e.detail.action ... })
 *
 * Action event shape
 * ──────────────────
 *  { action: 'castSpell',    slot: 0-3      }
 *  { action: 'dash'                         }
 *  { action: 'cycleTarget'                  }
 *  { action: 'togglePause'                  }
 *  { action: 'openInventory'                }
 *  { action: 'clickEnemy',   x, y           }  — world-space coords
 *
 * The event is only fired when the action is contextually valid (i.e. the
 * gate functions passed to init() return true). Consumers never need to
 * re-check "am I running / am I paused?" for these guarded actions.
 *
 * Key bindings are stored in the BINDINGS map and can be rebound at runtime
 * via InputManager.rebind(action, newCode).
 */

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL STATE
// ─────────────────────────────────────────────────────────────────────────────

/** @type {Record<string, boolean>} KeyboardEvent.code → pressed */
const _keys = {};

/** @type {HTMLCanvasElement|null} */
let _canvas = null;

/**
 * Camera offsets injected each frame by CombatManager so that click
 * coordinates can be converted to world space.
 * @type {{ x: number, y: number }}
 */
const _cam = { x: 0, y: 0 };

/**
 * Gate functions injected by the app shell. InputManager calls these before
 * dispatching actions so consumers don't have to repeat the same checks.
 *
 * @type {{
 *   isBattleRunning: function(): boolean,
 *   isPaused:        function(): boolean,
 * }}
 */
let _gates = {
  isBattleRunning: () => false,
  isPaused:        () => false,
};

// ─────────────────────────────────────────────────────────────────────────────
// KEY BINDINGS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {'castSpell0'|'castSpell1'|'castSpell2'|'castSpell3'
 *          |'dash'|'cycleTarget'|'togglePause'|'openInventory'
 *          |'moveUp'|'moveDown'|'moveLeft'|'moveRight'} ActionName
 */

/**
 * Mutable bindings map. Each action maps to exactly one KeyboardEvent.code.
 * Movement actions are polled (not dispatched as events).
 * All other actions are dispatched as 'game:action' events on keydown.
 *
 * @type {Record<ActionName, string>}
 */
export const BINDINGS = {
  // Movement (polled, not dispatched)
  moveUp:       'KeyW',
  moveDown:     'KeyS',
  moveLeft:     'KeyA',
  moveRight:    'KeyD',
  moveUpAlt:    'ArrowUp',
  moveDownAlt:  'ArrowDown',
  moveLeftAlt:  'ArrowLeft',
  moveRightAlt: 'ArrowRight',

  // Actions (dispatched as 'game:action' events)
  castSpell0:   'Digit1',
  castSpell1:   'Digit2',
  castSpell2:   'Digit3',
  castSpell3:   'Digit4',
  dash:         'Space',
  cycleTarget:  'Tab',
  openInventory:'KeyI',
  togglePause:  'KeyP',
  togglePauseAlt: 'Escape',
};

// Reverse lookup: code → action (rebuilt whenever BINDINGS changes).
let _codeToAction = _buildReverseMap();

function _buildReverseMap() {
  return Object.fromEntries(
    Object.entries(BINDINGS).map(([action, code]) => [code, action])
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Initialise InputManager. Call once at app start.
 *
 * @param {HTMLCanvasElement} canvas — used for click-to-target
 * @param {{
 *   isBattleRunning: function(): boolean,
 *   isPaused:        function(): boolean,
 * }} gates
 */
export function init(canvas, gates) {
  _canvas = canvas;
  _gates  = { ..._gates, ...gates };

  document.addEventListener('keydown', _onKeyDown);
  document.addEventListener('keyup',   _onKeyUp);
  canvas.addEventListener('click',     _onCanvasClick);
}

/**
 * Tear down all event listeners. Call if the game canvas is ever removed
 * from the DOM (e.g. in a SPA that destroys the game view).
 */
export function destroy() {
  document.removeEventListener('keydown', _onKeyDown);
  document.removeEventListener('keyup',   _onKeyUp);
  if (_canvas) _canvas.removeEventListener('click', _onCanvasClick);
  _canvas = null;
}

/**
 * Return the current movement direction as a normalised {x, y} vector.
 * Returns {x:0, y:0} when no movement keys are held.
 * Only meaningful while a battle is running.
 *
 * @returns {{ x: number, y: number }}
 */
export function movement() {
  let dx = 0, dy = 0;

  if (_keys[BINDINGS.moveLeft]  || _keys[BINDINGS.moveLeftAlt])  dx -= 1;
  if (_keys[BINDINGS.moveRight] || _keys[BINDINGS.moveRightAlt]) dx += 1;
  if (_keys[BINDINGS.moveUp]    || _keys[BINDINGS.moveUpAlt])    dy -= 1;
  if (_keys[BINDINGS.moveDown]  || _keys[BINDINGS.moveDownAlt])  dy += 1;

  if (dx === 0 && dy === 0) return { x: 0, y: 0 };

  const len = Math.hypot(dx, dy);
  return { x: dx / len, y: dy / len };
}

/**
 * Returns true while a key is held down.
 * Prefer movement() for movement; use this only for non-action polling.
 *
 * @param {string} code — KeyboardEvent.code
 * @returns {boolean}
 */
export function isDown(code) {
  return _keys[code] === true;
}

/**
 * Update the camera offset so that canvas clicks can be converted to
 * world-space coordinates. CombatManager calls this each frame.
 *
 * @param {number} x
 * @param {number} y
 */
export function setCameraOffset(x, y) {
  _cam.x = x;
  _cam.y = y;
}

/**
 * Rebind an action to a new key code at runtime.
 * Silently ignores attempts to bind a code already used by another action.
 *
 * @param {ActionName} action
 * @param {string}     newCode — KeyboardEvent.code
 * @returns {boolean} true if the rebind succeeded
 */
export function rebind(action, newCode) {
  if (!(action in BINDINGS))       return false;
  if (newCode in _codeToAction && _codeToAction[newCode] !== action) return false;

  const oldCode = BINDINGS[action];
  delete _codeToAction[oldCode];
  BINDINGS[action]       = newCode;
  _codeToAction[newCode] = action;
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// PRIVATE HANDLERS
// ─────────────────────────────────────────────────────────────────────────────

/** @param {KeyboardEvent} e */
function _onKeyDown(e) {
  _keys[e.code] = true;

  // Prevent browser scroll on game-relevant keys
  if (_SCROLL_PREVENT.has(e.code)) e.preventDefault();

  const action = _codeToAction[e.code];
  if (!action) return;

  // Movement keys are polled, not dispatched
  if (action.startsWith('move')) return;

  _dispatch(action);
}

/** @param {KeyboardEvent} e */
function _onKeyUp(e) {
  _keys[e.code] = false;
}

/** @param {MouseEvent} e */
function _onCanvasClick(e) {
  if (!_gates.isBattleRunning()) return;

  const rect = _canvas.getBoundingClientRect();
  const wx   = e.clientX - rect.left + _cam.x;
  const wy   = e.clientY - rect.top  + _cam.y;

  _fire({ action: 'clickEnemy', x: wx, y: wy });
}

// ─────────────────────────────────────────────────────────────────────────────
// DISPATCH LOGIC
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Apply context gates and fire the appropriate 'game:action' event.
 * @param {string} action — one of the BINDINGS keys
 */
function _dispatch(action) {
  const running = _gates.isBattleRunning();
  const paused  = _gates.isPaused();

  switch (action) {
    // ── Spell slots ────────────────────────────────────────────────
    case 'castSpell0':
    case 'castSpell1':
    case 'castSpell2':
    case 'castSpell3': {
      if (!running || paused) return;
      const slot = parseInt(action.replace('castSpell', ''), 10);
      _fire({ action: 'castSpell', slot });
      break;
    }

    // ── Dash ───────────────────────────────────────────────────────
    case 'dash': {
      if (!running || paused) return;
      _fire({ action: 'dash' });
      break;
    }

    // ── Cycle target ───────────────────────────────────────────────
    case 'cycleTarget': {
      if (!running || paused) return;
      _fire({ action: 'cycleTarget' });
      break;
    }

    // ── Inventory ──────────────────────────────────────────────────
    // Available while running OR paused (you can browse items in the
    // pause menu too); not available outside of a battle scene.
    case 'openInventory': {
      if (!running && !paused) return;
      _fire({ action: 'openInventory' });
      break;
    }

    // ── Pause / resume ─────────────────────────────────────────────
    // togglePause and its alt binding share the same dispatch.
    case 'togglePause':
    case 'togglePauseAlt': {
      if (!running && !paused) return;
      _fire({ action: 'togglePause' });
      break;
    }

    default:
      break;
  }
}

/**
 * Emit a 'game:action' CustomEvent on `document`.
 * @param {Object} detail
 */
function _fire(detail) {
  document.dispatchEvent(new CustomEvent('game:action', { detail }));
}

// Keys that should have their default browser behaviour suppressed during play.
const _SCROLL_PREVENT = new Set([
  'Space', 'Tab',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
]);
