# TODO

## olio

- [ ] Mappers for interfaces (only object types map today).
- [ ] Feature-scoped middleware: optionally limit a feature folder's middleware to the fields it defines (today maps are module-wide).
- [ ] Dependency injection: not in olio. Maybe a separate DI package later.

## codegen

- [ ] Custom root type names (`schema { query: RootQuery }`); rejected today.

## Later

- [ ] HTTP adapter on top of `app.schema` (graphql-http / graphql-ws).
- [ ] Release setup: versions, changesets, CI.
