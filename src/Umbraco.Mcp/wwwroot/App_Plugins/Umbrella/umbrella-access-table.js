import { css, html, nothing, repeat } from "@umbraco-cms/backoffice/external/lit";
import { UmbLitElement } from "@umbraco-cms/backoffice/lit-element";
import { UmbTextStyles } from "@umbraco-cms/backoffice/style";
import { formatDate } from "./umbrella-api.js";
import { LEVEL_LABELS, formatRelative, glyphStyles, levelGlyph, tools } from "./umbrella-access.js";

const STATE_TAGS = { disabled: "Disabled", lockedOut: "Locked out" };

/**
 * The Overview's API users table: one row per API user an MCP server connected as, then the API users the New connection
 * flow created that have not connected yet; one column per active product (evenly sized), a Last connected column,
 * and row actions. Every cell is a single line so rows stay compact and aligned; full details live in the Info modal.
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

  #renderCellContent(primary, isMuted = false) {
    return html`<div class="cell-primary ${isMuted ? "is-muted" : ""}">${primary}</div>`;
  }

  #renderUserCell(u, product, productStyle) {
    const a = u.access?.find((x) => x.productId === product.id);
    if (!a) {
      return html`<uui-table-cell class="product-col" style=${productStyle} title=${u.connected === false ? "Pending" : "Not reported"}>
        ${this.#renderCellContent(html`<span>–</span>`, true)}
      </uui-table-cell>`;
    }
    if (a.sectionAccess === false) {
      return html`<uui-table-cell
        class="product-col"
        style=${productStyle}
        title="None of this API user's user groups grant the ${product.displayName} section, so it gets no ${product.displayName} tools."
      >
        ${this.#renderCellContent(html`<span>No access</span>`, true)}
      </uui-table-cell>`;
    }
    const level = a.level ?? "full";
    const levelLabel = LEVEL_LABELS[level] ?? LEVEL_LABELS.full;
    const isOff = level === "off";
    const isCustom = a.scope === "user";
    const label = isCustom ? (isOff ? levelLabel : "Custom") : "Default";
    const primary = html`${levelGlyph(level)}<span>${label}</span>`;
    const countDetail = !isOff && a.toolCount !== null && a.toolCount !== undefined ? ` · ${tools(a.toolCount)}` : "";
    const disabledDetail = isCustom && !isOff && a.disabledToolCount > 0 ? ` (${a.disabledToolCount} switched off)` : "";
    const title = isCustom
      ? `Custom settings for ${product.displayName}: ${levelLabel}${countDetail}${disabledDetail}`
      : `Follows default permissions for ${product.displayName}: ${levelLabel}${countDetail}`;
    return html`<uui-table-cell class="product-col" style=${productStyle} title=${title}>
      ${this.#renderCellContent(primary, isOff)}
    </uui-table-cell>`;
  }

  #renderUserRow(u, columns, productStyle) {
    const popover = `more-${u.key}`;
    const connected = u.connected !== false && !!u.lastConnected;
    return html`<uui-table-row class="user-row ${u.state === "disabled" ? "is-disabled" : ""}">
      <uui-table-cell class="who-col">
        <div class="who">
          <uui-avatar name=${u.name}></uui-avatar>
          <div class="cell-primary who-name">
            <strong class="user-name" title=${u.name}>${u.name}</strong>
            ${STATE_TAGS[u.state]
              ? html`<uui-tag class="compact-tag" color="warning" look="primary">${STATE_TAGS[u.state]}</uui-tag>`
              : nothing}
          </div>
        </div>
      </uui-table-cell>
      ${columns.map((p) => this.#renderUserCell(u, p, productStyle))}
      <uui-table-cell class="last-connected-col">
        ${connected
          ? this.#renderCellContent(html`<span title=${formatRelative(u.lastConnected)}>${formatDate(u.lastConnected)}</span>`, false)
          : this.#renderCellContent(html`<span title="Waiting for first start">Not connected</span>`, true)}
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
        vertical-align: middle;
        padding-top: var(--uui-size-space-3);
        padding-bottom: var(--uui-size-space-3);
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
      .who-name {
        flex: 1;
        min-width: 0;
      }
      .user-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      uui-avatar {
        flex: none;
        font-size: 0.75rem;
        width: 2rem;
        height: 2rem;
      }
      .user-row.is-disabled {
        opacity: 0.72;
      }

      .product-col .cell-primary {
        min-width: 6.75rem;
      }
      .last-connected-col .cell-primary {
        min-width: 7.75rem;
        font-weight: normal;
        color: var(--uui-color-text-alt);
        font-variant-numeric: tabular-nums;
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

      uui-tag.compact-tag {
        flex: none;
        --uui-tag-font-size: 0.6875rem;
        --uui-tag-padding: 0 6px;
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
