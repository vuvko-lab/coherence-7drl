# COHERENCE

A cyberpunk roguelike where you play as an uploaded mind navigating crumbling virtual ship systems. Built for [7DRL 2026](https://itch.io/jam/7drl-challenge-2026).

## Local setup

Requires Node.js 18+.

```bash
npm install
npm run dev
```

Open `http://localhost:5173` in a browser.

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server with HMR |
| `npm run build` | Type-check and bundle for production |
| `npm run preview` | Serve the production build locally |
| `npm test` | Run all tests |
| `npm run test:sim` | Balancing/integration sim (50 seeds, 250 ticks) |
| `npm run test:ai` | AI player full-game completion (10 seeds) |
| `npm run deploy` | Build and deploy to Cloudflare Pages |

## Controls

- **WASD / Arrows** -- move
- **Click** -- move to tile / open terminal
- **Enter** -- transfer at interface exit
- **F** -- toggle aim mode (corrupt.m)
- **RMB** -- quick-fire at nearest visible target
- **Esc** -- cancel aim mode
- **~** -- admin panel (cheats)

## Seed reproduction

Append `#seed=N` to the URL to load a specific map seed.

## 7DRL Version

The `main` branch contains significant changes in project structure and some fixed\added features to the 7drl variant.
The jam submission can be found at the `7drl` branch.

## Online play

You can play on [itch](https://vuvko.itch.io/coherence-7drl).

Or on CloudFlare [pages](https://coherence.vuvko.net).
