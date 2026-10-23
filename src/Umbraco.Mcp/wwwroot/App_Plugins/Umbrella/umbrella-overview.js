import { css, html, nothing } from "@umbraco-cms/backoffice/external/lit";
import { UmbLitElement } from "@umbraco-cms/backoffice/lit-element";
import { UMB_AUTH_CONTEXT } from "@umbraco-cms/backoffice/auth";
import { UMB_NOTIFICATION_CONTEXT } from "@umbraco-cms/backoffice/notification";
import { umbConfirmModal } from "@umbraco-cms/backoffice/modal";
import { UmbTextStyles } from "@umbraco-cms/backoffice/style";
import { formatDate, request } from "./umbrella-api.js";
import { formatRelative } from "./umbrella-access.js";
import "./umbrella-access-table.js";

const AREAS = { products: "Products", server: "MCP server", apiUsers: "API users" };

/** McpClientConfig.SecretEnvironmentVariable. */
const SECRET_VARIABLE = "UMBRELLA_CLIENT_SECRET";

/**
 * Per AI tool from McpClientSnippets: its icon, where the config goes, and how the secret gets in: "env" (read from
 * SECRET_VARIABLE), "prompt" (the tool asks) or "placeholder" (replaced by hand).
 */
const CLIENTS = {
  "claude-code": { icon: "icon-terminal", where: "Put the file in the folder you open in Claude Code.", secret: "env" },
  "claude-code-cli": {
    icon: "icon-terminal",
    where: "Run it in the folder you open in Claude Code. Claude Code keeps the server in your own settings.",
    secret: "placeholder",
  },
  "claude-desktop": {
    icon: "icon-application-window",
    where: "In Claude Desktop, open Settings → Developer → Edit Config, and add the server to that file.",
    secret: "placeholder",
  },
  vscode: { icon: "icon-code", where: "The path is relative to your project folder.", secret: "prompt" },
  cursor: { icon: "icon-code", where: "The path is relative to your project folder.", secret: "env" },
  other: { icon: "icon-brackets", where: "Add it to your MCP client's configuration. It uses the common mcpServers format.", secret: "placeholder" },
};

/**
 * Settings → Umbrella → Overview: a status banner (all good, or what needs attention, with the versions in play), the
 * access table of the API users MCP servers have connected as, and how to connect an AI tool as a chosen API user.
 */
export class UmbrellaOverviewElement extends UmbLitElement {
  static properties = {
    _data: { state: true },
    _error: { state: true },
    _setup: { state: true },
    _setupError: { state: true },
    _client: { state: true },
    _busy: { state: true },
    _connectOpen: { state: true },
    _notesOpen: { state: true },
  };

  #auth;
  #notifications;
  // Bumped on each load; a response from an older load is dropped.
  #seq = 0;

