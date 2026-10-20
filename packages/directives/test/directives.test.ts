import { describe, expect, test } from "bun:test";

import {
  buildASTSchema,
  isInputObjectType,
  isObjectType,
  parse,
  print,
  Source,
  validateSchema,
  type GraphQLSchema
} from "graphql";

import {
  applyDirectives,
  copyDirective,
  implementsDirective,
  type SchemaDirective
} from "../src/index.js";

const both = [implementsDirective(), copyDirective()];

function run(sdl: string, directives: readonly SchemaDirective[] = both) {
  const document = applyDirectives(
    parse(new Source(sdl, "schema.gql")),
    directives
  );
  return { printed: print(document), schema: buildASTSchema(document) };
}

const fieldsOf = (schema: GraphQLSchema, name: string): string[] => {
  const type = schema.getType(name);
  if (!type || !(isObjectType(type) || isInputObjectType(type))) {
    throw new Error(`expected an object or input "${name}"`);
  }
  return Object.keys(type.getFields());
};

const interfacesOf = (schema: GraphQLSchema, name: string): string[] => {
  const type = schema.getType(name);
  if (!isObjectType(type)) throw new Error(`expected an object "${name}"`);
  return type.getInterfaces().map((i) => i.name);
};

describe("@implements", () => {
  test("adds the interfaces and copies their fields, in order", () => {
    const { schema, printed } = run(`
      interface A { id: ID! a: String! }
      interface B { id: ID! b: String! }
      type T @implements(from: ["A", "B"]) { c: String! }
    `);
    expect(interfacesOf(schema, "T")).toEqual(["A", "B"]);
    expect(fieldsOf(schema, "T")).toEqual(["id", "a", "b", "c"]);
    expect(printed).not.toContain("@implements");
  });

  test("merges with an existing implements clause", () => {
    const { schema } = run(`
      interface Node { id: ID! }
      interface Named { name: String! }
      type User implements Node @implements(from: ["Node", "Named"]) { id: ID! }
    `);
    expect(interfacesOf(schema, "User")).toEqual(["Node", "Named"]);
  });

  test("allows repeating an interface field as it is", () => {
    const { schema } = run(`
      interface A { id: ID! }
      interface B { id: ID! }
      type User @implements(from: ["A", "B"]) { "Docs are fine." id: ID! }
    `);
    expect(fieldsOf(schema, "User")).toEqual(["id"]);
  });

  test("rejects overriding an interface field", () => {
    expect(() =>
      run(`
        interface Node { id: ID }
        type User @implements(from: ["Node"]) { id: ID! }
      `)
    ).toThrow(
      '@implements on "User": "User" redeclares field "id" from "Node" (id: ID vs id: ID!). Remove one, or use @copy to override.'
    );
    expect(() =>
      run(`
        interface A { x: Int }
        interface B { x: String }
        type T @implements(from: ["A", "B"]) { t: Int }
      `)
    ).toThrow('"B" redeclares field "x" from "A"');
  });

  test("works on extensions, skipping fields the type already has", () => {
    const { schema } = run(`
      interface Timestamped { id: ID! at: String! }
      type User { id: ID! }
      extend type User @implements(from: ["Timestamped"])
    `);
    expect(interfacesOf(schema, "User")).toEqual(["Timestamped"]);
    expect(fieldsOf(schema, "User")).toEqual(["id", "at"]);
  });

  test("only references interfaces, only on object types", () => {
    expect(() =>
      run(`type A { a: Int } type T @implements(from: ["A"]) { t: Int }`)
    ).toThrow(
      'schema.gql:1:26: @implements on "T" can copy from interface types, but "A" is an object'
    );
    expect(() =>
      run(`interface I { a: Int } input T @implements(from: ["I"]) { t: Int }`)
    ).toThrow(
      '@implements can only be used on object types, but "T" is an input'
    );
    expect(() =>
      run(`interface I { a: Int } enum E @implements(from: ["I"]) { X }`)
    ).toThrow('but "E" is an enum');
  });
});

