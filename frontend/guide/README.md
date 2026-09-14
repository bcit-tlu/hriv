# HRIV user guide (source)

This folder holds the user-facing guide shown in the app via the bell menu
(**Documentation**, `?page=guide`). It is plain Markdown rendered by the
frontend — there is no separate docs site or build step.

## Editing

- Each `.md` file here is one page of the guide. Edit them directly; no coding
  required.
- Screenshots live in `images/`. Reference them as
  `![Alt text](images/your-file.png)`.
- To add a page: create `your-page.md`, then add it to the `GUIDE_PAGES` list
  in `src/components/GuidePage.tsx` so it appears in the guide's navigation.
- Link between pages with `[label](page-slug)` or `[label](page-slug#section)`
  — section anchors are the heading text in lowercase, words joined by `-`
  (e.g. `## Measuring on an image` → `#measuring-on-an-image`).

## Supported formatting

The renderer (`src/components/guideMarkdown.tsx`) understands a small subset
of Markdown — keep pages inside it:

- `#`, `##`, `###` headings, paragraphs, `- ` bullet lists, ``` fenced code
- `**bold**`, `*italic*`, `` `code` ``, `[links](…)`
- `![images](images/file.png)`
- simple `| pipe | tables |`
- `::: tip Title` … `:::` callout boxes (also `note`, `warning`, `important`,
  `caution`)

## Previewing

Run the app (`npm run dev` or `docker compose up`), sign in as an instructor
or admin, and open **Documentation** from the bell menu — or go straight to
`/?page=guide&doc=your-page`.