  constructor() {
    super();
    this._data = null;
    this._error = null;
    this._setup = null;
    this._setupError = null;
    this._client = null;
    this._busy = false;
    // null until the user opens or closes it; until then it follows #connectOpenByDefault().
    this._connectOpen = null;
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
    const setup = this.#loadSetup(this._setup?.clientId);
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
    this.updateComplete.then(() => this.shadowRoot.querySelector("#connect")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  /** The versions in play and when an MCP server last started, under the status headline. */
  #renderFacts() {
    const { addonVersion, server, apiUsers } = this._data;
    const latest = apiUsers.map((u) => u.lastConnected).sort().at(-1);
    return html`<dl class="facts">
      <div><dt>Add-on</dt><dd>${addonVersion}</dd></div>
      <div>
        <dt>MCP server</dt>
        <dd>
          ${server
            ? html`umbrella-mcp ${server.version}
              ${server.matchesAddon ? nothing : html`<uui-tag color="warning" look="primary">Version differs</uui-tag>`}`
            : html`<span class="muted">Not reported yet</span>`}
        </dd>
      </div>
      <div>
        <dt>Last connection</dt>
        <dd>${latest ? html`<span title=${formatDate(latest)}>${formatRelative(latest)}</span>` : html`<span class="muted">None yet</span>`}</dd>
      </div>
    </dl>`;
  }

  /** All good (or ready to connect) with any notes, or what needs attention grouped by area. */
  #renderStatus() {
    const { findings, apiUsers } = this._data;
    const warnings = findings.filter((f) => f.severity === "warning");
    // The empty API users table already says nobody has connected.
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
        ? "The add-on is installed. Connect an AI tool to start using MCP with this site."
        : `${users} API ${users === 1 ? "user has" : "users have"} connected through MCP.`;
    const areas = Object.keys(AREAS).filter((a) => warnings.some((f) => f.area === a));
    return html`<uui-box class="status ${attention ? "attention" : users === 0 ? "ready" : "ok"}">
      <div class="status-head" role="status">
        <span class="status-icon"><umb-icon name=${attention ? "icon-alert" : users === 0 ? "icon-wall-plug" : "icon-check"}></umb-icon></span>
        <div class="status-text">
          <h2>${headline}</h2>
          <p>${lead}</p>
        </div>
        <div class="status-actions">
          ${attention
            ? html`<uui-button look="secondary" label="Open health checks" href="/umbraco/section/settings/dashboard/health-check"></uui-button>`
            : nothing}
          <uui-button look=${users === 0 ? "primary" : "secondary"} label="Connect an AI tool" @click=${this.#openConnect}></uui-button>
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
      ${this.#renderNotes(notes)}
      ${this.#renderFacts()}
    </uui-box>`;
  }

