#!/usr/bin/env node

/**
 * Copies the user docs into a checkout of the public tracker, MarcusK00/Umbrella-Issues, where the NuGet readme and
 * PackageProjectUrl point. This repository is private, so README.md is not readable here by users.
 *
 * Writes README.md (this README without "Develop", plus "Report a problem"), LICENSE and the logo. It does not
 * commit or push: review the diff in the tracker checkout and push it by hand (docs/releasing.md).
 *
 * Usage:
 *   node scripts/sync-tracker-docs.mjs <path to an Umbrella-Issues checkout>
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = process.argv[2];
if (!target || !existsSync(join(target, ".git"))) {
  console.error("Usage: node scripts/sync-tracker-docs.mjs <path to an Umbrella-Issues checkout>");
  process.exit(1);
}

const tracker = "https://github.com/MarcusK00/Umbrella-Issues";

const intro = `> This is Umbrella's public home: the documentation below and the [issue tracker](${tracker}/issues). The source code is not public. To report a bug or ask a question, see [Report a problem](#report-a-problem).

`;

const reportAProblem = `## Report a problem

1. Run \`get-mcp-health\` in your AI tool, and look at Settings → **Umbrella** → **Overview** and the **MCP** health checks in the backoffice. [Troubleshooting](#troubleshooting) covers the common cases.
2. Search the [open and closed issues](${tracker}/issues?q=is%3Aissue).
3. [Open an issue](${tracker}/issues/new/choose) and pick a form: bug report, feature request or question. For a bug, include the add-on and \`umbrella-mcp\` versions and the \`get-mcp-health\` output.

Issues are public. Before you post, remove client secrets, API keys, site URLs you don't want public, and personal data (names, emails, member or form entry data).

**Security vulnerabilities:** don't open an issue. Report them privately, see [SECURITY.md](SECURITY.md).

Umbrella is a community project, not an official Umbraco HQ package. Problems with Umbraco CMS, Forms, Automate or Engage themselves belong in those products' channels; if you're not sure which it is, open an issue here.

`;

// Each edit must match exactly once, so a restructured README fails here instead of producing a broken copy.
const edits = [
  ["## Contents\n", intro + "## Contents\n"],
  ["- [Develop](#develop)\n", "- [Report a problem](#report-a-problem)\n"],
  [" Details for contributors: [docs/architecture.md](docs/architecture.md).", ""],
  [/## Develop\n[\s\S]*?(?=## License\n)/, reportAProblem],
];

let readme = readFileSync(join(root, "README.md"), "utf8");
for (const [from, to] of edits) {
  const count = typeof from === "string" ? readme.split(from).length - 1 : (readme.match(new RegExp(from, "g")) ?? []).length;
  if (count !== 1) {
    console.error(`README.md: expected one match for ${from}, found ${count}. Update scripts/sync-tracker-docs.mjs.`);
    process.exit(1);
  }
  readme = readme.replace(from, to);
}

const relativeLinks = [...readme.matchAll(/\]\((?!https?:|#|SECURITY\.md|LICENSE\)|docs\/images\/)([^)]+)\)/g)].map((m) => m[1]);
if (relativeLinks.length > 0) {
  console.error(`README.md links to files the tracker doesn't have: ${relativeLinks.join(", ")}. Update scripts/sync-tracker-docs.mjs.`);
  process.exit(1);
}

writeFileSync(join(target, "README.md"), readme);
copyFileSync(join(root, "LICENSE"), join(target, "LICENSE"));
mkdirSync(join(target, "docs", "images"), { recursive: true });
copyFileSync(join(root, "docs", "images", "umbrella-icon.png"), join(target, "docs", "images", "umbrella-icon.png"));

console.log(`Wrote README.md, LICENSE and docs/images/umbrella-icon.png to ${target}. Review the diff there, then commit and push.`);
