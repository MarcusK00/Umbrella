import { css, html, nothing } from "@umbraco-cms/backoffice/external/lit";
import { UmbLitElement } from "@umbraco-cms/backoffice/lit-element";
import { UmbTextStyles } from "@umbraco-cms/backoffice/style";

/** The access ladder, lowest step first. `off` means the MCP server does not load the product at all. */
export const LEVELS = [
  { value: "off", label: "Off" },
  { value: "readOnly", label: "Read-only" },
  { value: "noDestructive", label: "No deletes" },
  { value: "full", label: "Full" },
];

const LABEL = Object.fromEntries(LEVELS.map((l) => [l.value, l.label]));

const HINTS = {
  off: (product) => `Not loaded. Your AI tool won't see any ${product} tools.`,
  readOnly: () => "Only tools that read. Nothing is created, changed or deleted.",
  noDestructive: () => "Can create and change, but no tool that deletes or empties.",
  full: () => "Every tool in the groups that are switched on.",
};

const REQUIRED_HINT = "CMS is always on: the MCP server signs in through it.";

/**
 * One product on the Tool Permissions tab: its access level and, behind a disclosure, its tool groups. It holds no
 * settings of its own; every change is an event for the page to apply.
 *
 * Events (bubbling, composed): `level-change` { productId, level }, `group-change` { productId, name, enabled },
 * `customise` { productId } and `reset` { productId }.
 */
export class UmbrellaProductCardElement extends UmbLitElement {
  static properties = {
    product: { attribute: false },
    module: { attribute: false },
    level: { attribute: false },
    disabled: { attribute: false },
    editable: { attribute: false },
    showCounts: { attribute: false },
    mode: { attribute: false },
    userName: { attribute: false },
    isRequired: { attribute: false },
    notes: { attribute: false },
    _open: { state: true },
  };

  constructor() {
    super();
    this.product = null;
    this.module = null;
    this.level = "full";
    this.disabled = new Set();
    this.editable = true;
    this.showCounts = true;
    // "defaults", "follows" (a user view that follows the defaults) or "custom" (a user view with an override).
    this.mode = "defaults";
    this.userName = "";
    this.isRequired = false;
    this.notes = [];
    this._open = false;
  }

