## How to Run

Because the game uses ES modules (`type="module"`), browsers block module imports from `file://` URLs.  
You need to run the project through a local HTTP server.

Choose any option below:

### VS Code (recommended)

Install the **Live Server** extension, then:

1. Open the project folder
2. Right-click `index.html`
3. Select **Open with Live Server**

Done.

### Python

If Python is installed:

```bash
cd dungeon-descent
python -m http.server 8080
```

Then open:

```text
http://localhost:8080
```

### Node.js

```bash
cd dungeon-descent
npx serve .
```

Then open the URL shown in the terminal.

---

## Как запустить

Поскольку игра использует ES-модули (`type="module"`), браузеры блокируют импорт модулей через `file://`.

Поэтому проект нужно запускать через локальный HTTP-сервер.

Выберите любой удобный вариант:

### VS Code (рекомендуется)

Установите расширение **Live Server**, затем:

1. Откройте папку проекта
2. Нажмите правой кнопкой мыши на `index.html`
3. Выберите **Open with Live Server**

Готово.

### Python

Если Python установлен:

```bash
cd dungeon-descent
python -m http.server 8080
```

После этого откройте:

```text
http://localhost:8080
```

### Node.js

```bash
cd dungeon-descent
npx serve .
```

Затем откройте URL, который появится в терминале.
