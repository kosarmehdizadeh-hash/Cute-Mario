# Cute Mario — Blip's Big Adventure 🌟

A tiny cute 2D platformer built with plain HTML5 Canvas and vanilla JavaScript — no build step, no external assets, no dependencies to *play*.

Help **Blip**, a little cloud-blob, run, jump, and collect stars on the way to the flag.

## Play

Just open [`index.html`](./index.html) in a browser, or serve the folder with any static file server:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

## Controls

| Input | Action |
| --- | --- |
| ⬅️ / ➡️ | Walk |
| Shift + ⬅️ / ➡️ | Run |
| Space / ⬆️ | Jump (press again mid-air to double-jump) |
| Escape / P | Pause / resume |
| On-screen buttons | Walk / run / jump — shown automatically on touch/tablet devices |

The mute (🔊/🔇) and pause (⏸️) buttons are always in the top-right corner of the game. Your furthest stage, best score, best time, and mute preference are saved to `localStorage`, so a "Continue from Stage N" option appears on the start screen after your first run.

## Features

- **10 procedurally-generated stages** with a difficulty curve (more platforms, wider gaps, more hazards/enemies as you progress) — but every generated gap is checked against a physics-derived "can a real jump reach this?" bound, so the RNG never produces an unfair or impossible leap.
- **Double jump**, run, variable jump height, and a short jump-input buffer (a jump pressed just before landing still fires).
- **Patrolling enemies** (from stage 3 on) — stomp them for bonus stars, or dodge them like a hazard.
- **Coin combo streak** — 5 stars in a row without dying earns a bonus.
- **Mid-stage checkpoints** — dying to a hazard/enemy past the halfway point respawns you there, not at the start of the stage.
- **Pause**, **mute**, and **reduced-motion support** (respects your OS's "reduce motion" setting).
- **On-screen touch controls** for phones/tablets, and a responsive layout that holds up down to narrow phone widths.
- **Screen-reader status announcements** (stage/score/checkpoint/win) via an `aria-live` region, plus a text description of the game and controls for assistive tech.
- **Saved progress**: furthest stage, best score, and best time persist across visits.

## How it's built

- [`index.html`](./index.html) — markup only: the canvas, HUD, on-screen controls, and overlay screens.
- [`styles.css`](./styles.css) — all page/game-frame styling, including the responsive and reduced-motion rules.
- [`game.js`](./game.js) — all game logic, in one self-contained IIFE (no modules/bundler needed to *run* it). See the numbered section comments at the top for a full code map:
  - **Physics** — gravity/acceleration platformer physics with separate horizontal/vertical collision passes against AABB solids (ground + floating platforms).
  - **Level generation** — candy-colored platforms, bobbing star coins, spike hazards, patrolling enemies, and a checkpoint + goal flag, scaled per stage and bounded by jump-reachability checks.
  - **Camera** — smoothly follows the player with parallax clouds and hills in the background.
  - **Rendering** — everything is drawn each frame with the Canvas 2D API, including a squash-and-stretch animated player sprite (no image assets).
  - **Sound** — short WebAudio-generated beeps plus a small procedural background music loop (no audio files).

## Development (linting & tests)

A `package.json` is included for **development only** — it's not needed to play the game, only to lint/test changes to `game.js`.

```bash
npm install
npm run lint          # ESLint over game.js
npx playwright install --with-deps chromium   # first time only
npm test              # Playwright end-to-end + level-generator invariant tests
```

`.github/workflows/ci.yml` runs both on every push/PR.

The Playwright suite ([`tests/game.spec.js`](./tests/game.spec.js)) covers: the page loading without console errors, the core start/move/pause/mute loop, the screen-reader announcer, the responsive layout at a narrow viewport, the on-screen touch controls, and an invariant check that every procedurally-generated stage's platform gaps/rises stay within what a real jump can cross.

## Deploying to your own server

This repo includes a GitHub Actions workflow (`.github/workflows/deploy.yml`) that
copies the project files to a server over SCP/SSH on every push, using
**SSH key** authentication.

To enable it, add these repository secrets under
**Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
| --- | --- |
| `SSH_HOST` | Server IP or domain |
| `SSH_USER` | SSH username |
| `SSH_PRIVATE_KEY` | Private key for `SSH_USER` (the matching public key must be in that user's `~/.ssh/authorized_keys` on the server) |
| `SSH_PORT` | SSH port (usually `22`) |
| `DEPLOY_PATH` | Absolute path on the server to deploy into (e.g. `/srv/www/p18`) |

Once the secrets are set, every push to the tracked branch (or a manual run from
the **Actions** tab) copies the repo contents into `DEPLOY_PATH` on the server.
Point your web server (Nginx/Apache) at that path to serve `index.html`.
