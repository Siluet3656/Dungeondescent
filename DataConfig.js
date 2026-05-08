/**
 * DataConfig.js — Dungeon's Descent
 *
 * Pure static data. Zero runtime side-effects.
 * Import this module anywhere; never mutate its exports.
 *
 * Exports
 * -------
 *  ALL_SPELLS       — every spell definition
 *  SKILL_TIERS      — skill-tree tier + node definitions
 *  ITEM_POOL        — every loot/shop item
 *  ENEMY_CONFIGS    — base stats for every enemy type
 *  ACT_ENEMIES      — which enemy types appear in each act
 *  ENCOUNTERS       — random event definitions (titles, choices, effects)
 *  RARITY_WEIGHTS   — rarity → weight table used by the loot roller
 *  rollItem()       — weighted-random single item draw
 *  roll3Items()     — draw 3 distinct items
 *  scaleEnemy()     — apply node-column scaling + ascension modifiers
 */

// ─────────────────────────────────────────────────────────────────────────────
// SPELLS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} SpellDef
 * @property {string}  id         — unique key used in equippedSpells[]
 * @property {string}  name
 * @property {string}  icon       — emoji glyph for UI
 * @property {number}  cd         — cooldown in seconds
 * @property {number}  mpCost
 * @property {'damage'|'heal'|'drain'|'shield'} type
 * @property {number}  [dmgMult]  — damage = (10 + magic * dmgMult) * variance
 * @property {number}  [healMult] — heal  = (20 + magic * healMult)
 * @property {number}  [slow]     — slow duration in seconds applied on hit
 * @property {boolean} [aoe]      — if true, hits all living enemies
 * @property {number}  [shieldAmt]— flat shield points added (type:'shield')
 * @property {string}  desc       — short label shown in UI (cd·mp·tag)
 */

/** @type {SpellDef[]} */
export const ALL_SPELLS = [
  {
    id: 'fireball',
    name: 'Fireball',
    icon: '🔥',
    cd: 3,
    mpCost: 25,
    type: 'damage',
    dmgMult: 2.5,
    desc: '3s · 25mp · AoE',
  },
  {
    id: 'frostbolt',
    name: 'Frostbolt',
    icon: '❄',
    cd: 2.5,
    mpCost: 18,
    type: 'damage',
    dmgMult: 1.8,
    slow: 2,
    desc: '2.5s · 18mp · Slow',
  },
  {
    id: 'heal',
    name: 'Heal',
    icon: '💚',
    cd: 8,
    mpCost: 30,
    type: 'heal',
    healMult: 2.5,
    desc: '8s · 30mp · Heal',
  },
  {
    id: 'arcane',
    name: 'Arcane Bolt',
    icon: '✦',
    cd: 1.5,
    mpCost: 12,
    type: 'damage',
    dmgMult: 1.3,
    desc: '1.5s · 12mp · Fast',
  },
  {
    id: 'smite',
    name: 'Holy Smite',
    icon: '✝',
    cd: 4,
    mpCost: 20,
    type: 'damage',
    dmgMult: 3.5,
    desc: '4s · 20mp · Burst',
  },
  {
    id: 'blizzard',
    name: 'Blizzard',
    icon: '🌨',
    cd: 6,
    mpCost: 40,
    type: 'damage',
    dmgMult: 1.5,
    aoe: true,
    desc: '6s · 40mp · All',
  },
  {
    id: 'drain',
    name: 'Life Drain',
    icon: '🩸',
    cd: 5,
    mpCost: 15,
    type: 'drain',
    dmgMult: 1.5,
    desc: '5s · 15mp · Leech',
  },
  {
    id: 'magicShield',
    name: 'Mage Shield',
    icon: '🛡',
    cd: 10,
    mpCost: 35,
    type: 'shield',
    shieldAmt: 50,
    desc: '10s · 35mp · Absorb',
  },
];

/** Quick lookup by id — O(1) after module load. */
export const SPELL_BY_ID = Object.freeze(
  Object.fromEntries(ALL_SPELLS.map(s => [s.id, s]))
);

