# Storybook and Chromatic integration plan

This note describes how HRIV can adopt Storybook and Chromatic for UI review
and regression testing without rewriting the existing MUI-based frontend.

## Summary

Storybook should be introduced as a parallel component workbench for
`frontend/src/components`, not as a replacement for the application shell or
MUI. HRIV already uses React, Vite, MUI, Vitest, Testing Library, and a small
set of application providers. Storybook can reuse that stack by rendering
components in isolation with the same theme and representative mocked data.

Chromatic then consumes the Storybook stories and turns them into visual,
interaction, and accessibility regression checks in CI. The useful migration is
therefore:

1. Scaffold Storybook for React + Vite in `frontend`.
2. Add global decorators that reproduce HRIV's theme and lightweight provider
   context.
3. Add stories for stable, reusable components before large connected pages.
4. Refactor only components that are too tightly coupled to global app state or
   live network calls to render in isolation.
5. Add Chromatic after the first useful story set exists.

## What does not need to change

- HRIV does not need to abandon MUI. Storybook renders MUI components normally.
- Existing Vitest and Testing Library tests still cover logic, hooks, data
  transforms, and role/permission behavior.
- The deployed application does not need to route through Storybook.
- Full-page workflows do not need to be rewritten first.

## Recommended starting point

Start with components that have clear visual states and limited side effects:

- `MaintenanceBanner`
- `AnnouncementBanner`
- `CategoryRestrictionIcons`
- `ImageTile`
- `CategoryTile`
- `FilterPopoverButton`
- `FilterOptionPanel`
- `FileDropZone`
- `ReorderStatusIndicator`
- Dialog components with mocked open states, such as `MoveImageDialog`,
  `MoveCategoryDialog`, and `MoveRestrictionConfirmDialog`

These stories should cover states reviewers normally need to inspect:

- light and dark theme
- empty, loading, default, error, restricted, disabled, and overflow states
- admin, instructor, and student role variants where the component changes
  affordances
- narrow and desktop viewport layouts for tile/grid components

Large connected components such as `App`, `ManagePage`, `PeoplePage`, and
`ImageViewer` can wait until the smaller component surface is stable. They are
more likely to need mocks for auth, data fetching, OpenSeadragon, canvas, and
browser APIs.

## Storybook configuration shape

The expected frontend setup is:

- `.storybook/main.ts` using `@storybook/react-vite`
- `.storybook/preview.tsx` with global decorators
- `storybook` and `build-storybook` scripts in `frontend/package.json`
- optional `test-storybook` script once the Storybook Vitest addon is enabled

The global preview decorator should mirror the app providers that matter for
component rendering:

```tsx
import type { Preview } from '@storybook/react-vite'
import CssBaseline from '@mui/material/CssBaseline'
import { ThemeProvider } from '@mui/material/styles'
import { buildTheme } from '../src/theme'

const preview: Preview = {
  decorators: [
    (Story, context) => {
      const mode = context.globals.theme === 'dark' ? 'dark' : 'light'

      return (
        <ThemeProvider theme={buildTheme(mode)}>
          <CssBaseline />
          <Story />
        </ThemeProvider>
      )
    },
  ],
  globalTypes: {
    theme: {
      defaultValue: 'light',
      toolbar: {
        icon: 'circlehollow',
        items: ['light', 'dark'],
      },
    },
  },
}

export default preview
```

If a component needs `AuthContext`, prefer a small Storybook-only mock provider
or a test fixture builder instead of wiring Storybook to the real backend. The
same applies to API data: stories should import representative fixtures rather
than fetch live data.

## Refactoring guidance

Use Storybook pressure to improve component boundaries, but keep the refactors
small and behavior-preserving.

Good candidates:

- Components that read global context can accept explicit props for the pieces
  that vary visually.
- Data-fetching pages can split into a container plus a presentational view.
  The container owns API calls; the view receives data, loading, error, and
  callbacks as props.
- Components that depend on browser-only APIs can accept an adapter or mockable
  callback for the browser-specific part.

Avoid:

- Replacing MUI primitives with custom components just for Storybook.
- Moving authorization or visibility rules from backend/frontend logic into
  stories. Stories should demonstrate states; they are not the source of truth.
- Creating stories that rely on live API responses or mutable shared data.

## Chromatic rollout

Add Chromatic after the first representative stories build locally. The first
CI version should be non-blocking or review-only until the team accepts a
baseline.

The repository now has a dedicated GitHub Actions workflow at
`.github/workflows/chromatic.yml`. This is separate from the Chromatic GitHub
App: the App supplies project/repository integration and PR UI, while the
Action runs the Storybook build and uploads the result for pushes that change files under `frontend/`.
The workflow uses `CHROMATIC_PROJECT_TOKEN` from GitHub Actions secrets; the
secret value is never committed to the repository.

Recommended rollout:

1. Add the Chromatic project and configure `CHROMATIC_PROJECT_TOKEN` as a
   GitHub Actions secret.
2. Add a workflow that installs `frontend`, runs the Storybook build from that
   working directory, and uploads to Chromatic.
