import { css, html, nothing } from "@umbraco-cms/backoffice/external/lit";
import { UmbLitElement } from "@umbraco-cms/backoffice/lit-element";
import { UMB_AUTH_CONTEXT } from "@umbraco-cms/backoffice/auth";
import { UMB_NOTIFICATION_CONTEXT } from "@umbraco-cms/backoffice/notification";
import { UmbTextStyles } from "@umbraco-cms/backoffice/style";

const API_PATH = "/umbraco/management/api/v1/mcp/tool-settings";

const pad = (n) => String(n).padStart(2, "0");
/** DD-MM-YYYY HH:mm in the browser's time zone. */
const formatDate = (iso) => {
  const d = new Date(iso);
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** Settings → Umbrella: switch the MCP server's tool groups (collections) on or off per product. */
export class UmbrellaDashboardElement extends UmbLitElement {
  static properties = {
    _data: { state: true },
    _disabled: { state: true },
    _error: { state: true },
    _saving: { state: true },
  };

  #auth;
  #notifications;

  constructor() {
    super();
    this._data = null;
    this._disabled = {};
    this._error = null;
    this._saving = false;
    this.consumeContext(UMB_NOTIFICATION_CONTEXT, (ctx) => (this.#notifications = ctx));
    this.consumeContext(UMB_AUTH_CONTEXT, (ctx) => {
      if (!ctx) return;
      this.#auth = ctx;
      this.#load();
    });
  }

  async #request(method, body) {
    const config = this.#auth.getOpenApiConfiguration();
    const response = await fetch(`${config.base}${API_PATH}`, {
      method,
      credentials: config.credentials,
      headers: {
        Authorization: `Bearer ${await config.token()}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      const problem = await response.json().catch(() => null);
      throw new Error(problem?.detail ?? `HTTP ${response.status}`);
    }
    return response.json();
  }

  async #load() {
    try {
      this._data = await this.#request("GET");
      this._disabled = Object.fromEntries(
        Object.entries(this._data.disabledCollections ?? {}).map(([id, names]) => [id, new Set(names)]),
      );
      this._error = null;
    } catch (error) {
      this._error = error.message;
    }
  }

  #toggle(moduleId, name, enabled) {
    const set = new Set(this._disabled[moduleId] ?? []);
    if (enabled) set.delete(name);
    else set.add(name);
    this._disabled = { ...this._disabled, [moduleId]: set };
  }

  async #save() {
    this._saving = true;
    // Only modules and names the MCP reported: a name it no longer reports is dropped here.
    const modules = this._data.catalogue.modules;
    const disabledCollections = Object.fromEntries(
      this.#visibleProducts()
        .filter((p) => modules[p.id])
        .map((p) => [p.id, modules[p.id].collections.map((c) => c.name).filter((n) => this._disabled[p.id]?.has(n))]),
    );
    try {
      await this.#request("PUT", { disabledCollections });
      this.#notifications?.peek("positive", {
        data: { headline: "Tool groups saved", message: "Reconnect the MCP server in your AI tool to apply the change." },
      });
      await this.#load();
    } catch (error) {
      this.#notifications?.peek("danger", { data: { headline: "Could not save tool groups", message: error.message } });
    } finally {
      this._saving = false;
    }
  }

  #visibleProducts() {
    const modules = this._data?.catalogue?.modules ?? {};
    return (this._data?.products ?? []).filter((p) => p.installed || modules[p.id]);
  }

  #renderProduct(product) {
    const module = this._data.catalogue.modules[product.id];
    if (!module) {
      return html`<uui-box headline=${product.displayName}>
        <p>Not reported yet. Start the MCP server once; if it has started, call get-mcp-health in your AI tool to see why this product did not load.</p>
      </uui-box>`;
    }
    const off = module.collections.filter((c) => this._disabled[product.id]?.has(c.name)).length;
    return html`<uui-box headline=${product.displayName}>
      <span slot="header-actions">${off} of ${module.collections.length} groups off</span>
      ${module.siteSettingsIgnored
        ? html`<p class="warning">
            Your MCP server's environment sets collection filters for this product, so these settings are ignored there.
          </p>`
        : nothing}
      <div class="groups">
        ${module.collections.map(
          (c) => html`<uui-checkbox
            label="${c.name} (${c.toolCount})"
            ?checked=${!this._disabled[product.id]?.has(c.name)}
            @change=${(e) => this.#toggle(product.id, c.name, e.target.checked)}
          ></uui-checkbox>`,
        )}
      </div>
    </uui-box>`;
  }

  render() {
    if (this._error) return html`<uui-box headline="Umbrella"><p>Could not load the tool groups: ${this._error}</p></uui-box>`;
    if (!this._data) return html`<uui-loader></uui-loader>`;

    const reported = Object.values(this._data.catalogue.modules);
    if (reported.length === 0) {
      return html`<uui-box headline="Umbrella – MCP tool groups">
        <p>No tool groups reported yet. Start your MCP client once (it runs umbrella-mcp), then reload this page.</p>
      </uui-box>`;
    }
    const last = reported.map((m) => m.reportedAt).sort().at(-1);

    return html`
      <uui-box headline="Umbrella – MCP tool groups">
        <p>Last reported by umbrella-mcp ${this._data.catalogue.umbrellaVersion} · ${formatDate(last)}</p>
        <p>Changes apply the next time the MCP server starts. Reconnect it in your AI tool.</p>
      </uui-box>
      ${this.#visibleProducts().map((p) => this.#renderProduct(p))}
      <div class="actions">
        <uui-button look="primary" color="positive" label="Save" ?disabled=${this._saving} @click=${this.#save}></uui-button>
      </div>
    `;
  }

  static styles = [
    UmbTextStyles,
    css`
      :host { display: block; padding: var(--uui-size-layout-1); }
      uui-box { margin-bottom: var(--uui-size-space-5); }
      .groups { display: grid; grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr)); gap: var(--uui-size-space-3); }
      .warning { color: var(--uui-color-warning-standalone); }
      .actions { display: flex; justify-content: flex-end; }
    `,
  ];
}

customElements.define("umbrella-dashboard", UmbrellaDashboardElement);
export default UmbrellaDashboardElement;
