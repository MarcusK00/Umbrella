/**
 * Pure rules for single-tool switches on the Tool Permissions tab. No imports, so plain `node` can load and check it.
 * Tool names are unprefixed, as the catalogue reports them. A collection's `tools` is missing when an older MCP server
 * reported it; that is "not known", not "no tools".
 */

/** Whether a tool is offered at an access level, before any tool of the group is switched off. */
export function allowedAt(level, tool) {
  if (level === "off") return false;
  if (level === "readOnly") return !!tool.readOnly;
  if (level === "noDestructive") return !tool.destructive;
  return true;
}

/** The tools of a group the AI tool gets: group on, level allows it, not switched off. Empty without a `tools` list. */
export function keptTools(collection, { level, groupOn, disabledTools }) {
  if (!groupOn || level === "off" || !Array.isArray(collection.tools)) return [];
  return collection.tools.filter((t) => allowedAt(level, t) && !disabledTools.has(t.name));
}

/** How many tools of a group the AI tool gets; from the counts when an older server reported no tools. */
export function groupKeptCount(collection, state) {
  if (Array.isArray(collection.tools)) return keptTools(collection, state).length;
  if (!state.groupOn || state.level === "off") return 0;
  const kept =
    state.level === "readOnly" ? collection.readOnlyToolCount : state.level === "noDestructive" ? collection.nonDestructiveToolCount : null;
  return typeof kept === "number" ? kept : collection.toolCount;
}

/**
 * The groups that match the filter text. A group matching on its name or label shows all its tools; a group matching
 * only through tool names shows just those. `tools` is null for a group without a tools list.
 */
export function filterGroups(collections, text, groupLabel) {
  const needle = (text ?? "").trim().toLowerCase();
  if (!needle) return collections.map((collection) => ({ collection, tools: collection.tools ?? null, matchedGroup: true }));
  const result = [];
  for (const collection of collections) {
    if (collection.name.toLowerCase().includes(needle) || groupLabel(collection.name).toLowerCase().includes(needle)) {
      result.push({ collection, tools: collection.tools ?? null, matchedGroup: true });
      continue;
    }
    const matching = (collection.tools ?? []).filter((t) => t.name.toLowerCase().includes(needle));
    if (matching.length > 0) result.push({ collection, tools: matching, matchedGroup: false });
  }
  return result;
}

/**
 * Drops switched-off names the product no longer has, but only when the site-wide catalogue lists the tools of every
 * group; otherwise the names are kept, as the dashboard can't tell a dropped tool from an unreported one.
 */
export function pruneDisabledTools(names, siteModule) {
  const collections = siteModule?.collections;
  if (!Array.isArray(collections) || collections.length === 0 || !collections.every((c) => Array.isArray(c.tools))) return names;
  const known = new Set(collections.flatMap((c) => c.tools.map((t) => t.name)));
  return new Set([...names].filter((n) => known.has(n)));
}

/** "Switched off: a, b", and after 5 names " and {n} more". */
export function switchedOffSummary(names) {
  const shown = names.slice(0, 5).join(", ");
  const more = names.length > 5 ? ` and ${names.length - 5} more` : "";
  return `Switched off: ${shown}${more}`;
}
