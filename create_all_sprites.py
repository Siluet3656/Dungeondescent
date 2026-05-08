from PIL import Image

def create_enemy_sprite(filename, color, size=32):
    """Create a simple enemy sprite with solid color and outline"""
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    pixels = img.load()
    
    center = size // 2
    radius = size // 2 - 2
    
    # Parse hex color (handle both #rgb and #rrggbb)
    if len(color) == 4:
        r = int(color[1] * 2, 16)
        g = int(color[2] * 2, 16)
        b = int(color[3] * 2, 16)
    else:
        r = int(color[1:3], 16)
        g = int(color[3:5], 16)
        b = int(color[5:7], 16)
    
    for y in range(size):
        for x in range(size):
            dist = ((x - center) ** 2 + (y - center) ** 2) ** 0.5
            
            if dist < radius - 1:
                # Solid inner circle
                pixels[x, y] = (r, g, b, 255)
            elif dist < radius:
                # Slightly lighter edge
                pixels[x, y] = (min(r+40, 255), min(g+40, 255), min(b+40, 255), 255)
            elif dist < radius + 1:
                # Dark outline
                pixels[x, y] = (max(r-80, 0), max(g-80, 0), max(b-80, 0), 255)
    
    img.save(f'/workspace/Resources/Sprites/{filename}')
    print(f"Created: {filename}")

# Enemy colors from DataConfig.js
sprites = [
    ('rat.png', '#c94'),
    ('bandit.png', '#4a5'),
    ('mage.png', '#48f'),
    ('cleric.png', '#eee'),
    ('goblin_warrior.png', '#8a2'),
    ('goblin_archer.png', '#6a3'),
    ('goblin_warlord.png', '#b72'),
    ('goblin_shaman.png', '#4a6'),
    ('cultist.png', '#a5a'),
    ('demon.png', '#c4c'),
    ('fiend.png', '#f68'),
    ('necromancer.png', '#66c'),
    ('zombie.png', '#587'),
    ('skeleton.png', '#ccc'),
    ('boss.png', '#b33'),
    ('player.png', '#6af'),
    ('player_dash.png', '#aef'),
    ('particle_hit.png', '#fa0'),
    ('particle_heal.png', '#4fa'),
]

for filename, color in sprites:
    create_enemy_sprite(filename, color)

print(f"\nCreated {len(sprites)} sprites!")
