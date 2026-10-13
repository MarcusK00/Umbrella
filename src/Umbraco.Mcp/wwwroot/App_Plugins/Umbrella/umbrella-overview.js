import { css, html, nothing } from "@umbraco-cms/backoffice/external/lit";
import { UmbLitElement } from "@umbraco-cms/backoffice/lit-element";
import { UMB_AUTH_CONTEXT } from "@umbraco-cms/backoffice/auth";
import { UMB_NOTIFICATION_CONTEXT } from "@umbraco-cms/backoffice/notification";
import { umbConfirmModal } from "@umbraco-cms/backoffice/modal";
import { UmbTextStyles } from "@umbraco-cms/backoffice/style";
import { request } from "./umbrella-api.js";
import "./umbrella-user-card.js";

/**
 * Settings → Umbrella → Overview: a status line (all good, or what needs attention), the API users MCP servers have
 * connected as with the access each gets, and how to connect an AI tool as a chosen API user.
 */
export class UmbrellaOverviewElement extends UmbLitElement {
  static properties = {
    _data: { state: true },
    _error: { state: true },
    _setup: { state: true },
    _setupError: { state: true },
    _client: { state: true },
    _busy: { state: true },
    _showFindings: { state: true },
    _connectOpen: { state: true },
  };

  #auth;
  #notifications;

  constructor() {
    super();
    this._data = null;
    this._error = null;
    this._setup = null;
    this._setupError = null;
    this._client = null;
    this._busy = false;
    this._showFindings = true;
    // null until the user opens or closes it; until then it follows #connectOpenByDefault().
    this._connectOpen = null;
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
    const setup = this.#loadSetup(this._setup?.clientId);
    try {
      this._data = await request(this.#auth, "GET", "overview");
      this._error = null;
    } catch (error) {
      this._error = error.message;
    }
    await setup;
  }

  /**
   * The client config filled in with `clientId`, or with the configured client id when there is none. A client id
   * that no API user has any more falls back to the configured one.
   */
  async #loadSetup(clientId) {
    try {
      const query = clientId ? `?clientId=${encodeURIComponent(clientId)}` : "";
      this._setup = await request(this.#auth, "GET", `client-setup${query}`);
      this._setupError = null;
    } catch (error) {
      if (clientId) return this.#loadSetup();
      this._setupError = error.message;
    }
  }

  async #copy(content) {
    try {
      await navigator.clipboard.writeText(content);
      this.#notifications?.peek("positive", { data: { message: "Copied" } });
    } catch {
      this.#notifications?.peek("danger", { data: { message: "Could not copy. Select the text and copy it by hand." } });
    }
  }

  async #forget(key) {
    const user = this._data.apiUsers.find((u) => u.key === key);
    try {
      await umbConfirmModal(this, {
        headline: `Forget ${user?.name ?? "this"} connection?`,
        content: "This does not delete the API user. It appears here again the next time its MCP server connects.",
        confirmLabel: "Forget",
        color: "danger",
      });
    } catch {
      return; // Cancelled.
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

  #editPermissions(key) {
    this.dispatchEvent(new CustomEvent("umbrella-edit-permissions", { detail: { key }, bubbles: true, composed: true }));
  }

