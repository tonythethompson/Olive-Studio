/**
 * Auto-sync script: queries the installed olive-ai CLI for available passes
 * and writes the result to olive-mcp-server/olive_mcp_server/knowledge_base/passes.json.
 *
 * Usage:
 *   node scripts/sync-pass-catalog.mjs
 *
 * Requirements:
 *   - Project .venv must exist with olive-ai installed.
 *   - Run from the project root.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const VENV_PYTHON =
  process.platform === "win32"
    ? path.join(ROOT, ".venv", "Scripts", "python.exe")
    : path.join(ROOT, ".venv", "bin", "python");

const OUT_FILE = path.join(ROOT, "olive-mcp-server", "olive_mcp_server", "knowledge_base", "passes.json");

// ─── Olive CLI pass extraction ────────────────────────────────────────────────

async function runPython(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(VENV_PYTHON, args, {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => {
      if (code !== 0) reject(new Error(stderr.trim() || `exit ${code}`));
      else resolve(stdout.trim());
    });
    proc.on("error", reject);
  });
}

async function extractPassesFromOlive() {
  try {
    const raw = await runPython([
      "-c",
      `
import json, sys
try:
    from olive.passes import PassRegistry
    registry = PassRegistry()
    passes = {}
    for name in sorted(registry.get_all_passes()):
        try:
            config_cls = registry.get_pass_config_class(name)
            params = {}
            if config_cls:
                schema = config_cls.schema()
                params = schema.get("properties", {})
            passes[name] = {
                "description": getattr(registry.get_pass_class(name), "__doc__", "").strip() or "",
                "category": getattr(registry.get_pass_class(name), "category", "unknown") if hasattr(registry.get_pass_class(name), "category") else "unknown",
                "parameters": params,
            }
        except Exception as e:
            passes[name] = {"description": "", "category": "unknown", "parameters": {}, "_error": str(e)}
    print(json.dumps(passes, indent=2))
except ImportError:
    print("FALLBACK: olive.passes not importable")
except Exception as e:
    print(f"ERROR: {e}", file=sys.stderr)
    sys.exit(1)
      `,
    ]);
    if (raw.startsWith("FALLBACK:")) {
      console.warn("⚠ Could not extract passes from live olive-ai. Using existing passes.json.");
      return null;
    }
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`⚠ Olive CLI pass extraction failed: ${err.message}`);
    return null;
  }
}

// ─── Merge with existing ──────────────────────────────────────────────────────

function loadExisting() {
  try {
    if (!fs.existsSync(OUT_FILE)) return {};
    return JSON.parse(fs.readFileSync(OUT_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function mergePasses(existing, extracted) {
  // Start with extracted (authoritative). Only overlay *manual* annotations from
  // existing entries; never re-introduce catalog metadata keys (_generated, etc.).
  const merged = { ...extracted };
  for (const [name, data] of Object.entries(existing)) {
    if (name.startsWith("_")) continue; // skip metadata keys
    if (!data || typeof data !== "object") continue;
    if (!merged[name]) {
      // Preserve manually added passes only
      if (data._manual) merged[name] = data;
      continue;
    }
    const existingPass = data;
    const mergedPass = merged[name];
    if (existingPass._manual !== undefined) mergedPass._manual = existingPass._manual;
    if (existingPass.notes !== undefined) mergedPass.notes = existingPass.notes;
  }
  return merged;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!fs.existsSync(VENV_PYTHON)) {
    console.error("❌ Project .venv not found. Run 'Execute Live' first to create it.");
    process.exit(1);
  }

  console.log("🔍 Extracting passes from olive-ai CLI...");
  const extracted = await extractPassesFromOlive();

  if (!extracted) {
    console.error("❌ Could not extract passes from olive-ai. Refusing to overwrite passes.json.");
    process.exit(1);
  }

  const existing = loadExisting();
  const merged = mergePasses(existing, extracted);

  const metadata = {
    _generated: new Date().toISOString(),
    _source: "olive-ai CLI pass registry",
    _passCount: Object.keys(merged).length,
  };

  const output = { ...metadata, ...merged };

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2), "utf-8");

  console.log(`✅ Synced ${Object.keys(extracted).length} passes to ${path.relative(ROOT, OUT_FILE)}`);
  console.log(`   Total passes in catalog: ${Object.keys(merged).length}`);
}

main().catch((err) => {
  console.error("❌ Sync failed:", err.message);
  process.exit(1);
});
