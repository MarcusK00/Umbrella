import { css, html, live, nothing } from "@umbraco-cms/backoffice/external/lit";
import { UmbLitElement } from "@umbraco-cms/backoffice/lit-element";
import { UmbTextStyles } from "@umbraco-cms/backoffice/style";
import { LEVELS, LEVEL_LABELS, glyphStyles, groupLabel, levelGlyph, tools } from "./umbrella-access.js";
import { allowedAt, filterGroups, groupKeptCount, switchedOffSummary } from "./umbrella-tool-logic.js";

const HINTS = {
  off: (product) => `Not loaded. Your AI tool won't see any ${product} tools.`,
  readOnly: () => "Only tools that read. Nothing is created, changed or deleted.",
  noDestructive: () => "Can create and change, but no tool that deletes or empties.",
  full: () => "Every tool in the groups that are switched on.",
};

const REQUIRED_HINT = "CMS can't be switched off: the MCP server signs in through it.";

/**
 * One product on the Tool Permissions tab: its access level, how many tools that leaves, and behind a disclosure its
 * tool groups. A product a user view follows from the defaults shows only a summary. It holds no settings of its own;
 * every change is an event for the page to apply.
 *
 * Events (bubbling, composed): `level-change` { productId, level }, `groups-change` { productId, names, enabled },
 * `tools-change` { productId, names, enabled }, `customise` { productId } and `reset` { productId }.
 */
export class UmbrellaProductCardElement extends UmbLitElement {
  static properties = {
    product: { attribute: false },
    module: { attribute: false },
    level: { attribute: false },
    disabled: { attribute: false },
    disabledTools: { attribute: false },
    editable: { attribute: false },
    locked: { attribute: false },
    showCounts: { attribute: false },
    mode: { attribute: false },
    userName: { attribute: false },
    defaultLevel: { attribute: false },
    isRequired: { attribute: false },
    notes: { attribute: false },
    _open: { state: true },
    _filter: { state: true },
    _openGroups: { state: true },
  };

  constructor() {
    super();
    this.product = null;
    this.module = null;
    this.level = "full";
    this.disabled = new Set();
    // Tool names switched off in this product's groups (unprefixed).
    this.disabledTools = new Set();
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
    this._open = false;
    this._filter = "";
    this._openGroups = new Set();
  }

