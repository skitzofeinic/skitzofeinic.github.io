// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://skitzofeinic.github.io',
  integrations: [sitemap()],
  /* the stylesheet is small, so it goes straight into the page instead of costing a request */
  build: { inlineStylesheets: "always" },
  redirects: {
    '/contacts': '/#contact',
    '/cv': '/Nguyen_Anh_Le_Resume.pdf',
    '/experiences/education': '/#education',
    '/experiences/professional': '/#professional',
    '/projects/personal': '/#personal',
    '/projects/school': '/#school',
  },
  vite: {
    plugins: [tailwindcss()]
  }
});