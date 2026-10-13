import { css, html, nothing } from "@umbraco-cms/backoffice/external/lit";
import { UmbLitElement } from "@umbraco-cms/backoffice/lit-element";
import { UMB_AUTH_CONTEXT } from "@umbraco-cms/backoffice/auth";
import { UMB_NOTIFICATION_CONTEXT } from "@umbraco-cms/backoffice/notification";
import { UMB_CONFIRM_MODAL, umbOpenModal } from "@umbraco-cms/backoffice/modal";
import { UmbTextStyles } from "@umbraco-cms/backoffice/style";
import { formatDate, request } from "./umbrella-api.js";

const STATE_LABELS = { active: "Active", disabled: "Disabled", lockedOut: "Locked out" };
const ACCESS_LABELS = { full: "Full access", noDestructive: "No destructive tools", readOnly: "Read-only" };

/**
 * Settings → Umbrella → Overview: what needs attention (only when something does), how to connect an AI tool, and the
 * API users MCP servers have connected as, with what each can reach and the tools it gets.
 */
export class UmbrellaOverviewElement extends UmbLitElement {
  static properties = {
    _data: { state: true },
    _error: { state: true },
    _client: { state: true },
    _busy: { state: true },
  };

  #auth;
  #notifications;

  constructor() {
    super();
    this._data = null;
    this._error = null;
    this._client = null;
    this._busy = false;
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
    try {
      this._data = await request(this.#auth, "GET", "overview");
      this._error = null;
    } catch (error) {
      this._error = error.message;
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

  async #forget(user) {
    try {
      await umbOpenModal(this, UMB_CONFIRM_MODAL, {
        data: {
          headline: "Forget MCP connection?",
          content: "This does not delete the API user. It appears here again if it connects again.",
          confirmLabel: "Forget",
          color: "danger",
        },
      });
    } catch {
      return; // Cancelled.
    }
    this._busy = true;
    try {
      await request(this.#auth, "DELETE", `connections/${encodeURIComponent(user.key)}`);
      await this.#load();
    } catch (error) {
      this.#notifications?.peek("danger", { data: { headline: "Could not forget the connection", message: error.message } });
    } finally {
      this._busy = false;
    }
  }

  /** Only when something needs attention; information that needs no action is left out. */
  #renderStatus() {
    const warnings = this._data.findings.filter((f) => f.severity === "warning");
    if (warnings.length === 0) return nothing;
    const headline = `${warnings.length} ${warnings.length === 1 ? "thing needs" : "things need"} attention`;
    return html`<uui-box headline=${headline}>
      <ul class="findings">
        ${warnings.map(
          (f) => html`<li>
            <umb-icon name="icon-alert"></umb-icon>
            <span>${f.message}</span>
          </li>`,
        )}
      </ul>
    </uui-box>`;
  }

  #renderConnect() {
    const { apiUsers, server, findings, clients } = this._data;
    const open =
      apiUsers.length === 0 || server === null || findings.some((f) => f.severity === "warning" && f.area !== "products");
    const selected = clients.find((c) => c.id === this._client) ?? clients[0];
    const insecure = /UMBRACO_BASE_URL["'=:\s]+http:\/\//.test(clients[0]?.content ?? "");
    return html`<uui-box headline="Connect an AI tool">
      <details ?open=${open}>
        <summary>Set up an MCP client for this site</summary>
        ${insecure
          ? html`<p class="warning">
              The MCP server needs HTTPS. Open the backoffice over https, or change UMBRACO_BASE_URL in the snippet to the site's https address.
            </p>`
          : nothing}
        ${selected
          ? html`<uui-tab-group>
                ${clients.map(
                  (c) => html`<uui-tab
                    label=${c.label}
                    ?active=${c.id === selected.id}
                    @click=${() => (this._client = c.id)}
                  ></uui-tab>`,
                )}
              </uui-tab-group>
              <div class="snippet">
                <div class="snippet-header">
                  <strong>${selected.format === "shell" ? "Run in a terminal" : selected.fileName}</strong>
                  <uui-button look="secondary" label="Copy" @click=${() => this.#copy(selected.content)}></uui-button>
                </div>
                <pre>${selected.content}</pre>
              </div>`
          : nothing}
      </details>
    </uui-box>`;
  }

  /** One line per product: its level, whose settings, and how many tools the user's last start got with them. */
  #renderTools(user) {
    if (!user.access || user.access.length === 0) return nothing;
    const count = (n) => (n === null || n === undefined ? "" : ` · ${n} ${n === 1 ? "tool" : "tools"}`);
    return html`
      ${user.access.map(
        (a) => html`<div>
          ${a.displayName}: ${ACCESS_LABELS[a.level] ?? ACCESS_LABELS.full}
          <span class="muted">(${a.scope === "user" ? "own settings" : "defaults"})</span>${count(a.toolCount)}
        </div>`,
      )}
      ${user.toolCount === null || user.toolCount === undefined
        ? nothing
        : html`<div class="muted">${user.toolCount} ${user.toolCount === 1 ? "tool" : "tools"} in total</div>`}
    `;
  }

  #editPermissions(user) {
    this.dispatchEvent(new CustomEvent("umbrella-edit-permissions", { detail: { key: user.key }, bubbles: true, composed: true }));
  }

  #renderUsers() {
    const { apiUsers } = this._data;
    return html`<uui-box headline="MCP Users">
      ${apiUsers.length === 0
        ? html`<p>No MCP server has connected yet.</p>`
        : html`<uui-table>
            <uui-table-head>
              <uui-table-head-cell>API user</uui-table-head-cell>
              <uui-table-head-cell>Client ids</uui-table-head-cell>
              <uui-table-head-cell>Connection</uui-table-head-cell>
              <uui-table-head-cell>State</uui-table-head-cell>
              <uui-table-head-cell>Products</uui-table-head-cell>
              <uui-table-head-cell>Tools</uui-table-head-cell>
              <uui-table-head-cell></uui-table-head-cell>
            </uui-table-head>
            ${apiUsers.map(
              (u) => html`<uui-table-row>
                <uui-table-cell>${u.name}</uui-table-cell>
                <uui-table-cell>${u.clientIds.join(", ")}</uui-table-cell>
                <uui-table-cell>Last connected ${formatDate(u.lastConnected)}</uui-table-cell>
                <uui-table-cell class=${u.state === "active" ? "" : "warning"}>${STATE_LABELS[u.state] ?? u.state}</uui-table-cell>
                <uui-table-cell>
                  ${u.reachable.length > 0 ? html`<div>Can reach ${u.reachable.join(", ")}</div>` : nothing}
                  ${u.unreachable.length > 0
                    ? html`<div class="warning">Cannot reach ${u.unreachable.join(", ")}</div>`
                    : nothing}
                </uui-table-cell>
                <uui-table-cell>${this.#renderTools(u)}</uui-table-cell>
                <uui-table-cell class="row-actions">
                  <uui-button
                    look="secondary"
                    label="Edit permissions"
                    @click=${() => this.#editPermissions(u)}
                  ></uui-button>
                  <uui-button
                    look="secondary"
                    color="danger"
                    label="Forget"
                    ?disabled=${this._busy}
                    @click=${() => this.#forget(u)}
                  ></uui-button>
                </uui-table-cell>
              </uui-table-row>`,
            )}
          </uui-table>`}
    </uui-box>`;
  }

