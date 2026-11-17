// Guard for scripts/check-guards.sh: every name a dashboard module imports from another dashboard module must exist in
// that module as released, when it was released at all. Browsers can keep a cached copy of a released module next to
// newer ones after an upgrade (one fetched before the add-on sent Cache-Control: no-cache counts as fresh), and a
// missing export leaves the Umbrella tab blank. Prints one line per problem; prints nothing when all is well.
//
// Usage: node scripts/check-dashboard-imports.mjs <repo root> <released git ref>
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DASHBOARD = "src/Umbraco.Mcp/wwwroot/App_Plugins/Umbrella";
const [root, ref] = process.argv.slice(2);
const dir = join(root, DASHBOARD);
if (!existsSync(dir)) process.exit(0);

const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
try {
  git("rev-parse", "--verify", "--quiet", `${ref}^{commit}`);
} catch {
  console.log(`the released ref ${ref} is not available; fetch it (git fetch origin ${ref.replace(/^origin\//, "")}) or set GUARD_RELEASED_REF`);
  process.exit(0);
}

/** The names a module exports: declarations, `export { a, b as c }` and `default`. */
function exportsOf(source) {
  const names = new Set();
  for (const m of source.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z0-9_$]+)/g)) names.add(m[1]);
  for (const m of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop();
      if (name) names.add(name);
    }
  }
  if (/export\s+default\b/.test(source)) names.add("default");
  return names;
}

/** The names each import statement takes from a sibling module: `{ a, b as c }` and a default import. */
function importsOf(source) {
  const found = [];
  for (const m of source.matchAll(/import\s+([^"';]*?)\s+from\s*["']\.\/([^"']+)["']/g)) {
    const clause = m[1];
    const names = [];
    const braces = clause.match(/\{([^}]*)\}/);
    if (braces) names.push(...braces[1].split(",").map((p) => p.trim().split(/\s+as\s+/)[0]).filter(Boolean));
    const head = clause.replace(/\{[^}]*\}/, "").replace(/,/g, " ").trim();
    if (head && !head.startsWith("*")) names.push("default");
    found.push({ module: m[2], names });
  }
  return found;
}

const released = new Map();
function releasedExports(module) {
  if (!released.has(module)) {
    let source = null;
    try {
      source = git("show", `${ref}:${DASHBOARD}/${module}`);
    } catch {
      // Not released yet: no browser can have an old copy of it.
    }
    released.set(module, source === null ? null : exportsOf(source));
  }
  return released.get(module);
}

for (const file of readdirSync(dir).filter((f) => f.endsWith(".js")).sort()) {
  for (const { module, names } of importsOf(readFileSync(join(dir, file), "utf8"))) {
    const have = releasedExports(module);
    if (!have) continue;
    for (const name of names) {
      if (!have.has(name)) console.log(`${file} imports ${name} from ${module}, which the released ${module} (${ref}) doesn't export`);
    }
  }
}
