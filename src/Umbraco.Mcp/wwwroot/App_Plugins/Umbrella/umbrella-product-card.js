import { css, html, live, nothing } from "@umbraco-cms/backoffice/external/lit";
import { UmbLitElement } from "@umbraco-cms/backoffice/lit-element";
import { UmbTextStyles } from "@umbraco-cms/backoffice/style";
import { LEVELS, LEVEL_LABELS, glyphStyles, groupLabel, levelGlyph, tools } from "./umbrella-access.js";

const HINTS = {
  off: (product) => `Not loaded. Your AI tool won't see any ${product} tools.`,
  readOnly: () => "Only tools that read. Nothing is created, changed or deleted.",
  noDestructive: () => "Can create and change, but no tool that deletes or empties.",
  full: () => "Every tool in the groups that are switched on.",
};

const REQUIRED_HINT = "CMS can't be switched off: the MCP server signs in through it.";

/** Above this many groups the list gets a filter. */
const FILTER_FROM = 8;

/**
 * One product on the Tool Permissions tab: its access level, how many tools that leaves, and behind a disclosure its
 * tool groups. A product a user view follows from the defaults shows only a summary. It holds no settings of its own;
 * every change is an event for the page to apply.
 *
 * Events (bubbling, composed): `level-change` { productId, level }, `groups-change` { productId, names, enabled },
 * `customise` { productId } and `reset` { productId }.
 */
export class UmbrellaProductCardElement extends UmbLitElement {
  static properties = {
    product: { attribute: false },
    module: { attribute: false },
    level: { attribute: false },
    disabled: { attribute: false },
    editable: { attribute: false },
    locked: { attribute: false },
    showCounts: { attribute: false },
    mode: { attribute: false },
    userName: { attribute: false },
    defaultLevel: { attribute: false },
    isRequired: { attribute: false },
    notes: { attribute: false },
    noSectionAccess: { attribute: false },
    _open: { state: true },
    _filter: { state: true },
  };

  constructor() {
    super();
    this.product = null;
    this.module = null;
    this.level = "full";
    this.disabled = new Set();
    this.editable = true;
    // While the page saves or loads a user: nothing can be changed, also not "Customise".
    this.locked = false;
    this.showCounts = true;
    // "defaults", "follows" (a user view that follows the defaults) or "custom" (a user view with an override).
    this.mode = "defaults";
    this.userName = "";
    // In a user view, the defaults' level, to compare with.
    this.defaultLevel = null;
    this.isRequired = false;
    this.notes = [];
    // In a user view: none of the user's groups grant the product's section, so the settings have no effect.
    this.noSectionAccess = false;
    this._open = false;
    this._filter = "";
  }

  #emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail: { productId: this.product.id, ...detail }, bubbles: true, composed: false }));
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

  /** How many tools the AI tool gets with these settings, out of every tool the product reported; null without counts. */
  #available() {
    if (!this.showCounts || !this.module) return null;
    const total = this.module.collections.reduce((sum, c) => sum + c.toolCount, 0);
    const kept =
      this.level === "off"
        ? 0
        : this.module.collections.filter((c) => !this.disabled.has(c.name)).reduce((sum, c) => sum + (this.#keptCount(c) ?? c.toolCount), 0);
    return { kept, total };
  }

  #renderTag() {
    if (this.noSectionAccess) return html`<uui-tag look="secondary">No section access</uui-tag>`;
    if (this.mode === "follows") return html`<uui-tag look="secondary">Follows defaults</uui-tag>`;
    if (this.mode === "custom") return html`<uui-tag look="primary" color="positive">Own settings</uui-tag>`;
    return nothing;
  }

