import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { spawn } from "child_process";
import * as https from "https";
import AdmZip from "adm-zip";

export interface BinaryOptions {
  customPath: string;
  autoBuild: boolean;
  autoDownload: boolean;
  version: string;
}

const REPO_RELEASE_BASE =
  "https://github.com/GermanHeim/aspensqlplus-fmt/releases/download";

function platformTriple(): string {
  const arch = process.arch;
  const plat = process.platform;
  if (plat === "win32") return `win32-${arch}`;
  if (plat === "darwin") return `darwin-${arch}`;
  return `${plat}-${arch}`; // linux-x64, etc.
}

export async function resolveBinary(
  context: vscode.ExtensionContext,
  opts: BinaryOptions
): Promise<string> {
  if (opts.customPath?.trim()) return opts.customPath.trim();

  const exeName =
    process.platform === "win32" ? "aspensqlplus-fmt.exe" : "aspensqlplus-fmt";

  // 1. Bundled
  const bundled = context.asAbsolutePath(
    path.join("bin", platformTriple(), exeName)
  );
  if (fs.existsSync(bundled)) return bundled;

  // 2. Cached downloaded
  const storageDir = context.globalStorageUri.fsPath;
  const cacheDir = path.join(storageDir, "bin", platformTriple());
  const cached = path.join(cacheDir, exeName);
  if (fs.existsSync(cached)) return cached;
  fs.mkdirSync(cacheDir, { recursive: true });

  // 3. Download
  if (opts.autoDownload) {
    try {
      const zipName = `aspensqlplus-fmt-${
        opts.version
      }-${platformTriple()}.zip`;
      const url = `${REPO_RELEASE_BASE}/v${opts.version}/${zipName}`;
      await downloadAndExtract(url, cacheDir, exeName);
      if (fs.existsSync(cached)) return cached;
    } catch (e: any) {
      vscode.window.showWarningMessage(
        `AspenSQLplus-fmt: download failed (${e.message || e}), falling back.`
      );
    }
  }

  // 4. Auto-build
  if (opts.autoBuild) {
    const ws = vscode.workspace.workspaceFolders?.[0];
    if (ws) {
      const root = ws.uri.fsPath;
      const cargoToml = path.join(root, "formatter", "Cargo.toml");
      if (fs.existsSync(cargoToml)) {
        try {
          await runCargoBuild(path.join(root, "formatter"));
          const releasePath = path.join(
            root,
            "formatter",
            "target",
            "release",
            exeName
          );
          if (fs.existsSync(releasePath)) return releasePath;
          const debugPath = path.join(
            root,
            "formatter",
            "target",
            "debug",
            exeName
          );
          if (fs.existsSync(debugPath)) return debugPath;
        } catch (e: any) {
          vscode.window.showWarningMessage(
            `AspenSQLplus auto-build failed: ${e.message || e}`
          );
        }
      }
    }
  }

  // 5. PATH fallback
  return exeName;
}

function runCargoBuild(dir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const cargo = process.platform === "win32" ? "cargo.exe" : "cargo";
    const proc = spawn(cargo, ["build", "--release"], { cwd: dir });
    let stderr = "";
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      code === 0
        ? resolve()
        : reject(new Error(stderr || `cargo build exited with code ${code}`));
    });
  });
}

async function downloadAndExtract(
  url: string,
  outDir: string,
  exeName: string
): Promise<void> {
  const zipPath = path.join(outDir, "download.zip");
  await downloadFile(url, zipPath);
  const zip = new AdmZip(zipPath);
  zip.extractAllTo(outDir, true);
  try {
    fs.unlinkSync(zipPath);
  } catch {
    /* ignore */
  }
  if (process.platform !== "win32") {
    try {
      fs.chmodSync(path.join(outDir, exeName), 0o755);
    } catch {
      /* ignore */
    }
  }
}

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https
      .get(url, (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        res.pipe(file);
        file.on("finish", () => file.close(() => resolve()));
      })
      .on("error", (err) => reject(err));
  });
}
