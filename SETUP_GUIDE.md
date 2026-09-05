# Setup Guide

## What's in this repo

This is a private GitHub repository for DroneViz3D. The code is fully editable by you — all source files are in `src/app/droneviz3d/`.

## Quick start

```bash
cd DroneViz3D
npm install
npm run dev
```

Open http://localhost:3000/droneviz3d

## Repository contents

- `src/app/droneviz3d/` — All app routes and modules
- `src/app/globals.css` — Global styles with topographic contour animations
- `src/app/layout.tsx` — Root layout (fonts, metadata)
- `src/app/page.tsx` — Redirect to `/droneviz3d`
- `.gitignore` — Excludes `node_modules`, `.env*`, `.next/`, `screenshots/`
- `.env.example` — Template for secrets (never commit `.env.local`)
- `LICENSE` — Apache 2.0
- `README.md` — Project documentation
- `PERMISSIONS.md` — What is/isn't committed, how to edit
- `package.json` — Dependencies (Next.js, TypeScript, Zustand, Tailwind)

## How to get it on GitHub

1. Go to https://github.com/new
2. Repository name: **Droneviz3d**
3. Visibility: **Private**
4. Do NOT check "Add a README file" (your README is already in this commit)
5. Click **Create repository**

Then either:

- **Command line:**
  ```bash
  git remote add origin git@github.com:RudranshS15/Droneviz3d.git
  git branch -M main
  git push -u origin main
  ```

- **GitHub Desktop:**
  - File → Clone Repository → paste `https://github.com/RudranshS15/Droneviz3d.git`
  - Drag the `DroneViz3D` folder from your Desktop into GitHub Desktop
  - Commit and push

## Editing

All editable files are under `src/app/droneviz3d/`. The most important:

- `page.tsx` — Landing page
- `upload/page.tsx` — Upload form
- `processing/page.tsx` — Pipeline visualization
- `viewer/page.tsx` — 3D viewer (canvas-based)
- `results/page.tsx` — Results and export
- `store.ts` — Zustand state
- `pipeline.ts` — Processing pipeline module
- `pointcloud.ts` — Point cloud factory
- `validator.ts` — Flight data validation
- `tokens.ts` — Design tokens

## Secrets

Create `.env.local` from `.env.example` if you need backend integration. `.env.local` is gitignored — never commit it.
