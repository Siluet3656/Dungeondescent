/**
 * SpriteLoader.js — Dungeon's Descent
 *
 * Handles loading and caching of custom sprites from Resources/Sprites/
 * Falls back to drawing primitives if sprites are not found.
 *
 * Contract
 * ────────
 *   READ-ONLY for game state. Manages image assets only.
 *
 * Dependencies
 * ────────────
 *   None (pure asset loader)
 *
 * Lifecycle
 * ─────────
 *   init()              — preload all available sprites
 *   getSprite(key)      — returns Image object or null
 *   isLoaded(key)       — check if specific sprite is ready
 *   drawSprite(ctx, key, x, y, size, fallbackFn) — draw sprite or fallback
 */

// ─────────────────────────────────────────────────────────────────────────────
// MODULE STATE
// ─────────────────────────────────────────────────────────────────────────────

/** @type {Map<string, HTMLImageElement>} */
const _sprites = new Map();

/** @type {Map<string, boolean>} */
const _loadStatus = new Map();

/** @type {boolean} */
let _initialized = false;

// ─────────────────────────────────────────────────────────────────────────────
// SPRITE MAPPING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map enemy types and special entities to their sprite filenames.
 * Add new entries here when adding custom sprites.
 */
export const SPRITE_KEYS = Object.freeze({
  // Enemies
  rat:            'rat.png',
  bandit:         'bandit.png',
  mage:           'mage.png',
  cleric:         'cleric.png',
  goblin_warrior: 'goblin_warrior.png',
  goblin_archer:  'goblin_archer.png',
  goblin_warlord: 'goblin_warlord.png',
  goblin_shaman:  'goblin_shaman.png',
  cultist:        'cultist.png',
  demon:          'demon.png',
  fiend:          'fiend.png',
  necromancer:    'necromancer.png',
  zombie:         'zombie.png',
  skeleton:       'skeleton.png',
  boss:           'boss.png',
  
  // Player
  player:         'player.png',
  player_dash:    'player_dash.png',
  
  // Particles / Effects
  particle_hit:   'particle_hit.png',
  particle_heal:  'particle_heal.png',
});

// ─────────────────────────────────────────────────────────────────────────────
// INITIALIZATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Preload all sprites from Resources/Sprites/
 * Call once during game initialization.
 * @returns {Promise<void>} Resolves when all sprite loading attempts complete
 */
export async function init() {
  if (_initialized) return;
  
  const basePath = 'Resources/Sprites/';
  console.log(`[SpriteLoader] Starting sprite preload from "${basePath}".`);
  console.log(`[SpriteLoader] Keys to load:`, Object.keys(SPRITE_KEYS));

  const loadPromises = [];
  
  for (const [key, filename] of Object.entries(SPRITE_KEYS)) {
    const url = basePath + filename;
    loadPromises.push(_loadSprite(filename, url));
}
  
  await Promise.allSettled(loadPromises);
  _initialized = true;
  
  const loadedCount = _sprites.size;
  const totalCount = Object.keys(SPRITE_KEYS).length;
  console.log(`[SpriteLoader] Preload complete. ${loadedCount}/${totalCount} sprites loaded.`);
  
  if (loadedCount < totalCount) {
    console.warn(`[SpriteLoader] Missing sprites: ${
      Object.keys(SPRITE_KEYS).filter(k => !_loadStatus.get(k)).join(', ')
    }. The game will use fallback primitives for these.`);
  }
}

/**
 * Load a single sprite from URL.
 * @param {string} key - Internal identifier for the sprite
 * @param {string} url - Path to the image file
 * @returns {Promise<HTMLImageElement|null>}
 */
async function _loadSprite(spriteName, url) {   // ← переименовали
  console.log(`[SpriteLoader] Attempting to load: ${spriteName} from ${url}`);
  return new Promise((resolve) => {
    const img = new Image();
    
    img.onload = () => {
      _sprites.set(spriteName, img);           // ← сохраняем по spriteName (имени файла)
      _loadStatus.set(spriteName, true);
      console.log(`[SpriteLoader] ✔ Loaded: ${spriteName} (${img.naturalWidth}x${img.naturalHeight})`);
      resolve(img);
    };
    
    img.onerror = (err) => {
      _loadStatus.set(spriteName, false);
      console.error(`[SpriteLoader] ✘ Failed to load: ${spriteName} (${url})`, err);
      resolve(null);
    };
    
    // Убираем cache-busting — он не нужен и может мешать
    img.src = url;   // было url + '?v=' + Date.now();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get a loaded sprite by key.
 * @param {string} key - The sprite key from SPRITE_KEYS
 * @returns {HTMLImageElement|null} The image or null if not loaded
 */
export function getSprite(key) {
  const sprite = _sprites.get(key);
  if (!sprite) {
    console.warn(`[SpriteLoader] getSprite("${key}") returned null. Loaded keys:`, Array.from(_sprites.keys()));
  }
  return sprite || null;
}

/**
 * Check if a specific sprite is loaded and ready.
 * @param {string} key - The sprite key
 * @returns {boolean}
 */
export function isLoaded(key) {
  return _loadStatus.get(key) === true;
}

/**
 * Check if the sprite loader has been initialized.
 * @returns {boolean}
 */
export function isInitialized() {
  return _initialized;
}

/**
 * Draw a sprite with fallback to primitive drawing.
 * 
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {string} key - Sprite key from SPRITE_KEYS
 * @param {number} x - Center X position in world coordinates
 * @param {number} y - Center Y position in world coordinates
 * @param {number} size - Radius/size for the sprite (will be drawn as diameter)
 * @param {Function} fallbackFn - Function to call if sprite not available: (ctx, x, y, size) => void
 */
export function drawSprite(ctx, key, x, y, size, fallbackFn) {
  const sprite = _sprites.get(key);
  if (sprite && sprite.complete && sprite.naturalWidth > 0) {
    console.debug(`[drawSprite] drawing image for ${key}, size=${size}`);
    // Sprite loaded and usable
    const diameter = size * 2;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    try {
      ctx.drawImage(
        sprite,
        Math.floor(x - diameter / 2),
        Math.floor(y - diameter / 2),
        Math.floor(diameter),
        Math.floor(diameter)
      );
    } catch (e) {
      console.warn(`[SpriteLoader] drawImage error for ${key}:`, e);
      if (fallbackFn) fallbackFn(ctx, x, y, size);
    }
    ctx.restore();
  } else {
    console.debug(`[drawSprite] FALLBACK for ${key}, sprite=${!!sprite}, complete=${sprite?.complete}, nw=${sprite?.naturalWidth}`);
    if (fallbackFn) fallbackFn(ctx, x, y, size);
  }
}

/**
 * Get all loaded sprite keys (useful for debugging).
 * @returns {string[]}
 */
export function getLoadedKeys() {
  return Array.from(_sprites.keys());
}

/**
 * Clear all cached sprites (useful for hot-reloading during development).
 */
export function clearCache() {
  console.log('[SpriteLoader] Clearing cache and resetting.');
  _sprites.clear();
  _loadStatus.clear();
  _initialized = false;
}