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

function callsGuard(node: ts.Node): boolean {
  if (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    ["runAction", "remoteAction", "isRemote"].includes(node.expression.text)
  )
    return true;
  return ts.forEachChild(node, callsGuard) ?? false;
}

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
    for (const node of source.statements) {
      if (
        !ts.canHaveModifiers(node) ||
        !ts
          .getModifiers(node)
          ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
      )
        continue;
      if (ts.isFunctionDeclaration(node) && node.name && node.body) {
        if (!callsGuard(node.body))
          unguarded.push(`${path.relative(root, file)}:${node.name.text}`);
      } else if (ts.isVariableStatement(node)) {
        for (const declaration of node.declarationList.declarations) {
          if (
            ts.isIdentifier(declaration.name) &&
            declaration.initializer &&
            (ts.isArrowFunction(declaration.initializer) ||
              ts.isFunctionExpression(declaration.initializer)) &&
            !callsGuard(declaration.initializer.body)
          )
            unguarded.push(
              `${path.relative(root, file)}:${declaration.name.text}`,
            );
        }
      }
    }
  }
  expect(unguarded).toEqual([]);
});
