import { css, html, nothing } from "@umbraco-cms/backoffice/external/lit";
import { UmbLitElement } from "@umbraco-cms/backoffice/lit-element";
import { UMB_AUTH_CONTEXT } from "@umbraco-cms/backoffice/auth";
import { UMB_NOTIFICATION_CONTEXT } from "@umbraco-cms/backoffice/notification";
import { umbConfirmModal, umbOpenModal } from "@umbraco-cms/backoffice/modal";
import { UmbTextStyles } from "@umbraco-cms/backoffice/style";
import { formatDate, request } from "./umbrella-api.js";
import { LEVEL_LABELS, formatRelative, glyphStyles, levelGlyph } from "./umbrella-access.js";
import "./umbrella-access-table.js";
import { UMBRELLA_CONNECT_MODAL } from "./umbrella-connect-modal.js";
import { UMBRELLA_API_USER_INFO_MODAL, UMBRELLA_NEW_CONNECTION_MODAL, UMBRELLA_NEW_SECRET_MODAL } from "./umbrella-modals.js";
import { disableUser, enableUser } from "./umbrella-users-api.js";

const AREAS = { products: "Products", server: "MCP server", apiUsers: "API users" };

/**
 * Settings → Umbrella → Overview:
 * 1. Compact status banner (all good, ready to connect, or what needs attention).
 * 2. Default permissions card (lists active products, their versions and default levels, with a prominent Edit default permissions action).
 * 3. Connections table (connected and created API users, when each last connected, their per-product access and row actions).
 */
export class UmbrellaOverviewElement extends UmbLitElement {
  static properties = {
    _data: { state: true },
    _error: { state: true },
    _setup: { state: true },
    _busy: { state: true },
    _notesOpen: { state: true },
  };

  #auth;
  #notifications;
  #seq = 0;

