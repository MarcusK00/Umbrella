import { css, html, live, nothing } from "@umbraco-cms/backoffice/external/lit";
import { UmbLitElement } from "@umbraco-cms/backoffice/lit-element";
import { UmbTextStyles } from "@umbraco-cms/backoffice/style";
import { LEVELS, LEVEL_LABELS, glyphStyles, groupLabel, levelGlyph, tools } from "./umbrella-access.js";
import { allowedAt, filterGroups, groupKeptCount } from "./umbrella-tool-logic.js";
import { buildSizeSegments, formatApproxTokens, formatSizeTooltip } from "./umbrella-tool-size.js";

const LEVEL_DESCRIPTIONS = {
  off: "Not loaded",
  readOnly: "Inspect only",
  noDestructive: "No delete tools",
  full: "All enabled tools",
};

/**
 * One product on the Tool Permissions tab:
 * - Collapsed summary card when `mode === "follows"` (API user inherits site defaults), folding out when Customise is clicked.
 * - Full editor (access level ladder, availability meter, and split group/tool browser) when editing defaults or custom settings.
 *
 * Events (bubbling): `level-change` { productId, level }, `groups-change` { productId, names, enabled },
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
    userKey: { attribute: false },
    userName: { attribute: false },
    defaultLevel: { attribute: false },
    isRequired: { attribute: false },
    notes: { attribute: false },
    _filter: { state: true },
    _selectedGroup: { state: true },
    _groupsExpanded: { state: true },
  };

  constructor() {
    super();
    this.product = null;
    this.module = null;
    this.level = "full";
    this.disabled = new Set();
    this.disabledTools = new Set();
    this.editable = true;
    this.locked = false;
    this.showCounts = true;
    this.mode = "defaults";
    this.userKey = "";
    this.userName = "";
    this.defaultLevel = null;
    this.isRequired = false;
    this.notes = [];
    this._filter = "";
    this._selectedGroup = "";
    this._groupsExpanded = false;
  }

  willUpdate(changed) {
    if (
      (changed.has("product") && changed.get("product")?.id !== this.product?.id) ||
      (changed.has("userKey") && changed.get("userKey") !== this.userKey) ||
      (changed.has("userName") && changed.get("userName") !== this.userName)
    ) {
      this._filter = "";
      this._selectedGroup = "";
      this._groupsExpanded = false;
    } else if (changed.has("mode") && changed.get("mode") !== this.mode) {
      this._groupsExpanded = false;
    }
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

  #sizeData() {
    if (!this.showCounts || !this.module) return null;
    return buildSizeSegments(this.module.collections, (c) => this.#stateFor(c));
  }

  async #focusGroup(name) {
    this._filter = "";
    this._selectedGroup = name;
    this._groupsExpanded = true;
    await this.updateComplete;
    this.shadowRoot?.querySelector(`.group-item[data-group="${CSS.escape(name)}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  /** The tools switched off in a group that is on and that the level would otherwise offer. */
  #offInGroup(collection) {
    if (!Array.isArray(collection.tools)) return 0;
    return collection.tools.filter((t) => allowedAt(this.level, t) && this.disabledTools.has(t.name)).length;
  }

  #renderTag() {
    if (this.mode === "follows") return html`<uui-tag look="secondary">Follows default</uui-tag>`;
    return nothing;
  }

  #renderHeaderAction() {
    if (this.mode === "follows") {
      return html`<uui-button
        slot="header-actions"
        look="primary"
        compact
        label="Customise"
        ?disabled=${this.locked}
        @click=${() => this.#emit("customise", {})}
      ></uui-button>`;
    }
    if (this.mode === "custom") {
      return html`<uui-button
        slot="header-actions"
        look="secondary"
        compact
        label="Use defaults"
        ?disabled=${!this.editable}
        @click=${() => this.#emit("reset", {})}
      ></uui-button>`;
    }
    return nothing;
  }

  /** Collapsed summary shown when an API user follows the site defaults for this product. */
  #renderCollapsedFollows() {
    const available = this.#available();
    const levelLabel = LEVEL_LABELS[this.level] ?? LEVEL_LABELS.full;
    return html`<div class="follows-collapsed">
      <div class="follows-pill ${this.level === "off" ? "is-off" : ""}">
        ${levelGlyph(this.level)}
        <span>${levelLabel}</span>
      </div>
      <p class="follows-meta muted small">
        Inherited from site defaults${available && this.level !== "off" ? ` · ${available.kept} of ${tools(available.total)}` : ""}${this.disabledTools.size > 0 && this.level !== "off"
          ? ` · ${this.disabledTools.size} switched off`
          : ""}
      </p>
    </div>`;
  }

  #renderLadder() {
    const showDefault = this.mode === "custom" && this.defaultLevel && this.defaultLevel !== this.level;
    return html`<div class="level-grid" role="radiogroup" aria-label="Access for ${this.product.displayName}">
      ${LEVELS.map((l) => {
        const active = this.level === l.value;
        const requiredOff = this.isRequired && l.value === "off";
        const isDefault = showDefault && this.defaultLevel === l.value;
        const desc = requiredOff ? "Required for sign-in" : LEVEL_DESCRIPTIONS[l.value];
        return html`<button
          type="button"
          role="radio"
          class="level-option"
          aria-checked=${active ? "true" : "false"}
          ?disabled=${!this.editable || requiredOff}
          title=${requiredOff ? "CMS cannot be switched off" : ""}
          @click=${() => !active && this.#emit("level-change", { level: l.value })}
        >
          <span class="level-option-top">
            <span class="level-option-title">${levelGlyph(l.value)} <span>${l.label}</span></span>
            ${isDefault ? html`<span class="level-default-badge">Default</span>` : nothing}
          </span>
          <span class="level-option-desc">${desc}</span>
        </button>`;
      })}
    </div>`;
  }

  #renderMeter() {
    const available = this.#available();
    if (!available) return nothing;
    const share = available.total ? Math.round((available.kept / available.total) * 100) : 0;
    const size = this.#sizeData();
    return html`<div class="meter" aria-label="${available.kept} of ${tools(available.total)} available (${share}%)">
      <div class="meter-head" title=${size ? formatSizeTooltip(size.keptBytes) : nothing}>
        <span class="meter-text"><strong>${available.kept}</strong> of ${tools(available.total)} available</span>
        <span class="meter-pct">${share}%</span>
      </div>
      ${size
        ? html`<div class="meter-track is-segmented" role="group" aria-label="Context size breakdown by tool group">
            ${size.segments.map((seg) => {
              const pct = Math.max(1, Math.round(seg.pctOfTotal));
              if (seg.kind === "group") {
                const label = groupLabel(seg.name);
                return html`<button
                  type="button"
                  class="meter-seg seg-${seg.colorIndex} ${this._selectedGroup === seg.name ? "is-selected" : ""}"
                  style="width: ${seg.pctOfTotal.toFixed(2)}%"
                  title="${label} · ${pct}% (${formatApproxTokens(seg.bytes, { unit: true })}) — click to inspect"
                  aria-label="${label}, ${pct}% of context size"
                  @click=${() => this.#focusGroup(seg.name)}
                ></button>`;
              }
              return html`<span
                class="meter-seg seg-other"
                style="width: ${seg.pctOfTotal.toFixed(2)}%"
                title="${seg.count} other ${seg.count === 1 ? "group" : "groups"} · ${pct}% (${formatApproxTokens(seg.bytes, { unit: true })})"
              ></span>`;
            })}
          </div>`
        : html`<div class="meter-track" role="presentation"><div class="meter-fill" style="width: ${share}%"></div></div>`}
    </div>`;
  }

  #renderToolDetailPane(selectedEntry, size) {
    if (!selectedEntry) return nothing;
    const { collection: c, tools: filteredTools } = selectedEntry;
    const label = groupLabel(c.name);
    const checkedGroup = !this.disabled.has(c.name);
    const kept = groupKeptCount(c, this.#stateFor(c));
    const rowSize = size?.byGroup.get(c.name) ?? null;
    const hasTools = Array.isArray(c.tools);
    const list = filteredTools ?? c.tools ?? [];
    const all = c.tools ?? [];
    const anyOff = hasTools && all.some((t) => this.disabledTools.has(t.name));

    return html`<div class="tools-pane" role="region" aria-label="${label} tools">
      <div class="tools-pane-head">
        <div class="tools-pane-title-row">
          <h4>${label}</h4>
          ${this.showCounts
            ? html`<span class="muted small" title=${rowSize ? formatSizeTooltip(rowSize.bytes) : nothing}>${checkedGroup ? `${kept} / ${c.toolCount}` : "Off"}</span>`
            : nothing}
        </div>
        ${anyOff && this.editable
          ? html`<uui-button
              look="secondary"
              compact
              label="Switch all on"
              @click=${() => this.#emit("tools-change", { names: all.map((t) => t.name), enabled: true })}
            ></uui-button>`
          : nothing}
      </div>

      ${!hasTools
        ? html`<div class="no-tools-note">
            <umb-icon name="icon-info"></umb-icon>
            <span>Per-tool switches appear after the MCP server starts with the current version.</span>
          </div>`
        : html`<ul class="tool-list">
            ${list.map((t) => {
              const allowed = allowedAt(this.level, t);
              const isChecked = allowed && !this.disabledTools.has(t.name);
              const reason = allowed ? "" : this.level === "readOnly" ? "Read-only" : "No deletes";
              return html`<li class="tool-item ${!isChecked || !checkedGroup ? "is-inactive" : ""}">
                <div class="tool-item-top">
                  <uui-checkbox
                    label=${t.name}
                    .checked=${live(isChecked)}
                    ?disabled=${!this.editable || !allowed || !checkedGroup}
                    @change=${(e) => this.#emit("tools-change", { names: [t.name], enabled: e.target.checked })}
                  ></uui-checkbox>
                  <span class="tool-meta">
                    ${t.readOnly ? html`<uui-tag class="compact-tag" look="secondary">Read-only</uui-tag>` : nothing}
                    ${t.destructive ? html`<uui-tag class="compact-tag" look="secondary" color="danger">Destructive</uui-tag>` : nothing}
                    ${reason ? html`<uui-tag class="compact-tag" look="outline" color="warning">Filtered (${reason})</uui-tag>` : nothing}
                  </span>
                </div>
                ${t.description ? html`<p class="tool-description">${t.description}</p>` : nothing}
              </li>`;
            })}
          </ul>`}
    </div>`;
  }

  #renderGroups() {
    if (this.level === "off") return nothing;
    if (!this.module) {
      return html`<div class="note">
        <umb-icon name="icon-info"></umb-icon>
        <span>Start the MCP server once to load tool groups for this product.</span>
      </div>`;
    }
    const collections = this.module.collections;
    const on = collections.filter((c) => !this.disabled.has(c.name)).length;
    const filter = this._filter.trim();
    const shown = filterGroups(collections, this._filter, groupLabel);
    const size = this.#sizeData();
    const off = this.disabledTools.size;

    const collapsible = this.mode === "custom";
    const expanded = !collapsible || this._groupsExpanded;
    const selectedEntry = shown.find((g) => g.collection.name === this._selectedGroup) ?? shown[0] ?? null;
    const selectedName = selectedEntry?.collection.name ?? "";

    return html`<div class="groups-section ${!expanded ? "is-collapsed" : ""}">
      <div class="groups-header">
        <div class="groups-title">
          <h3>Tool groups</h3>
          <span class="muted small">${on}/${collections.length}${off > 0 ? ` · ${off} off` : ""}</span>
        </div>
        ${!expanded
          ? html`<uui-button
              look="secondary"
              compact
              class="groups-toggle-btn"
              label="Expand tool groups"
              aria-expanded="false"
              @click=${() => (this._groupsExpanded = true)}
            >
              <span>Expand</span>
              <uui-symbol-expand></uui-symbol-expand>
            </uui-button>`
          : html`<div class="groups-toolbar">
              <uui-input
                class="filter"
                label="Filter groups and tools"
                placeholder="Filter groups or tools..."
                .value=${this._filter}
                @input=${(e) => (this._filter = e.target.value)}
              >
                <umb-icon slot="prepend" name="icon-search"></umb-icon>
                ${filter
                  ? html`<uui-button
                      slot="append"
                      look="secondary"
                      compact
                      label="Clear filter"
                      @click=${() => (this._filter = "")}
                    >×</uui-button>`
                  : nothing}
              </uui-input>
              ${collapsible
                ? html`<uui-button
                    look="secondary"
                    compact
                    class="groups-toggle-btn"
                    label="Collapse tool groups"
                    aria-expanded="true"
                    @click=${() => (this._groupsExpanded = false)}
                  >
                    <span>Collapse</span>
                    <uui-symbol-expand open></uui-symbol-expand>
                  </uui-button>`
                : nothing}
            </div>`}
      </div>

      ${!expanded
        ? nothing
        : shown.length === 0
          ? html`<div class="empty-filter">
              <umb-icon name="icon-search"></umb-icon>
              <p class="muted">No matches for "<strong>${this._filter}</strong>".</p>
            </div>`
          : html`<div class="browser-split">
            <ul class="groups-list" role="listbox" aria-label="Tool groups">
              ${shown.map(({ collection: c, tools: matchedTools, matchedGroup }) => {
                const checked = !this.disabled.has(c.name);
                const kept = groupKeptCount(c, this.#stateFor(c));
                const rowSize = size?.byGroup.get(c.name) ?? null;
                const offCount = checked ? this.#offInGroup(c) : 0;
                const label = groupLabel(c.name);
                const isSelected = c.name === selectedName;
                const matchHint = filter && !matchedGroup && Array.isArray(matchedTools) ? `${matchedTools.length}` : null;
                const rowTitle =
                  rowSize && rowSize.bytes > 0
                    ? `${c.name} · ${formatApproxTokens(rowSize.bytes, { unit: true })} (${Math.max(1, Math.round(rowSize.pctOfTotal))}%)`
                    : c.name;

                return html`<li
                  class="group-item ${isSelected ? "is-selected" : ""} ${!checked ? "is-unchecked" : ""}"
                  data-group=${c.name}
                  title=${rowTitle}
                >
                  <button
                    type="button"
                    class="group-select"
                    aria-selected=${isSelected ? "true" : "false"}
                    @click=${() => (this._selectedGroup = c.name)}
                  >
                    <div class="group-select-main">
                      <span class="group-name">${label}</span>
                      ${this.showCounts
                        ? html`<span class="group-count">${checked ? `${kept}/${c.toolCount}` : "Off"}</span>`
                        : nothing}
                    </div>
                    <div class="group-badges">
                      ${matchHint ? html`<uui-tag class="compact-tag" look="primary">${matchHint}</uui-tag>` : nothing}
                      ${offCount > 0 ? html`<uui-tag class="compact-tag" look="secondary" color="warning">${offCount} off</uui-tag>` : nothing}
                    </div>
                  </button>
                  <uui-toggle
                    class="group-toggle"
                    aria-label="Toggle ${label}"
                    .checked=${live(checked)}
                    ?disabled=${!this.editable}
                    @change=${(e) => this.#emit("groups-change", { names: [c.name], enabled: e.target.checked })}
                  ></uui-toggle>
                  ${rowSize && rowSize.pctOfTotal > 0
                    ? html`<span
                        class="group-weight ${rowSize.colorIndex >= 0 ? `seg-${rowSize.colorIndex}` : "seg-other"} ${rowSize.active ? "" : "is-off"}"
                        style="width: ${Math.max(rowSize.pctOfTotal, 1.5).toFixed(2)}%"
                        aria-hidden="true"
                      ></span>`
                    : nothing}
                </li>`;
              })}
            </ul>
            ${this.#renderToolDetailPane(selectedEntry, size)}
          </div>`}
    </div>`;
  }

  render() {
    if (!this.product) return nothing;
    const name = this.product.displayName;

    if (this.mode === "follows") {
      return html`<div class="follows-box mode-follows">
        <div class="follows-box-header">
          <h5 class="uui-h5 headline">
            <span>${name}</span>
            ${this.#renderTag()}
          </h5>
          <div class="follows-box-actions">${this.#renderHeaderAction()}</div>
        </div>
        ${this.#renderCollapsedFollows()}
      </div>`;
    }

    return html`<uui-box class="mode-${this.mode}">
      <div slot="headline" class="headline">
        <span>${name}</span>
        ${this.#renderTag()}
      </div>
      ${this.#renderHeaderAction()}
      <div class="access-section">
        ${this.#renderLadder()}
        ${this.#renderMeter()}
      </div>
      ${this.#renderGroups()}
    </uui-box>`;
  }

  static styles = [
    UmbTextStyles,
    glyphStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        --umbrella-seg-0: var(--uui-color-interactive-emphasis, #2152a3);
        --umbrella-seg-1: #2a9d8f;
        --umbrella-seg-2: #e09f3e;
        --umbrella-seg-3: #8b6cc1;
        --umbrella-seg-other: var(--uui-color-border-emphasis, #a1a1aa);
      }
      uui-box {
        flex: 1;
        box-sizing: border-box;
      }
      h3,
      h4,
      p {
        margin: 0;
      }
      .headline {
        display: flex;
        align-items: center;
        gap: var(--uui-size-space-3);
        flex-wrap: wrap;
      }
      .muted {
        color: var(--uui-color-text-alt);
      }
      .small {
        font-size: var(--uui-type-small-size);
      }

      .follows-box {
        flex: 1;
        display: flex;
        flex-direction: column;
        box-sizing: border-box;
        border-width: var(--uui-box-border-width, 1px);
        border-style: solid;
        border-color: var(--uui-box-border-color, var(--uui-color-divider-standalone));
        border-radius: var(--uui-box-border-radius, var(--uui-border-radius-3));
        background-color: var(--uui-color-surface);
      }
      .follows-box-header {
        display: flex;
        align-items: center;
        column-gap: var(--uui-size-space-5);
        border-bottom: 1px solid var(--uui-color-divider-standalone);
        padding: var(--uui-box-header-padding, var(--uui-size-space-4) var(--uui-size-space-5));
      }
      .follows-box-header h5 {
        margin: 0;
      }
      .follows-box-actions {
        margin-left: auto;
        flex: none;
      }
      .follows-collapsed {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: var(--uui-size-space-2);
        padding: var(--uui-size-layout-1) var(--uui-box-default-padding, var(--uui-size-space-5));
        text-align: center;
      }
      .follows-pill {
        display: inline-flex;
        align-items: center;
        gap: var(--uui-size-space-2);
        padding: var(--uui-size-space-1) var(--uui-size-space-3);
        border-radius: 999px;
        border: 1px solid var(--uui-color-border);
        background: var(--uui-color-surface-alt);
        font-weight: 600;
      }
      .follows-pill.is-off {
        color: var(--uui-color-text-alt);
        font-weight: normal;
      }
      .follows-meta {
        font-variant-numeric: tabular-nums;
      }

      .access-section {
        display: flex;
        flex-direction: column;
        gap: var(--uui-size-space-4);
      }
      .level-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: var(--uui-size-space-2);
        padding: 4px;
        border-radius: var(--uui-border-radius);
        background: var(--uui-color-surface-alt);
        border: 1px solid var(--uui-color-border);
      }
      @media (max-width: 44rem) {
        .level-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
      .level-option {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 2px;
        min-width: 0;
        padding: var(--uui-size-space-2) var(--uui-size-space-3);
        border: 1px solid transparent;
        border-radius: calc(var(--uui-border-radius) - 1px);
        background: transparent;
        font: inherit;
        color: var(--uui-color-text);
        text-align: left;
        cursor: pointer;
        transition: background-color 120ms ease, color 120ms ease, border-color 120ms ease, box-shadow 120ms ease;
      }
      .level-option:hover:not(:disabled):not([aria-checked="true"]) {
        background: var(--uui-color-surface);
        border-color: var(--uui-color-border);
      }
      .level-option:focus-visible {
        outline: 2px solid var(--uui-color-focus);
        outline-offset: 1px;
      }
      .level-option[aria-checked="true"] {
        background: var(--uui-color-current);
        color: var(--uui-color-current-contrast);
        box-shadow: var(--uui-shadow-depth-1);
      }
      .level-option:disabled {
        cursor: not-allowed;
        opacity: 0.5;
      }
      .level-option-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--uui-size-space-2);
        width: 100%;
      }
      .level-option-title {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-weight: 700;
        white-space: nowrap;
      }
      .level-option-desc {
        font-size: var(--uui-type-small-size);
        color: var(--uui-color-text-alt);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 100%;
      }
      .level-option[aria-checked="true"] .level-option-desc {
        color: inherit;
        opacity: 0.85;
      }
      .level-default-badge {
        padding: 0 6px;
        border-radius: 999px;
        background: var(--uui-color-surface-emphasis);
        color: var(--uui-color-text-alt);
        font-size: 0.6875rem;
        font-weight: 600;
      }

      .meter {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .meter-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: var(--uui-size-space-2);
      }
      .meter-text {
        color: var(--uui-color-text-alt);
        font-size: var(--uui-type-small-size);
        font-variant-numeric: tabular-nums;
      }
      .meter-text strong {
        color: var(--uui-color-text);
        font-size: var(--uui-type-default-size);
      }
      .meter-pct {
        font-size: var(--uui-type-small-size);
        font-weight: 700;
        color: var(--uui-color-text-alt);
        font-variant-numeric: tabular-nums;
      }
      .meter-track {
        height: 6px;
        border-radius: 3px;
        background: var(--uui-color-surface-emphasis);
        overflow: hidden;
      }
      .meter-track.is-segmented {
        display: flex;
        gap: 2px;
        height: 8px;
        border-radius: 4px;
      }
      .meter-fill {
        height: 100%;
        border-radius: 3px;
        background: var(--uui-color-interactive-emphasis);
        transition: width 200ms ease;
      }
      .meter-seg {
        display: block;
        height: 100%;
        min-width: 3px;
        padding: 0;
        border: 0;
        transition: width 200ms ease, opacity 120ms ease, filter 120ms ease;
      }
      button.meter-seg {
        cursor: pointer;
      }
      button.meter-seg:hover,
      button.meter-seg.is-selected {
        filter: brightness(1.12);
      }
      button.meter-seg:focus-visible {
        outline: 2px solid var(--uui-color-focus);
        outline-offset: -1px;
      }
      .seg-0 {
        background: var(--umbrella-seg-0);
      }
      .seg-1 {
        background: var(--umbrella-seg-1);
      }
      .seg-2 {
        background: var(--umbrella-seg-2);
      }
      .seg-3 {
        background: var(--umbrella-seg-3);
      }
      .seg-other {
        background: var(--umbrella-seg-other);
      }
      @media (prefers-reduced-motion: reduce) {
        .meter-fill,
        .meter-seg {
          transition: none;
        }
      }

      .groups-section {
        margin-top: var(--uui-size-space-4);
        border-top: 1px solid var(--uui-color-divider);
        padding-top: var(--uui-size-space-4);
      }
      .groups-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: var(--uui-size-space-3);
        margin-bottom: var(--uui-size-space-3);
      }
      .groups-section.is-collapsed .groups-header {
        margin-bottom: 0;
      }
      .groups-title {
        display: flex;
        align-items: baseline;
        gap: var(--uui-size-space-2);
        flex: none;
      }
      .groups-title h3 {
        font-size: var(--uui-type-default-size);
      }
      .groups-toolbar {
        flex: 1 1 16rem;
        min-width: 0;
        display: flex;
        align-items: center;
        gap: var(--uui-size-space-2);
      }
      .filter {
        flex: 1;
        min-width: 0;
      }
      .groups-toggle-btn {
        flex: none;
      }
      .groups-toggle-btn uui-symbol-expand {
        margin-left: 4px;
      }
      .filter umb-icon {
        margin-left: var(--uui-size-space-3);
        color: var(--uui-color-text-alt);
      }

      .empty-filter {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--uui-size-space-2);
        padding: var(--uui-size-layout-1);
        border-radius: var(--uui-border-radius);
        background: var(--uui-color-surface-alt);
        text-align: center;
      }
      .empty-filter umb-icon {
        font-size: 1.5rem;
        color: var(--uui-color-text-alt);
      }

      .browser-split {
        display: grid;
        grid-template-columns: minmax(14rem, 19rem) minmax(0, 1fr);
        border: 1px solid var(--uui-color-border);
        border-radius: var(--uui-border-radius);
        background: var(--uui-color-surface);
        overflow: hidden;
      }
      @media (max-width: 56rem) {
        .browser-split {
          grid-template-columns: minmax(0, 1fr);
        }
      }

      .groups-list {
        list-style: none;
        margin: 0;
        padding: 0;
        border-right: 1px solid var(--uui-color-divider);
        max-height: 32rem;
        overflow-y: auto;
        background: var(--uui-color-surface-alt);
      }
      @media (max-width: 56rem) {
        .groups-list {
          border-right: 0;
          border-bottom: 1px solid var(--uui-color-divider);
          max-height: 15rem;
        }
      }
      .group-item {
        position: relative;
        display: flex;
        align-items: center;
        border-bottom: 1px solid var(--uui-color-divider);
        transition: background-color 100ms ease;
      }
      .group-weight {
        position: absolute;
        left: 0;
        bottom: 0;
        height: 2px;
        opacity: 0.72;
        pointer-events: none;
        transition: width 200ms ease, opacity 120ms ease;
      }
      .group-weight.seg-other {
        opacity: 0.45;
      }
      .group-weight.is-off {
        opacity: 0.22;
      }
      .group-item:last-child {
        border-bottom: 0;
      }
      .group-item:hover {
        background: var(--uui-color-surface);
      }
      .group-item.is-selected {
        background: var(--uui-color-surface);
        box-shadow: inset 3px 0 0 var(--uui-color-selected);
      }
      .group-select {
        flex: 1;
        min-width: 0;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--uui-size-space-2);
        padding: var(--uui-size-space-2) var(--uui-size-space-3) var(--uui-size-space-2) var(--uui-size-space-4);
        border: 0;
        background: none;
        font: inherit;
        color: inherit;
        text-align: left;
        cursor: pointer;
      }
      .group-select:focus-visible {
        outline: 2px solid var(--uui-color-focus);
        outline-offset: -2px;
      }
      .group-select-main {
        display: flex;
        flex-direction: column;
        min-width: 0;
        gap: 1px;
      }
      .group-name {
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .group-item.is-selected .group-name {
        color: var(--uui-color-selected);
      }
      .group-count {
        font-size: var(--uui-type-small-size);
        color: var(--uui-color-text-alt);
        font-variant-numeric: tabular-nums;
      }
      .group-item.is-unchecked .group-name,
      .group-item.is-unchecked .group-count {
        color: var(--uui-color-text-alt);
      }
      .group-badges {
        display: flex;
        align-items: center;
        gap: 4px;
        flex: none;
      }
      .group-toggle {
        flex: none;
        padding-right: var(--uui-size-space-3);
      }

      .tools-pane {
        display: flex;
        flex-direction: column;
        min-width: 0;
        max-height: 32rem;
      }
      .tools-pane-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: var(--uui-size-space-3);
        padding: var(--uui-size-space-2) var(--uui-size-space-4);
        border-bottom: 1px solid var(--uui-color-divider);
        background: var(--uui-color-surface);
      }
      .tools-pane-title-row {
        display: flex;
        align-items: baseline;
        flex-wrap: wrap;
        gap: var(--uui-size-space-2);
      }
      .tools-pane-title-row h4 {
        font-size: var(--uui-type-default-size);
      }

      .no-tools-note {
        display: flex;
        align-items: center;
        gap: var(--uui-size-space-2);
        padding: var(--uui-size-space-4);
        color: var(--uui-color-text-alt);
        font-size: var(--uui-type-small-size);
      }
      .tool-list {
        list-style: none;
        margin: 0;
        padding: 0;
        overflow-y: auto;
        flex: 1;
      }
      .tool-item {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: var(--uui-size-space-2) var(--uui-size-space-4);
        border-bottom: 1px solid var(--uui-color-divider);
        transition: background-color 100ms ease;
      }
      .tool-item:last-child {
        border-bottom: 0;
      }
      .tool-item:hover {
        background: var(--uui-color-surface-alt);
      }
      .tool-item.is-inactive {
        opacity: 0.72;
      }
      .tool-item-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: var(--uui-size-space-2);
      }
      .tool-item uui-checkbox {
        font-family: var(--uui-font-monospace, ui-monospace, Menlo, Consolas, monospace);
        font-size: var(--uui-type-small-size);
        font-weight: 600;
      }
      .tool-meta {
        display: inline-flex;
        align-items: center;
        gap: var(--uui-size-space-2);
        flex-wrap: wrap;
      }
      uui-tag.compact-tag {
        flex: none;
        --uui-tag-font-size: 0.6875rem;
        --uui-tag-padding: 0 6px;
      }
      .tool-description {
        padding-left: calc(var(--uui-size-space-6, 24px) + 4px);
        color: var(--uui-color-text-alt);
        font-size: var(--uui-type-small-size);
        line-height: 1.35;
      }

      .note {
        display: flex;
        gap: var(--uui-size-space-2);
        align-items: flex-start;
        margin-top: var(--uui-size-space-3);
        padding: var(--uui-size-space-3) var(--uui-size-space-4);
        border-radius: var(--uui-border-radius);
        background: var(--uui-color-surface-alt);
        border: 1px solid var(--uui-color-divider);
        color: var(--uui-color-text-alt);
        font-size: var(--uui-type-small-size);
      }
      .note umb-icon {
        flex: none;
        margin-top: 2px;
      }
    `,
  ];
}

customElements.define("umbrella-product-card", UmbrellaProductCardElement);
export default UmbrellaProductCardElement;
