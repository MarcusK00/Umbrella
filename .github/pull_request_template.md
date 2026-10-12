## What and why



## Breaking change?

No / Yes: <what breaks, and which part of the version moves>

## Checklist

Tick what applies and write n/a next to the rest. "Safe to merge" = all CI checks green + this list done (`docs/merging.md`).

- [ ] **Always:** `cd npm && npm test` passed locally **with** the Engage tarball installed (CI runs without Engage).
- [ ] **If** npm dependencies, a module, `npm/src/core/` or the capabilities/catalogue handling changed: `scripts/e2e.sh` and `scripts/pack-check.sh` passed against the running demo site.
- [ ] **If** a detector id, the capabilities payload or the tool-settings/catalogue shapes changed: both the C# and the npm side are updated (cross-language contract in CLAUDE.md).
- [ ] **If** behaviour or configuration changed: `README.md`, `npm/README.md`, `src/Umbraco.Mcp/README.md`, `docs/architecture.md` and `CLAUDE.md` are updated, with dates as DD-MM-YYYY.
- [ ] **If** the Engage tarball was re-packed: `npm ls @umbraco-cms/mcp-server-sdk` shows one deduped copy locally.