  render() {
    if (this._error) return html`<uui-box headline="Umbrella"><p>Could not load the overview: ${this._error}</p></uui-box>`;
    if (!this._data) return html`<uui-loader></uui-loader>`;

    return html`
      ${this.#renderStatus()} ${this.#renderConnect()} ${this.#renderUsers()}
    `;
  }

  static styles = [
    UmbTextStyles,
    css`
      :host { display: block; padding: var(--uui-size-layout-1); }
      uui-box { margin-bottom: var(--uui-size-space-5); }
      .warning { color: var(--uui-color-warning-standalone); }
      .muted { color: var(--uui-color-text-alt); }
      .findings { list-style: none; margin: 0; padding: 0; }
      .findings li { display: flex; gap: var(--uui-size-space-3); align-items: flex-start; margin-bottom: var(--uui-size-space-3); }
      .findings li umb-icon { flex: none; margin-top: 0.2em; }
      .findings li umb-icon { color: var(--uui-color-warning-standalone); }
      summary { cursor: pointer; margin-bottom: var(--uui-size-space-4); }
      .snippet { margin-top: var(--uui-size-space-4); }
      .snippet-header { display: flex; justify-content: space-between; align-items: center; gap: var(--uui-size-space-3); }
      pre {
        overflow-x: auto;
        padding: var(--uui-size-space-4);
        background: var(--uui-color-surface-alt);
        border-radius: var(--uui-border-radius);
        white-space: pre;
      }
      .row-actions { text-align: right; white-space: nowrap; }
    `,
  ];
}

customElements.define("umbrella-overview", UmbrellaOverviewElement);
export default UmbrellaOverviewElement;
