# TODO

## Later

- [ ] File uploads (the GraphQL multipart request spec), client and server.

- [ ] Docs, including migration guides for people coming from GraphQL Yoga and Apollo Server.
- [ ] Our own GraphQL client for exploring and calling an API, something like HTTPie but for GraphQL (instead of GraphiQL).
- [ ] Release setup: versions, changesets, CI.
- [ ] A codegen CLI (`nxara codegen`) reading a config file (`nxara.config.ts`): paths resolve against the config file, errors print as plain messages with exit code 1 (issues 030, 033).
- [ ] Measure what the `@nxlab/tools` load functions cost (`loadModules`, `loadFeatures`, `loadTypeDefs`, `loadResolvers`, `loadEnums`) against the same app wired by hand with imports and inline SDL: startup time, memory, type-check time, and bundle/build size where it applies. Use the example server for both.
