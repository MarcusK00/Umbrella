import { css, html, nothing } from "@umbraco-cms/backoffice/external/lit";
import { UmbLitElement } from "@umbraco-cms/backoffice/lit-element";
import { UMB_NOTIFICATION_CONTEXT } from "@umbraco-cms/backoffice/notification";
import { UmbTextStyles } from "@umbraco-cms/backoffice/style";

/** McpClientConfig.SecretEnvironmentVariable. */
export const SECRET_VARIABLE = "UMBRELLA_CLIENT_SECRET";

/** McpClientSnippets.PluginId. */
export const PLUGIN_ID = "umbrella@umbrella";

/**
 * Per AI tool from McpClientSnippets: its icon, where the config goes, and how the secret gets in: "env" (read from
 * SECRET_VARIABLE), "prompt" (the tool asks), "plugin" (the Claude Code plugin asks) or "placeholder" (replaced by hand).
 */
export const CLIENTS = {
  "claude-code": { icon: "icon-terminal", where: "Put the file in the folder you open in Claude Code.", secret: "env" },
  "claude-code-cli": {
    icon: "icon-terminal",
    where: "Run it in the folder you open in Claude Code. Claude Code keeps the server in your own settings.",
    secret: "placeholder",
  },
  "claude-code-plugin": {
    icon: "icon-plugin",
    where: "Run them in a terminal. They install the Umbrella plugin for Claude Code in every folder you open, with the site and client id filled in.",
    secret: "plugin",
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
 * The AI tool picker and the config to copy for it, from a `GET client-setup` response. Used by the Overview's
 * "Connect an AI tool" box (after its own "Sign in as" step, put in the `choose` slot) and by the New connection
 * flow's result screen.
 *
 * Properties: `setup` (the client-setup response), `userName` (who the AI tool connects as, or null), `firstStep`
 * (the number of the AI tool step; the others follow). Attributes: `stacked` puts everything in one column (for a
 * sidebar), `hide-secret-step` leaves out "Add the client secret" when the caller shows the secret itself.
 */
export class UmbrellaClientSetupElement extends UmbLitElement {
  static properties = {
    setup: { attribute: false },
    userName: { attribute: false },
    firstStep: { attribute: false },
    stacked: { type: Boolean, reflect: true },
    hideSecretStep: { type: Boolean, attribute: "hide-secret-step" },
    _client: { state: true },
  };

  #notifications;

  constructor() {
    super();
    this.setup = null;
    this.userName = null;
    this.firstStep = 2;
    this.stacked = false;
    this.hideSecretStep = false;
    this._client = null;
    this.consumeContext(UMB_NOTIFICATION_CONTEXT, (ctx) => (this.#notifications = ctx));
  }

  async #copy(content) {
    try {
      await navigator.clipboard.writeText(content);
      this.#notifications?.peek("positive", { data: { message: "Copied" } });
    } catch {
      this.#notifications?.peek("danger", { data: { message: "Could not copy. Select the text and copy it by hand." } });
    }
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
    if (meta.secret === "plugin") {
      return html`<p>Start Claude Code and run this. It asks for the client secret, hides it as you type, and keeps it in your system's credential store.</p>
        <code class="command">/plugin configure ${PLUGIN_ID}</code>
        <p class="muted small">The same command changes the site or client id later.</p>`;
    }
    return html`<p>
      Replace the placeholder with the API user's client secret. The ${client.format === "shell" ? "command" : "file"} then contains the
      secret, so keep it out of source control.
    </p>`;
  }

  render() {
    if (!this.setup) return nothing;
    const { clients } = this.setup;
    const selected = clients.find((c) => c.id === this._client) ?? clients[0];
    const meta = CLIENTS[selected?.id] ?? CLIENTS.other;
    const insecure = /UMBRACO_BASE_URL["'=:\s]+http:\/\//.test(clients[0]?.content ?? "");
    let n = this.firstStep;
    const toolStep = n++;
    const configStep = n++;
    const secretStep = this.hideSecretStep ? null : n++;
    const restartStep = n;
    return html`<div class="connect">
      <div class="connect-choose">
        <slot name="choose"></slot>
        <div class="field">
          <h3 id="tool-heading"><span class="num">${toolStep}</span>AI tool</h3>
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
          <p class="muted small">The MCP server runs with npx: the computer running the AI tool needs Node.js 22.23.4 or later (24.22.1+ on Node 24, 26.12.1+ on Node 26).</p>
        </div>
      </div>
      ${selected
        ? html`<div class="connect-result">
            <div class="field">
              <h3>
                <span class="num">${configStep}</span>${selected.format === "shell"
                  ? selected.content.includes("\n")
                    ? "Run these commands"
                    : "Run this command"
                  : `Add this to ${selected.fileName ?? "the MCP configuration"}`}
              </h3>
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
            ${secretStep === null
              ? nothing
              : html`<div class="field">
                  <h3><span class="num">${secretStep}</span>Add the client secret</h3>
                  ${this.#renderSecret(selected, meta)}
                </div>`}
            <div class="field">
              <h3><span class="num">${restartStep}</span>Restart ${selected.label.replace(/ \((command|plugin)\)$/, "")}</h3>
              <p class="muted">
                It connects as ${this.userName ? html`<strong>${this.userName}</strong>` : "the API user"} and shows up in
                <strong>Access per API user</strong>.
              </p>
            </div>
          </div>`
        : nothing}
    </div>`;
  }

  static styles = [
    UmbTextStyles,
    css`
      :host { display: block; }
      .muted { color: var(--uui-color-text-alt); margin: 0; }
      .small { font-size: var(--uui-type-small-size); }
      .warning { display: flex; align-items: center; gap: var(--uui-size-space-2); margin: 0 0 var(--uui-size-space-3); }
      .warning umb-icon { color: var(--uui-color-warning-standalone); flex: none; }
      h3 { margin: 0; }

      .connect { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 3fr); gap: var(--uui-size-layout-1); align-items: start; }
      @media (max-width: 64rem) { .connect { grid-template-columns: minmax(0, 1fr); } }
      :host([stacked]) .connect { grid-template-columns: minmax(0, 1fr); }
      .connect-choose, .connect-result { display: flex; flex-direction: column; gap: var(--uui-size-space-6); min-width: 0; }
      .connect-result { padding: var(--uui-size-space-5); border-radius: var(--uui-border-radius); background: var(--uui-color-surface-alt); }
      .field { display: flex; flex-direction: column; align-items: stretch; gap: var(--uui-size-space-3); }
      .field > p { margin: 0; max-width: 70ch; }
      .field h3 { display: flex; align-items: center; gap: var(--uui-size-space-3); font-size: var(--uui-type-default-size); }
      .num {
        display: inline-grid; place-items: center; flex: none; width: 1.5rem; height: 1.5rem; border-radius: 50%;
        background: var(--uui-color-current); color: var(--uui-color-current-contrast); font-size: var(--uui-type-small-size); font-weight: 700;
      }

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

customElements.define("umbrella-client-setup", UmbrellaClientSetupElement);
export default UmbrellaClientSetupElement;
