# HRIV Frontend - Image Viewer

A minimal, functional [OpenSeaDragon](https://openseadragon.github.io/) deep-zoom image viewer built with contemporary tooling and Material Design.

## Stack

| Layer        | Technology                  |
| ------------ | --------------------------- |
| Build        | Vite 8                      |
| Framework    | React 19 + TypeScript 5.9   |
| UI           | Material UI (MUI) v7        |
| Image viewer | OpenSeaDragon 6             |

## Getting started

```bash
cd frontend
npm install
npm run dev        # starts dev server at http://localhost:5173
```

## Available scripts

| Script          | Description                        |
| --------------- | ---------------------------------- |
| `npm run dev`   | Start Vite dev server with HMR     |
| `npm run build` | Type-check then production build   |
| `npm run lint`  | Run ESLint                         |
| `npm run preview` | Preview production build locally |

## Project structure

```
frontend/
├── src/
│   ├── components/
│   │   └── ImageViewer.tsx   # OpenSeaDragon wrapper component
│   ├── App.tsx               # Gallery + viewer layout
│   ├── main.tsx              # Entry point with MUI theme
│   └── theme.ts              # Material Design theme config
├── index.html
├── vite.config.ts
└── package.json
```
