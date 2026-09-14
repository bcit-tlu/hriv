# HRIV user guide (source)

This folder is the source for the user-facing guide served in the app at
`/guide/` (bell menu → **Documentation**). It is a [VitePress](https://vitepress.dev)
site — plain Markdown pages plus a small config file.

## Editing

- Each `.md` file here is one page of the guide. Edit them directly; no coding
  required.
- Screenshots live in `images/`. Reference them as
  `![Alt text](images/your-file.png)`.
- To add a page: create `your-page.md`, then add it to the `sidebar` list in
  `.vitepress/config.mts` so it shows up in the navigation.
- VitePress supports friendly callouts — `> [!TIP]`, `> [!WARNING]`,
  `> [!IMPORTANT]` — used sparingly in the existing pages.

## Previewing

From the `frontend/` directory:

```sh
npm run docs:dev     # live preview at http://localhost:5174
npm run docs:build   # build into frontend/public/guide (what the app serves)
```

The build also runs inside the frontend Docker image, so changes to this folder
ship automatically with the next deployment.