  #emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail: { productId: this.product.id, ...detail }, bubbles: true, composed: false }));
  }

  #stateFor(collection) {
    return { level: this.level, groupOn: !this.disabled.has(collection.name), disabledTools: this.disabledTools };
  }

  /** How many tools the AI tool gets with these settings, out of every tool the product reported; null without counts. */
  #available() {
    if (!this.showCounts || !this.module) return null;
    const total = this.module.collections.reduce((sum, c) => sum + c.toolCount, 0);
    const kept = this.module.collections.reduce((sum, c) => sum + groupKeptCount(c, this.#stateFor(c)), 0);
    return { kept, total };
  }

  /** The tools switched off in a group that is on and that the level would otherwise offer. */
  #offInGroup(collection) {
    if (!Array.isArray(collection.tools)) return 0;
    return collection.tools.filter((t) => allowedAt(this.level, t) && this.disabledTools.has(t.name)).length;
  }

  #toggleOpen(name) {
    const next = new Set(this._openGroups);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    this._openGroups = next;
  }

  #renderSwitchedOff() {
    if (this.disabledTools.size === 0 || this.level === "off") return nothing;
    const names = [...this.disabledTools].sort();
    return html`<div class="switched-off">
      <span class="muted">${switchedOffSummary(names)}</span>
      <uui-button
        look="secondary"
        compact
        label="Switch them on"
        ?disabled=${!this.editable}
        @click=${() => this.#emit("tools-change", { names, enabled: true })}
      ></uui-button>
    </div>`;
  }

  #renderTools(c, tools, checkedGroup) {
    const all = c.tools;
    const anyOff = all.some((t) => this.disabledTools.has(t.name));
    return html`<div class="tools">
      ${anyOff
        ? html`<uui-button
            class="switch-all"
            look="secondary"
            compact
            label="Switch all ${all.length} on"
            ?disabled=${!this.editable}
            @click=${() => this.#emit("tools-change", { names: all.map((t) => t.name), enabled: true })}
          ></uui-button>`
        : nothing}
      <ul>
        ${tools.map((t) => {
          const allowed = allowedAt(this.level, t);
          const reason = allowed ? "" : this.level === "readOnly" ? "Not offered at Read-only." : "Removed by No deletes.";
          return html`<li>
            <uui-checkbox
              label=${t.name}
              .checked=${live(allowed && !this.disabledTools.has(t.name))}
              ?disabled=${!this.editable || !allowed || !checkedGroup}
              @change=${(e) => this.#emit("tools-change", { names: [t.name], enabled: e.target.checked })}
            ></uui-checkbox>
            <span class="tool-meta">
              ${t.readOnly ? html`<uui-tag look="secondary" size="s">Read-only</uui-tag>` : nothing}
              ${t.destructive ? html`<uui-tag look="secondary" color="danger" size="s">Destructive</uui-tag>` : nothing}
            </span>
            ${t.description ? html`<span class="tool-description">${t.description}</span>` : nothing}
            ${reason ? html`<span class="tool-reason">${reason}</span>` : nothing}
          </li>`;
        })}
      </ul>
    </div>`;
  }

  #renderTag() {
    if (this.mode === "follows") return html`<uui-tag look="secondary">Follows defaults</uui-tag>`;
    if (this.mode === "custom") return html`<uui-tag look="primary" color="positive">Own settings</uui-tag>`;
    return nothing;
  }

  #renderHeaderAction() {
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
    const filter = this._filter.trim();
    const shown = filterGroups(collections, this._filter, groupLabel);
    const names = shown.map((g) => g.collection.name);
    const off = this.disabledTools.size;
    return html`<div class="groups-section">
      <button class="disclosure" aria-expanded=${this._open ? "true" : "false"} @click=${() => (this._open = !this._open)}>
        <uui-symbol-expand ?open=${this._open}></uui-symbol-expand>
        <span>Tool groups</span>
        <span class="muted">${on} of ${collections.length} switched on${off > 0 ? ` · ${tools(off)} off` : ""}</span>
      </button>
      ${this._open
        ? html`<div class="groups-toolbar">
              <uui-input
                class="filter"
                label="Filter groups and tools"
                placeholder="Filter groups and tools"
                .value=${this._filter}
                @input=${(e) => (this._filter = e.target.value)}
              >
                <umb-icon slot="prepend" name="icon-search"></umb-icon>
              </uui-input>
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
              ? html`<p class="muted">No tool group or tool matches "${this._filter}".</p>`
              : html`<ul class="groups">
                  ${shown.map(({ collection: c, tools: groupTools, matchedGroup }) => {
                    const checked = !this.disabled.has(c.name);
                    const kept = groupKeptCount(c, this.#stateFor(c));
                    const empty = checked && kept === 0;
                    const hasTools = Array.isArray(c.tools);
                    const isOpen = hasTools && (this._openGroups.has(c.name) || (!!filter && !matchedGroup));
                    const offCount = checked ? this.#offInGroup(c) : 0;
                    const label = groupLabel(c.name);
                    return html`<li class=${checked ? (empty ? "empty" : "") : "unchecked"} title=${c.name}>
                      <div class="group-row">
                        ${hasTools
                          ? html`<button
                              class="expand"
                              aria-expanded=${isOpen ? "true" : "false"}
                              aria-label=${isOpen ? `Hide the tools in ${label}` : `Show the tools in ${label}`}
                              @click=${() => this.#toggleOpen(c.name)}
                            >
                              <uui-symbol-expand ?open=${isOpen}></uui-symbol-expand>
                            </button>`
                          : html`<span class="expand-spacer"></span>`}
                        <uui-toggle
                          label=${label}
                          .checked=${live(checked)}
                          ?disabled=${!this.editable}
                          @change=${(e) => this.#emit("groups-change", { names: [c.name], enabled: e.target.checked })}
                        ></uui-toggle>
                        ${this.showCounts
                          ? html`<span class="count">${checked ? `${kept} of ${c.toolCount} tools` : "Off"}</span>
                              ${offCount > 0 ? html`<uui-tag look="secondary" size="s">${offCount} off</uui-tag>` : nothing}`
                          : nothing}
                      </div>
                      ${isOpen ? this.#renderTools(c, groupTools ?? c.tools, checked) : nothing}
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
      ${this.disabledTools.size > 0 && this.level !== "off"
        ? html`<span class="muted">${this.disabledTools.size} ${this.disabledTools.size === 1 ? "tool" : "tools"} switched off</span>`
        : nothing}
      ${(this.notes ?? []).map((n) => html`<p class="note"><umb-icon name="icon-info"></umb-icon><span>${n}</span></p>`)}
    </div>`;
  }

  render() {
    if (!this.product) return nothing;
    const name = this.product.displayName;
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
            ${this.#renderMeter()} ${this.#renderSwitchedOff()} ${this.#renderGroups()}
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
      .groups { list-style: none; margin: 0; padding: 0; }
      .groups > li { padding: var(--uui-size-space-2) 0; border-bottom: 1px solid var(--uui-color-divider); }
      .group-row { display: flex; align-items: center; gap: var(--uui-size-space-3); }
      .group-row uui-toggle { flex: 1; min-width: 0; }
      .expand {
        display: inline-flex; align-items: center; justify-content: center; width: 1.5rem; height: 1.5rem; padding: 0;
        background: none; border: 0; color: inherit; cursor: pointer; border-radius: var(--uui-border-radius);
      }
      .expand:focus-visible { outline: 2px solid var(--uui-color-focus); outline-offset: 1px; }
      .expand-spacer { display: inline-block; width: 1.5rem; flex: none; }
      .groups li.unchecked .count, .groups li.empty .count { color: var(--uui-color-disabled-contrast); }
      .count { color: var(--uui-color-text-alt); font-size: var(--uui-type-small-size); font-variant-numeric: tabular-nums; white-space: nowrap; }

      .switched-off { display: flex; align-items: center; gap: var(--uui-size-space-3); flex-wrap: wrap; margin-top: var(--uui-size-space-3); }
      .tools { margin: var(--uui-size-space-2) 0 var(--uui-size-space-1) calc(1.5rem + var(--uui-size-space-3)); padding-left: var(--uui-size-space-4); border-left: 2px solid var(--uui-color-divider); }
      .tools ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--uui-size-space-3); }
      .switch-all { margin-bottom: var(--uui-size-space-3); }
      .tools li { display: flex; flex-wrap: wrap; align-items: center; column-gap: var(--uui-size-space-3); row-gap: 2px; }
      .tools uui-checkbox { font-family: var(--uui-font-monospace, monospace); font-size: var(--uui-type-small-size); }
      .tool-meta { display: inline-flex; gap: var(--uui-size-space-2); }
      .tool-description, .tool-reason { flex-basis: 100%; padding-left: calc(var(--uui-size-space-6, 24px) + var(--uui-size-space-2)); color: var(--uui-color-text-alt); font-size: var(--uui-type-small-size); }
      .tool-reason { font-style: italic; }

      .note { display: flex; gap: var(--uui-size-space-2); align-items: baseline; margin: var(--uui-size-space-3) 0 0; color: var(--uui-color-text-alt); }
      .note umb-icon { flex: none; }

      .follows { display: flex; align-items: center; gap: var(--uui-size-space-3); flex-wrap: wrap; }
      .follows .note { flex-basis: 100%; margin-top: 0; }
    `,
  ];
}

customElements.define("umbrella-product-card", UmbrellaProductCardElement);
export default UmbrellaProductCardElement;
