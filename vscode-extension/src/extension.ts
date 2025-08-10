import * as vscode from "vscode";
import { spawn } from "child_process";
import * as path from "path";
import { resolveBinary } from "./binaryManager";

function getConfig() {
  const cfg = vscode.workspace.getConfiguration("aspensqlplusfmt");
  return {
    execPath: cfg.get<string>("path") || "",
    lineWidth: cfg.get<number>("lineWidth", 88),
    indent: cfg.get<number>("indent", 2),
    uppercaseKeywords: cfg.get<boolean>("uppercaseKeywords", true),
    autoBuild: cfg.get<boolean>("autoBuild", true),
    autoDownload: cfg.get<boolean>("autoDownload", true),
    version: cfg.get<string>("version", "0.1.0"),
    enableUnused: cfg.get<boolean>("enableUnusedVariableDiagnostics", true),
    enableDuplicates: cfg.get<boolean>(
      "enableDuplicateVariableDiagnostics",
      true
    ),
  };
}

async function getDiagnostics(document: vscode.TextDocument): Promise<string> {
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
    const args = ["--check"];

    const p = spawn(exec, args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d.toString()));
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("error", (e) => reject(e));
    p.on("close", (code) => {
      // Exit code 1 means diagnostics were found, which is normal
      if (code === 0 || code === 1) resolve(err || out);
      else
        reject(new Error(err || `aspensqlplus-fmt exited with code ${code}`));
    });
    p.stdin.write(document.getText());
    p.stdin.end();
  });
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

function parseDiagnostics(
  diagnosticsOutput: string,
  document: vscode.TextDocument
): vscode.Diagnostic[] {
  const diagnostics: vscode.Diagnostic[] = [];
  const lines = diagnosticsOutput.trim().split("\n");

  for (const line of lines) {
    if (!line.trim()) continue;

    // Parse format: "line:column:endColumn: severity: message [code]"
    const match = line.match(
      /^(\d+):(\d+):(\d+):\s*(error|warning|info):\s*(.*?)\s*\[([^\]]+)\]$/
    );
    if (match) {
      const [, lineStr, columnStr, endColumnStr, severityStr, message, code] =
        match;
      const lineNum = parseInt(lineStr) - 1; // Convert to 0-based
      const column = parseInt(columnStr) - 1; // Convert to 0-based
      const endColumn = parseInt(endColumnStr) - 1; // Convert to 0-based

      const severity =
        severityStr === "error"
          ? vscode.DiagnosticSeverity.Error
          : severityStr === "warning"
          ? vscode.DiagnosticSeverity.Warning
          : vscode.DiagnosticSeverity.Information;

      const range = new vscode.Range(
        new vscode.Position(lineNum, column),
        new vscode.Position(lineNum, endColumn)
      );

      const diagnostic = new vscode.Diagnostic(range, message, severity);
      diagnostic.code = code;
      diagnostic.source = "aspensqlplus-fmt";
      diagnostics.push(diagnostic);
    }
  }

  return diagnostics;
}

export function activate(context: vscode.ExtensionContext) {
  // Update function references to use the real context
  const getDiagnosticsWithContext = async (doc: vscode.TextDocument) => {
    const cfg = getConfig();
    const exec = await resolveBinary(context, {
      customPath: cfg.execPath,
      autoBuild: cfg.autoBuild,
      autoDownload: cfg.autoDownload,
      version: cfg.version,
    });
    return new Promise<string>((resolve, reject) => {
      const args = ["--check"];
      const p = spawn(exec, args, { stdio: ["pipe", "pipe", "pipe"] });
      let out = "";
      let err = "";
      p.stdout.on("data", (d) => (out += d.toString()));
      p.stderr.on("data", (d) => (err += d.toString()));
      p.on("error", (e) => reject(e));
      p.on("close", (code) => {
        // Exit code 1 means diagnostics were found, which is normal
        if (code === 0 || code === 1) resolve(err || out);
        else
          reject(new Error(err || `aspensqlplus-fmt exited with code ${code}`));
      });
      p.stdin.write(doc.getText());
      p.stdin.end();
    });
  };

  const formatDocumentWithContext = async (doc: vscode.TextDocument) => {
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
        const formatted = await formatDocumentWithContext(doc);
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

  // Diagnostics using Rust implementation
  const diagCollection = vscode.languages.createDiagnosticCollection(
    "aspensql-diagnostics"
  );
  context.subscriptions.push(diagCollection);

  async function refreshDiagnostics(doc: vscode.TextDocument) {
    const cfg = getConfig();
    if (
      doc.languageId !== "sql" ||
      (!cfg.enableUnused && !cfg.enableDuplicates)
    ) {
      diagCollection.delete(doc.uri);
      return;
    }

    try {
      const diagnosticsOutput = await getDiagnosticsWithContext(doc);
      const diagnostics = parseDiagnostics(diagnosticsOutput, doc);

      // Filter diagnostics based on configuration
      const filteredDiagnostics = diagnostics.filter((diag) => {
        if (diag.code === "duplicate-variable") {
          return cfg.enableDuplicates;
        }
        if (diag.code === "unused-variable") {
          return cfg.enableUnused;
        }
        return true;
      });

      diagCollection.set(doc.uri, filteredDiagnostics);
    } catch (error) {
      // If diagnostics fail, just clear any existing ones
      diagCollection.delete(doc.uri);
    }
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