// ─────────────────────────────────────────────────────────────────────────────
// SKILL TREE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} SkillNode
 * @property {string} name
 * @property {string} desc        — tooltip copy
 * @property {'power'|'magic'|'maxHp'|'maxMp'|'hpRegen'} stat
 * @property {number} max         — max rank
 * @property {number} val         — stat increase per rank
 */

/**
 * @typedef {Object} SkillTier
 * @property {string}     label    — display heading
 * @property {'t1'|'t2'|'t3'|'t4'} cls  — CSS modifier class
 * @property {number}     bossReq  — bosses defeated needed to unlock
 * @property {number}     spCost   — skill points per rank purchase
 * @property {SkillNode[]} skills  — exactly 3 nodes per tier
 */

/** @type {SkillTier[]} */
export const SKILL_TIERS = [
  {
    label: 'Tier I — Novice',
    cls: 't1',
    bossReq: 0,
    spCost: 1,
    skills: [
      { name: 'Basic Power',  desc: '+3 power/rank',    stat: 'power',  max: 3, val: 3  },
      { name: 'Minor Magic',  desc: '+3 magic/rank',    stat: 'magic',  max: 3, val: 3  },
      { name: 'Thick Skin',   desc: '+15 max HP/rank',  stat: 'maxHp',  max: 3, val: 15 },
    ],
  },
  {
    label: 'Tier II — Adept',
    cls: 't2',
    bossReq: 1,
    spCost: 2,
    skills: [
      { name: 'Battle Focus',    desc: '+6 power/rank',    stat: 'power',  max: 3, val: 6  },
      { name: 'Arcane Insight',  desc: '+5 magic/rank',    stat: 'magic',  max: 3, val: 5  },
      { name: 'Vital Surge',     desc: '+25 max HP/rank',  stat: 'maxHp',  max: 3, val: 25 },
    ],
  },
  {
    label: 'Tier III — Expert',
    cls: 't3',
    bossReq: 2,
    spCost: 5,
    skills: [
      { name: "Warrior's Edge",  desc: '+10 power/rank',   stat: 'power',  max: 3, val: 10 },
      { name: 'Spell Mastery',   desc: '+8 magic/rank',    stat: 'magic',  max: 3, val: 8  },
      { name: 'Iron Body',       desc: '+40 max HP/rank',  stat: 'maxHp',  max: 3, val: 40 },
    ],
  },
  {
    label: 'Tier IV — Master',
    cls: 't4',
    bossReq: 3,
    spCost: 8,
    skills: [
      { name: 'Godslayer',      desc: '+18 power/rank',   stat: 'power',  max: 3, val: 18 },
      { name: 'Arcane Ascent',  desc: '+15 magic/rank',   stat: 'magic',  max: 3, val: 15 },
      { name: 'Colossus',       desc: '+60 max HP/rank',  stat: 'maxHp',  max: 3, val: 60 },
    ],
  },
];

/**
 * Flat index helper — mirrors the original `skillRanks[ti*3+si]` layout.
 * @param {number} tierIndex  0-based tier index
 * @param {number} skillIndex 0-based skill index within the tier (0–2)
 * @returns {number} flat array index
 */
export function skillFlatIndex(tierIndex, skillIndex) {
  return tierIndex * 3 + skillIndex;
}

/** Total number of skill nodes across all tiers. */
export const SKILL_COUNT = SKILL_TIERS.reduce((n, t) => n + t.skills.length, 0);

// ─────────────────────────────────────────────────────────────────────────────
// ITEMS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {'common'|'uncommon'|'rare'|'epic'} Rarity
 *
 * @typedef {Object} ItemDef
 * @property {string} name
 * @property {string} icon
 * @property {Rarity} rarity
 * @property {string} stat     — key on player.stats to increment
 * @property {number} val      — amount added
 * @property {string} desc     — tooltip copy
 * @property {number} price    — shop price in gold
 */

