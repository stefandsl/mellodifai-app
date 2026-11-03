import ts from "typescript";

const keys = new Set([
  "KIE_API_KEY",
  "OPENROUTER_API_KEY",
  "LYRICS_OPENROUTER_KEY",
  "GROQ_API_KEY",
  "HIGGSFIELD_API_KEY",
]);
const rawProviderExports = new Set([
  "OPENROUTER_BASE",
  "OPENROUTER_CHAT_URL",
  "OPENROUTER_DECISIONS_URL",
  "openRouterKey",
  "openRouterKeyFromEnv",
]);

export function hasPaidAccess(source: string): boolean {
  const file = ts.createSourceFile(
    "scan.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  let found = false;
  const remakeClients = new Set<string>();
  for (const statement of file.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== "@mellodifai/remake"
    )
      continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings))
      for (const item of bindings.elements) {
        if ((item.propertyName ?? item.name).text === "createClient")
          remakeClients.add(item.name.text);
      }
  }
  function visit(node: ts.Node) {
    if (
      ts.isStringLiteralLike(node) &&
      /(?:api\.kie\.ai|kieai\.redpandaai\.co|openrouter\.ai|api\.groq\.com)/u.test(
        node.text,
      )
    )
      found = true;
    if (
      ts.isPropertyAccessExpression(node) &&
      (keys.has(node.name.text) || rawProviderExports.has(node.name.text))
    )
      found = true;
    if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      keys.has(node.argumentExpression.text)
    )
      found = true;
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ["get", "require"].includes(node.expression.name.text) &&
      node.arguments.some(
        (arg) => ts.isStringLiteralLike(arg) && keys.has(arg.text),
      )
    )
      found = true;
    if (
      ts.isImportSpecifier(node) &&
      rawProviderExports.has((node.propertyName ?? node.name).text)
    )
      found = true;
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      remakeClients.has(node.expression.text)
    ) {
      const options = node.arguments[0];
      if (
        !options ||
        !ts.isObjectLiteralExpression(options) ||
        !options.properties.some(
          (p) => p.name && ts.isIdentifier(p.name) && p.name.text === "fetchFn",
        )
      )
        found = true;
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return found;
}
