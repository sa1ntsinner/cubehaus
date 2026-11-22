# cubehaus

A speedcubing timer for the browser. It works offline, needs no account and keeps your solves on your device.

**Use it:** https://cubehaus.imslide.workers.dev

## What it does

- Times every WCA event, with official scrambles, inspection, +2 and DNF handled by the WCA's rules.
- Sessions and folders, with averages (ao5 to ao10000), bests and a progress view: trend, practice calendar, distribution and a target estimate.
- Imports your history from csTimer, CubeTime, Twisty Timer and CubeDesk without duplicates. Exports and restores a full backup.
- Solve a past scramble again and keep every attempt.
- Drill scrambles for the 3×3: cross and xcross in a few turns with their solutions, edges or corners only, chosen OLL and PLL cases.
- An algorithm trainer for PLL, OLL and COLL with spaced repetition. Every algorithm in it is checked by a test.
- Keyboard first, with shortcuts you can change. Dark, light and custom themes. English and Russian.

## Develop

Use Node 26 and pnpm 12.18.0.

```sh
pnpm install
pnpm --filter @cubehaus/web dev      # the app on a local port
pnpm typecheck && pnpm lint && pnpm test
pnpm build                           # production build
pnpm e2e                             # Chromium and WebKit; install them first:
pnpm --filter @cubehaus/web exec playwright install chromium webkit
```

`apps/web` is the app. `packages/` holds the logic it is built from: solve rules (`core`), statistics (`stats`), timing (`timer`), scrambles (`scramble`), the cube model and solvers (`cube`), algorithms (`algs`), importers and storage. The packages know nothing of the DOM.

## Licence

[MPL-2.0](LICENSE). Scrambles come from [cubing.js](https://github.com/cubing/cubing.js) (MPL-2.0 option). The interface is set in Roboto and Roboto Mono (Apache-2.0).
