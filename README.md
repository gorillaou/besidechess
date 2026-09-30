# Beside

Beside reads a game on [Chess.com](https://www.chess.com) and tells you the move to play there. Enter your Chess.com username for current daily games, or paste a `chess.com/game/live` or `chess.com/game/daily` link. The board here mirrors that position. The button opens the same game on Chess.com.

Share the Chess.com window if you want the call drawn over the picture. Voice speaks the move once the line settles.

It is for study and casual games. Rated games on Chess.com do not allow an engine.

## Run it

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:43123](http://127.0.0.1:43123).

## GitHub Pages

The site can be published with GitHub Actions. After the repository is on GitHub:

1. Open the repository on GitHub.
2. Go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **GitHub Actions**.

The workflow in `.github/workflows/pages.yml` publishes the site on every push to `main`. A project repository is served at `https://<user>.github.io/<repo>/`. A repository named `<user>.github.io` is served at the root.

GitHub Pages is a static site. Your username’s daily games, the screen share, and bot or coach boards still work. A live game link does not, because Chess.com does not let other websites read that game. Share the Chess.com window instead. Running `npm run dev` on your own computer still follows live links.

## How to use it

1. Enter your Chess.com username and click **Load my games**. Current daily games appear, with the one waiting on you first.
2. In a live game, copy the address bar (`https://www.chess.com/game/live/…` or `https://www.chess.com/game/…`) and click **Follow this game**. Beside keeps reading that game while it is being played.
3. Read the call, or turn on **Say each new move**. **Open this game on Chess.com** goes to the real board.
4. **Show my screen** and pick the Chess.com **window**. A live game is followed from the address bar. Bot and coach games (`/play/computer` and `/play/coach`) are read from the board itself. If you are playing Black, flip the board so your pieces sit at the bottom. A tab share hides the address, so the window is the one that works on its own.

Live games in progress are not listed on Chess.com’s public games feed. The game link is how Beside follows those.

## Engine

The coach uses [Stockfish 19 Lite](https://stockfishchess.org) (single-threaded WASM) from [stockfish.js](https://github.com/nmrugg/stockfish.js). Those files are in `public/engine` and are licensed under GPL-3.0. See `public/engine/COPYING.txt`.
