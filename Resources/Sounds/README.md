# Custom Sounds Folder

Place your custom sound effect files in this folder. The game will automatically load any matching filenames at startup.

## Required Filenames

### Combat Sounds
- `hit.wav` - Basic hit/damage sound
- `crit.wav` - Critical hit sound
- `heal.wav` - Healing sound
- `shield.wav` - Shield activation/block sound
- `dash.wav` - Dash ability sound

### Spell Sounds
- `spell_fireball.wav` - Fireball spell cast
- `spell_heal.wav` - Healing spell cast
- `spell_shield.wav` - Shield spell cast
- `spell_drain.wav` - Life drain spell cast

### Enemy Sounds
- `enemy_hit.wav` - Enemy taking damage
- `enemy_death.wav` - Enemy dying
- `boss_roar.wav` - Boss roar/aggro sound

### UI Sounds
- `ui_click.wav` - Button click sound
- `ui_hover.wav` - UI hover sound
- `level_up.wav` - Level up sound
- `item_pickup.wav` - Item pickup sound

## Specifications

- **Format**: WAV, MP3, or OGG (browser-dependent)
- **Recommended**: WAV or OGG for best compatibility
- **Sample Rate**: 44.1kHz recommended
- **Channels**: Mono or stereo

## Fallback Behavior

If a sound file is not found, the game will silently continue without playing that sound. This means:
- You can add sounds incrementally
- Missing sounds won't break the game
- Each sound can be added independently

## Volume Control

The sound manager includes:
- Master volume control (default: 50%)
- Per-sound volume override option
- Mute/unmute functionality

## Adding New Sounds

1. Create or obtain your sound effect
2. Save it with the correct filename in this folder
3. Refresh the game page to load the new sound
4. Check the browser console for loading status messages

## Usage in Code

To play a sound from game code:

```javascript
import * as SoundManager from './SoundManager.js';

// Play a sound
SoundManager.play(SoundManager.SOUND_KEYS.hit);

// Play with custom volume
SoundManager.play(SoundManager.SOUND_KEYS.crit, { volume: 0.8 });

// Toggle mute
SoundManager.toggleMute();
```
