>> How to run it <<
Because the game uses ES modules (type="module"), browsers block module imports from file:// URLs. You need a local HTTP server. Pick whichever is easiest:
VS Code — install the Live Server extension, right-click index.html → Open with Live Server. Done.

Python (if you have it installed):
bashcd dungeon-descent
python -m http.server 8080
# then open http://localhost:8080

Node:
bashcd dungeon-descent
npx serve .
# then open the URL it prints

>> Как запустить <<

Поскольку в игре используются ES-модули (type="module"), браузеры блокируют импорт модулей из локальных файлов (по протоколу file://). Вам потребуется локальный HTTP-сервер. Выберите самый удобный способ:

VS Code — установите расширение Live Server, нажмите правой кнопкой мыши на index.html → «Open with Live Server». Готово.

Python (если он установлен):
bash

cd dungeon-descent
python -m http.server 8080
# затем откройте http://localhost:8080

Node.js:
bash

cd dungeon-descent
npx serve .
# затем откройте URL, который появится в консоли