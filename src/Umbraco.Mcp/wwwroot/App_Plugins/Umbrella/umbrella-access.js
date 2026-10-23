import { css, html } from "@umbraco-cms/backoffice/external/lit";

/** The access ladder, lowest step first. `off` means the MCP server does not load the product at all. */
export const LEVELS = [
  { value: "off", label: "Off" },
  { value: "readOnly", label: "Read-only" },
  { value: "noDestructive", label: "No deletes" },
  { value: "full", label: "Full" },
];

export const LEVEL_LABELS = Object.fromEntries(LEVELS.map((l) => [l.value, l.label]));

/** One icon per level: the most the AI tool may do with the product. */
const GLYPHS = {
  off: { icon: "icon-block", title: "Not loaded" },
  readOnly: { icon: "icon-eye", title: "Can read" },
  noDestructive: { icon: "icon-edit", title: "Can read, create and change" },
  full: { icon: "icon-unlocked", title: "Can read, create, change and delete" },
};

/**
 * The access level as one small icon. Decorative for assistive technology (the label next to it carries the meaning);
 * the tooltip spells it out. Needs `glyphStyles`.
 */
export function levelGlyph(level) {
  const glyph = GLYPHS[level] ?? GLYPHS.full;
  return html`<umb-icon class="glyph" aria-hidden="true" title=${glyph.title} name=${glyph.icon}></umb-icon>`;
}

export const glyphStyles = css`
  .glyph { flex: none; font-size: 1em; }
`;

export const tools = (n) => `${n} ${n === 1 ? "tool" : "tools"}`;

const WORDS = { ab: "A/B", api: "API", mcp: "MCP", seo: "SEO", ui: "UI", url: "URL" };

/** A tool group's name for people: "document-blueprint" → "Document blueprint", "ab-test" → "A/B test". */
export function groupLabel(name) {
  const words = name.split(/[-_]/).map((w) => WORDS[w] ?? w);
  const text = words.join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const RELATIVE = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const UNITS = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

/** "3 hours ago", "yesterday", "just now". */
export function formatRelative(iso) {
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return RELATIVE.format(Math.round(seconds / size), unit);
  }
  return "just now";
}
