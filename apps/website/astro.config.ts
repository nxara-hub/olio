import starlight from "@astrojs/starlight";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

import { repoUrl } from "./site.ts";

export default defineConfig({
  site: "https://olio.nxara.dev",
  vite: { plugins: [tailwindcss()] },
  integrations: [
    starlight({
      title: "olio",
      description:
        "Modular, type-safe GraphQL for TypeScript. Many modules, one schema.",
      logo: {
        light: "./src/assets/mark.svg",
        dark: "./src/assets/mark-tile.svg",
        alt: "olio"
      },
      favicon: "/favicon.svg",
      social: [{ icon: "github", label: "GitHub", href: repoUrl }],
      editLink: { baseUrl: `${repoUrl}/edit/main/apps/website/` },
      lastUpdated: true,
      customCss: ["./src/styles/global.css"],
      expressiveCode: {
        themes: ["github-light", "github-dark"],
        styleOverrides: { borderRadius: "14px" }
      },
      sidebar: [
        {
          label: "Start here",
          items: ["getting-started/introduction", "getting-started/quick-start"]
        },
        {
          label: "Concepts",
          items: [{ autogenerate: { directory: "concepts" } }]
        },
        {
          label: "Packages",
          items: [{ autogenerate: { directory: "reference" } }]
        }
      ]
    })
  ]
});
