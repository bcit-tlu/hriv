import { defineConfig } from 'vitepress'

// The built site is emitted into ../public/guide so Vite serves it at /guide/
// in both `vite dev` and the nginx production image. See frontend/package.json
// (`docs:build`) and frontend/Dockerfile.
export default defineConfig({
  title: 'HRIV Guide',
  description: 'A quick guide for instructors using the High Resolution Image Viewer',
  base: '/guide/',
  outDir: '../public/guide',
  srcExclude: ['README.md'],
  themeConfig: {
    nav: [{ text: 'Guide home', link: '/' }],
    sidebar: [
      { text: 'Welcome', link: '/' },
      { text: 'Browsing & Viewing', link: '/browsing' },
      { text: 'Managing Categories', link: '/categories' },
      { text: 'Managing Images', link: '/images' },
      { text: 'Managing Groups', link: '/groups' },
      { text: 'Announcements', link: '/announcements' },
      { text: 'Getting Help', link: '/help' },
    ],
    search: { provider: 'local' },
    outline: { level: 2, label: 'On this page' },
    docFooter: { prev: 'Previous page', next: 'Next page' },
  },
})
