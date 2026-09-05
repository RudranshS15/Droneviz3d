# Permissions & Secrets

This repository contains the full source code for DroneViz3D. All code is visible in the private repository and can be edited by you directly.

## What is committed

- All source files under `src/`
- Configuration files (`tsconfig.json`, `tailwind.config.ts`, `next.config.js`, etc.)
- `package.json` and `package-lock.json`
- `README.md`, `LICENSE`, `.gitignore`
- `.env.example` — a template with empty values, never real secrets

## What is NOT committed

The following are in `.gitignore` and never touch the repository:

- `.env.local` — your real environment variables (API keys, backend URLs, storage credentials). Create it from `.env.example`.
- `node_modules/` — dependencies, install with `npm install`
- `.next/` — Next.js build output
- `screenshots/` — local test screenshots (ignored by `.gitignore`)
- `Start.bat` — local Windows launcher script

## How to edit

Clone or download the repo, then:

```bash
cd DroneViz3D
npm install
npm run dev
```

All source files are in `src/app/droneviz3d/`. Edit whatever you like — the repository is fully editable by you.

## Going public later

When you're ready to make the repo public, the code will be fully visible. Secrets stay protected because `.env.local` is always gitignored. Just make sure you never commit real values to `.env.local` and you're good.
