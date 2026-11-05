import { defineConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

export default defineConfig({
  ...ultracite,
  printWidth: 80,
  tabWidth: 2,
  useTabs: false,
  semi: true,
  singleQuote: false,
  quoteProps: "as-needed",
  jsxSingleQuote: false,
  trailingComma: "none",
  bracketSpacing: true,
  bracketSameLine: false,
  arrowParens: "always",
  endOfLine: "lf",
  ignorePatterns: [
    "**/generated.ts",
    "**/typedefs.generated.ts",
    // GraphQL SDL is codegen input, not hand-formatted source; empty files are
    // valid and oxfmt's GraphQL parser rejects them.
    "**/*.gql",
    "**/*.graphql",
    // oxfmt moves code fences out of components nested in list items (Starlight
    // <Tabs> inside <Steps>), which breaks the MDX.
    "**/*.mdx"
  ]
});
