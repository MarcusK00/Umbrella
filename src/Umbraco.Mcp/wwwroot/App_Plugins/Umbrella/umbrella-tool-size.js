/**
 * Pure helpers for `tools/list` context size visualizations on Tool Permissions and the API user Info modal.
 * Kept in its own module with zero backoffice imports so browsers never hit missing exports on cached older files,
 * and plain `node` can test it directly.
 */

function allowedAt(level, tool) {
  if (level === "off") return false;
  if (level === "readOnly") return !!tool.readOnly;
  if (level === "noDestructive") return !tool.destructive;
  return true;
}

/** Rough token estimate (~4 UTF-8 characters per token, matching `@umbraco-cms/mcp-server-sdk`). */
export function estimateTokens(bytes) {
  return Math.ceil(Math.max(0, bytes) / 4);
}

/** Compact approximate token figure: `~45k` or `~45k tokens` (`unit: true`). */
export function formatApproxTokens(bytes, { unit = false } = {}) {
  const suffix = unit ? " tokens" : "";
  if (bytes <= 0) return `0${suffix}`;
  const tokens = estimateTokens(bytes);
  if (tokens < 1000) return `~${tokens}${suffix}`;
  if (tokens < 10_000) return `~${(tokens / 1000).toFixed(1)}k${suffix}`;
  return `~${Math.round(tokens / 1000)}k${suffix}`;
}

export function formatSizeTooltip(bytes) {
  const tokens = estimateTokens(bytes).toLocaleString("en-US");
  const kb = (Math.max(0, bytes) / 1024).toFixed(bytes >= 10240 ? 0 : 1);
  return `~${tokens} tokens (estimated at ~4 chars/token from ${kb} KB of tool definitions; actual count varies by model)`;
}

/**
 * UTF-8 bytes the AI tool receives from one group under `state` (`{ level, groupOn, disabledTools }`),
 * or `null` when an older MCP server reported the group without size data.
 */
export function groupKeptSizeBytes(collection, state) {
  if (Array.isArray(collection.tools) && (collection.tools.length === 0 || collection.tools.every((t) => typeof t.sizeBytes === "number"))) {
    if (!state.groupOn || state.level === "off") return 0;
    return collection.tools.reduce(
      (sum, t) => (allowedAt(state.level, t) && !state.disabledTools.has(t.name) ? sum + t.sizeBytes : sum),
      0,
    );
  }
  if (!state.groupOn || state.level === "off") return 0;
  const variant =
    state.level === "readOnly"
      ? collection.readOnlySizeBytes
      : state.level === "noDestructive"
        ? collection.nonDestructiveSizeBytes
        : collection.sizeBytes;
  if (typeof variant === "number") return variant;
  if (typeof collection.sizeBytes === "number") return collection.sizeBytes;
  return collection.toolCount === 0 ? 0 : null;
}

/** What a group would cost at `level` if switched on. */
export function groupPotentialSizeBytes(collection, level) {
  return groupKeptSizeBytes(collection, { level: level === "off" ? "full" : level, groupOn: true, disabledTools: new Set() });
}

/**
 * Builds proportional footprint segments for the meter bar and per-group row hairlines.
 * Returns `null` when any non-empty group lacks size data or the product has 0 total bytes.
 */
export function buildSizeSegments(collections, stateFor, maxNamed = 4) {
  if (!Array.isArray(collections) || collections.length === 0) return null;

  let totalBytes = 0;
  let keptBytes = 0;
  const rows = [];
  for (const c of collections) {
    const state = stateFor(c);
    const fullBytes = typeof c.sizeBytes === "number" ? c.sizeBytes : c.toolCount === 0 ? 0 : null;
    const kept = groupKeptSizeBytes(c, state);
    const potential = groupPotentialSizeBytes(c, state.level);
    if (fullBytes === null || kept === null || potential === null) return null;
    totalBytes += fullBytes;
    keptBytes += kept;
    rows.push({ name: c.name, active: state.groupOn && state.level !== "off", kept, potential });
  }
  if (totalBytes <= 0) return null;

  const activeSorted = rows
    .filter((r) => r.active && r.kept > 0)
    .sort((a, b) => b.kept - a.kept || a.name.localeCompare(b.name));

  const top = activeSorted.slice(0, maxNamed);
  const rest = activeSorted.slice(maxNamed);
  const colorByName = new Map(top.map((r, i) => [r.name, i]));

  const segments = top.map((r, i) => ({
    kind: "group",
    name: r.name,
    bytes: r.kept,
    pctOfTotal: (r.kept / totalBytes) * 100,
    colorIndex: i,
  }));
  if (rest.length > 0) {
    const restBytes = rest.reduce((sum, r) => sum + r.kept, 0);
    segments.push({
      kind: "other",
      count: rest.length,
      bytes: restBytes,
      pctOfTotal: (restBytes / totalBytes) * 100,
      colorIndex: -1,
    });
  }

  const byGroup = new Map();
  for (const r of rows) {
    const bytes = r.active ? r.kept : r.potential;
    byGroup.set(r.name, {
      active: r.active,
      bytes,
      pctOfTotal: (bytes / totalBytes) * 100,
      colorIndex: r.active ? (colorByName.get(r.name) ?? -1) : -1,
    });
  }

  return { totalBytes, keptBytes, segments, byGroup };
}
