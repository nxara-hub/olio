# Website

The olio site: a landing page and the docs, built with [Astro](https://astro.build), [Starlight](https://starlight.astro.build) and Tailwind CSS v4.

```sh
bun run --cwd apps/website dev       # http://localhost:4321
bun run --cwd apps/website build     # static site in dist/
bun run --cwd apps/website preview
```

## Where things live

| Path | What |
| --- | --- |
| `src/pages/index.astro` | The landing page |
| `src/components/hero-3d.astro` | The 3D hero; the scene is `src/components/hero/olio-hero.js` |
| `src/content/docs/**/*.md(x)` | Docs pages. Each file is a page; its folder is the URL |
| `src/content/docs/reference/` | Generated from `packages/*/README.md`; don't edit, it's gitignored |
| `readmes.ts` | Copies the package READMEs in on every dev and build, and rewrites their links |
| `src/styles/global.css` | Tailwind theme and brand colours, shared by the docs and the landing page |

## Writing docs

Add a Markdown file under `src/content/docs/` with a `title` and `description` in its frontmatter. Use `.mdx` to import Starlight's components (`Tabs`, `Steps`, `FileTree`). The sidebar groups are in `astro.config.ts`; `concepts` and `reference` fill themselves, ordered by `sidebar.order`.

Package docs stay in each package's README, so npm and GitHub show the same text. Links between READMEs (`../codegen`) become links to their reference pages; other relative links go to GitHub.
