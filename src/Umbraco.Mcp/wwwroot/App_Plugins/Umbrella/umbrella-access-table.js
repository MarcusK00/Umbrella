import { css, html, nothing, repeat } from "@umbraco-cms/backoffice/external/lit";
import { UmbLitElement } from "@umbraco-cms/backoffice/lit-element";
import { UmbTextStyles } from "@umbraco-cms/backoffice/style";
import { formatDate } from "./umbrella-api.js";
import { LEVEL_LABELS, formatRelative, glyphStyles, levelGlyph, tools } from "./umbrella-access.js";

const STATE_TAGS = { disabled: "Disabled", lockedOut: "Locked out" };

/**
 * The Overview's access table: one row per API user an MCP server connected as, one column per product, and in each
 * cell the access that user's server gets. The first row is the defaults, which every user without its own settings
 * follows. It holds no state; "Edit permissions" and "Forget" are events for the Overview.
 *
 * Events (bubbling, composed): `edit-permissions` { key } ("" for the defaults) and `forget` { key }.
 */
export class UmbrellaAccessTableElement extends UmbLitElement {
  static properties = {
    users: { attribute: false },
    products: { attribute: false },
    busy: { attribute: false },
  };

  constructor() {
    super();
    this.users = [];
    this.products = [];
    this.busy = false;
  }

