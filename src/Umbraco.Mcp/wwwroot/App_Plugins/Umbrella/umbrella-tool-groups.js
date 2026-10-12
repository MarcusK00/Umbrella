import { css, html, nothing } from "@umbraco-cms/backoffice/external/lit";
import { UmbLitElement } from "@umbraco-cms/backoffice/lit-element";
import { UMB_AUTH_CONTEXT } from "@umbraco-cms/backoffice/auth";
import { UMB_NOTIFICATION_CONTEXT } from "@umbraco-cms/backoffice/notification";
import { UmbTextStyles } from "@umbraco-cms/backoffice/style";
import { formatDate, request } from "./umbrella-api.js";

/** Settings → Umbrella → Tool groups: switch the MCP server's tool groups (collections) on or off, and set a tool level (full access, no destructive tools or read-only) per product. */
export class UmbrellaToolGroupsElement extends UmbLitElement {
  static properties = {
    _data: { state: true },
    _disabled: { state: true },
    _levels: { state: true },
    _error: { state: true },
    _saving: { state: true },
  };

  #auth;
  #notifications;

  constructor() {
    super();
    this._data = null;
    this._disabled = {};
    this._levels = {};
    this._error = null;
    this._saving = false;
    this.consumeContext(UMB_NOTIFICATION_CONTEXT, (ctx) => (this.#notifications = ctx));
    this.consumeContext(UMB_AUTH_CONTEXT, (ctx) => {
      if (!ctx) return;
      this.#auth = ctx;
      this.#load();
    });
  }

  async #load() {
    try {
      this._data = await request(this.#auth, "GET", "tool-settings");
      // A product without a saved list starts from the groups its module keeps off by default.
      const saved = this._data.disabledCollections ?? {};
      this._disabled = Object.fromEntries(
        Object.entries(this._data.catalogue?.modules ?? {})
          .filter(([id]) => !(id in saved))
          .map(([id, m]) => [id, new Set((m.collections ?? []).filter((c) => c.disabledByDefault).map((c) => c.name))])
          .concat(Object.entries(saved).map(([id, names]) => [id, new Set(names)])),
      );
      // Read-only wins when a product is somehow in both lists.
      const levels = {};
      for (const id of this._data.noDestructiveModules ?? []) levels[id] = "noDestructive";
      for (const id of this._data.readOnlyModules ?? []) levels[id] = "readOnly";
      this._levels = levels;
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

  #setLevel(moduleId, level) {
    this._levels = { ...this._levels, [moduleId]: level };
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
    // A level only removes tools, so it is kept for every product the site detects, reported or not.
    // Each product has one level, so it can never be in both lists.
    const ids = this._data.products.map((p) => p.id);
    const readOnlyModules = ids.filter((id) => this._levels[id] === "readOnly");
    const noDestructiveModules = ids.filter((id) => this._levels[id] === "noDestructive");
    try {
      await request(this.#auth, "PUT", "tool-settings", { disabledCollections, readOnlyModules, noDestructiveModules });
      this.#notifications?.peek("positive", {
        data: { headline: "Tool settings saved", message: "Reconnect the MCP server in your AI tool to apply the change." },
      });
      await this.#load();
    } catch (error) {
      this.#notifications?.peek("danger", { data: { headline: "Could not save tool settings", message: error.message } });
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
    const level = this._levels[product.id] ?? "full";
    const suffix = level === "readOnly" ? " · read-only" : level === "noDestructive" ? " · no destructive tools" : "";
    const olderServer =
      level === "noDestructive" && !module.collections.some((c) => typeof c.nonDestructiveToolCount === "number");
    return html`<uui-box headline=${product.displayName}>
      <span slot="header-actions">${off} of ${module.collections.length} groups off${suffix}</span>
      ${module.siteSettingsIgnored
        ? html`<p class="warning">
            Your MCP server's environment sets collection filters for this product, so the group settings are ignored there.
            Read-only still applies.
          </p>`
        : nothing}
      <uui-radio-group
        class="level"
        .value=${level}
        @change=${(e) => this.#setLevel(product.id, e.target.value)}
      >
        <uui-radio value="full" label="Full access"></uui-radio>
        <uui-radio value="noDestructive" label="No destructive tools"></uui-radio>
        <uui-radio value="readOnly" label="Read-only"></uui-radio>
      </uui-radio-group>
      ${olderServer
        ? html`<p class="warning">
            The MCP server that last started is older and still includes destructive tools. Update umbrella-mcp to apply this level.
          </p>`
        : nothing}
      <div class="groups">
        ${module.collections.map(
          (c) => html`<uui-checkbox
            label="${c.name} (${this.#toolCount(c, level)})"
            ?checked=${!this._disabled[product.id]?.has(c.name)}
            @change=${(e) => this.#toggle(product.id, c.name, e.target.checked)}
          ></uui-checkbox>`,
        )}
      </div>
    </uui-box>`;
  }

  /** "12", or "4 of 12" under read-only or no destructive tools; reports from older MCP servers lack those counts. */
  #toolCount(collection, level) {
    const kept =
      level === "readOnly" ? collection.readOnlyToolCount : level === "noDestructive" ? collection.nonDestructiveToolCount : null;
    return typeof kept === "number" ? `${kept} of ${collection.toolCount}` : `${collection.toolCount}`;
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
    const { umbrellaVersion } = this._data.catalogue;
    const addonVersion = this._data.addonVersion;

    return html`
      <uui-box headline="Umbrella – MCP tool groups">
        <p>Last reported by umbrella-mcp ${umbrellaVersion} · ${formatDate(last)}</p>
        ${addonVersion && umbrellaVersion && umbrellaVersion !== addonVersion
          ? html`<p class="warning">
              The add-on is ${addonVersion}, but the MCP server ran umbrella-mcp ${umbrellaVersion}. The two are released
              together: set umbrella-mcp@${addonVersion} in your AI tool's MCP configuration.
            </p>`
          : nothing}
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
      .level { display: flex; flex-direction: column; margin-bottom: var(--uui-size-space-4); }
      .actions { display: flex; justify-content: flex-end; }
    `,
  ];
}

customElements.define("umbrella-tool-groups", UmbrellaToolGroupsElement);
export default UmbrellaToolGroupsElement;