  /** Info findings, collapsed behind a small toggle: they are often on purpose (an API user for content only). */
  #renderNotes(notes) {
    if (!notes.length) return nothing;
    return html`<div class="notes">
      <button class="notes-toggle" aria-expanded=${this._notesOpen ? "true" : "false"} @click=${() => (this._notesOpen = !this._notesOpen)}>
        <umb-icon name="icon-info"></umb-icon>
        ${notes.length} ${notes.length === 1 ? "note" : "notes"}
        <umb-icon class="chevron" name=${this._notesOpen ? "icon-navigation-up" : "icon-navigation-down"}></umb-icon>
      </button>
      ${this._notesOpen ? html`<ul>${notes.map((f) => html`<li>${f.message}</li>`)}</ul>` : nothing}
    </div>`;
  }

  #renderUsers() {
    const { apiUsers, products } = this._data;
    return html`<uui-box id="users" headline="Access per API user" headline-variant="h2">
      ${apiUsers.length
        ? html`<span slot="header-actions" class="muted">${apiUsers.length} connected</span>`
        : nothing}
      ${apiUsers.length === 0
        ? html`<div class="empty">
            <umb-icon name="icon-users"></umb-icon>
            <p><strong>No MCP server has connected yet</strong></p>
            <p class="muted">When an AI tool starts the MCP server, the API user it signs in as appears here with the tools it gets.</p>
            <uui-button look="primary" label="Connect an AI tool" @click=${this.#openConnect}></uui-button>
          </div>`
        : html`<umbrella-access-table
            .users=${apiUsers}
            .products=${products}
            .busy=${this._busy}
            @edit-permissions=${(e) => this.#editPermissions(e.detail.key)}
            @forget=${(e) => this.#forget(e.detail.key)}
          ></umbrella-access-table>`}
    </uui-box>`;
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

  /** How the client secret gets into the selected AI tool's config. */
  #renderSecret(client, meta) {
    if (meta.secret === "env") {
      return html`<p>
          ${client.label} reads the client secret from the <code>${SECRET_VARIABLE}</code> environment variable. Set it before you
          start ${client.label}.
        </p>
        <code class="command">export ${SECRET_VARIABLE}="&lt;the client secret&gt;"</code>
        <p class="muted small">macOS and Linux. Add the line to your shell profile to keep it.</p>`;
    }
    if (meta.secret === "prompt") return html`<p>Nothing to add here: ${client.label} asks for the client secret when it starts the server.</p>`;
    return html`<p>
      Replace the placeholder with the API user's client secret. The ${client.format === "shell" ? "command" : "file"} then contains the
      secret, so keep it out of source control.
    </p>`;
  }

  #renderConnectSteps() {
    if (!this._setup) {
      return this._setupError
        ? html`<p class="warning"><umb-icon name="icon-alert"></umb-icon>Could not load the client config: ${this._setupError}</p>`
        : html`<uui-loader></uui-loader>`;
    }
    const { clients, apiUsers, clientId } = this._setup;
    const selected = clients.find((c) => c.id === this._client) ?? clients[0];
    const meta = CLIENTS[selected?.id] ?? CLIENTS.other;
    const userName = apiUsers.find((u) => u.clientIds.includes(clientId))?.name;
    const insecure = /UMBRACO_BASE_URL["'=:\s]+http:\/\//.test(clients[0]?.content ?? "");
    return html`<div class="connect">
      <div class="connect-choose">
        <div class="field">
          <h3><span class="num">1</span>Sign in as</h3>
          ${this.#renderClientIdPicker()}
          <p class="muted small">
            Give each person their own API user, so their access can be set on its own.
            <a href="/umbraco/section/user-management">Create an API user</a>
          </p>
        </div>
        <div class="field">
          <h3 id="tool-heading"><span class="num">2</span>AI tool</h3>
          <div class="tools" role="group" aria-labelledby="tool-heading">
            ${clients.map((c) => {
              const m = CLIENTS[c.id] ?? CLIENTS.other;
              return html`<button class="tool" aria-pressed=${c.id === selected?.id ? "true" : "false"} @click=${() => (this._client = c.id)}>
                <umb-icon name=${m.icon}></umb-icon>
                <span class="tool-text">
                  <span class="tool-name">${c.label}</span>
                  <span class="tool-sub">${c.format === "shell" ? "Terminal command" : c.fileName ?? "mcpServers config"}</span>
                </span>
              </button>`;
            })}
          </div>
          <p class="muted small">The MCP server runs with npx: the computer running the AI tool needs Node.js 22 or later.</p>
        </div>
      </div>
      ${selected
        ? html`<div class="connect-result">
            <div class="field">
              <h3><span class="num">3</span>${selected.format === "shell" ? "Run this command" : `Add this to ${selected.fileName ?? "the MCP configuration"}`}</h3>
              <p class="muted">${meta.where}</p>
              ${insecure
                ? html`<p class="warning">
                    <umb-icon name="icon-alert"></umb-icon>
                    The MCP server needs HTTPS. Open the backoffice over https, or change UMBRACO_BASE_URL below to the site's https address.
                  </p>`
                : nothing}
              <div class="snippet">
                <div class="snippet-head">
                  <span><umb-icon name=${selected.format === "shell" ? "icon-terminal" : "icon-document"}></umb-icon>${selected.format === "shell" ? "Terminal" : selected.fileName ?? "MCP configuration"}</span>
                  <uui-button look="primary" compact label="Copy" @click=${() => this.#copy(selected.content)}>
                    <umb-icon name="icon-documents"></umb-icon> Copy
                  </uui-button>
                </div>
                <pre tabindex="0" role="region" aria-label="${selected.label} configuration">${selected.content}</pre>
              </div>
            </div>
            <div class="field">
              <h3><span class="num">4</span>Add the client secret</h3>
              ${this.#renderSecret(selected, meta)}
            </div>
            <div class="field">
              <h3><span class="num">5</span>Restart ${selected.label.replace(/ \(command\)$/, "")}</h3>
              <p class="muted">
                It connects as ${userName ? html`<strong>${userName}</strong>` : "the API user"} and shows up in
                <a href="#" @click=${this.#scrollToUsers}>Access per API user</a>.
              </p>
            </div>
          </div>`
        : nothing}
    </div>`;
  }

  #scrollToUsers(e) {
    e.preventDefault();
    this.shadowRoot.querySelector("#users")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  #renderConnect() {
    const open = this._connectOpen ?? this.#connectOpenByDefault();
    return html`<uui-box id="connect" headline="Connect an AI tool" headline-variant="h2">
      <uui-button
        slot="header-actions"
        look="secondary"
        compact
        label=${open ? "Hide steps" : "Show steps"}
        @click=${() => (this._connectOpen = !open)}
      ></uui-button>
      ${open
        ? this.#renderConnectSteps()
        : html`<p class="muted">The config for Claude Code, Claude Desktop, VS Code, Cursor and other MCP clients, signed in as an API user you pick.</p>`}
    </uui-box>`;
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
      h2, h3 { margin: 0; }
      .muted { color: var(--uui-color-text-alt); margin: 0; }
      .small { font-size: var(--uui-type-small-size); }
      .warning { display: flex; align-items: center; gap: var(--uui-size-space-2); margin: 0 0 var(--uui-size-space-3); }
      .warning umb-icon { color: var(--uui-color-warning-standalone); flex: none; }

      .status { border-left: 4px solid var(--uui-color-positive-standalone); }
      .status.ready { border-left-color: var(--uui-color-interactive-emphasis); }
      .status.attention { border-left-color: var(--uui-color-warning-standalone); }
      .status-head { display: flex; align-items: center; gap: var(--uui-size-space-4); flex-wrap: wrap; }
      .status-icon {
        display: inline-grid; place-items: center; flex: none; width: 2.5rem; height: 2.5rem; border-radius: 50%;
        font-size: 1.25rem; color: var(--uui-color-positive-contrast); background: var(--uui-color-positive-standalone);
      }
      .ready .status-icon { color: var(--uui-color-interactive-contrast); background: var(--uui-color-interactive-emphasis); }
      .attention .status-icon { color: var(--uui-color-warning-contrast); background: var(--uui-color-warning-standalone); }
      .status-text { flex: 1 1 18rem; min-width: 0; }
      .status-text h2 { font-size: var(--uui-type-h5-size, 1.125rem); }
      .status-text p { margin: var(--uui-size-space-1) 0 0; color: var(--uui-color-text-alt); }
      .status-actions { display: flex; gap: var(--uui-size-space-2); flex-wrap: wrap; }
      .findings { display: grid; gap: var(--uui-size-space-4); margin-top: var(--uui-size-space-5); padding-left: calc(2.5rem + var(--uui-size-space-4)); }
      .finding-group h3 { font-size: var(--uui-type-small-size); color: var(--uui-color-text-alt); font-weight: 700; }
      .finding-group ul { margin: var(--uui-size-space-2) 0 0; padding-left: 1.1em; }
      .finding-group li { margin-bottom: var(--uui-size-space-2); max-width: 75ch; }
      .notes { margin: var(--uui-size-space-4) 0 0; padding-left: calc(2.5rem + var(--uui-size-space-4)); }
      .notes-toggle {
        display: inline-flex; align-items: center; gap: var(--uui-size-space-2); padding: 2px 0; border: 0; background: none;
        font: inherit; font-size: var(--uui-type-small-size); color: var(--uui-color-text-alt); cursor: pointer;
      }
      .notes-toggle:hover { color: var(--uui-color-interactive-emphasis); }
      .notes-toggle .chevron { font-size: 0.75em; }
      .notes ul { margin: var(--uui-size-space-2) 0 0; padding-left: 1.1em; }
      .notes li { color: var(--uui-color-text-alt); font-size: var(--uui-type-small-size); max-width: 75ch; margin-bottom: var(--uui-size-space-1); }
      .facts {
        display: flex; flex-wrap: wrap; gap: var(--uui-size-space-3) var(--uui-size-layout-2);
        margin: var(--uui-size-space-5) 0 0; padding: var(--uui-size-space-4) 0 0 calc(2.5rem + var(--uui-size-space-4));
        border-top: 1px solid var(--uui-color-divider);
      }
      .facts dt { font-size: var(--uui-type-small-size); color: var(--uui-color-text-alt); }
      .facts dd { margin: 2px 0 0; font-weight: 600; display: flex; align-items: center; gap: var(--uui-size-space-2); }
      @media (max-width: 48rem) { .findings, .notes, .facts { padding-left: 0; } }

      .empty { display: flex; flex-direction: column; align-items: center; text-align: center; gap: var(--uui-size-space-2); padding: var(--uui-size-layout-2) var(--uui-size-space-5); }
      .empty > umb-icon { font-size: 2rem; color: var(--uui-color-text-alt); }
      .empty p { margin: 0; max-width: 50ch; }
      .empty uui-button { margin-top: var(--uui-size-space-3); }

      .connect { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 3fr); gap: var(--uui-size-layout-1); align-items: start; }
      @media (max-width: 64rem) { .connect { grid-template-columns: minmax(0, 1fr); } }
      .connect-choose, .connect-result { display: flex; flex-direction: column; gap: var(--uui-size-space-6); min-width: 0; }
      .connect-result { padding: var(--uui-size-space-5); border-radius: var(--uui-border-radius); background: var(--uui-color-surface-alt); }
      .field { display: flex; flex-direction: column; align-items: stretch; gap: var(--uui-size-space-3); }
      .field > p { margin: 0; max-width: 70ch; }
      .field h3 { display: flex; align-items: center; gap: var(--uui-size-space-3); font-size: var(--uui-type-default-size); }
      .num {
        display: inline-grid; place-items: center; flex: none; width: 1.5rem; height: 1.5rem; border-radius: 50%;
        background: var(--uui-color-current); color: var(--uui-color-current-contrast); font-size: var(--uui-type-small-size); font-weight: 700;
      }
      uui-select { width: 100%; }
      a { color: var(--uui-color-interactive); }
      a:hover { color: var(--uui-color-interactive-emphasis); }

      .tools { display: grid; grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr)); gap: var(--uui-size-space-2); }
      .tool {
        display: flex; align-items: center; gap: var(--uui-size-space-3); min-width: 0;
        padding: var(--uui-size-space-3); border: 1px solid var(--uui-color-border); border-radius: var(--uui-border-radius);
        background: var(--uui-color-surface); font: inherit; color: inherit; text-align: left; cursor: pointer;
      }
      .tool:hover { border-color: var(--uui-color-border-emphasis); }
      .tool:focus-visible { outline: 2px solid var(--uui-color-focus); outline-offset: 1px; }
      .tool[aria-pressed="true"] { border-color: var(--uui-color-selected); box-shadow: inset 0 0 0 1px var(--uui-color-selected); }
      .tool > umb-icon { flex: none; font-size: 1.25rem; color: var(--uui-color-text-alt); }
      .tool[aria-pressed="true"] > umb-icon { color: var(--uui-color-selected); }
      .tool-text { display: flex; flex-direction: column; min-width: 0; }
      .tool-name { font-weight: 600; }
      .tool-sub { font-size: var(--uui-type-small-size); color: var(--uui-color-text-alt); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

      .snippet { border: 1px solid var(--uui-color-border); border-radius: var(--uui-border-radius); background: var(--uui-color-surface); overflow: hidden; }
      .snippet-head {
        display: flex; justify-content: space-between; align-items: center; gap: var(--uui-size-space-3);
        padding: var(--uui-size-space-2) var(--uui-size-space-2) var(--uui-size-space-2) var(--uui-size-space-4);
        border-bottom: 1px solid var(--uui-color-divider);
      }
      .snippet-head span { display: inline-flex; align-items: center; gap: var(--uui-size-space-2); font-weight: 600; }
      pre { margin: 0; overflow-x: auto; padding: var(--uui-size-space-4); white-space: pre; font-size: var(--uui-type-small-size); max-height: 24rem; }
      code { font-size: 0.9em; }
      .command {
        display: block; padding: var(--uui-size-space-3) var(--uui-size-space-4); overflow-x: auto; white-space: pre;
        border: 1px solid var(--uui-color-border); border-radius: var(--uui-border-radius); background: var(--uui-color-surface);
      }
    `,
  ];
}

customElements.define("umbrella-overview", UmbrellaOverviewElement);
export default UmbrellaOverviewElement;