  /** Open when nobody has connected yet, or when something about the server or the API users needs attention. */
  #connectOpenByDefault() {
    const { apiUsers, server, findings } = this._data;
    return apiUsers.length === 0 || server === null || findings.some((f) => f.severity === "warning" && f.area !== "products");
  }

  #openConnect() {
    this._connectOpen = true;
    this.updateComplete.then(() => this.shadowRoot.querySelector(".connect")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  /** Always one line: all good, or how many things need attention with the list below it. */
  #renderStatus() {
    const warnings = this._data.findings.filter((f) => f.severity === "warning");
    const users = this._data.apiUsers.length;
    if (warnings.length === 0) {
      const parts = [...(users === 0 ? [] : [`${users} MCP ${users === 1 ? "user" : "users"} connected`]), `add-on ${this._data.addonVersion}`];
      return html`<div class="status ok" role="status">
        <umb-icon name=${users === 0 ? "icon-info" : "icon-check"}></umb-icon>
        <span><strong>${users === 0 ? "Ready to connect" : "All good"}</strong> · ${parts.join(" · ")}</span>
      </div>`;
    }
    const headline = `${warnings.length} ${warnings.length === 1 ? "thing needs" : "things need"} attention`;
    return html`<div class="status attention" role="status">
      <div class="status-line">
        <umb-icon name="icon-alert"></umb-icon>
        <strong>${headline}</strong>
        <uui-button
          compact
          look="placeholder"
          label=${this._showFindings ? "Hide" : "Show"}
          @click=${() => (this._showFindings = !this._showFindings)}
        ></uui-button>
      </div>
      ${this._showFindings ? html`<ul class="findings">${warnings.map((f) => html`<li>${f.message}</li>`)}</ul>` : nothing}
    </div>`;
  }

  #renderUsers() {
    const { apiUsers } = this._data;
    return html`<section>
      <div class="section-head">
        <h3>MCP users</h3>
        ${apiUsers.length ? html`<span class="muted">${apiUsers.length} connected</span>` : nothing}
      </div>
      ${apiUsers.length === 0
        ? html`<div class="empty">
            <p>No MCP server has connected yet. Connect an AI tool, and the API user it signs in as shows up here.</p>
            <uui-button look="primary" label="Connect an AI tool" @click=${this.#openConnect}></uui-button>
          </div>`
        : html`<div
            class="users"
            @edit-permissions=${(e) => this.#editPermissions(e.detail.key)}
            @forget=${(e) => this.#forget(e.detail.key)}
          >
            ${apiUsers.map((u) => html`<umbrella-user-card .user=${u} .busy=${this._busy}></umbrella-user-card>`)}
          </div>`}
    </section>`;
  }

  /** One option per client id of each API user, plus the configured client id when no API user has it yet. */
  #renderClientIdPicker() {
    const { apiUsers, clientId, configuredClientId } = this._setup;
    const options = apiUsers.flatMap((u) => u.clientIds.map((id) => ({ name: `${u.name} (${id})`, value: id })));
    if (!options.some((o) => o.value === configuredClientId)) {
      options.unshift({ name: `${configuredClientId} (no API user has this client id yet)`, value: configuredClientId });
    }
    return html`<uui-select
      label="API user"
      .options=${options.map((o) => ({ ...o, selected: o.value === clientId }))}
      @change=${(e) => this.#loadSetup(e.target.value)}
    ></uui-select>`;
  }

  #renderConnectSteps() {
    if (!this._setup) {
      return this._setupError
        ? html`<p class="warning">Could not load the client config: ${this._setupError}</p>`
        : html`<uui-loader></uui-loader>`;
    }
    const { clients } = this._setup;
    const selected = clients.find((c) => c.id === this._client) ?? clients[0];
    const insecure = /UMBRACO_BASE_URL["'=:\s]+http:\/\//.test(clients[0]?.content ?? "");
    return html`<ol class="steps">
      <li>
        <span class="step-label">Sign in as</span>
        <div>
          ${this.#renderClientIdPicker()}
          <p class="muted hint">
            Give each person their own API user and its client secret. They need Node.js 22 or later.
          </p>
        </div>
      </li>
      <li>
        <span class="step-label">AI tool</span>
        <uui-tab-group>
          ${clients.map(
            (c) => html`<uui-tab label=${c.label} ?active=${c.id === selected?.id} @click=${() => (this._client = c.id)}></uui-tab>`,
          )}
        </uui-tab-group>
      </li>
      <li>
        <span class="step-label">Copy</span>
        <div class="snippet">
          ${insecure
            ? html`<p class="warning">
                The MCP server needs HTTPS. Open the backoffice over https, or change UMBRACO_BASE_URL below to the site's https address.
              </p>`
            : nothing}
          ${selected
            ? html`<div class="snippet-head">
                  <span class="muted">${selected.format === "shell" ? "Run in a terminal" : selected.fileName}</span>
                  <uui-button look="primary" compact label="Copy" @click=${() => this.#copy(selected.content)}></uui-button>
                </div>
                <pre>${selected.content}</pre>`
            : nothing}
        </div>
      </li>
    </ol>`;
  }

  #renderConnect() {
    const open = this._connectOpen ?? this.#connectOpenByDefault();
    return html`<section class="connect">
      <div class="section-head">
        <h3>Connect an AI tool</h3>
        <uui-button
          look="secondary"
          compact
          label=${open ? "Close" : "Open"}
          aria-expanded=${open ? "true" : "false"}
          @click=${() => (this._connectOpen = !open)}
        ></uui-button>
      </div>
      ${open
        ? this.#renderConnectSteps()
        : html`<p class="muted">The config for Claude Code, Claude Desktop, VS Code, Cursor and other MCP clients, signed in as an API user you pick.</p>`}
    </section>`;
  }

  render() {
    if (this._error) return html`<uui-box headline="Umbrella"><p>Could not load the overview: ${this._error}</p></uui-box>`;
    if (!this._data) return html`<uui-loader></uui-loader>`;
    return html`${this.#renderStatus()} ${this.#renderUsers()} ${this.#renderConnect()}`;
  }

  static styles = [
    UmbTextStyles,
    css`
      :host { display: flex; flex-direction: column; gap: var(--uui-size-layout-1); padding: var(--uui-size-layout-1); }
      h3 { margin: 0; }
      .muted { color: var(--uui-color-text-alt); margin: 0; }
      .warning { color: var(--uui-color-warning-standalone); margin: 0 0 var(--uui-size-space-3); }
      .status {
        padding: var(--uui-size-space-4) var(--uui-size-space-5);
        border-radius: var(--uui-border-radius);
        border: 1px solid var(--uui-color-border);
        background: var(--uui-color-surface);
      }
      .status.ok { display: flex; align-items: center; gap: var(--uui-size-space-3); }
      .status.ok umb-icon { color: var(--uui-color-positive-standalone); }
      .status.attention { border-color: var(--uui-color-warning-standalone); }
      .status-line { display: flex; align-items: center; gap: var(--uui-size-space-3); }
      .status-line umb-icon { color: var(--uui-color-warning-standalone); }
      .findings { margin: var(--uui-size-space-3) 0 0; padding-left: calc(var(--uui-size-space-3) + 1.2em); }
      .findings li { margin-bottom: var(--uui-size-space-2); }
      section { display: flex; flex-direction: column; gap: var(--uui-size-space-4); }
      .section-head { display: flex; align-items: center; justify-content: space-between; gap: var(--uui-size-space-3); }
      .users { display: flex; flex-direction: column; gap: var(--uui-size-space-3); }
      .empty {
        display: flex; flex-direction: column; align-items: flex-start; gap: var(--uui-size-space-3);
        padding: var(--uui-size-space-5); border: 1px dashed var(--uui-color-border-emphasis); border-radius: var(--uui-border-radius);
      }
      .empty p { margin: 0; }
      .steps {
        list-style: none; counter-reset: step; margin: 0; padding: var(--uui-size-space-5);
        display: flex; flex-direction: column; gap: var(--uui-size-space-5);
        border: 1px solid var(--uui-color-border); border-radius: var(--uui-border-radius); background: var(--uui-color-surface);
      }
      .steps > li { counter-increment: step; display: grid; grid-template-columns: 9rem minmax(0, 1fr); gap: var(--uui-size-space-4); align-items: start; }
      .step-label { display: flex; align-items: center; gap: var(--uui-size-space-2); font-weight: 600; padding-top: var(--uui-size-space-2); }
      .step-label::before {
        content: counter(step); display: inline-grid; place-items: center; width: 1.5em; height: 1.5em; border-radius: 50%;
        background: var(--uui-color-current); color: var(--uui-color-current-contrast); font-size: var(--uui-type-small-size);
      }
      @media (max-width: 48rem) { .steps > li { grid-template-columns: minmax(0, 1fr); } }
      uui-select { min-width: 20rem; max-width: 100%; }
      .hint { margin-top: var(--uui-size-space-2); font-size: var(--uui-type-small-size); }
      uui-tab-group { flex-wrap: wrap; }
      .snippet-head { display: flex; justify-content: space-between; align-items: center; gap: var(--uui-size-space-3); margin-bottom: var(--uui-size-space-2); }
      pre {
        margin: 0; overflow-x: auto; padding: var(--uui-size-space-4);
        background: var(--uui-color-surface-alt); border-radius: var(--uui-border-radius); white-space: pre;
      }
    `,
  ];
}

customElements.define("umbrella-overview", UmbrellaOverviewElement);
export default UmbrellaOverviewElement;
