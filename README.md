# Cute Mario — Blip's Big Adventure 🌟

A tiny cute 2D platformer built with plain HTML5 Canvas and vanilla JavaScript — no build step, no external assets, no dependencies.

Help **Blip**, a little cloud-blob, run, jump, and collect stars on the way to the flag.

## Play

Just open [`index.html`](./index.html) in a browser, or serve the folder with any static file server:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

## Controls

| Key | Action |
| --- | --- |
| ⬅️ / ➡️ | Walk |
| Shift + ⬅️ / ➡️ | Run |
| Space / ⬆️ | Jump |

## How it's built

Everything lives in a single self-contained `index.html`:

- **Physics** — simple gravity/acceleration platformer physics with separate horizontal/vertical collision passes against AABB solids (ground + floating platforms).
- **Level** — a hand-placed set of candy-colored platforms, bobbing star coins, and a goal flag across a scrolling level.
- **Camera** — smoothly follows the player with parallax clouds and hills in the background.
- **Rendering** — everything is drawn each frame with the Canvas 2D API, including a squash-and-stretch animated player sprite (no image assets).
- **Sound** — short WebAudio-generated beeps for jumps, coin pickups, and winning (no audio files).

See the numbered section comments inside the `<script>` tag in `index.html` for a full code map.

## Deploying to your own server

This repo includes a GitHub Actions workflow (`.github/workflows/deploy.yml`) that
copies the project files to a server over SSH/rsync on every push.

To enable it, add these repository secrets under
**Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
| --- | --- |
| `SSH_HOST` | Server IP or domain |
| `SSH_USER` | SSH username |
| `SSH_PORT` | SSH port (usually `22`) |
| `SSH_PRIVATE_KEY` | Private key (PEM format) whose matching public key is in the server's `~/.ssh/authorized_keys` for `SSH_USER` |
| `DEPLOY_PATH` | Absolute path on the server to deploy into (e.g. `/var/www/cute-mario`) |

Once the secrets are set, every push to the tracked branch (or a manual run from
the **Actions** tab) rsyncs the repo contents to `DEPLOY_PATH` on the server.
Point your web server (Nginx/Apache) at that path to serve `index.html`.

> ⚠️ The workflow uses `rsync --delete`, which removes files in `DEPLOY_PATH`
> that no longer exist in the repo. Use a dedicated directory for this
> deployment, not one shared with other content.
