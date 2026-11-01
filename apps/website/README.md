# Website

The olio site: a landing page and the docs, built with [Astro](https://astro.build), [Starlight](https://starlight.astro.build) and Tailwind CSS v4.

```sh
bun run --cwd apps/website dev       # http://localhost:4321
bun run --cwd apps/website build     # static site in dist/
bun run --cwd apps/website preview
```

## Deploying

`.github/workflows/website.yml` builds the site and deploys it to Cloudflare Pages (project `olio`, at https://olio.nxara.dev) with wrangler (`bun run deploy`, a dev dependency here). A push to `main` that changes the site deploys to production. A pull request from this repo that changes it gets a preview URL, printed in the job's log. It needs the repo secrets `CLOUDFLARE_API_TOKEN` (an API token with Cloudflare Pages: Edit) and `CLOUDFLARE_ACCOUNT_ID`.

## Where things live

| Path | What |
| --- | --- |
| `src/pages/index.astro` | The landing page |
| `src/components/hero.astro` | The hero animation. The scene is `src/components/hero/olio-hero.js` |
| `src/content/docs/**/*.md(x)` | Docs pages. Each file is a page, and its folder is the URL |
| `src/content/docs/reference/` | One page per package. The package READMEs only link here |
| `site.ts` | The repository URL, shared by the config and the landing page |
| `src/styles/global.css` | Tailwind theme and brand colours, shared by the docs and the landing page |

## Writing docs

Add a Markdown file under `src/content/docs/` with a `title` and `description` in its frontmatter. Use `.mdx` to import Starlight's components (`Tabs`, `Steps`, `FileTree`). The sidebar groups are in `astro.config.ts`. `concepts` and `reference` fill themselves, ordered by `sidebar.order`.

The docs live only here. Each package's README on npm and GitHub is a short card that links to its page, so there's one place to keep up to date.