/** @type {ItemDef[]} */
export const ITEM_POOL = [
  { name: 'Iron Sword',      icon: '🗡',  rarity: 'common',   stat: 'power',   val: 4,   desc: '+4 Power',      price: 24  },
  { name: 'Steel Blade',     icon: '⚔',  rarity: 'uncommon', stat: 'power',   val: 8,   desc: '+8 Power',      price: 48  },
  { name: 'Enchanted Staff', icon: '🪄',  rarity: 'rare',     stat: 'magic',   val: 10,  desc: '+10 Magic',     price: 84  },
  { name: 'Leather Armor',   icon: '🧥',  rarity: 'common',   stat: 'maxHp',   val: 25,  desc: '+25 Max HP',    price: 22  },
  { name: 'Chain Mail',      icon: '🛡',  rarity: 'uncommon', stat: 'maxHp',   val: 45,  desc: '+45 Max HP',    price: 54  },
  { name: 'Mage Robe',       icon: '👘',  rarity: 'uncommon', stat: 'magic',   val: 7,   desc: '+7 Magic',      price: 46  },
  { name: 'Void Crystal',    icon: '💎',  rarity: 'epic',     stat: 'magic',   val: 16,  desc: '+16 Magic',     price: 144 },
  { name: 'Dragon Scale',    icon: '🐉',  rarity: 'epic',     stat: 'maxHp',   val: 80,  desc: '+80 Max HP',    price: 156 },
  { name: 'Battle Axe',      icon: '🪓',  rarity: 'rare',     stat: 'power',   val: 14,  desc: '+14 Power',     price: 96  },
  { name: 'Mana Gem',        icon: '🔮',  rarity: 'rare',     stat: 'maxMp',   val: 40,  desc: '+40 Max MP',    price: 78  },
  { name: 'Amulet of Life',  icon: '📿',  rarity: 'uncommon', stat: 'hpRegen', val: 1,   desc: '+1 HP/s',       price: 60  },
  { name: 'Arcane Tome',     icon: '📖',  rarity: 'rare',     stat: 'magic',   val: 12,  desc: '+12 Magic',     price: 90  },
];

/** @type {Record<Rarity, number>} */
export const RARITY_WEIGHTS = Object.freeze({
  common:   50,
  uncommon: 30,
  rare:     15,
  epic:      5,
});

/** Total weight sum — precomputed so rollers don't recalculate each call. */
const TOTAL_WEIGHT = ITEM_POOL.reduce((s, i) => s + (RARITY_WEIGHTS[i.rarity] ?? 10), 0);

/**
 * Weighted-random draw of one item (returns a shallow copy).
 * @returns {ItemDef}
 */
export function rollItem() {
  let roll = Math.random() * TOTAL_WEIGHT;
  for (const item of ITEM_POOL) {
    roll -= RARITY_WEIGHTS[item.rarity] ?? 10;
    if (roll <= 0) return { ...item };
  }
  return { ...ITEM_POOL[0] }; // fallback (should never fire)
}

/**
 * Draw `count` distinct items (by name) without replacement.
 * @param {number} [count=3]
 * @returns {ItemDef[]}
 */
