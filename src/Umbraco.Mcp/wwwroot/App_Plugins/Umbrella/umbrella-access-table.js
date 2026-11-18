import { css, html, nothing, repeat } from "@umbraco-cms/backoffice/external/lit";
import { UmbLitElement } from "@umbraco-cms/backoffice/lit-element";
import { UmbTextStyles } from "@umbraco-cms/backoffice/style";
import { formatDate } from "./umbrella-api.js";
import { LEVEL_LABELS, formatRelative, glyphStyles, levelGlyph, tools } from "./umbrella-access.js";

const STATE_TAGS = { disabled: "Disabled", lockedOut: "Locked out" };

/**
 * The Overview's API users table: one row per API user an MCP server connected as, then the API users the New connection
 * flow created that have not connected yet; one column per active product (evenly sized), a Last connected column,
 * and row actions. Every cell uses a strict two-line layout so labels, badges and subtitles align across every column.
 *
 * Events (bubbling): `edit-permissions` { key }, `info`, `new-secret`, `toggle-disabled` and `forget`, each { key }.
 */
export class UmbrellaAccessTableElement extends UmbLitElement {
  static properties = {
    users: { attribute: false },
    products: { attribute: false },
    busy: { attribute: false },
    canManageUsers: { attribute: false },
    _openPopover: { state: true },
  };

  constructor() {
    super();
    this.users = [];
    this.products = [];
    this.busy = false;
    this.canManageUsers = false;
    this._openPopover = null;
  }