  #emit(type, key) {
    this.dispatchEvent(new CustomEvent(type, { detail: { key }, bubbles: true, composed: false }));
  }

  /** The products an API user's settings can cover: installed and enabled, in the site's order. */
  #columns() {
    return this.products.filter((p) => p.installed && p.enabled);
  }

  #renderLevel(level, count, own) {
    return html`<span class="level ${level === "off" ? "off" : ""}">
      ${levelGlyph(level)}
      <span>${LEVEL_LABELS[level] ?? LEVEL_LABELS.full}</span>
      ${own ? html`<span class="own" aria-hidden="true" title="This API user's own settings"></span><span class="visually-hidden">, own settings</span>` : nothing}
    </span>
    ${count === null || count === undefined || level === "off" ? nothing : html`<span class="count">${tools(count)}</span>`}`;
  }

  #renderUserCell(u, product) {
    const a = u.access?.find((x) => x.productId === product.id);
    if (!a) return html`<uui-table-cell><span class="count">Not reported</span></uui-table-cell>`;
    // Without the product's section its API refuses every tool, whatever the level: often on purpose, so no warning.
    if (a.sectionAccess === false) {
      return html`<uui-table-cell>
        <div class="cell" title="None of this API user's user groups grant the ${product.displayName} section, so it gets no ${product.displayName} tools.">
          <span class="level off">${levelGlyph("off")}<span>No access</span></span>
          <span class="count">No section access</span>
        </div>
      </uui-table-cell>`;
    }
    return html`<uui-table-cell>
      <div class="cell">${this.#renderLevel(a.level, a.toolCount, a.scope === "user")}</div>
    </uui-table-cell>`;
  }

  #renderDefaultsRow(columns) {
    return html`<uui-table-row class="defaults">
      <uui-table-cell>
        <div class="who">
          <span class="defaults-icon"><umb-icon name="icon-settings"></umb-icon></span>
          <div>
            <strong>Defaults</strong>
            <span class="sub">For every API user without its own settings</span>
          </div>
        </div>
      </uui-table-cell>
      ${columns.map((p) => html`<uui-table-cell><div class="cell">${this.#renderLevel(p.access)}</div></uui-table-cell>`)}
      <uui-table-cell></uui-table-cell>
      <uui-table-cell class="actions">
        <div class="row-actions">
          <uui-button look="secondary" compact label="Edit defaults" @click=${() => this.#emit("edit-permissions", "")}></uui-button>
        </div>
      </uui-table-cell>
    </uui-table-row>`;
  }

  #renderUserRow(u, columns) {
    const popover = `more-${u.key}`;
    return html`<uui-table-row>
      <uui-table-cell>
        <div class="who">
          <uui-avatar name=${u.name}></uui-avatar>
          <div class="name">
            <strong>${u.name}</strong>
            ${STATE_TAGS[u.state] ? html`<uui-tag color="warning" look="primary">${STATE_TAGS[u.state]}</uui-tag>` : nothing}
          </div>
        </div>
      </uui-table-cell>
      ${columns.map((p) => this.#renderUserCell(u, p))}
      <uui-table-cell class="total">${u.toolCount === null || u.toolCount === undefined ? "–" : u.toolCount}</uui-table-cell>
      <uui-table-cell class="actions">
        <div class="row-actions">
          <uui-button look="secondary" compact label="Edit permissions" @click=${() => this.#emit("edit-permissions", u.key)}></uui-button>
          <uui-button class="more" look="secondary" compact label="Details and actions for ${u.name}" popovertarget=${popover}>
            <uui-symbol-more></uui-symbol-more>
          </uui-button>
        </div>
        <uui-popover-container id=${popover} placement="bottom-end">
          <umb-popover-layout>
            <dl class="details">
              <div><dt>Client id</dt><dd>${u.clientIds?.length ? u.clientIds.join(", ") : "None"}</dd></div>
              <div>
                <dt>Last connected</dt>
                <dd>${formatRelative(u.lastConnected)} <span class="sub">(${formatDate(u.lastConnected)})</span></dd>
              </div>
              <div><dt>MCP server</dt><dd>${u.serverVersion ? `umbrella-mcp ${u.serverVersion}` : "Not reported yet"}</dd></div>
            </dl>
            <uui-menu-item label="Forget connection" ?disabled=${this.busy} @click-label=${() => this.#emit("forget", u.key)}>
              <umb-icon slot="icon" name="icon-trash"></umb-icon>
            </uui-menu-item>
          </umb-popover-layout>
        </uui-popover-container>
      </uui-table-cell>
    </uui-table-row>`;
  }

  render() {
    const columns = this.#columns();
    const anyOwn = this.users.some((u) => u.access?.some((a) => a.scope === "user"));
    return html`<div class="scroll" tabindex="0" role="region" aria-label="Tool access per API user">
        <uui-table aria-label="Tool access per API user">
          <uui-table-head>
            <uui-table-head-cell>API user</uui-table-head-cell>
            ${columns.map((p) => html`<uui-table-head-cell>${p.displayName.replace(/^Umbraco /, "")}</uui-table-head-cell>`)}
            <uui-table-head-cell class="total">Tools</uui-table-head-cell>
            <uui-table-head-cell><span class="visually-hidden">Actions</span></uui-table-head-cell>
          </uui-table-head>
          ${this.#renderDefaultsRow(columns)} ${repeat(this.users, (u) => u.key, (u) => this.#renderUserRow(u, columns))}
        </uui-table>
      </div>
      ${anyOwn ? html`<p class="legend"><span class="own" aria-hidden="true"></span>Own settings: this API user doesn't follow the defaults for the product.</p>` : nothing}`;
  }

  static styles = [
    UmbTextStyles,
    glyphStyles,
    css`
      :host { display: block; }
      .scroll { overflow-x: auto; }
      uui-table { min-width: 44rem; }
      uui-table-head-cell { white-space: nowrap; }
      uui-table-cell { vertical-align: top; padding-top: var(--uui-size-space-4); padding-bottom: var(--uui-size-space-4); }
      .who { display: flex; align-items: center; gap: var(--uui-size-space-3); min-width: 12rem; }
      .who .name { flex-direction: row; align-items: center; flex-wrap: wrap; gap: var(--uui-size-space-2); }
      .who > div { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; min-width: 0; }
      .details {
        display: flex; flex-direction: column; gap: var(--uui-size-space-3); min-width: 16rem; max-width: 24rem;
        margin: 0; padding: var(--uui-size-space-4); border-bottom: 1px solid var(--uui-color-divider);
      }
      .details dt { font-size: var(--uui-type-small-size); color: var(--uui-color-text-alt); }
      .details dd { margin: 2px 0 0; overflow-wrap: anywhere; }
      uui-avatar { flex: none; font-size: 0.75rem; width: 2rem; height: 2rem; }
      .defaults-icon {
        display: inline-grid; place-items: center; flex: none; width: 2rem; height: 2rem; border-radius: 50%;
        background: var(--uui-color-surface-emphasis); color: var(--uui-color-text-alt);
      }
      .defaults { background: var(--uui-color-surface-alt); }
      .sub { color: var(--uui-color-text-alt); font-size: var(--uui-type-small-size); overflow-wrap: anywhere; }
      .cell { display: flex; flex-direction: column; gap: 2px; }
      .level { display: inline-flex; align-items: center; gap: var(--uui-size-space-2); white-space: nowrap; font-weight: 600; }
      .level.off { color: var(--uui-color-text-alt); font-weight: normal; }
      .count { color: var(--uui-color-text-alt); font-size: var(--uui-type-small-size); white-space: nowrap; }
      .own { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--uui-color-interactive-emphasis); flex: none; }
      .total { text-align: right; font-variant-numeric: tabular-nums; }
      .actions { white-space: nowrap; }
      .row-actions { display: flex; align-items: stretch; justify-content: flex-end; gap: var(--uui-size-space-1); }
      .row-actions uui-button { margin: 0; }
      .row-actions .more { --uui-button-padding-left-factor: 1; --uui-button-padding-right-factor: 1; }
      .legend {
        display: flex; align-items: center; gap: var(--uui-size-space-2);
        margin: var(--uui-size-space-3) 0 0; color: var(--uui-color-text-alt); font-size: var(--uui-type-small-size);
      }
      .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
    `,
  ];
}

customElements.define("umbrella-access-table", UmbrellaAccessTableElement);
export default UmbrellaAccessTableElement;