export function rollItems(count = 3) {
  const seen = new Set();
  const results = [];
  let guard = 0;
  while (results.length < count && guard++ < 200) {
    const item = rollItem();
    if (!seen.has(item.name)) {
      seen.add(item.name);
      results.push(item);
    }
  }
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// ENEMIES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} EnemyBaseCfg
 * @property {string}  name
 * @property {string}  color          — CSS colour used by RenderEngine
 * @property {number}  size           — collision + draw radius
 * @property {number}  hp             — base HP (before column scaling)
 * @property {number}  spd            — base movement speed multiplier
 * @property {number}  dmg            — base melee/ranged damage
 * @property {number}  atkRate        — seconds between melee hits
 * @property {number}  aggroRange     — aggro distance in tiles
 * @property {number}  xp             — XP granted on death
 * @property {number}  gold           — gold granted on death (before 0.64 factor)
 * @property {number}  [projTimer]
 * @property {number}  [projRate]
 * @property {number}  [projRange]
 * @property {number}  [slowOnHit]
 * @property {number}  [burnDps]
 * @property {number}  [burnDur]
 * @property {number}  [poisonDps]
 * @property {number}  [poisonDur]
 * @property {number}  [goldSteal]
 * @property {number}  [healTimer]
 * @property {number}  [healRate]
 * @property {number}  [healRange]
 * @property {number}  [healAnim]
 * @property {number}  [castTimer]
 * @property {number}  [castRate]
 * @property {number}  [summonTimer]
 * @property {number}  [summonRate]
 * @property {string}  [summonType]
 * @property {number}  [auraRange]
 * @property {number}  [auraDmgBuff]
 * @property {number}  [auraDefBuff]
 * @property {number}  [stealHpMp]
 * @property {number}  [debuffDmgOut]
 * @property {number}  [undyingChance]
 */

/**
 * Base enemy stats keyed by enemy type string.
 * All numeric stats are at column-scale 1.0; `scaleEnemy()` applies
 * the per-node and ascension multipliers at spawn time.
 *
 * Gold values are stored pre-factor here; `scaleEnemy()` applies the 0.64
 * drop-rate factor so callers don't have to remember it.
 *
 * @type {Record<string, EnemyBaseCfg>}
 */
export const ENEMY_CONFIGS = Object.freeze({
  rat: {
    name: 'Rat', color: '#c94', size: 7,
    hp: 11, spd: 2.0, dmg: 4, atkRate: 1.0, aggroRange: 5,
    xp: 15, gold: 3,
  },
  bandit: {
    name: 'Bandit', color: '#4a5', size: 9,
    hp: 22, spd: 0.9, dmg: 7, atkRate: 2.0, aggroRange: 6,
    xp: 30, gold: 6,
    projTimer: 0, projRate: 2.5, projRange: 192, // 6 * TILE (32)
  },
  mage: {
    name: 'Mage', color: '#48f', size: 8,
    hp: 13, spd: 0.8, dmg: 0, atkRate: 99, aggroRange: 6,
    xp: 28, gold: 5,
    castTimer: 0, castRate: 3.5,
  },
  cleric: {
    name: 'Cleric', color: '#eee', size: 9,
    hp: 16.5, spd: 0.8, dmg: 0, atkRate: 99, aggroRange: 5,
    xp: 25, gold: 4,
    healTimer: 0, healRate: 3, healRange: 160, healAnim: 0,
  },
  goblin_warrior: {
    name: 'Goblin Warrior', color: '#8a2', size: 9,
    hp: 20, spd: 1.8, dmg: 8, atkRate: 1.2, aggroRange: 5,
    xp: 35, gold: 7,
    goldSteal: 10,
  },
  goblin_archer: {
    name: 'Goblin Archer', color: '#6a3', size: 8,
    hp: 15, spd: 1.2, dmg: 6, atkRate: 2.5, aggroRange: 6,
    xp: 32, gold: 6,
    projTimer: 0, projRate: 2.2, projRange: 192, slowOnHit: 2,
  },
  goblin_warlord: {
    name: 'Goblin Warlord', color: '#b72', size: 18,
    hp: 50, spd: 0.8, dmg: 14, atkRate: 3.0, aggroRange: 6,
    xp: 60, gold: 12,
    auraRange: 120, auraDmgBuff: 1.2,
  },
  goblin_shaman: {
    name: 'Goblin Shaman', color: '#4a6', size: 11,
    hp: 23, spd: 1.0, dmg: 0, atkRate: 99, aggroRange: 6,
    xp: 45, gold: 9,
    castTimer: 0, castRate: 3.0,
    auraRange: 120, auraDefBuff: 0.8,
  },
  cultist: {
    name: 'Cultist', color: '#a5a', size: 10,
    hp: 28, spd: 1.0, dmg: 0, atkRate: 99, aggroRange: 6,
    xp: 50, gold: 10,
    summonTimer: 0, summonRate: 8, summonType: 'demon',
  },
  demon: {
    name: 'Demon', color: '#c4c', size: 14,
    hp: 45, spd: 1.4, dmg: 9, atkRate: 2.2, aggroRange: 5,
    xp: 55, gold: 11,
    projTimer: 0, projRate: 2.8, projRange: 192,
    burnDps: 4, burnDur: 3,
  },
  fiend: {
    name: 'Fiend', color: '#f68', size: 13,
    hp: 35, spd: 1.3, dmg: 10, atkRate: 1.8, aggroRange: 5,
    xp: 52, gold: 10,
    stealHpMp: 10,
  },
  necromancer: {
    name: 'Necromancer', color: '#66c', size: 11,
    hp: 32, spd: 0.9, dmg: 0, atkRate: 99, aggroRange: 6,
    xp: 58, gold: 12,
    castTimer: 0, castRate: 4.5, debuffDmgOut: 0.7,
  },
  zombie: {
    name: 'Zombie', color: '#587', size: 12,
    hp: 70, spd: 0.6, dmg: 7, atkRate: 2.0, aggroRange: 5,
    xp: 40, gold: 8,
    poisonDps: 3, poisonDur: 4,
  },
  skeleton: {
    name: 'Skeleton', color: '#ccc', size: 8,
    hp: 15, spd: 1.6, dmg: 16, atkRate: 1.0, aggroRange: 5,
    xp: 38, gold: 7,
    undyingChance: 0.4,
  },
});

/**
 * Apply column-scale and ascension multipliers to a fresh enemy stats object.
 * Returns a new plain object — does NOT mutate ENEMY_CONFIGS.
 *
 * @param {EnemyBaseCfg} base     — one entry from ENEMY_CONFIGS
 * @param {number}       scale    — column difficulty scalar (1 + col * 0.2)
 * @param {number}       ascension — current ascension level (0–3)
 * @returns {EnemyBaseCfg}
 */
export function scaleEnemy(base, scale, ascension) {
  const e = { ...base };
  e.hp     = e.hp    * scale;
  e.maxHp  = e.hp;                    // maxHp mirrors scaled hp at spawn
  e.dmg    = e.dmg   * scale;
  e.gold   = e.gold  * scale * 0.64;  // 0.64 = in-game drop-rate factor

  if (ascension >= 1) e.spd  *= 1.2;
  if (ascension >= 2) { e.hp *= 1.3; e.maxHp *= 1.3; e.dmg *= 1.3; }

  return e;
}

// ─────────────────────────────────────────────────────────────────────────────
// ACT ROSTERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Which enemy types can appear in each act (keyed by act number 1–3).
 * Derived from node column: col ≤ 2 → act 1, col ≤ 4 → act 2, else act 3.
 * @type {Record<number, string[]>}
 */
export const ACT_ENEMIES = Object.freeze({
  1: ['rat', 'bandit', 'mage', 'cleric'],
  2: ['goblin_warrior', 'goblin_archer', 'goblin_warlord', 'goblin_shaman'],
  3: ['cultist', 'demon', 'fiend', 'necromancer', 'zombie', 'skeleton'],
});

/**
 * Derive act number from a node's column index.
 * @param {number} col — map node column (1–6)
 * @returns {1|2|3}
 */
export function actFromCol(col) {
  if (col <= 2) return 1;
  if (col <= 4) return 2;
  return 3;
}

// ─────────────────────────────────────────────────────────────────────────────
// ENCOUNTERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} EncounterChoice
 * @property {string}   text   — button label
 * @property {function(Object): string} fn
 *   Called with the live `playerPersist` object.
 *   Mutates it and returns a result string shown in the UI.
 *   May also mutate `persistSP` via the callback registered at runtime —
 *   see the `spCallback` parameter on `getRandomEncounter()`.
 */

/**
 * @typedef {Object} EncounterDef
 * @property {string}           title
 * @property {string}           desc
 * @property {EncounterChoice[]} choices
 */

/**
 * Factory that returns all encounter definitions.
 * Choices are pure functions of `playerPersist`; they return a result string.
 *
 * The `onSPGain` callback is injected so encounter logic can award skill
 * points without importing GameState (avoiding a circular dep).
 *
 * @param {{ onSPGain: function(number): void }} callbacks
 * @returns {EncounterDef[]}
 */
export function buildEncounters({ onSPGain }) {
  return [
    {
      title: 'Wandering Merchant',
      desc: 'A hooded merchant offers wares.',
      choices: [
        {
          text: 'Buy HP Potion (10g) — +50 HP',
          fn: (p) => {
            if (p.gold < 10) return '✗ Not enough gold!';
            p.gold -= 10;
            p.hp = Math.min(p.stats.maxHp, p.hp + 50);
            return '✓ Healed 50 HP!';
          },
        },
        {
          text: 'Buy MP Elixir (10g) — +50 MP',
          fn: (p) => {
            if (p.gold < 10) return '✗ Not enough gold!';
            p.gold -= 10;
            p.mp = Math.min(p.stats.maxMp, p.mp + 50);
            return '✓ Restored 50 MP!';
          },
        },
        { text: 'Leave', fn: () => 'You move on.' },
      ],
    },
    {
      title: 'Ancient Shrine',
      desc: 'A shrine pulses with energy. Bless or curse?',
      choices: [
        {
          text: 'Pray for power (+3 magic, risky)',
          fn: (p) => {
            if (Math.random() < 0.6) {
              p.stats.magic += 3;
              return '✓ The shrine blesses you! +3 Magic';
            }
            p.hp = Math.max(1, p.hp - 20);
            return '✗ Cursed! −20 HP';
          },
        },
        {
          text: 'Pray for health (+20 max HP)',
          fn: (p) => {
            p.stats.maxHp += 20;
            p.hp = Math.min(p.stats.maxHp, p.hp + 20);
            return '✓ +20 Max HP!';
          },
        },
        { text: 'Leave it alone', fn: () => 'You walk away wisely.' },
      ],
    },
    {
      title: 'Wounded Soldier',
      desc: 'A dying soldier begs for aid.',
      choices: [
        {
          text: 'Give aid (−15 HP) → +1 Skill Point',
          fn: (p) => {
            if (p.hp <= 20) return '✗ You are too wounded yourself!';
            p.hp -= 15;
            p.skillPoints = (p.skillPoints || 0) + 1;
            onSPGain(1);
            return '✓ +1 Skill Point! He thanks you.';
          },
        },
        {
          text: 'Take his gold (+20g)',
          fn: (p) => {
            p.gold += 20;
            return '✓ +20 Gold. You feel a pang of guilt.';
          },
        },
        { text: 'Leave', fn: () => 'You cannot help everyone.' },
      ],
    },
    {
      title: 'Trapped Chest',
      desc: 'A glittering chest sits in the center. Too easy?',
      choices: [
        {
          text: 'Open it (risky)',
          fn: (p) => {
            const r = Math.random();
            if (r < 0.5) {
              const g = 10 + Math.floor(Math.random() * 25);
              p.gold += g;
              return `✓ +${g} Gold!`;
            }
            if (r < 0.75) {
              p.hp = Math.max(1, p.hp - 30);
              return '✗ Trapped! −30 HP';
            }
            p.stats.maxHp += 15;
            return '✓ Magical chest! +15 Max HP';
          },
        },
        {
          text: 'Disarm carefully (−5 HP, safe gold)',
          fn: (p) => {
            p.hp = Math.max(1, p.hp - 5);
            const g = 5 + Math.floor(Math.random() * 15);
            p.gold += g;
            return `✓ +${g} Gold, −5 HP`;
          },
        },
        { text: 'Leave it alone', fn: () => 'Better safe than sorry.' },
      ],
    },
  ];
}

/**
 * Pick a random encounter definition.
 * @param {{ onSPGain: function(number): void }} callbacks
 * @returns {EncounterDef}
 */
export function getRandomEncounter(callbacks) {
  const pool = buildEncounters(callbacks);
  return pool[Math.floor(Math.random() * pool.length)];
}

// ─────────────────────────────────────────────────────────────────────────────
// CLASS BASE STATS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Starting stats per player class before skill-tree bonuses are applied.
 * @type {Record<'warrior'|'mage', Object>}
 */
export const CLASS_BASE_STATS = Object.freeze({
  warrior: {
    power: 5, magic: 5,
    maxHp: 100, maxMp: 50,
    hpRegen: 2, mpRegen: 1,
    atkSpd: 1,
  },
  mage: {
    power: 5, magic: 5,
    maxHp: 50, maxMp: 100,
    hpRegen: 1, mpRegen: 5,
    atkSpd: 2,
  },
});
