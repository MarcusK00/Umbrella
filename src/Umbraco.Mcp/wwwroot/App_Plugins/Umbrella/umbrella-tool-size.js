/**
 * Pure helpers for `tools/list` context size estimates on Tool Permissions and the API user Info modal.
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

/**
 * Compact approximate token figure (`~` signals an estimate without repeating "est." on every row).
 * Examples: `~45k` (compact) or `~45k tokens` (`unit: true`).
 */
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

/** What a group would cost at `level` if switched on (used for sorting and showing size on Off groups). */
export function groupPotentialSizeBytes(collection, level) {
  return groupKeptSizeBytes(collection, { level: level === "off" ? "full" : level, groupOn: true, disabledTools: new Set() });
}

/**
 * Total and kept bytes across a product's collections; returns `null` when any non-empty group lacks size data.
 */
export function moduleSizeSummary(collections, stateFor) {
  if (!Array.isArray(collections) || collections.length === 0) return null;
  let totalBytes = 0;
  let keptBytes = 0;
  for (const c of collections) {
    const groupTotal = typeof c.sizeBytes === "number" ? c.sizeBytes : c.toolCount === 0 ? 0 : null;
    const groupKept = groupKeptSizeBytes(c, stateFor(c));
    if (groupTotal === null || groupKept === null) return null;
    totalBytes += groupTotal;
    keptBytes += groupKept;
  }
  return { keptBytes, totalBytes };
}

/** Sorts `{ collection, tools, matchedGroup }` entries by `"name"` (original order) or `"size"` (largest first). */
export function sortGroupEntries(entries, sortBy, level) {
  if (sortBy !== "size") return entries;
  return [...entries].sort((a, b) => {
    const sa = groupPotentialSizeBytes(a.collection, level) ?? -1;
    const sb = groupPotentialSizeBytes(b.collection, level) ?? -1;
    return sb - sa;
  });
}