  #renderHeaderAction() {
    // Customising would change nothing; an override saved earlier can still be dropped.
    if (this.noSectionAccess && this.mode !== "custom") return nothing;
    if (this.mode === "follows") {
      return html`<uui-button
        slot="header-actions"
        look="secondary"
        compact
        label="Customise for ${this.userName}"
        ?disabled=${this.locked}
        @click=${() => this.#emit("customise", {})}
      ></uui-button>`;
    }
    if (this.mode === "custom") {
      return html`<uui-button
        slot="header-actions"
        look="secondary"
        compact
        label="Use the defaults"
        ?disabled=${!this.editable}
        @click=${() => this.#emit("reset", {})}
      ></uui-button>`;
    }
    return nothing;
  }

  #renderLadder() {
    return html`<uui-button-group class="ladder" role="group" aria-label="Access for ${this.product.displayName}">
      ${LEVELS.map(
        (l) => html`<uui-button
          look=${this.level === l.value ? "primary" : "outline"}
          label=${this.level === l.value ? `${l.label} (current)` : l.label}
          ?disabled=${!this.editable || (this.isRequired && l.value === "off")}
          @click=${() => this.level !== l.value && this.#emit("level-change", { level: l.value })}
          ><span class="ladder-step">${levelGlyph(l.value)} ${l.label}</span></uui-button
        >`,
      )}
    </uui-button-group>`;
  }

  #renderMeter() {
    const available = this.#available();
    if (!available) return nothing;
    const share = available.total ? Math.round((available.kept / available.total) * 100) : 0;
    return html`<div class="meter">
      <div class="meter-text">
        <strong>${available.kept}</strong> of ${tools(available.total)} available to the AI tool
      </div>
      <div class="meter-track" role="presentation"><div class="meter-fill" style="width: ${share}%"></div></div>
    </div>`;
  }

  #renderGroups() {
    if (this.level === "off") return nothing;
    if (!this.module) {
      return html`<p class="note">
        <umb-icon name="icon-info"></umb-icon>
        <span>Tool groups are not reported yet. Start the MCP server once; if it has started, call get-mcp-health in your AI tool to see why this
        product did not load.</span>
      </p>`;
    }
    const collections = this.module.collections;
    const on = collections.filter((c) => !this.disabled.has(c.name)).length;
    const filter = this._filter.trim().toLowerCase();
    const shown = filter
      ? collections.filter((c) => c.name.toLowerCase().includes(filter) || groupLabel(c.name).toLowerCase().includes(filter))
      : collections;
    const names = shown.map((c) => c.name);
    return html`<div class="groups-section">
      <button class="disclosure" aria-expanded=${this._open ? "true" : "false"} @click=${() => (this._open = !this._open)}>
        <uui-symbol-expand ?open=${this._open}></uui-symbol-expand>
        <span>Tool groups</span>
        <span class="muted">${on} of ${collections.length} switched on</span>
      </button>
      ${this._open
        ? html`<div class="groups-toolbar">
              ${collections.length > FILTER_FROM
                ? html`<uui-input
                    class="filter"
                    label="Filter tool groups"
                    placeholder="Filter groups"
                    .value=${this._filter}
                    @input=${(e) => (this._filter = e.target.value)}
                  >
                    <umb-icon slot="prepend" name="icon-search"></umb-icon>
                  </uui-input>`
                : nothing}
              <uui-button
                look="secondary"
                compact
                label=${filter ? "Switch on shown" : "Switch all on"}
                ?disabled=${!this.editable || names.every((n) => !this.disabled.has(n))}
                @click=${() => this.#emit("groups-change", { names, enabled: true })}
              ></uui-button>
              <uui-button
                look="secondary"
                compact
                label=${filter ? "Switch off shown" : "Switch all off"}
                ?disabled=${!this.editable || names.every((n) => this.disabled.has(n))}
                @click=${() => this.#emit("groups-change", { names, enabled: false })}
              ></uui-button>
            </div>
            ${shown.length === 0
              ? html`<p class="muted">No tool group matches "${this._filter}".</p>`
              : html`<ul class="groups">
                  ${shown.map((c) => {
                    const checked = !this.disabled.has(c.name);
                    const empty = checked && this.#keptCount(c) === 0;
                    return html`<li class=${checked ? (empty ? "empty" : "") : "unchecked"} title=${c.name}>
                      <uui-toggle
                        label=${groupLabel(c.name)}
                        .checked=${live(checked)}
                        ?disabled=${!this.editable}
                        @change=${(e) => this.#emit("groups-change", { names: [c.name], enabled: e.target.checked })}
                      ></uui-toggle>
                      ${this.showCounts ? html`<span class="count">${this.#toolCount(c)}</span>` : nothing}
                    </li>`;
                  })}
                </ul>`}`
        : nothing}
    </div>`;
  }

  /** A user view following the defaults: what it gets, without the controls. */
  #renderFollows() {
    const available = this.#available();
    return html`<div class="follows">
      <span class="level ${this.level === "off" ? "off" : ""}">${levelGlyph(this.level)} ${LEVEL_LABELS[this.level] ?? LEVEL_LABELS.full}</span>
      ${available && this.level !== "off" ? html`<span class="muted">${available.kept} of ${tools(available.total)}</span>` : nothing}
      ${(this.notes ?? []).map((n) => html`<p class="note"><umb-icon name="icon-info"></umb-icon><span>${n}</span></p>`)}
    </div>`;
  }

  /** A user view of a product whose section the user lacks: no access, whatever the level. */
  #renderNoSectionAccess() {
    const name = this.product.displayName;
    return html`<div class="follows">
      <span class="level off">${levelGlyph("off")} No access</span>
      <p class="note">
        <umb-icon name="icon-info"></umb-icon>
        <span>None of ${this.userName}'s user groups grant the ${name} section, so its MCP server doesn't load ${name} and these settings
        have no effect. To give access, add the section to one of its user groups in Users, then reconnect the MCP server.</span>
      </p>
    </div>`;
  }

  render() {
    if (!this.product) return nothing;
    const name = this.product.displayName;
    if (this.noSectionAccess) {
      return html`<uui-box class="mode-${this.mode}">
        <div slot="headline" class="headline">
          <span>${name}</span>
          ${this.#renderTag()}
        </div>
        ${this.#renderHeaderAction()} ${this.#renderNoSectionAccess()}
      </uui-box>`;
    }
    const differs = this.mode === "custom" && this.defaultLevel && this.defaultLevel !== this.level;
    return html`<uui-box class="mode-${this.mode}">
      <div slot="headline" class="headline">
        <span>${name}</span>
        ${this.#renderTag()}
      </div>
      ${this.#renderHeaderAction()}
      ${this.mode === "follows"
        ? this.#renderFollows()
        : html`<div class="access">
              ${this.#renderLadder()}
              <p class="hint">
                ${(HINTS[this.level] ?? HINTS.full)(name)}
                ${differs ? html`<span class="muted">The defaults are ${LEVEL_LABELS[this.defaultLevel]}.</span>` : nothing}
              </p>
              ${this.isRequired ? html`<p class="muted small">${REQUIRED_HINT}</p>` : nothing}
            </div>
            ${this.#renderMeter()} ${this.#renderGroups()}
            ${(this.notes ?? []).map((n) => html`<p class="note"><umb-icon name="icon-info"></umb-icon><span>${n}</span></p>`)}`}
    </uui-box>`;
  }

  static styles = [
    UmbTextStyles,
    glyphStyles,
    css`
      :host { display: block; }
      .headline { display: flex; align-items: center; gap: var(--uui-size-space-3); flex-wrap: wrap; }
      .muted { color: var(--uui-color-text-alt); }
      .small { font-size: var(--uui-type-small-size); margin: 0; }
      .ladder { flex-wrap: wrap; }
      .ladder-step { display: inline-flex; align-items: center; gap: var(--uui-size-space-2); }
      .hint { margin: var(--uui-size-space-3) 0 var(--uui-size-space-1); }
      .hint .muted { margin-left: var(--uui-size-space-1); }
      .level { display: inline-flex; align-items: center; gap: var(--uui-size-space-2); font-weight: 600; }
      .level.off { color: var(--uui-color-text-alt); font-weight: normal; }

      .meter { margin-top: var(--uui-size-space-5); max-width: 32rem; }
      .meter-text { margin-bottom: var(--uui-size-space-2); color: var(--uui-color-text-alt); }
      .meter-text strong { color: var(--uui-color-text); font-variant-numeric: tabular-nums; }
      .meter-track { height: 6px; border-radius: 3px; background: var(--uui-color-surface-emphasis); overflow: hidden; }
      .meter-fill { height: 100%; border-radius: 3px; background: var(--uui-color-interactive-emphasis); transition: width 200ms ease; }
      @media (prefers-reduced-motion: reduce) { .meter-fill { transition: none; } }

      .groups-section { margin-top: var(--uui-size-space-5); border-top: 1px solid var(--uui-color-divider); padding-top: var(--uui-size-space-2); }
      .disclosure {
        display: inline-flex; align-items: center; gap: var(--uui-size-space-2);
        padding: var(--uui-size-space-2) 0; background: none; border: 0; font: inherit; color: inherit; cursor: pointer; font-weight: 600;
      }
      .disclosure .muted { font-weight: normal; }
      .disclosure:hover > span:first-of-type { text-decoration: underline; }
      .groups-toolbar { display: flex; align-items: center; gap: var(--uui-size-space-2); flex-wrap: wrap; margin: var(--uui-size-space-3) 0; }
      .filter { flex: 0 1 18rem; }
      .filter umb-icon { margin-left: var(--uui-size-space-3); color: var(--uui-color-text-alt); }
      .groups {
        list-style: none; margin: 0; padding: 0;
        display: grid; grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr)); column-gap: var(--uui-size-space-6);
      }
      .groups li {
        display: flex; align-items: center; justify-content: space-between; gap: var(--uui-size-space-3);
        padding: var(--uui-size-space-2) 0; border-bottom: 1px solid var(--uui-color-divider);
      }
      .groups li.unchecked .count, .groups li.empty .count { color: var(--uui-color-disabled-contrast); }
      .count { color: var(--uui-color-text-alt); font-size: var(--uui-type-small-size); font-variant-numeric: tabular-nums; white-space: nowrap; }

      .note { display: flex; gap: var(--uui-size-space-2); align-items: baseline; margin: var(--uui-size-space-3) 0 0; color: var(--uui-color-text-alt); }
      .note umb-icon { flex: none; }

      .follows { display: flex; align-items: center; gap: var(--uui-size-space-3); flex-wrap: wrap; }
      .follows .note { flex-basis: 100%; margin-top: 0; }
    `,
  ];
}

customElements.define("umbrella-product-card", UmbrellaProductCardElement);
export default UmbrellaProductCardElement;
