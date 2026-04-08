# Testing Corgi Frontend

How to run and test the Corgi frontend application locally.

## Prerequisites

- Docker and Docker Compose installed
- The repo cloned locally

## Setup

1. Start all services:
   ```bash
   docker compose up --build
   ```
   This starts: frontend (Vite dev server on :5173), backend (FastAPI on :8000), PostgreSQL database, and backup service.

2. Wait for all services to be healthy. The frontend is ready when you can access `http://localhost:5173`.

3. Seed data is automatically loaded on first run, including test images and categories.

## Seed Credentials

- **Admin user**: `admin@bcit.ca` / `password`
  - Role: admin (has `canEditContent` and `canManageUsers` permissions)
  - Access to: HOME, IMAGES, MANAGE, PEOPLE, ADMIN tabs

## Seed Data

### Categories (hierarchical)
- Architecture (parent)
  - American
  - Italian
    - Gothic
- Panoramas

### Images
| ID | Name | Category | Note |
|----|------|----------|------|
| 1 | Duomo di Milano | Italian | OpenSeaDragon Examples |
| 2 | Duomo di Milano (Gothic Detail) | Gothic | OpenSeaDragon Examples |
| 3 | Highsmith Panorama | American | Library of Congress |
| 4 | Library of Congress | Panoramas | Library of Congress |

## Key UI Navigation Paths

### Images Tab
- Click **IMAGES** in the top nav
- Shows a table with columns: ID, Name, Category, Copyright, Note, Program, Status, Modified, Actions
- Click the filter icon (funnel) next to "ADD IMAGE" to show per-column filter fields
- Category filter matches against the full category path (e.g., "Architecture : Italian")

### Edit Details Modal
- From the Images tab, click on any image name to open the Edit Details modal
- The modal includes: Name, Category (dropdown with tree), Copyright, Note, Program, Status toggle, Measurement Settings
- A **VIEW IMAGE** button in the top-right navigates to the image viewer
- The Category dropdown shows the full category tree with icons for view, edit, and add (+)

### Category Management
- In the Category dropdown, click "+" next to any category to add a subcategory
- A "New Category" dialog appears for naming the new category
- After creation, the new category is automatically selected in the dropdown

### Add Image Modal
- Click **ADD IMAGE** button on the Images tab
- Similar form to Edit Details but for creating new images
- Category dropdown works the same way with add-and-auto-select

### Bulk Import Modal
- Click **BULK IMPORT** button on the Images tab
- Allows importing multiple images at once
- Category dropdown works the same way

### Footer
- The footer contains a link "BCIT Teaching and Learning Unit" pointing to https://github.com/bcit-tlu
- Visible on all pages

## Testing Tips

- When testing category filters, use partial strings like "arch" to verify matching against the full category path (e.g., "Architecture : Italian" should match)
- When testing auto-select, cancel without saving after verifying the dropdown value to avoid polluting test data
- The Chrome browser needs to be started with `--remote-debugging-port=29229` for CDP access if using Playwright scripts
- Use `/opt/.devin/chrome/chrome/linux-*/chrome-linux64/chrome` as the Chrome binary (the `google-chrome` wrapper requires CDP proxy)
- Maximize the browser window before recording: `wmctrl -r "Google Chrome" -b add,maximized_vert,maximized_horz` (install wmctrl first if needed: `sudo apt-get install -y wmctrl`)