3. Enable required status checks only after the initial baseline is approved.
4. Use Storybook parameters to tune noisy stories rather than disabling the
   whole suite.

For HRIV's repository layout, the workflow needs to run in `frontend` or pass
Chromatic's `workingDir: frontend` option.

## Testing strategy

Storybook should complement, not replace, existing tests:

- Vitest unit tests: pure functions, hooks, reducers, API helpers, permission
  and visibility utilities.
- Testing Library component tests: behavior that is easier to assert in JSDOM
  and does not need visual review.
- Storybook stories: canonical visual states and interaction examples.
- Storybook play functions: user interactions that reviewers need to see, such
  as opening menus, filtering options, selecting tiles, and dialog validation.
- Chromatic: visual diffs, responsive snapshots, interaction completion, and
  accessibility checks from the story catalog.

## Current implementation

The initial frontend setup now includes:

- Storybook React/Vite config in `frontend/.storybook/main.ts`.
- The Storybook MUI themes addon (`@storybook/addon-themes`) configured in
  `frontend/.storybook/preview.tsx` with HRIV's `buildTheme('light')` and
  `buildTheme('dark')`, plus MUI `ThemeProvider` and `CssBaseline`.
- Storybook quality addons for local review:
  - `@chromatic-com/storybook` provides the Visual Tests panel for Chromatic
    visual regression review.
  - `@storybook/addon-a11y` provides the Accessibility panel for axe-based checks
    while browsing stories.
- Frontend scripts: `npm run storybook`, `npm run build-storybook`,
  `npm run chromatic`, and `npm run test:storybook`.
- GitHub Actions automation in `.github/workflows/chromatic.yml` publishes the
  frontend Storybook on pushes using `chromaui/action@latest` and the
  `CHROMATIC_PROJECT_TOKEN` repository secret. The workflow also supports manual
  runs through `workflow_dispatch`.
- Foundation stories at `frontend/src/theme.stories.tsx` and
  `frontend/src/typography.stories.tsx` document HRIV's light/dark palettes,
  typography variants, custom semantic tokens, opacity treatments, and common
  MUI component variants.
- Component stories at
  `frontend/src/components/AnnouncementBanner.stories.tsx`,
  `frontend/src/components/CategoryTile.stories.tsx`,
  `frontend/src/components/CategoryRestrictionIcons.stories.tsx`,
  `frontend/src/components/ColorModeToggle.stories.tsx`,
  `frontend/src/components/FooterBar.stories.tsx`,
  `frontend/src/components/LoginSplashImage.stories.tsx`,
  `frontend/src/button.stories.tsx`, `frontend/src/field.stories.tsx`, and
  `frontend/src/link.stories.tsx` use a Grafana-inspired docs pattern for simple
  component stories:
  - Group components by purpose in the sidebar, e.g.
    `Information/AnnouncementBanner`.
  - Add an attached `*.docs.mdx` page for each documented component/section so
    the sidebar includes a Grafana-style `Docs` entry with usage guidance,
    canvases, and controls.
  - Make `Basic` the first story and keep it close to the default production
    usage.
  - Expose meaningful underlying UI-library variants as controls on `Basic` when
    they are safe for consumers to use. For example, `AnnouncementBanner`
    exposes curated MUI `Alert` presentation props such as `alertVariant`,
    `severity`, and `color`; `CategoryTile` exposes HRIV browse-tile states such
    as visibility, card image, restrictions, counts, and admin/instructor
    actions.
  - Add focused, named example stories for meaningful states such as `With
Dismiss Action`, `Login Screen`, and `Empty Message`.
  - Use the attached `*.docs.mdx` page as the showcase/reference surface: add
    explicit `Canvas` blocks for the examples designers and developers should
    compare, rather than creating a separate `Examples` story.
  - Prefer `play` functions for small, deterministic user interactions that do
    not require live backend state. `AnnouncementBanner`'s `With Dismiss Action`
    story is the first example: it clicks the dismiss button and asserts the
    dismissed state.
  - When a story intentionally disables controls, explain why in the component's
    attached `*.docs.mdx` page and point readers back to `Basic` for interactive
    controls.

Because the frontend currently uses Vite 8, the Storybook packages are pinned to
Storybook 10.6 beta versions, which are the available versions whose React/Vite
framework advertises Vite 8 peer support. Storybook's Vitest addon is configured
with `frontend/vitest.config.ts` and runs story tests in Chromium via
`@vitest/browser-playwright`; install the browser once with
`npx playwright install chromium` before running `npm run test:storybook` on a
fresh machine.

## First implementation slice

The original recommended first PR was intentionally small:

1. Install Storybook React + Vite dependencies.
2. Add `storybook` and `build-storybook` scripts.
3. Add the MUI theme decorator with light/dark globals.
4. Add stories for `MaintenanceBanner`, `CategoryRestrictionIcons`, and one tile
   component.
5. Verify `npm run build-storybook`.

Once that is stable, add Chromatic CI and expand stories by workflow area.