  #emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail: { productId: this.product.id, ...detail }, bubbles: true, composed: true }));
  }

  /** The group's tools left under read-only or no deletes; null at full access or when an older MCP server did not report the count. */
  #keptCount(collection) {
    const kept =
      this.level === "readOnly" ? collection.readOnlyToolCount : this.level === "noDestructive" ? collection.nonDestructiveToolCount : null;
    return typeof kept === "number" ? kept : null;
  }

  /** "12", or "4 of 12" under read-only or no deletes. */
  #toolCount(collection) {
    const kept = this.#keptCount(collection);
    return kept === null ? `${collection.toolCount}` : `${kept} of ${collection.toolCount}`;
  }

  #summary() {
    if (this.level === "off") return LABEL.off;
    const label = LABEL[this.level] ?? LABEL.full;
    if (!this.showCounts || !this.module) return label;
    const tools = this.module.collections
      .filter((c) => !this.disabled.has(c.name))
      .reduce((sum, c) => sum + (this.#keptCount(c) ?? c.toolCount), 0);
    return `${label} · ${tools} tools`;
  }

  #renderTag() {
    if (this.mode === "follows") return html`<uui-tag look="secondary">Follows defaults</uui-tag>`;
    if (this.mode === "custom") return html`<uui-tag look="primary" color="positive">Custom for ${this.userName}</uui-tag>`;
    return nothing;
  }

  #renderLadder() {
    return html`<uui-button-group class="ladder" role="radiogroup" aria-label="Access for ${this.product.displayName}">
      ${LEVELS.map(
        (l) => html`<uui-button
          role="radio"
          aria-checked=${this.level === l.value ? "true" : "false"}
          look=${this.level === l.value ? "primary" : "outline"}
          label=${l.label}
          ?disabled=${!this.editable || (this.isRequired && l.value === "off")}
          @click=${() => this.level !== l.value && this.#emit("level-change", { level: l.value })}
        ></uui-button>`,
      )}
    </uui-button-group>`;
  }

  #renderGroups() {
    if (this.level === "off") return nothing;
    if (!this.module) {
      return html`<p class="muted">
        Not reported yet. Start the MCP server once; if it has started, call get-mcp-health in your AI tool to see why this
        product did not load.
      </p>`;
    }
    const total = this.module.collections.length;
    const on = this.module.collections.filter((c) => !this.disabled.has(c.name)).length;
    return html`<button class="disclosure" aria-expanded=${this._open ? "true" : "false"} @click=${() => (this._open = !this._open)}>
        <uui-symbol-expand ?open=${this._open}></uui-symbol-expand>
        Tool groups: ${on} of ${total} on
      </button>
      ${this._open
        ? html`<div class="groups">
            ${this.module.collections.map(
              (c) => html`<uui-checkbox
                label=${this.showCounts ? `${c.name} (${this.#toolCount(c)})` : c.name}
                ?checked=${!this.disabled.has(c.name)}
                ?disabled=${!this.editable}
                @change=${(e) => this.#emit("group-change", { name: c.name, enabled: e.target.checked })}
              ></uui-checkbox>`,
            )}
          </div>`
        : nothing}`;
  }

  render() {
    if (!this.product) return nothing;
    const name = this.product.displayName;
    return html`<uui-box>
      <div slot="headline" class="headline">${name} ${this.#renderTag()}</div>
      <span slot="header-actions" class="summary">${this.#summary()}</span>
      <div class=${this.editable ? "" : "dimmed"}>
        ${this.#renderLadder()}
        <p class="hint">${(HINTS[this.level] ?? HINTS.full)(name)}</p>
        ${this.isRequired ? html`<p class="muted">${REQUIRED_HINT}</p>` : nothing}
        ${this.#renderGroups()}
        ${(this.notes ?? []).map((n) => html`<p class="muted">${n}</p>`)}
      </div>
      ${this.mode === "follows"
        ? html`<uui-button class="action" look="secondary" label="Customise for ${this.userName}" @click=${() => this.#emit("customise", {})}></uui-button>`
        : this.mode === "custom"
          ? html`<uui-button class="action" look="placeholder" compact label="Reset to defaults" @click=${() => this.#emit("reset", {})}></uui-button>`
          : nothing}
    </uui-box>`;
  }

  static styles = [
    UmbTextStyles,
    css`
      :host { display: block; }
      .headline { display: flex; align-items: center; gap: var(--uui-size-space-3); flex-wrap: wrap; }
      .summary { color: var(--uui-color-text-alt); white-space: nowrap; }
      .ladder { flex-wrap: wrap; }
      .hint { margin: var(--uui-size-space-3) 0 var(--uui-size-space-2); }
      .muted { color: var(--uui-color-text-alt); margin: var(--uui-size-space-2) 0; }
      .disclosure {
        display: inline-flex; align-items: center; gap: var(--uui-size-space-2);
        margin-top: var(--uui-size-space-3); padding: var(--uui-size-space-2) 0;
        background: none; border: 0; font: inherit; color: var(--uui-color-interactive); cursor: pointer;
      }
      .disclosure:hover { color: var(--uui-color-interactive-emphasis); }
      .groups {
        display: grid; grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
        gap: var(--uui-size-space-3); margin-top: var(--uui-size-space-3);
      }
      .dimmed { opacity: 0.55; }
      .action { margin-top: var(--uui-size-space-4); }
    `,
  ];
}

customElements.define("umbrella-product-card", UmbrellaProductCardElement);
export default UmbrellaProductCardElement;
