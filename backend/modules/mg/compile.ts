import ts from "typescript";
import { MAX_MG_COMPILED } from "../../../shared/contract";

// Names the agent's code may not mention: network, storage, timers, globals and code-from-string.
// `constructor`/`__proto__` close the `[].map.constructor("…")` route back to Function. This is the agent's early warning
// (a clear 400 before anything runs), not the boundary: MG code runs only inside its own sandboxed iframe
// (spec row 24: opaque origin, no network), never in a Sabi page and never on the server.
export const DENY: ReadonlySet<string> = new Set([
  "window", "document", "globalThis", "self", "fetch", "XMLHttpRequest", "WebSocket", "eval", "Function", "require", "process",
  "localStorage", "sessionStorage", "indexedDB", "navigator", "setTimeout", "setInterval", "setImmediate", "queueMicrotask",
  "Worker", "importScripts", "postMessage", "location", "constructor", "__proto__",
  // window aliases, requests by other means, reflection, and HTML-from-string
  "top", "parent", "frames", "opener", "open", "Image", "Audio", "EventSource", "BroadcastChannel", "SharedWorker", "Reflect", "Proxy",
  "dangerouslySetInnerHTML", "innerHTML", "outerHTML", "insertAdjacentHTML", "srcDoc", "srcdoc",
]);
// As string literals only the property names matter (`[].map["constructor"]`, `{ "innerHTML": … }`); "top" is also a CSS value.
// Dangerous wherever they appear: code from strings, HTML from strings, and the DOM's ways back to `window` (refs, events).
const DENY_KEYS = new Set([
  "constructor", "__proto__", "dangerouslySetInnerHTML", "innerHTML", "outerHTML", "insertAdjacentHTML", "srcDoc", "srcdoc",
  "ownerDocument", "defaultView", "getRootNode", "contentWindow", "contentDocument",
]);
// Global names that are also everyday property names (`style.top`, `props.open`); every other denied name stays denied as a property too.
const SAFE_PROPERTY_NAMES = new Set(["top", "parent", "open", "self", "frames", "location"]);
const DENY_TAGS = new Set(["script", "iframe", "object", "embed", "frame", "frameset", "link", "meta", "base", "form"]);

// `x[k]` is fine; a property name built from strings (`x["con" + "structor"]`) is how a denylist gets walked around.
const stringy = (e: ts.Expression): boolean => ts.isStringLiteralLike(e) || ts.isTemplateExpression(e)
  || (ts.isParenthesizedExpression(e) && stringy(e.expression))
  || (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken && (stringy(e.left) || stringy(e.right)));

type CompileResult = { compiled: string } | { error: "bad_code"; detail: string };

// A property or attribute name (`x.open`, `{ top: 0 }`, `<a href>`, `const { parent } = …`) is not a reference to the global of that name.
const isPropertyName = (id: ts.Identifier) => {
  const p = id.parent;
  return ((ts.isPropertyAccessExpression(p) || ts.isPropertyAssignment(p) || ts.isJsxAttribute(p) || ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p)) && p.name === id)
    || (ts.isBindingElement(p) && (p.propertyName === id || (!p.propertyName && p.name === id))); // `{ parent }` reads the key `parent`
};
const deniedIdentifier = (id: ts.Identifier, isLocal: (id: ts.Identifier) => boolean) =>
  DENY_KEYS.has(id.text) || (DENY.has(id.text) && (isPropertyName(id) ? !SAFE_PROPERTY_NAMES.has(id.text) : !isLocal(id)));

// Binds the file on its own (no lib): a name declared in the code resolves to that declaration; a global resolves to nothing.
function parseWithScopes(code: string) {
  const fileName = "mg.jsx";
  const options: ts.CompilerOptions = { allowJs: true, noLib: true, noResolve: true, types: [], target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.Preserve };
  const file = ts.createSourceFile(fileName, code, ts.ScriptTarget.ES2020, true, ts.ScriptKind.JSX);
  const host = ts.createCompilerHost(options);
  host.getSourceFile = (name) => (name === fileName ? file : undefined);
  host.fileExists = (name) => name === fileName;
  const checker = ts.createProgram([fileName], options, host).getTypeChecker();
  const isLocal = (id: ts.Identifier) => {
    const sym = ts.isShorthandPropertyAssignment(id.parent) ? checker.getShorthandAssignmentValueSymbol(id.parent) : checker.getSymbolAtLocation(id);
    return !!sym?.declarations?.some((d) => d.getSourceFile() === file);
  };
  return { file, isLocal };
}

// Plain JS + JSX in, React.createElement JS out — vetted, never executed here.
export function compileMotionGraphic(code: string): CompileResult {
  const bad = (detail: string): CompileResult => ({ error: "bad_code", detail });
  const out = ts.transpileModule(code, {
    fileName: "mg.jsx", reportDiagnostics: true,
    compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None, allowJs: true },
  });
  const diag = out.diagnostics?.[0];
  if (diag) return bad(ts.flattenDiagnosticMessageText(diag.messageText, "\n"));

  const { file, isLocal } = parseWithScopes(code);
  let forbidden: string | null = null;
  const visit = (node: ts.Node): void => {
    if (forbidden) return;
    if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node)) forbidden = "import";
    else if (ts.isExportAssignment(node) || ts.isExportDeclaration(node) || ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Export) forbidden = "export";
    else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) forbidden = "import()";
    else if (node.kind === ts.SyntaxKind.WithStatement) forbidden = "with";
    else if (ts.isIdentifier(node) && deniedIdentifier(node, isLocal)) forbidden = node.text;
    else if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) && DENY.has(node.argumentExpression.text)) forbidden = node.argumentExpression.text;
    else if (ts.isStringLiteralLike(node) && DENY_KEYS.has(node.text)) forbidden = node.text; // { "innerHTML": … }, const k = "constructor"
    else if ((ts.isElementAccessExpression(node) && !ts.isStringLiteralLike(node.argumentExpression) && stringy(node.argumentExpression))
      || (ts.isComputedPropertyName(node) && stringy(node.expression))) forbidden = "computed property name";
    else if (ts.isJsxSpreadAttribute(node)) forbidden = "{...spread} attribute";
    else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "createElement"
      && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0]) && DENY_TAGS.has(node.arguments[0].text.toLowerCase())) forbidden = `<${node.arguments[0].text}>`;
    else if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && DENY_TAGS.has(node.tagName.getText(file).toLowerCase())) forbidden = `<${node.tagName.getText(file)}>`;
    else if (ts.isJsxAttribute(node) && DENY_KEYS.has(node.name.getText(file))) forbidden = node.name.getText(file);
    else if (ts.isStringLiteralLike(node) && /^\s*javascript:/i.test(node.text)) forbidden = "javascript: URL";
    else ts.forEachChild(node, visit);
  };
  visit(file);
  if (forbidden) return bad(`forbidden: ${forbidden}`);

  const declaresComponent = file.statements.some((s) => ts.isVariableStatement(s)
    && s.declarationList.declarations.some((d) => ts.isIdentifier(d.name) && d.name.text === "Component"));
  if (!declaresComponent) return bad("missing Component");
  if (out.outputText.length > MAX_MG_COMPILED) return bad(`compiled code over ${MAX_MG_COMPILED} chars`);
  return { compiled: out.outputText };
}