  #emit(type, key) {
    this.dispatchEvent(new CustomEvent(type, { detail: { key }, bubbles: true, composed: false }));
  }

  /** Runs a menu entry and closes the row's menu. */
  #menu(type, key, popover) {
    this.shadowRoot.getElementById(popover)?.hidePopover?.();
    this.#emit(type, key);
  }

  /** The products an API user's settings can cover: installed and enabled, in the site's order. */
  #columns() {
    return this.products.filter((p) => p.installed && p.enabled);
  }

  #renderCellContent(primary, secondary, isMuted = false, own = false) {
    return html`<div class="cell">
      <div class="cell-primary ${isMuted ? "is-muted" : ""}">${primary}</div>
      <div class="cell-secondary">
        <span>${secondary}</span>
        ${own
          ? html`<uui-tag class="compact-tag" look="secondary" title="This API user has its own settings for this product">Own</uui-tag>`
          : nothing}
      </div>
    </div>`;
  }

  #renderUserCell(u, product, productStyle) {
    const a = u.access?.find((x) => x.productId === product.id);
    if (!a) {
      return html`<uui-table-cell class="product-col" style=${productStyle}>
        ${this.#renderCellContent(html`<span>–</span>`, u.connected === false ? "Pending" : "Not reported", true, false)}
      </uui-table-cell>`;
    }
    if (a.sectionAccess === false) {
      return html`<uui-table-cell
        class="product-col"
        style=${productStyle}
        title="None of this API user's user groups grant the ${product.displayName} section, so it gets no ${product.displayName} tools."
      >
        ${this.#renderCellContent(html`<span>No access</span>`, "No section access", true, false)}
      </uui-table-cell>`;
    }
    const level = a.level ?? "full";
    const isOff = level === "off";
    const own = a.scope === "user";
    const primary = html`${levelGlyph(level)}<span>${LEVEL_LABELS[level] ?? LEVEL_LABELS.full}</span>`;
    const secondary = isOff
      ? "Not loaded"
      : a.toolCount === null || a.toolCount === undefined
        ? u.connected === false
          ? "Pending"
          : "Not reported"
        : tools(a.toolCount);
    return html`<uui-table-cell class="product-col" style=${productStyle}>
      ${this.#renderCellContent(primary, secondary, isOff, own)}
    </uui-table-cell>`;
  }

  #renderUserRow(u, columns, productStyle) {
    const popover = `more-${u.key}`;
    const connected = u.connected !== false && !!u.lastConnected;
    return html`<uui-table-row class="user-row ${u.state === "disabled" ? "is-disabled" : ""}">
      <uui-table-cell class="who-col">
        <div class="who">
          <uui-avatar name=${u.name}></uui-avatar>
          <div class="who-text">
            <div class="cell-primary">
              <strong class="user-name" title=${u.name}>${u.name}</strong>
              ${STATE_TAGS[u.state]
                ? html`<uui-tag class="compact-tag" color="warning" look="primary">${STATE_TAGS[u.state]}</uui-tag>`
                : nothing}
            </div>
            <div class="cell-secondary">
              <span class="mono" title=${u.clientIds?.[0] ?? ""}>${u.clientIds?.length ? u.clientIds[0] : "No client id"}</span>
            </div>
          </div>
        </div>
      </uui-table-cell>
      ${columns.map((p) => this.#renderUserCell(u, p, productStyle))}
      <uui-table-cell class="last-connected-col">
        ${connected
          ? this.#renderCellContent(
              html`<span title=${formatDate(u.lastConnected)}>${formatRelative(u.lastConnected)}</span>`,
              formatDate(u.lastConnected),
              false,
              false,
            )
          : this.#renderCellContent(html`<span>Not connected</span>`, "Waiting for first start", true, false)}
      </uui-table-cell>
      <uui-table-cell class="actions actions-col">
        <div class="row-actions">
          <uui-button class="actions-btn" look="secondary" compact label="Actions for ${u.name}" popovertarget=${popover}>
            <span>Actions</span>
            <uui-symbol-expand ?open=${this._openPopover === popover}></uui-symbol-expand>
          </uui-button>
        </div>
        <uui-popover-container
          id=${popover}
          placement="bottom-end"
          @beforetoggle=${(e) => {
            if (e.newState === "open") this._openPopover = popover;
            else if (this._openPopover === popover) this._openPopover = null;
          }}
        >
          <umb-popover-layout>
            ${u.state === "disabled"
              ? nothing
              : html`<uui-menu-item label="Edit permissions" @click-label=${() => this.#menu("edit-permissions", u.key, popover)}>
                  <umb-icon slot="icon" name="icon-edit"></umb-icon>
                </uui-menu-item>`}
            <uui-menu-item label="Info" @click-label=${() => this.#menu("info", u.key, popover)}>
              <umb-icon slot="icon" name="icon-info"></umb-icon>
            </uui-menu-item>
            ${this.canManageUsers
              ? html`<uui-menu-item label="New secret" ?disabled=${this.busy} @click-label=${() => this.#menu("new-secret", u.key, popover)}>
                  <umb-icon slot="icon" name="icon-sync"></umb-icon>
                </uui-menu-item>`
              : nothing}
            ${this.canManageUsers && (u.state === "active" || u.state === "disabled")
              ? html`<uui-menu-item
                  label=${u.state === "active" ? "Disable API user" : "Enable API user"}
                  ?disabled=${this.busy}
                  @click-label=${() => this.#menu("toggle-disabled", u.key, popover)}
                >
                  <umb-icon slot="icon" name=${u.state === "active" ? "icon-lock" : "icon-unlocked"}></umb-icon>
                </uui-menu-item>`
              : nothing}
            <uui-menu-item label="Forget connection" ?disabled=${this.busy} @click-label=${() => this.#menu("forget", u.key, popover)}>
              <umb-icon slot="icon" name="icon-trash"></umb-icon>
            </uui-menu-item>
          </umb-popover-layout>
        </uui-popover-container>
      </uui-table-cell>
    </uui-table-row>`;
  }

  render() {
    const columns = this.#columns();
    // Reserve 56% evenly across all installed products so 3, 4, or 5+ products stay uniformly spaced regardless of permission text.
    const productStyle = columns.length ? `width: ${(56 / columns.length).toFixed(2)}%` : "";
    return html`<div class="scroll" tabindex="0" role="region" aria-label="Tool access per API user">
      <uui-table aria-label="Tool access per API user">
        <uui-table-head>
          <uui-table-head-cell class="who-col">API user</uui-table-head-cell>
          ${columns.map(
            (p) => html`<uui-table-head-cell class="product-col" style=${productStyle}>
              <span class="product">${p.displayName.replace(/^Umbraco /, "")}</span>
            </uui-table-head-cell>`,
          )}
          <uui-table-head-cell class="last-connected-col">Last connected</uui-table-head-cell>
          <uui-table-head-cell class="actions-col"><span class="visually-hidden">Actions</span></uui-table-head-cell>
        </uui-table-head>
        ${repeat(this.users, (u) => u.key, (u) => this.#renderUserRow(u, columns, productStyle))}
      </uui-table>
    </div>`;
  }

  static styles = [
    UmbTextStyles,
    glyphStyles,
    css`
      :host {
        display: block;
      }
      .scroll {
        overflow-x: auto;
      }
      uui-table {
        width: max-content;
        min-width: 100%;
        --uui-table-cell-padding: var(--uui-size-space-3) var(--uui-size-space-3);
      }
      uui-table-head-cell {
        white-space: nowrap;
        vertical-align: middle;
        background: var(--uui-color-surface-alt);
      }
      uui-table-cell {
        vertical-align: top;
        padding-top: var(--uui-size-space-4);
        padding-bottom: var(--uui-size-space-4);
      }
      uui-table-cell.actions {
        vertical-align: middle;
      }

      .who-col {
        width: 22%;
      }
      .last-connected-col {
        width: 14%;
      }
      .actions-col {
        width: 8%;
      }
      .who {
        display: flex;
        align-items: center;
        gap: var(--uui-size-space-3);
        min-width: 11rem;
        max-width: 16rem;
      }
      .who-text {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }
      .who-text .cell-primary,
      .who-text .cell-secondary {
        display: flex;
        max-width: 100%;
        min-width: 0;
      }
      .user-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      uui-avatar {
        flex: none;
        font-size: 0.8rem;
        width: 2.25rem;
        height: 2.25rem;
      }
      .user-row.is-disabled {
        opacity: 0.72;
      }

      /* Strict 2-line cell structure with uniform product column floor so spacing never shifts per permission */
      .cell {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }
      .product-col .cell {
        min-width: 7.75rem;
      }
      .last-connected-col .cell {
        min-width: 7.25rem;
      }
      .cell-primary {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 1.35rem;
        line-height: 1.35rem;
        font-weight: 600;
        white-space: nowrap;
      }
      .cell-primary.is-muted {
        color: var(--uui-color-text-alt);
        font-weight: normal;
      }
      .cell-secondary {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 1.2rem;
        line-height: 1.2rem;
        color: var(--uui-color-text-alt);
        font-size: var(--uui-type-small-size);
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }

      uui-tag.compact-tag {
        flex: none;
        --uui-tag-font-size: 0.6875rem;
        --uui-tag-padding: 0 6px;
      }

      .mono {
        font-family: var(--uui-font-monospace, ui-monospace, Menlo, Consolas, monospace);
        font-size: 0.92em;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .muted {
        color: var(--uui-color-text-alt);
      }

      .actions {
        white-space: nowrap;
      }
      .row-actions {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: var(--uui-size-space-2);
      }
      .row-actions uui-button {
        margin: 0;
        flex: none;
      }
      .actions-btn {
        font-weight: 600;
        --uui-button-padding-left-factor: 2;
        --uui-button-padding-right-factor: 2;
      }
      .actions-btn uui-symbol-expand {
        margin-left: 2px;
      }
      .visually-hidden {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
      }
    `,
  ];
}

customElements.define("umbrella-access-table", UmbrellaAccessTableElement);
export default UmbrellaAccessTableElement;
