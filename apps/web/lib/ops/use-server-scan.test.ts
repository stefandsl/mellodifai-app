// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

function serverModules(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory())
      return ["node_modules", ".next", "coverage", "test-results"].includes(
        entry.name,
      )
        ? []
        : serverModules(file);
    if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) return [];
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
    );
    const first = source.statements[0];
    return first &&
      ts.isExpressionStatement(first) &&
      ts.isStringLiteral(first.expression) &&
      first.expression.text === "use server"
      ? [file]
      : [];
  });
}

function unwrap(node: ts.Node): ts.Node {
  if (ts.isAwaitExpression(node) || ts.isParenthesizedExpression(node))
    return unwrap(node.expression);
  return node;
}

function wrapperReturn(node: ts.Node): boolean {
  const expression = unwrap(node);
  return (
    ts.isCallExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    ["runAction", "remoteAction"].includes(expression.expression.text)
  );
}

function refusal(node: ts.Node): boolean {
  if (ts.isBlock(node))
    return node.statements.length === 1 && refusal(node.statements[0]);
  if (!ts.isReturnStatement(node)) return false;
  if (!node.expression) return true;
  const expression = unwrap(node.expression);
  if (!ts.isObjectLiteralExpression(expression)) return false;
  // Only a literal failed result is accepted, never a call or spread with side effects.
  return (
    expression.properties.every(
      (property) =>
        ts.isPropertyAssignment(property) &&
        (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
        (ts.isStringLiteral(property.initializer) ||
          property.initializer.kind === ts.SyntaxKind.FalseKeyword),
    ) &&
    expression.properties.some(
      (property) =>
        ts.isPropertyAssignment(property) &&
        (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
        property.name.text === "ok" &&
        property.initializer.kind === ts.SyntaxKind.FalseKeyword,
    )
  );
}

function effectiveGuard(node: ts.Node): boolean {
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node))
    return effectiveGuard(node.body);
  if (!ts.isBlock(node)) return wrapperReturn(node);
  const first = node.statements[0];
  if (!first) return false;
  if (
    node.statements.length === 1 &&
    ts.isReturnStatement(first) &&
    first.expression
  )
    return wrapperReturn(first.expression);
  if (!ts.isIfStatement(first)) return false;
  const condition = unwrap(first.expression);
  return (
    ts.isCallExpression(condition) &&
    ts.isIdentifier(condition.expression) &&
    condition.expression.text === "isRemote" &&
    refusal(first.thenStatement)
  );
}

function unguardedExports(source: ts.SourceFile): string[] {
  const declarations = new Map<string, ts.Node>();
  const exports = new Map<string, ts.Node>();
  for (const node of source.statements) {
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : [];
    const exported = modifiers?.some(
      (item) => item.kind === ts.SyntaxKind.ExportKeyword,
    );
    const defaultExport = modifiers?.some(
      (item) => item.kind === ts.SyntaxKind.DefaultKeyword,
    );
    if (ts.isFunctionDeclaration(node) && node.body) {
      if (node.name) declarations.set(node.name.text, node.body);
      if (exported)
        exports.set(
          defaultExport ? "default" : (node.name?.text ?? "default"),
          node.body,
        );
    } else if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer) {
          declarations.set(declaration.name.text, declaration.initializer);
          if (exported)
            exports.set(declaration.name.text, declaration.initializer);
        }
      }
    } else if (ts.isExportAssignment(node)) {
      exports.set("default", node.expression);
    } else if (ts.isExportDeclaration(node) && !node.isTypeOnly) {
      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const element of node.exportClause.elements) {
          if (!element.isTypeOnly)
            exports.set(
              element.name.text,
              node.moduleSpecifier
                ? node
                : (element.propertyName ?? element.name),
            );
        }
      } else {
        // Re-exports must be explicit so every server action can be checked locally.
        exports.set("*", node);
      }
    }
  }
  const unguarded: string[] = [];
  for (const [name, exported] of exports) {
    let node: ts.Node | undefined = exported;
    const seen = new Set<string>();
    while (node && ts.isIdentifier(node) && !seen.has(node.text)) {
      seen.add(node.text);
      node = declarations.get(node.text);
    }
    if (!node || !effectiveGuard(node)) unguarded.push(name);
  }
  return unguarded;
}

it.each([
  [
    "named",
    "async function action() {} export { action as renamed };",
    "renamed",
  ],
  ["default function", "export default async function () {}", "default"],
  ["default expression", "export default async () => {};", "default"],
  [
    "default reference",
    "const action = async () => {}; export default action;",
    "default",
  ],
])("detects unguarded %s exports", (_kind, text, name) => {
  const source = ts.createSourceFile(
    "action.ts",
    text,
    ts.ScriptTarget.Latest,
    true,
  );
  expect(unguardedExports(source)).toEqual([name]);
});

it.each([
  "async function action() { return runAction(def, input); } export { action as renamed };",
  "export default async function () { return remoteAction(def, input); }",
  "const action = async () => runAction(def, input); export default action;",
  "export default async () => { if (isRemote(headers)) return; };",
])("accepts guarded export forms: %s", (text) => {
  expect(
    unguardedExports(
      ts.createSourceFile("action.ts", text, ts.ScriptTarget.Latest, true),
    ),
  ).toEqual([]);
});

it.fails("every use server export uses an action wrapper or checks remote access", () => {
  const root = path.resolve(import.meta.dirname, "../..");
  const unguarded: string[] = [];
  for (const file of serverModules(root)) {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    unguarded.push(
      ...unguardedExports(source).map(
        (name) => `${path.relative(root, file)}:${name}`,
      ),
    );
  }
  expect(unguarded).toEqual([]);
});

it.each([
  "isRemote(headers); return spend();",
  "const unused = () => runAction(def, input); return spend();",
  "function unused() { if (isRemote(headers)) return; } return spend();",
  "if (flag) return runAction(def, input); return spend();",
  "await spend(); if (isRemote(headers)) return;",
  "if (isRemote(headers)) { spend(); return; } return spend();",
  "if (isRemote(headers)) return spend();",
])("rejects ineffective guards: %s", (body) => {
  expect(
    unguardedExports(
      ts.createSourceFile(
        "action.ts",
        `export async function action() { ${body} }`,
        ts.ScriptTarget.Latest,
        true,
      ),
    ),
  ).toEqual(["action"]);
});
