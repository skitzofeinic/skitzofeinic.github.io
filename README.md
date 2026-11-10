# portfolio

Personal portfolio of Nguyen Anh Le, live at <https://skitzofeinic.github.io>.

Built with [Astro](https://astro.build) and [Tailwind CSS](https://tailwindcss.com). The site is fully static.

## Development

Requires Node.js 22.12 or newer.

```sh
npm ci          # install dependencies
npm run dev     # start the dev server
npm run build   # build the site into dist/
npm run preview # serve the production build locally
```

## Structure

| Path | Contents |
| --- | --- |
| `src/layouts/layout.astro` | Shared page shell: metadata, header, navigation, footer, theme toggle |
| `src/pages/index.astro` | The single page, with one `.snap-panel` per section |
| `src/styles/global.css` | Theme colors, fonts, and base styles |
| `public/` | Static files served as-is, including the CV PDF |

The page passes a `title` and `description` to the layout, which uses them for the page title and search and social previews. Old page URLs redirect to their panel through `redirects` in `astro.config.mjs`.

## Deployment

Pushing to `main` builds the site and deploys it to GitHub Pages through `.github/workflows/static.yml`.