  constructor() {
    super();
    this._data = null;
    this._error = null;
    this._setup = null;
    this._busy = false;
    this._notesOpen = false;
    this.consumeContext(UMB_NOTIFICATION_CONTEXT, (ctx) => (this.#notifications = ctx));
    this.consumeContext(UMB_AUTH_CONTEXT, (ctx) => {
      if (!ctx) return;
      this.#auth = ctx;
      this.#load();
    });
  }

  /** Loads the overview again, for example after settings changed on Tool Permissions. */
  reload() {
    if (this.#auth) this.#load();
  }

  async #load() {
    const seq = ++this.#seq;
    const setup = this.#loadSetup();
    try {
      const data = await request(this.#auth, "GET", "overview");
      if (seq !== this.#seq) return;
      this._data = data;
      this._error = null;
    } catch (error) {
      if (seq !== this.#seq) return;
      this._error = error.message;
    }
    await setup;
  }

  async #loadSetup() {
    try {
      this._setup = await request(this.#auth, "GET", "client-setup");
    } catch {
      // Fallback for takenClientIds only.
    }
  }

  /** The API users whose MCP server has connected; rows created on the dashboard that haven't are left out. */
  #connectedUsers() {
    return this._data.apiUsers.filter((u) => u.connected !== false);
  }

  #user(key) {
    return this._data.apiUsers.find((u) => u.key === key);
  }

  async #forget(key) {
    const user = this.#user(key);
    try {
      await umbConfirmModal(this, {
        headline: `Forget ${user?.name ?? "this"} connection?`,
        content:
          user?.connected === false
            ? "It is no longer listed here. The API user is not deleted."
            : "This does not delete the API user. It appears here again the next time its MCP server connects.",
        confirmLabel: "Forget",
        color: "danger",
      });
    } catch {
      return;
    }
    this._busy = true;
    try {
      await request(this.#auth, "DELETE", `connections/${encodeURIComponent(key)}`);
      await this.#load();
    } catch (error) {
      this.#notifications?.peek("danger", { data: { headline: "Could not forget the connection", message: error.message } });
    } finally {
      this._busy = false;
    }
  }

  async #showInfo(key) {
    const user = this.#user(key);
    if (!user) return;
    try {
      await umbOpenModal(this, UMBRELLA_API_USER_INFO_MODAL, {
        data: { user, products: this._data.products, addonVersion: this._data.addonVersion },
      });
    } catch {
      // Closed.
    }
  }

  /** Every client id an API user already has, so a new one can't clash. */
  #takenClientIds() {
    const fromSetup = (this._setup?.apiUsers ?? []).flatMap((u) => u.clientIds ?? []);
    const fromOverview = (this._data?.apiUsers ?? []).flatMap((u) => u.clientIds ?? []);
    return [...new Set([...fromSetup, ...fromOverview])];
  }

  async #newConnection() {
    const products = this._data.products.filter((p) => p.installed && p.enabled);
    try {
      await umbOpenModal(this, UMBRELLA_NEW_CONNECTION_MODAL, { data: { products, takenClientIds: this.#takenClientIds() } });
    } catch {
      // Closed before Done; a user may still have been created, so reload below.
    }
    await this.#load();
  }

  async #openConnect(userKey) {
    const user = userKey ? this.#user(userKey) : null;
    const clientId = user?.clientIds?.[0] ?? undefined;
    let result;
    try {
      result = await umbOpenModal(this, UMBRELLA_CONNECT_MODAL, {
        data: { clientId, canManageUsers: this._data?.canManageUsers === true },
      });
    } catch {
      return;
    }
    if (result?.action === "new-connection") {
      await this.#newConnection();
    }
  }

  async #newSecret(key) {
    const user = this.#user(key);
    if (!user) return;
    const takenClientIds = this.#takenClientIds();
    try {
      await umbOpenModal(this, UMBRELLA_NEW_SECRET_MODAL, { data: { user, takenClientIds } });
    } catch {
      // Closed without a new secret; something may still have changed, so reload below.
    }
    await this.#load();
  }

  async #toggleDisabled(key) {
    const user = this.#user(key);
    if (!user) return;
    const disable = user.state === "active";
    if (disable) {
      try {
        await umbConfirmModal(this, {
          headline: `Disable ${user.name}?`,
          content: "Its AI tool can no longer sign in. You can enable it again later.",
          confirmLabel: "Disable",
          color: "danger",
        });
      } catch {
        return;
      }
    }
    this._busy = true;
    try {
      await (disable ? disableUser : enableUser)(this.#auth, key);
      await this.#load();
    } catch (error) {
      this.#notifications?.peek("danger", {
        data: { headline: disable ? "Could not disable the API user" : "Could not enable the API user", message: error.message },
      });
    } finally {
      this._busy = false;
    }
  }

  #editPermissions(key, productId) {
    this.dispatchEvent(new CustomEvent("umbrella-edit-permissions", { detail: { key, productId }, bubbles: true, composed: true }));
  }

  #renderStatus() {
    const { findings } = this._data;
    const apiUsers = this.#connectedUsers();
    const latest = apiUsers.reduce((a, u) => (!a || u.lastConnected > a.lastConnected ? u : a), null);
    const warnings = findings.filter((f) => f.severity === "warning");
    const notes = findings.filter((f) => f.severity === "info" && !(f.area === "apiUsers" && apiUsers.length === 0));
    const attention = warnings.length > 0;
    const users = apiUsers.length;
    const headline = attention
      ? `${warnings.length} ${warnings.length === 1 ? "thing needs" : "things need"} attention`
      : users === 0
        ? "Ready to connect"
        : "Everything is working";
    const lead = attention
      ? "AI tools may be missing tools until these are fixed."
      : users === 0
        ? "The add-on is installed. Create a new connection or open Client setup to start using MCP with this site."
        : html`${users} API ${users === 1 ? "user has" : "users have"} connected through MCP${latest
            ? html` <span class="sep">·</span> Last connected <span title=${formatDate(latest.lastConnected)}>${formatRelative(latest.lastConnected)}</span> by <strong>${latest.name}</strong>`
            : nothing}.`;
    const areas = Object.keys(AREAS).filter((a) => warnings.some((f) => f.area === a));

    return html`<uui-box class="status ${attention ? "attention" : users === 0 ? "ready" : "ok"}">
      <div class="status-head" role="status">
        <span class="status-icon">
          <umb-icon name=${attention ? "icon-alert" : users === 0 ? "icon-wall-plug" : "icon-check"}></umb-icon>
        </span>
        <div class="status-text">
          <h2>${headline}</h2>
          <p>${lead}</p>
        </div>
        <div class="status-actions">
          ${notes.length > 0
            ? html`<uui-button
                look="secondary"
                compact
                label=${this._notesOpen ? `Hide ${notes.length} ${notes.length === 1 ? "note" : "notes"}` : `${notes.length} ${notes.length === 1 ? "note" : "notes"}`}
                @click=${() => (this._notesOpen = !this._notesOpen)}
              >
                <umb-icon name="icon-info"></umb-icon>
                ${notes.length} ${notes.length === 1 ? "note" : "notes"}
                <uui-symbol-expand ?open=${this._notesOpen}></uui-symbol-expand>
              </uui-button>`
            : nothing}
          ${attention
            ? html`<uui-button
                look="secondary"
                compact
                label="Open health checks"
                href="/umbraco/section/settings/dashboard/health-check"
              ></uui-button>`
            : nothing}
        </div>
      </div>
      ${attention
        ? html`<div class="findings">
            ${areas.map(
              (a) => html`<div class="finding-group">
                <h3>${AREAS[a]}</h3>
                <ul>
                  ${warnings.filter((f) => f.area === a).map((f) => html`<li>${f.message}</li>`)}
                </ul>
              </div>`,
            )}
          </div>`
        : nothing}
      ${this._notesOpen && notes.length > 0
        ? html`<div class="notes-panel">
            <ul>
              ${notes.map((f) => html`<li>${f.message}</li>`)}
            </ul>
          </div>`
        : nothing}
    </uui-box>`;
  }

  /** Installed & enabled products and their default access levels, with a prominent Edit default permissions action. */
  #renderDefaultProducts() {
    const activeProducts = this._data.products.filter((p) => p.installed && p.enabled);
    return html`<uui-box headline="Default permissions" headline-variant="h2">
      <div slot="header-actions">
        <uui-button look="secondary" label="Edit default permissions" @click=${() => this.#editPermissions("")}>
          <umb-icon name="icon-edit"></umb-icon> Edit default permissions
        </uui-button>
      </div>
      <div class="products-grid">
        ${activeProducts.map(
          (p) => html`<div class="product-card ${p.access === "off" ? "is-off" : ""}">
            <div class="product-card-top">
              <span class="product-card-name">${p.displayName}</span>
              ${p.version ? html`<span class="product-card-version">${p.version}</span>` : nothing}
            </div>
            <div class="product-card-bottom">
              <span class="product-card-level">
                ${levelGlyph(p.access)}
                <span>${LEVEL_LABELS[p.access] ?? LEVEL_LABELS.full}</span>
              </span>
            </div>
          </div>`,
        )}
      </div>
    </uui-box>`;
  }

  #renderUsers() {
    const { apiUsers, products, canManageUsers } = this._data;
    const connectBtn = (look = "secondary") =>
      html`<uui-button look=${look} label="Client setup" @click=${() => this.#openConnect()}>
        <umb-icon name="icon-code"></umb-icon> Client setup
      </uui-button>`;
    const newConnectionBtn = (look = "primary") =>
      html`<uui-button look=${look} label="New connection" @click=${this.#newConnection}>
        <umb-icon name="icon-add"></umb-icon> New connection
      </uui-button>`;

    return html`<uui-box id="users" headline="Connections" headline-variant="h2">
      <div slot="header-actions" class="header-actions">
        ${connectBtn("secondary")}
        ${canManageUsers && apiUsers.length > 0 ? newConnectionBtn("primary") : nothing}
      </div>
      ${apiUsers.length === 0
        ? html`<div class="empty">
            <span class="empty-icon"><umb-icon name="icon-users"></umb-icon></span>
            <h3>No MCP server has connected yet</h3>
            <p class="muted">
              ${canManageUsers
                ? "Create a new connection to set up an API user with client credentials and product access, or generate the config for an existing API user."
                : "When an AI tool starts the MCP server, the API user it signs in as appears here along with the tools it receives."}
            </p>
            <div class="empty-actions">
              ${canManageUsers ? newConnectionBtn("primary") : nothing}
              ${connectBtn(canManageUsers ? "secondary" : "primary")}
            </div>
          </div>`
        : html`<umbrella-access-table
            .users=${apiUsers}
            .products=${products}
            .busy=${this._busy}
            .canManageUsers=${canManageUsers === true}
            @edit-permissions=${(e) => this.#editPermissions(e.detail.key)}
            @info=${(e) => this.#showInfo(e.detail.key)}
            @new-secret=${(e) => this.#newSecret(e.detail.key)}
            @toggle-disabled=${(e) => this.#toggleDisabled(e.detail.key)}
            @forget=${(e) => this.#forget(e.detail.key)}
          ></umbrella-access-table>`}
    </uui-box>`;
  }

  render() {
    if (this._error) return html`<uui-box headline="Umbrella"><p>Could not load the overview: ${this._error}</p></uui-box>`;
    if (!this._data) return html`<div class="loader-wrap"><uui-loader></uui-loader></div>`;
    return html`${this.#renderStatus()} ${this.#renderDefaultProducts()} ${this.#renderUsers()}`;
  }

  static styles = [
    UmbTextStyles,
    glyphStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        gap: var(--uui-size-layout-1);
        padding: var(--uui-size-layout-1);
      }
      h2,
      h3 {
        margin: 0;
      }
      .muted {
        color: var(--uui-color-text-alt);
        margin: 0;
      }
      .small {
        font-size: var(--uui-type-small-size);
      }
      .sep {
        margin: 0 2px;
        opacity: 0.6;
      }
      .loader-wrap {
        display: flex;
        justify-content: center;
        padding: var(--uui-size-layout-2);
      }

      .status {
        border-left: 4px solid var(--uui-color-positive-standalone);
      }
      .status.ready {
        border-left-color: var(--uui-color-interactive-emphasis);
      }
      .status.attention {
        border-left-color: var(--uui-color-warning-standalone);
      }
      .status-head {
        display: flex;
        align-items: center;
        gap: var(--uui-size-space-4);
        flex-wrap: wrap;
      }
      .status-icon {
        display: inline-grid;
        place-items: center;
        flex: none;
        width: 2.5rem;
        height: 2.5rem;
        border-radius: 50%;
        font-size: 1.25rem;
        color: var(--uui-color-positive-contrast);
        background: var(--uui-color-positive-standalone);
      }
      .ready .status-icon {
        color: var(--uui-color-interactive-contrast);
        background: var(--uui-color-interactive-emphasis);
      }
      .attention .status-icon {
        color: var(--uui-color-warning-contrast);
        background: var(--uui-color-warning-standalone);
      }
      .status-text {
        flex: 1 1 18rem;
        min-width: 0;
      }
      .status-text h2 {
        font-size: var(--uui-type-h5-size, 1.125rem);
      }
      .status-text p {
        margin: 2px 0 0;
        color: var(--uui-color-text-alt);
      }
      .status-text strong {
        color: var(--uui-color-text);
      }
      .status-actions {
        display: flex;
        align-items: center;
        gap: var(--uui-size-space-2);
        flex-wrap: wrap;
      }

      .findings {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
        gap: var(--uui-size-space-3);
        margin-top: var(--uui-size-space-4);
      }
      .finding-group {
        padding: var(--uui-size-space-3) var(--uui-size-space-4);
        border-radius: var(--uui-border-radius);
        background: var(--uui-color-surface-alt);
        border: 1px solid var(--uui-color-divider);
      }
      .finding-group h3 {
        font-size: var(--uui-type-small-size);
        color: var(--uui-color-text-alt);
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .finding-group ul {
        margin: var(--uui-size-space-2) 0 0;
        padding-left: 1.15em;
      }
      .finding-group li {
        margin-bottom: var(--uui-size-space-1);
        font-size: var(--uui-type-small-size);
      }

      .notes-panel {
        margin-top: var(--uui-size-space-4);
        padding: var(--uui-size-space-3) var(--uui-size-space-4);
        border-radius: var(--uui-border-radius);
        background: var(--uui-color-surface-alt);
        border: 1px solid var(--uui-color-divider);
      }
      .notes-panel ul {
        margin: 0;
        padding-left: 1.15em;
      }
      .notes-panel li {
        color: var(--uui-color-text-alt);
        font-size: var(--uui-type-small-size);
        margin-bottom: var(--uui-size-space-1);
      }

      .products-grid {
        display: flex;
        flex-wrap: wrap;
        gap: var(--uui-size-space-3);
      }
      .product-card {
        flex: 1 1 13rem;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        gap: var(--uui-size-space-3);
        padding: var(--uui-size-space-3) var(--uui-size-space-4);
        border: 1px solid var(--uui-color-border);
        border-radius: var(--uui-border-radius);
        background: var(--uui-color-surface-alt);
      }
      .product-card-top {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: var(--uui-size-space-2);
      }
      .product-card-name {
        font-weight: 700;
      }
      .product-card-version {
        font-size: var(--uui-type-small-size);
        color: var(--uui-color-text-alt);
        font-variant-numeric: tabular-nums;
      }
      .product-card-bottom {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--uui-size-space-2);
      }
      .product-card-level {
        display: inline-flex;
        align-items: center;
        gap: var(--uui-size-space-2);
        font-weight: 600;
        font-size: var(--uui-type-small-size);
      }
      .product-card.is-off .product-card-level {
        color: var(--uui-color-text-alt);
        font-weight: normal;
      }

      .header-actions {
        display: flex;
        align-items: center;
        gap: var(--uui-size-space-2);
        flex-wrap: wrap;
      }

      .empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        gap: var(--uui-size-space-2);
        padding: var(--uui-size-layout-2) var(--uui-size-space-5);
      }
      .empty-icon {
        display: inline-grid;
        place-items: center;
        width: 3.5rem;
        height: 3.5rem;
        border-radius: 50%;
        background: var(--uui-color-surface-alt);
        color: var(--uui-color-text-alt);
        font-size: 1.75rem;
        margin-bottom: var(--uui-size-space-2);
      }
      .empty p {
        margin: 0;
        max-width: 54ch;
      }
      .empty-actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: var(--uui-size-space-2);
        margin-top: var(--uui-size-space-4);
      }
    `,
  ];
}

customElements.define("umbrella-overview", UmbrellaOverviewElement);
export default UmbrellaOverviewElement;
