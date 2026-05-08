# Custom Sprites Folder

Place your custom sprite images in this folder. The game will automatically load any matching filenames at startup.

## Required Filenames

### Enemy Sprites
- `rat.png` - Rat enemy
- `bandit.png` - Bandit enemy  
- `mage.png` - Mage enemy
- `cleric.png` - Cleric enemy
- `goblin_warrior.png` - Goblin Warrior enemy
- `goblin_archer.png` - Goblin Archer enemy
- `goblin_warlord.png` - Goblin Warlord (mini-boss) enemy
- `goblin_shaman.png` - Goblin Shaman enemy
- `cultist.png` - Cultist enemy
- `demon.png` - Demon enemy
- `fiend.png` - Fiend enemy
- `necromancer.png` - Necromancer enemy
- `zombie.png` - Zombie enemy
- `skeleton.png` - Skeleton enemy
- `boss.png` - Main boss enemy

### Player Sprites
- `player.png` - Normal player appearance
- `player_dash.png` - Player during dash ability

### Effect Sprites
- `particle_hit.png` - Hit/damage particle effect
- `particle_heal.png` - Healing particle effect

## Specifications

- **Format**: PNG with transparency recommended
- **Size**: Sprites will be scaled to fit the entity's size (diameter = size * 2)
- **Recommended**: 32x32 or 64x64 pixels for best quality

## Fallback Behavior

If a sprite file is not found, the game will automatically fall back to drawing the entity using the original colored circle primitives. This means:
- You can add sprites incrementally
- Missing sprites won't break the game
- Each entity type can have its own sprite independently

## Adding New Sprites

1. Create your sprite image following the specifications above
2. Save it with the correct filename in this folder
3. Refresh the game page to load the new sprite
4. Check the browser console for loading status messages
