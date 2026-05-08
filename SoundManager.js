/**
 * SoundManager.js — Dungeon's Descent
 *
 * Handles loading and playback of sound effects from Resources/Sounds/
 * Falls back to silence if sounds are not found.
 *
 * Contract
 * ────────
 *   READ-ONLY for game state. Manages audio assets only.
 *
 * Dependencies
 * ────────────
 *   None (pure asset manager)
 *
 * Lifecycle
 * ─────────
 *   init()              — preload all available sounds
 *   play(soundKey)      — play a sound by key
 *   stop(soundKey)      — stop a playing sound
 *   setVolume(volume)   — set master volume (0.0 - 1.0)
 */

// ─────────────────────────────────────────────────────────────────────────────
// MODULE STATE
// ─────────────────────────────────────────────────────────────────────────────

/** @type {Map<string, HTMLAudioElement>} */
const _sounds = new Map();

/** @type {Map<string, boolean>} */
const _loadStatus = new Map();

/** @type {number} */
let _masterVolume = 0.5;

/** @type {boolean} */
let _initialized = false;

/** @type {boolean} */
let _muted = false;

// ─────────────────────────────────────────────────────────────────────────────
// SOUND MAPPING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map sound effects to their filenames.
 * Add new entries here when adding custom sounds.
 */
export const SOUND_KEYS = Object.freeze({
  // Combat
  hit:           'hit.wav',
  crit:          'crit.wav',
  heal:          'heal.wav',
  shield:        'shield.wav',
  dash:          'dash.wav',
  
  // Spells
  spell_fireball: 'spell_fireball.wav',
  spell_heal:     'spell_heal.wav',
  spell_shield:   'spell_shield.wav',
  spell_drain:    'spell_drain.wav',
  
  // Enemy sounds
  enemy_hit:     'enemy_hit.wav',
  enemy_death:   'enemy_death.wav',
  boss_roar:     'boss_roar.wav',
  
  // UI
  ui_click:      'ui_click.wav',
  ui_hover:      'ui_hover.wav',
  level_up:      'level_up.wav',
  item_pickup:   'item_pickup.wav',
});

// ─────────────────────────────────────────────────────────────────────────────
// INITIALIZATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Preload all sounds from Resources/Sounds/
 * Call once during game initialization.
 * @returns {Promise<void>} Resolves when all sound loading attempts complete
 */
export async function init() {
  if (_initialized) return;
  
  const basePath = 'Resources/Sounds/';
  const loadPromises = [];
  
  for (const [key, filename] of Object.entries(SOUND_KEYS)) {
    loadPromises.push(_loadSound(key, basePath + filename));
  }
  
  await Promise.allSettled(loadPromises);
  _initialized = true;
  
  console.log(`[SoundManager] Initialized: ${_sounds.size}/${Object.keys(SOUND_KEYS).length} sounds loaded`);
}

/**
 * Load a single sound from URL.
 * @param {string} key - Internal identifier for the sound
 * @param {string} url - Path to the audio file
 * @returns {Promise<HTMLAudioElement|null>}
 */
async function _loadSound(key, url) {
  return new Promise((resolve) => {
    const audio = new Audio();
    
    audio.oncanplaythrough = () => {
      audio.volume = _masterVolume;
      _sounds.set(key, audio);
      _loadStatus.set(key, true);
      resolve(audio);
    };
    
    audio.onerror = () => {
      _loadStatus.set(key, false);
      console.log(`[SoundManager] Sound not found: ${url}`);
      resolve(null);
    };
    
    audio.preload = 'auto';
    audio.src = url;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Play a sound by key.
 * @param {string} key - The sound key from SOUND_KEYS
 * @param {Object} options - Optional parameters
 * @param {number} options.volume - Override volume for this playback (0.0 - 1.0)
 * @param {boolean} options.loop - Whether to loop the sound
 */
export function play(key, options = {}) {
  if (_muted) return;
  
  const sound = _sounds.get(key);
  if (!sound || _loadStatus.get(key) !== true) {
    return; // Silently fail if sound not loaded
  }
  
  // Clone for overlapping playback
  const clone = sound.cloneNode();
  clone.volume = options.volume !== undefined ? options.volume : _masterVolume;
  clone.loop = options.loop || false;
  
  clone.play().catch(err => {
    // Ignore autoplay errors (user interaction required)
    if (err.name !== 'NotAllowedError') {
      console.warn(`[SoundManager] Failed to play "${key}":`, err);
    }
  });
  
  return clone;
}

/**
 * Stop a currently playing sound instance.
 * @param {HTMLAudioElement} instance - The audio instance returned by play()
 */
export function stop(instance) {
  if (instance) {
    instance.pause();
    instance.currentTime = 0;
  }
}

/**
 * Stop all sounds of a specific type.
 * @param {string} key - The sound key to stop
 */
export function stopAll(key) {
  // Note: This only stops the original, not clones
  const sound = _sounds.get(key);
  if (sound) {
    sound.pause();
    sound.currentTime = 0;
  }
}

/**
 * Set the master volume.
 * @param {number} volume - Volume level (0.0 - 1.0)
 */
export function setVolume(volume) {
  _masterVolume = Math.max(0, Math.min(1, volume));
}

/**
 * Get the current master volume.
 * @returns {number}
 */
export function getVolume() {
  return _masterVolume;
}

/**
 * Mute or unmute all sounds.
 * @param {boolean} muted - Whether to mute
 */
export function setMuted(muted) {
  _muted = muted;
}

/**
 * Check if sounds are muted.
 * @returns {boolean}
 */
export function isMuted() {
  return _muted;
}

/**
 * Toggle mute state.
 * @returns {boolean} New mute state
 */
export function toggleMute() {
  _muted = !_muted;
  return _muted;
}

/**
 * Check if the sound manager has been initialized.
 * @returns {boolean}
 */
export function isInitialized() {
  return _initialized;
}

/**
 * Check if a specific sound is loaded and ready.
 * @param {string} key - The sound key
 * @returns {boolean}
 */
export function isLoaded(key) {
  return _loadStatus.get(key) === true;
}

/**
 * Get all loaded sound keys (useful for debugging).
 * @returns {string[]}
 */
export function getLoadedKeys() {
  return Array.from(_sounds.keys());
}

/**
 * Clear all cached sounds (useful for hot-reloading during development).
 */
export function clearCache() {
  _sounds.forEach(sound => {
    sound.pause();
    sound.src = '';
  });
  _sounds.clear();
  _loadStatus.clear();
  _initialized = false;
}
