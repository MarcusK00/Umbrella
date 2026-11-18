import { css, html, nothing } from "@umbraco-cms/backoffice/external/lit";
import { UMB_AUTH_CONTEXT } from "@umbraco-cms/backoffice/auth";
import { UmbModalBaseElement, UmbModalToken } from "@umbraco-cms/backoffice/modal";
import { UmbTextStyles } from "@umbraco-cms/backoffice/style";
import { request } from "./umbrella-api.js";
import "./umbrella-client-setup.js";

/**
 * Sidebar modal token for Client setup (MCP configuration snippets for an existing API user).
 * Kept in its own module so released modules in `umbrella-modals.js` keep their exact export surface.
 */
export const UMBRELLA_CONNECT_MODAL = new UmbModalToken("Umbrella.Modal.Connect", {
  modal: { type: "sidebar", size: "medium" },
});

/**
 * Sidebar modal for generating and copying the MCP client configuration for any existing API user.
 * Data: `{ clientId?, canManageUsers? }`.
 * Submits `{ action: "new-connection" }` if the user chooses to create a new API user instead.
 */
export class UmbrellaConnectModalElement extends UmbModalBaseElement {
  static properties = {
    _setup: { state: true },
    _error: { state: true },
    _loading: { state: true },
  };

  #auth;

  constructor() {
    super();
    this._setup = null;
    this._error = null;
    this._loading = true;
    this.consumeContext(UMB_AUTH_CONTEXT, (ctx) => {
      if (!ctx || this.#auth) return;
      this.#auth = ctx;
      this.#loadSetup(this.data?.clientId);
    });
  }

  async #loadSetup(clientId) {
    this._loading = true;
    try {
      const query = clientId ? `?clientId=${encodeURIComponent(clientId)}` : "";
      this._setup = await request(this.#auth, "GET", `client-setup${query}`);
      this._error = null;
    } catch (error) {
      if (clientId) {
        await this.#loadSetup();
        return;
      }
      this._error = error.message;
    } finally {
      this._loading = false;
    }
  }

  #createNewUser() {
    this.value = { action: "new-connection" };
    this._submitModal();
  }

  #renderClientIdPicker() {
    const { apiUsers, clientId, configuredClientId } = this._setup;
    const options = apiUsers.flatMap((u) => u.clientIds.map((id) => ({ name: `${u.name} (${id})`, value: id })));
    if (!options.some((o) => o.value === configuredClientId)) {
      options.unshift({ name: `${configuredClientId} (no API user has this client id yet)`, value: configuredClientId });
    }
    return html`<uui-select
      id="connect-user-select"
      label="API user"
      .options=${options.map((o) => ({ ...o, selected: o.value === clientId }))}
      @change=${(e) => this.#loadSetup(e.target.value)}
    ></uui-select>`;
  }

  render() {
    const canManageUsers = this.data?.canManageUsers === true;
    const userName = this._setup?.apiUsers?.find((u) => u.clientIds.includes(this._setup.clientId))?.name ?? null;

    return html`<umb-body-layout headline="Client setup">
      <div class="content">
        <uui-box>
          <p class="intro">
            Generate the MCP configuration snippet for Claude Code, Claude Desktop, VS Code, Cursor, Codex, Antigravity, or another MCP client
            signed in as an existing API user.
          </p>
          ${this._loading && !this._setup
            ? html`<div class="loader-wrap"><uui-loader></uui-loader></div>`
            : this._error
              ? html`<div class="error-banner">
                  <umb-icon name="icon-alert"></umb-icon>
                  <span>Could not load the client configuration: ${this._error}</span>
                </div>`
              : html`<umbrella-client-setup stacked .setup=${this._setup} .userName=${userName}>
                  <div class="field" slot="choose">
                    <div class="step-head">
                      <span class="num">1</span>
                      <uui-label for="connect-user-select">Sign in as API user</uui-label>
                    </div>
                    ${this.#renderClientIdPicker()}
                    <div class="user-hint">
                      <span class="muted small">
                        Give each person or agent their own API user so their permissions can be managed independently.
                      </span>
                      ${canManageUsers
                        ? html`<uui-button
                            look="secondary"
                            compact
                            label="Create a new API user"
                            @click=${this.#createNewUser}
                          >
                            <umb-icon name="icon-add"></umb-icon> Create a new API user
                          </uui-button>`
                        : html`<span class="muted small">An administrator with access to the Users section can create one with New connection.</span>`}
                    </div>
                  </div>
                </umbrella-client-setup>`}
        </uui-box>
      </div>
      <div slot="actions">
        <uui-button look="primary" label="Close" @click=${() => this._rejectModal()}></uui-button>
      </div>
    </umb-body-layout>`;
  }

  static styles = [
    UmbTextStyles,
    css`
      .content {
        display: flex;
        flex-direction: column;
        gap: var(--uui-size-space-4);
      }
      .intro {
        margin: 0 0 var(--uui-size-space-5);
        color: var(--uui-color-text-alt);
      }
      .loader-wrap {
        display: flex;
        justify-content: center;
        padding: var(--uui-size-layout-1);
      }
      .error-banner {
        display: flex;
        align-items: center;
        gap: var(--uui-size-space-3);
        padding: var(--uui-size-space-3) var(--uui-size-space-4);
        border-radius: var(--uui-border-radius);
        background: var(--uui-color-danger);
        color: var(--uui-color-danger-contrast);
      }
      .field {
        display: flex;
        flex-direction: column;
        gap: var(--uui-size-space-3);
      }
      .step-head {
        display: flex;
        align-items: center;
        gap: var(--uui-size-space-3);
      }
      .step-head uui-label {
        font-weight: 700;
        font-size: var(--uui-type-default-size);
      }
      .num {
        display: inline-grid;
        place-items: center;
        flex: none;
        width: 1.6rem;
        height: 1.6rem;
        border-radius: 50%;
        background: var(--uui-color-current);
        color: var(--uui-color-current-contrast);
        font-size: var(--uui-type-small-size);
        font-weight: 700;
      }
      uui-select {
        width: 100%;
      }
      .user-hint {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--uui-size-space-2);
        padding: var(--uui-size-space-3);
        border-radius: var(--uui-border-radius);
        background: var(--uui-color-surface-alt);
      }
      .muted {
        color: var(--uui-color-text-alt);
      }
      .small {
        font-size: var(--uui-type-small-size);
      }
    `,
  ];
}

customElements.define("umbrella-connect-modal", UmbrellaConnectModalElement);
export default UmbrellaConnectModalElement;
