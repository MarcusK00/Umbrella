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
 * Settings → Umbrella → Overview: what needs attention, how to connect an AI tool, which products the MCP server
 * loaded, and the API users it has connected as.
 */
export class UmbrellaOverviewElement extends UmbLitElement {
  static properties = {
    _data: { state: true },
    _error: { state: true },
    _client: { state: true },
    _mcpJsonMessage: { state: true },
    _busy: { state: true },
  };

  #auth;
  #notifications;

  constructor() {
    super();
    this._data = null;
    this._error = null;
    this._client = null;
    this._mcpJsonMessage = null;
    this._busy = false;
    this.consumeContext(UMB_NOTIFICATION_CONTEXT, (ctx) => (this.#notifications = ctx));
    this.consumeContext(UMB_AUTH_CONTEXT, (ctx) => {
      if (!ctx) return;
      this.#auth = ctx;
      this.#load();
    });
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

  async #writeMcpJson() {
    this._busy = true;
    try {
      const result = await request(this.#auth, "POST", "mcp-json");
      this._mcpJsonMessage = result?.message ?? null;
      await this.#load();
    } catch (error) {
      this.#notifications?.peek("danger", { data: { headline: "Could not write .mcp.json", message: error.message } });
    } finally {
      this._busy = false;
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

  #renderStatus() {
    const { findings, server, apiUsers } = this._data;
    const warnings = findings.filter((f) => f.severity === "warning").length;
    const headline =
      server === null || apiUsers.length === 0
        ? "Not connected yet"
        : warnings === 0
          ? "Everything is connected"
          : `${warnings} ${warnings === 1 ? "thing needs" : "things need"} attention`;
    return html`<uui-box headline=${headline}>
      ${findings.length === 0
        ? nothing
        : html`<ul class="findings">
            ${findings.map(
              (f) => html`<li class=${f.severity === "warning" ? "is-warning" : "is-info"}>
                <umb-icon name=${f.severity === "warning" ? "icon-alert" : "icon-info"}></umb-icon>
                <span>${f.message}</span>
              </li>`,
            )}
          </ul>`}
    </uui-box>`;
  }

  #renderConnect() {
    const { apiUsers, server, findings, clients, mcpJson } = this._data;
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
        ${mcpJson.available
          ? html`<div class="mcp-json">
              <uui-button
                look="primary"
                label="Write .mcp.json"
                ?disabled=${this._busy}
                @click=${this.#writeMcpJson}
              ></uui-button>
              ${this._mcpJsonMessage ? html`<p>${this._mcpJsonMessage}</p>` : nothing}
            </div>`
          : nothing}
      </details>
    </uui-box>`;
  }

  #differingUsersSuffix(count) {
    if (!count || count <= 0) return "";
    return count === 1 ? " (1 API user differs)" : ` (${count} API users differ)`;
  }

  #reportLine(user) {
    if (!user.serverVersion) return null;
    const parts = [`umbrella-mcp ${user.serverVersion}`];
    if (user.lastReportedAt) parts.push(`last start ${formatDate(user.lastReportedAt)}`);
    if (user.toolCount !== null && user.toolCount !== undefined) parts.push(`${user.toolCount} tools`);
    return parts.join(" · ");
  }

  #accessLine(user) {
    if (!user.access || user.access.length === 0) return null;
    return user.access
      .map((a) => `${a.displayName}: ${ACCESS_LABELS[a.level] ?? ACCESS_LABELS.full} (${a.scope === "user" ? "own settings" : "defaults"})`)
      .join(" · ");
  }

  #renderProducts() {
    const installed = this._data.products.filter((p) => p.installed);
    const notInstalled = this._data.products.filter((p) => !p.installed);
    return html`<uui-box headline="Products">
      ${installed.length === 0
        ? html`<p>No Umbraco products detected.</p>`
        : html`<uui-table>
            <uui-table-head>
              <uui-table-head-cell>Product</uui-table-head-cell>
              <uui-table-head-cell>Version</uui-table-head-cell>
              <uui-table-head-cell>API</uui-table-head-cell>
              <uui-table-head-cell>MCP server</uui-table-head-cell>
              <uui-table-head-cell>Access</uui-table-head-cell>
              <uui-table-head-cell>Tools available</uui-table-head-cell>
            </uui-table-head>
            ${installed.map(
              (p) => html`<uui-table-row>
                <uui-table-cell>${p.displayName}</uui-table-cell>
                <uui-table-cell>${p.version ?? ""}</uui-table-cell>
                <uui-table-cell class=${p.enabled ? "" : "warning"}>${p.enabled ? "Available" : "Not available"}</uui-table-cell>
                <uui-table-cell>${p.loaded ? "Loaded" : "Not loaded"}</uui-table-cell>
                <uui-table-cell>${ACCESS_LABELS[p.access] ?? ACCESS_LABELS.full}${this.#differingUsersSuffix(p.usersWithOwnSettings)}</uui-table-cell>
                <uui-table-cell>${p.loaded ? p.toolCount : ""}</uui-table-cell>
              </uui-table-row>`,
            )}
          </uui-table>`}
      ${notInstalled.length > 0
        ? html`<p class="muted">Not installed: ${notInstalled.map((p) => p.displayName).join(", ")}</p>`
        : nothing}
    </uui-box>`;
  }

  #renderServerAndUsers() {
    // Each API user's row shows the version and start of its own MCP server, so there is no site-wide line here.
    const { apiUsers } = this._data;
    return html`<uui-box headline="MCP server and API users">
      ${apiUsers.length === 0
        ? html`<p>No MCP server has connected yet.</p>`
        : html`<uui-table>
            <uui-table-head>
              <uui-table-head-cell>API user</uui-table-head-cell>
              <uui-table-head-cell>Client ids</uui-table-head-cell>
              <uui-table-head-cell>Connection</uui-table-head-cell>
              <uui-table-head-cell>State</uui-table-head-cell>
              <uui-table-head-cell>Products</uui-table-head-cell>
              <uui-table-head-cell></uui-table-head-cell>
            </uui-table-head>
            ${apiUsers.map((u) => {
              const reportLine = this.#reportLine(u);
              const accessLine = this.#accessLine(u);
              return html`<uui-table-row>
                <uui-table-cell>${u.name}</uui-table-cell>
                <uui-table-cell>${u.clientIds.join(", ")}</uui-table-cell>
                <uui-table-cell>
                  <div>Last connected ${formatDate(u.lastConnected)}</div>
                  ${reportLine ? html`<div class="muted">${reportLine}</div>` : nothing}
                </uui-table-cell>
                <uui-table-cell class=${u.state === "active" ? "" : "warning"}>${STATE_LABELS[u.state] ?? u.state}</uui-table-cell>
                <uui-table-cell>
                  ${u.reachable.length > 0 ? html`<div>Can reach ${u.reachable.join(", ")}</div>` : nothing}
                  ${u.unreachable.length > 0
                    ? html`<div class="warning">Cannot reach ${u.unreachable.join(", ")}</div>`
                    : nothing}
                  ${accessLine ? html`<div class="muted">${accessLine}</div>` : nothing}
                </uui-table-cell>
                <uui-table-cell class="row-actions">
                  <uui-button
                    look="secondary"
                    color="danger"
                    label="Forget"
                    ?disabled=${this._busy}
                    @click=${() => this.#forget(u)}
                  ></uui-button>
                </uui-table-cell>
              </uui-table-row>`;
            })}
          </uui-table>`}
    </uui-box>`;
  }

  render() {
    if (this._error) return html`<uui-box headline="Umbrella"><p>Could not load the overview: ${this._error}</p></uui-box>`;
    if (!this._data) return html`<uui-loader></uui-loader>`;

    return html`
      ${this.#renderStatus()} ${this.#renderConnect()} ${this.#renderProducts()} ${this.#renderServerAndUsers()}
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
      .findings li.is-warning umb-icon { color: var(--uui-color-warning-standalone); }
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
      .mcp-json { margin-top: var(--uui-size-space-4); }
      .row-actions { text-align: right; }
    `,
  ];
}

customElements.define("umbrella-overview", UmbrellaOverviewElement);
export default UmbrellaOverviewElement;
