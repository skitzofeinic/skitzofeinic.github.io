// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://skitzofeinic.github.io',
  base: 'skitzofeinic.github.io',
  vite: {
    plugins: [tailwindcss()]
  }
});