describe("@copy", () => {
  test("copies fields without adding implements", () => {
    const { schema } = run(`
      interface Node { id: ID! }
      type Base { createdAt: String! }
      type User @copy(from: ["Node", "Base"]) { name: String! }
    `);
    expect(fieldsOf(schema, "User")).toEqual(["id", "createdAt", "name"]);
    expect(interfacesOf(schema, "User")).toEqual([]);
  });

  test("copies inputs from inputs, and local fields win", () => {
    const { schema, printed } = run(`
      input Page { cursor: String limit: Int }
      input UserPage @copy(from: ["Page"]) { cursor: ID }
    `);
    expect(fieldsOf(schema, "UserPage")).toEqual(["cursor", "limit"]);
    expect(printed).toContain(
      "input UserPage {\n  cursor: ID\n  limit: Int\n}"
    );
  });

  test("accepts a single type name", () => {
    const { schema } = run(
      `type A { a: Int } type B @copy(from: "A") { b: Int }`
    );
    expect(fieldsOf(schema, "B")).toEqual(["a", "b"]);
  });

  test("works on extensions", () => {
    const { schema } = run(`
      input Page { limit: Int }
      input Filter { name: String }
      extend input Filter @copy(from: ["Page"])
    `);
    expect(fieldsOf(schema, "Filter")).toEqual(["name", "limit"]);
  });

  test("later sources override earlier ones, local fields override all", () => {
    const { printed } = run(`
      type A { x: Int y: Int }
      type B { x: String z: Int }
      type C @copy(from: ["A", "B"]) { y: Boolean }
    `);
    // Spread order: { ...A, ...B, ...local }, positions from first appearance.
    expect(printed).toContain(
      "type C {\n  x: String\n  y: Boolean\n  z: Int\n}"
    );
  });

  test("rejects unknown and mismatched sources and targets", () => {
    expect(() => run(`type U @copy(from: ["Nope"]) { a: Int }`)).toThrow(
      'schema.gql:1:8: @copy on "U" references unknown type "Nope"'
    );
    expect(() => run(`scalar S type U @copy(from: ["S"]) { a: Int }`)).toThrow(
      '@copy on "U" can copy from object types and interface types, but "S" is a scalar'
    );
    expect(() =>
      run(`type A { a: Int } input I @copy(from: ["A"]) { b: Int }`)
    ).toThrow('@copy on "I" can copy from input types, but "A" is an object');
    expect(() =>
      run(`input A { a: Int } type T @copy(from: ["A"]) { b: Int }`)
    ).toThrow('but "A" is an input');
    expect(() =>
      run(`type A { a: Int } interface I @copy(from: ["A"]) { b: Int }`)
    ).toThrow(
      '@copy can only be used on object types and input types, but "I" is an interface'
    );
    expect(() => run(`type U @copy { a: Int }`)).toThrow(
      '@copy needs a "from" argument'
    );
  });
});

describe("applyDirectives", () => {
  test("resolves chains, in either directive order", () => {
    const sdl = `
      interface Node { id: ID! }
      type A @implements(from: ["Node"]) { a: Int }
      type B @copy(from: ["A"]) { b: Int }
      type C @copy(from: ["B"]) { c: Int }
    `;
    for (const order of [both, both.toReversed()]) {
      expect(fieldsOf(run(sdl, order).schema, "C")).toEqual([
        "id",
        "a",
        "b",
        "c"
      ]);
    }
  });

  test("rejects cycles", () => {
    expect(() =>
      run(
        `type A @copy(from: ["B"]) { a: Int } type B @copy(from: ["A"]) { b: Int }`
      )
    ).toThrow('Schema directives reference each other in a cycle: "A", "B"');
  });

  test("enables only the directives passed", () => {
    const { printed } = run(
      `
        interface Node { id: ID! }
        directive @copy(from: [String!]!) on OBJECT
        type User @implements(from: ["Node"]) @copy(from: ["Node"]) { name: String! }
      `,
      [implementsDirective()]
    );
    expect(printed).toContain("type User implements Node @copy(");
  });

  test("removes the directives' definitions from the output", () => {
    const { printed } = run(`
      directive @copy(from: [String!]!) on OBJECT | INPUT_OBJECT
      type A { a: Int }
      type B @copy(from: ["A"]) { b: Int }
    `);
    expect(printed).not.toContain("directive @copy");
  });

  test("validates every directive before transforming", () => {
    let transformed = false;
    const spy: SchemaDirective = {
      name: "spy",
      definition: "directive @spy on OBJECT",
      transform(document) {
        transformed = true;
        return document;
      }
    };
    expect(() =>
      run(`type A @copy(from: ["Nope"]) { a: Int }`, [spy, copyDirective()])
    ).toThrow("unknown type");
    expect(transformed).toBe(false);
  });

  test("returns the document unchanged with no directives", () => {
    const document = parse("type Query { a: Int }");
    expect(applyDirectives(document, [])).toBe(document);
  });
});
