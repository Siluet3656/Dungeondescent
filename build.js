// build.js
const fs = require('fs');
const path = require('path');

// ----- 1. ORDERED FILE LIST -----
const files = [
  { path: 'DataConfig.js',    glob: 'DataConfig' },
  { path: 'GameState.js',     glob: 'GameState'  },
  { path: 'SoundManager.js',  glob: 'SoundManager' },
  { path: 'SpriteLoader.js',  glob: 'SpriteLoader' },
  { path: 'InputManager.js',  glob: 'InputManager' },
  { path: 'CombatManager.js', glob: 'CombatManager' },
  { path: 'RenderEngine.js',  glob: 'RenderEngine'  },
  { path: 'UIManager.js',     glob: 'UIManager' },
  { path: 'MapManager.js',    glob: 'MapManager' },
  { path: 'LobbyManager.js',  glob: 'LobbyManager' },
];

// ----- 2. HELPER: extract exported names -----
function getExports(code, moduleName) {
  // Very simple: look for "export function", "export const", "export let", "export {"
  const names = new Set();
  const lines = code.split('\n');
  for (let line of lines) {
    line = line.trim();
    if (line.startsWith('export function ')) names.add(line.split('function ')[1].split('(')[0]);
    else if (line.startsWith('export const ')) names.add(line.split('const ')[1].split('=')[0].trim());
    else if (line.startsWith('export let ')) names.add(line.split('let ')[1].split('=')[0].trim());
    else if (line.startsWith('export class ')) names.add(line.split('class ')[1].split(' ')[0]);
    // export { a, b } — catch most
    if (line.startsWith('export {')) {
      const inside = line.match(/\{([^}]+)\}/)[1];
      inside.split(',').forEach(n => names.add(n.trim()));
    }
  }
  // Also catch "export default" if any (none in your code)
  return names.size ? Array.from(names).join(', ') : '';
}

// ----- 3. TRANSFORM each module -----
let bundle = '';

for (const file of files) {
  let code = fs.readFileSync(file.path, 'utf8');
  // Remove all import lines
  code = code.replace(/^import .*$/gm, '');
  // Remove all export keywords (keep the declaration)
  code = code.replace(/\bexport\b\s*/g, '');
  // Wrap in IIFE and assign to window
  const exportsList = getExports(code, file.glob);
  bundle += `\n// ========== ${file.path} ==========\n`;
  bundle += `(function() {\n`;
  bundle += code;
  bundle += `\nwindow.${file.glob} = { ${exportsList} };\n`;
  bundle += `})();\n\n`;
}

// ----- 4. ADD BOOTSTRAP CODE (from index.html <script type="module">) -----
const bs = `
// ========== Bootstrap ==========
const canvas  = document.getElementById('c');
const minimap = document.getElementById('mm');

// Alias for convenience (optional)
const GS = window.GameState;
const DC = window.DataConfig;
const SM = window.SoundManager;
const SL = window.SpriteLoader;
const InputManager = window.InputManager;
const CM = window.CombatManager;
const UI = window.UIManager;
const MapManager = window.MapManager;
const LobbyManager = window.LobbyManager;
const RenderEngine = window.RenderEngine;

// Below is the exact same init code from the original module script,
// but without the import lines.
GS.load();                      // restore cross-run persist
SL.init().catch(err => console.warn('[SpriteLoader] Init failed:', err));
SM.init().catch(err => console.warn('[SoundManager] Init failed:', err));
RenderEngine.init(canvas, minimap);
UI.init();
InputManager.init(canvas, {
  isBattleRunning: () => GS.battle.running,
  isPaused:        () => GS.battle.paused,
});
MapManager.init(canvas);
LobbyManager.init(canvas);

document.getElementById('btn-inv').addEventListener('click', () => {
  SM.play('ui_click');
  MapManager.openInventory();
});
document.getElementById('btn-pause').addEventListener('click', () => {
  SM.play('ui_click');
  CM.openPause();
});
document.getElementById('btn-resume').addEventListener('click', () => {
  SM.play('ui_click');
  CM.closePause();
});
document.getElementById('btn-surrender').addEventListener('click', () => {
  SM.play('ui_click');
  CM.surrender();
});

document.addEventListener('game:action', e => {
  const { action, slot, x, y } = e.detail;
  switch (action) {
    case 'castSpell':    CM.castSpell(slot);         break;
    case 'dash':         CM.doDash();                break;
    case 'cycleTarget':  CM.cycleTarget();           break;
    case 'clickEnemy':   CM.handleClick(x, y);       break;
    case 'togglePause':  CM.togglePause();           break;
    case 'openInventory':MapManager.openInventory(); break;
  }
});

document.addEventListener('lobby:runStarted', () => {
  const nodes = MapManager.generateMap();
  GS.setMapNodes(nodes);
  MapManager.enterMap();
});

document.addEventListener('nav:goLobbyReady', () => {
  document.getElementById('lobby').style.display = 'flex';
  LobbyManager.buildLobby();
});

document.addEventListener('combat:battleStarted', () => {
  LobbyManager.buildHotbar(slot => CM.castSpell(slot));
  UI.resetHUD();
});
`;

bundle += bs;

// ----- 5. READ index.html and inject the bundle -----
let html = fs.readFileSync('index.html', 'utf8');
// Remove the entire <script type="module"> block
html = html.replace(/<script type="module">[\s\S]*?<\/script>/, '');
// Insert a plain script tag before </body>
html = html.replace('</body>', `<script>\n${bundle}\n</script>\n</body>`);

// ----- 6. WRITE single file -----
if (!fs.existsSync('dist')) fs.mkdirSync('dist');
fs.writeFileSync('dist/index.html', html);

console.log('✅ dist/index.html ready for itch.io!');