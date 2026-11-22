# Contributing

Thank you for helping. Small pull requests are the easiest to take: one fix or one idea each.

## Set up

Use Node 26 and pnpm 12.18.0.

```sh
pnpm install
pnpm --filter @cubehaus/web dev
```

## Before a pull request

```sh
pnpm typecheck && pnpm lint && pnpm test
```

For changes to a screen, also run the browser tests:

```sh
pnpm --filter @cubehaus/web exec playwright install chromium webkit
pnpm e2e
```

## Where things are

- `apps/web` is the app.
- `packages/` holds the logic: solve rules (`core`), statistics (`stats`), timing (`timer`), scrambles (`scramble`), the cube model and solvers (`cube`), algorithms (`algs`), importers and storage. Packages know nothing of the DOM.

## Rules

- Logic comes with a test.
- Interface text is in English and Russian.
- Do not copy code from GPL, AGPL or unlicensed projects (csTimer, CubeTime, Twisty Timer, CubeDesk and others). New dependencies must be MIT, BSD, ISC, Apache-2.0 or MPL-2.0.
- For a bigger change, open an issue first so we can agree on it before you write the code.
