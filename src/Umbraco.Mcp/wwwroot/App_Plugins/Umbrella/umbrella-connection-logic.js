/**
 * The New connection flow's rules, without any backoffice import, so they can be checked with plain node.
 *
 * A product "choice" is "defaults" (follow the site's defaults) or a level: "full", "noDestructive", "readOnly", "off".
 * Products are the Overview's: `{ id, sectionAlias, access }`, where `access` is the defaults' level. Groups are
 * Umbraco's user groups: `{ id, name, alias, sections }`.
 */

/** Umbraco requires an API user's client id to start with this. */
export const CLIENT_ID_PREFIX = "umbraco-back-office-";

const SUFFIX_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Umbraco's built-in Administrators group. */
const ADMIN_ALIAS = "admin";

/** A client id suffix from a name: lower-case, every run of other characters a single dash, no dash at either end. */
export function suggestSuffix(name) {
  return (name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Null when the suffix can be used, else the message to show. */
export function validateSuffix(suffix, takenClientIds) {
  if (!SUFFIX_PATTERN.test(suffix ?? "")) return "Use lower-case letters, digits and single dashes.";
  if ((takenClientIds ?? []).includes(CLIENT_ID_PREFIX + suffix)) return "Another API user already has this client id.";
  return null;
}

/** 32 random bytes, base64url without padding. */
export function generateSecret() {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The level a choice comes to: "defaults" is the defaults' level. */
export function effectiveLevel(choice, defaultLevel) {
  return choice === "defaults" ? defaultLevel : choice;
}

/** The products that end up on and need a backoffice section. */
function productsNeedingSections(products, choices) {
  return products.filter((p) => p.sectionAlias && effectiveLevel(choices[p.id] ?? "defaults", p.access) !== "off");
}

/**
 * The group ids to preselect: for each product that ends up on and needs a section, the first group by name that grants
 * it and is not Administrators. A caller who is not an admin can only give groups they are in, so only those are picked.
 */
export function suggestGroups(products, choices, groups, { isAdmin, ownGroupIds }) {
  const pickable = [...groups]
    .filter((g) => g.alias !== ADMIN_ALIAS && (isAdmin || (ownGroupIds ?? []).includes(g.id)))
    .sort((a, b) => a.name.localeCompare(b.name));
  const picked = new Set();
  for (const p of productsNeedingSections(products, choices)) {
    const group = pickable.find((g) => (g.sections ?? []).includes(p.sectionAlias));
    if (group) picked.add(group.id);
  }
  return picked;
}

/** The products that end up on but whose section no selected group grants: `{ product, section }`. */
export function missingSections(products, choices, groups, selectedIds) {
  const granted = new Set(groups.filter((g) => selectedIds.has(g.id)).flatMap((g) => g.sections ?? []));
  return productsNeedingSections(products, choices)
    .filter((p) => !granted.has(p.sectionAlias))
    .map((p) => ({ product: p, section: p.sectionAlias }));
}

/**
 * The user's own settings, for `PUT tool-settings/users/{key}`: only the products not on "defaults", each with the
 * defaults' disabled tool groups and switched-off tools for that product.
 */
export function buildOverrides(choices, defaultsDisabled, defaultsTools) {
  const overrides = {};
  for (const [id, choice] of Object.entries(choices)) {
    if (choice === "defaults") continue;
    overrides[id] = { disabledCollections: [...((defaultsDisabled ?? {})[id] ?? [])], disabledTools: [...((defaultsTools ?? {})[id] ?? [])], level: choice };
  }
  return overrides;
}
