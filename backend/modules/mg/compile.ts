import ts from "typescript";
import { MAX_MG_COMPILED } from "../../../shared/contract";

// Names the agent's code may not mention: network, storage, timers, globals and code-from-string.
// `constructor`/`__proto__` close the `[].map.constructor("…")` route back to Function. A denylist is a guard rail,
// not a sandbox: the code runs only in Chrome (render, frames, Player), never on the server.
export const DENY: ReadonlySet<string> = new Set([
  "window", "document", "globalThis", "self", "fetch", "XMLHttpRequest", "WebSocket", "eval", "Function", "require", "process",
  "localStorage", "sessionStorage", "indexedDB", "navigator", "setTimeout", "setInterval", "setImmediate", "queueMicrotask",
  "Worker", "importScripts", "postMessage", "location", "constructor", "__proto__",
]);

type CompileResult = { compiled: string } | { error: "bad_code"; detail: string };

// Plain JS + JSX in, React.createElement JS out — vetted, never executed here.
export function compileMotionGraphic(code: string): CompileResult {
  const bad = (detail: string): CompileResult => ({ error: "bad_code", detail });
  const out = ts.transpileModule(code, {
    fileName: "mg.jsx", reportDiagnostics: true,
    compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None, allowJs: true },
  });
  const diag = out.diagnostics?.[0];
  if (diag) return bad(ts.flattenDiagnosticMessageText(diag.messageText, "\n"));

  const file = ts.createSourceFile("mg.jsx", code, ts.ScriptTarget.ES2020, true, ts.ScriptKind.JSX);
  let forbidden: string | null = null;
  const visit = (node: ts.Node): void => {
    if (forbidden) return;
    if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node)) forbidden = "import";
    else if (ts.isExportAssignment(node) || ts.isExportDeclaration(node) || ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Export) forbidden = "export";
    else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) forbidden = "import()";
    else if (node.kind === ts.SyntaxKind.WithStatement) forbidden = "with";
    else if (ts.isIdentifier(node) && DENY.has(node.text)) forbidden = node.text;
    else if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) && DENY.has(node.argumentExpression.text)) forbidden = node.argumentExpression.text;
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
