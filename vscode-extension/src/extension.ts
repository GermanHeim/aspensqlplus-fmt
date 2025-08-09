import * as vscode from "vscode";
import { spawn } from "child_process";
import * as path from "path";
import { resolveBinary } from "./binaryManager";

function getConfig() {
  const cfg = vscode.workspace.getConfiguration("aspensqlFmt");
  return {
    execPath: cfg.get<string>("path") || "",
    lineWidth: cfg.get<number>("lineWidth", 88),
    indent: cfg.get<number>("indent", 2),
    uppercaseKeywords: cfg.get<boolean>("uppercaseKeywords", true),
    autoBuild: cfg.get<boolean>("autoBuild", true),
    autoDownload: cfg.get<boolean>("autoDownload", true),
    version: cfg.get<string>("version", "0.1.0"),
    enableUnused: cfg.get<boolean>("enableUnusedVariableDiagnostics", true),
  };
}

async function formatDocument(document: vscode.TextDocument): Promise<string> {
  const cfg = getConfig();
  const exec = await resolveBinary(
    { globalStorageUri: { fsPath: path.join(__dirname, "..", "..") } } as any, // placeholder
    {
      customPath: cfg.execPath,
      autoBuild: cfg.autoBuild,
      autoDownload: cfg.autoDownload,
      version: cfg.version,
    }
  );
  return new Promise((resolve, reject) => {
    const args = [
      `--line-width`,
      String(cfg.lineWidth),
      `--indent`,
      String(cfg.indent),
      `--uppercase-keywords`,
      String(cfg.uppercaseKeywords),
    ];

    const p = spawn(exec, args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d.toString()));
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("error", (e) => reject(e));
    p.on("close", (code) => {
      if (code === 0) resolve(out);
      else
        reject(new Error(err || `aspensqlplus-fmt exited with code ${code}`));
    });
    p.stdin.write(document.getText());
    p.stdin.end();
  });
}

export function activate(context: vscode.ExtensionContext) {
  // Monkey patch formatDocument to receive real context for resolveBinary
  (formatDocument as any) = async (doc: vscode.TextDocument) => {
    const cfg = getConfig();
    const exec = await resolveBinary(context, {
      customPath: cfg.execPath,
      autoBuild: cfg.autoBuild,
      autoDownload: cfg.autoDownload,
      version: cfg.version,
    });
    return new Promise<string>((resolve, reject) => {
      const args = [
        `--line-width`,
        String(cfg.lineWidth),
        `--indent`,
        String(cfg.indent),
        `--uppercase-keywords`,
        String(cfg.uppercaseKeywords),
      ];
      const p = spawn(exec, args, { stdio: ["pipe", "pipe", "pipe"] });
      let out = "";
      let err = "";
      p.stdout.on("data", (d) => (out += d.toString()));
      p.stderr.on("data", (d) => (err += d.toString()));
      p.on("error", (e) => reject(e));
      p.on("close", (code) => {
        code === 0
          ? resolve(out)
          : reject(new Error(err || `aspensql-fmt exited with code ${code}`));
      });
      p.stdin.write(doc.getText());
      p.stdin.end();
    });
  };
  const selector: vscode.DocumentSelector = [
    { language: "sql", scheme: "file" },
    { language: "sql", scheme: "untitled" },
  ];

  const provider: vscode.DocumentFormattingEditProvider = {
    provideDocumentFormattingEdits: async (doc) => {
      try {
        const formatted = await formatDocument(doc);
        const fullRange = new vscode.Range(
          doc.positionAt(0),
          doc.positionAt(doc.getText().length)
        );
        return [vscode.TextEdit.replace(fullRange, formatted)];
      } catch (err: any) {
        vscode.window.showErrorMessage(
          `Aspen SQLplus formatter error: ${err?.message || err}`
        );
        return [];
      }
    },
  };

  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider(selector, provider)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("aspensql.formatDocument", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const edits = await provider.provideDocumentFormattingEdits!(
        editor.document,
        {} as any,
        {} as any
      );
      if (edits && edits.length > 0) {
        editor.edit((builder) =>
          edits.forEach((e) => builder.replace(e.range, e.newText))
        );
      }
    })
  );

  // Diagnostics: unused variables (simple heuristic)
  const diagCollection =
    vscode.languages.createDiagnosticCollection("aspensql-unused");
  context.subscriptions.push(diagCollection);

  function refreshDiagnostics(doc: vscode.TextDocument) {
    const cfg = getConfig();
    if (doc.languageId !== "sql" || !cfg.enableUnused) {
      diagCollection.delete(doc.uri);
      return;
    }
    const text = doc.getText();
    // Capture variable declarations: DECLARE var_name / SET var_name / LOCAL var_name
    const declRegex = /\b(DECLARE|SET|LOCAL)\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi;
    const usages = new Map<string, number>();
    const declarations: { name: string; index: number }[] = [];
    let m: RegExpExecArray | null;
    while ((m = declRegex.exec(text)) !== null) {
      const name = m[2];
      declarations.push({ name, index: m.index });
      usages.set(name.toLowerCase(), 0);
    }
    if (declarations.length === 0) {
      diagCollection.set(doc.uri, []);
      return;
    }
    // Count usages (excluding the declaration positions) - simplistic word boundary match
    for (const [lower] of usages) {
      const usageRegex = new RegExp(`\\b${lower}\\b`, "gi");
      let u: RegExpExecArray | null;
      while ((u = usageRegex.exec(text)) !== null) {
        // Skip if this position is part of a declaration word we already logged
        // We allow one occurrence (the declaration) without counting
        usages.set(lower, (usages.get(lower) || 0) + 1);
      }
      // Subtract one for its own declaration if found at least once
      const adjusted = (usages.get(lower) || 0) - 1;
      usages.set(lower, adjusted < 0 ? 0 : adjusted);
    }
    const diags: vscode.Diagnostic[] = [];
    for (const decl of declarations) {
      const count = usages.get(decl.name.toLowerCase()) || 0;
      if (count === 0) {
        const start = doc.positionAt(decl.index);
        const end = doc.positionAt(decl.index + decl.name.length + 1); // rough span
        diags.push(
          new vscode.Diagnostic(
            new vscode.Range(start, end),
            `Unused variable '${decl.name}'`,
            vscode.DiagnosticSeverity.Warning
          )
        );
      }
    }
    diagCollection.set(doc.uri, diags);
  }

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(refreshDiagnostics)
  );
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) =>
      refreshDiagnostics(e.document)
    )
  );
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((doc) =>
      diagCollection.delete(doc.uri)
    )
  );

  // Initialize for already-open documents
  vscode.workspace.textDocuments.forEach(refreshDiagnostics);
}

export function deactivate() {}
