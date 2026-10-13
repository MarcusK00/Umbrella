import { css, html, nothing } from "@umbraco-cms/backoffice/external/lit";
import { UmbLitElement } from "@umbraco-cms/backoffice/lit-element";
import { UMB_AUTH_CONTEXT } from "@umbraco-cms/backoffice/auth";
import { UMB_NOTIFICATION_CONTEXT } from "@umbraco-cms/backoffice/notification";
import { umbConfirmModal } from "@umbraco-cms/backoffice/modal";
import { UmbTextStyles } from "@umbraco-cms/backoffice/style";
import { formatDate, request } from "./umbrella-api.js";

/** The picker's value for the defaults; an API user's value is its key (a GUID). */
const DEFAULTS = "defaults";
const STATE_SUFFIX = { disabled: " – disabled", lockedOut: " – locked out" };

/**
 * Settings → Umbrella → Tool groups: switch the MCP server's tool groups (collections) on or off, and set a tool level
 * (full access, no destructive tools or read-only) per product. The defaults apply to every API user; each API user can
 * override a product, all-or-nothing, with its own groups and level.
 */
export class UmbrellaToolGroupsElement extends UmbLitElement {
  static properties = {
    _data: { state: true },
    _disabled: { state: true },
    _levels: { state: true },
    _error: { state: true },
    _saving: { state: true },
    _selected: { state: true },
    _user: { state: true },
    _overrides: { state: true },
    _dirty: { state: true },
    _busy: { state: true },
  };

  #auth;
  #notifications;

  constructor() {
    super();
    this._data = null;
    // The defaults: the groups switched off and the level per product, as saved on the site.
    this._disabled = {};
    this._levels = {};
    this._error = null;
    this._saving = false;
    // "" is the defaults view; otherwise the key of the API user being edited.
    this._selected = "";
    // The user's GET response, and its overrides as { [productId]: { disabled: Set, level } } (the products whose switch is off).
    this._user = null;
    this._overrides = {};
    this._dirty = false;
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

  #fetchUser(key) {
    return request(this.#auth, "GET", `tool-settings/users/${key}`);
  }

  /** Shows an API user's settings, with nothing unsaved. */
  #showUser(key, user) {
    this._selected = key;
    this._user = user;
    this._overrides = Object.fromEntries(
      Object.entries(user.overrides ?? {}).map(([id, o]) => [id, { disabled: new Set(o.disabledCollections ?? []), level: o.level ?? "full" }]),
    );
    this._dirty = false;
  }

  /** Asks before unsaved changes are thrown away; true when there is nothing to lose or the user agrees. */
  async #confirmDiscard() {
    if (!this._dirty) return true;
    try {
      await umbConfirmModal(this, {
        headline: "Discard changes?",
        content: "You have unsaved changes. Discard them?",
        color: "danger",
        confirmLabel: "Discard",
      });
      return true;
    } catch {
      return false; // Cancelled.
    }
  }

  async #pick(e) {
    const select = e.target;
    const value = select.value === DEFAULTS ? "" : select.value;
    if (value === this._selected) return;
    // The picker already shows the new value, so a cancel or a failure puts the old one back.
    const keep = () => (select.value = this._selected || DEFAULTS);
    if (!(await this.#confirmDiscard())) return keep();
    this._busy = true;
    try {
      if (value === "") {
        this._selected = "";
        this._user = null;
        this._overrides = {};
        this._dirty = false;
        return;
      }
      let user;
      try {
        user = await this.#fetchUser(value);
      } catch (error) {
        this.#notifications?.peek("danger", { data: { headline: "Could not load the API user's tool settings", message: error.message } });
        return keep();
      }
      // Unsaved edits to the defaults are gone, so the defaults the user view shows must be the saved ones.
      if (!this._selected && this._dirty) await this.#load();
      this.#showUser(value, user);
    } finally {
      this._busy = false;
    }
  }

  #toggle(moduleId, name, enabled) {
    const edit = (current) => {
      const set = new Set(current ?? []);
      if (enabled) set.delete(name);
      else set.add(name);
      return set;
    };
    if (this._selected) {
      const override = this._overrides[moduleId];
      if (!override) return;
      this._overrides = { ...this._overrides, [moduleId]: { ...override, disabled: edit(override.disabled) } };
    } else {
      this._disabled = { ...this._disabled, [moduleId]: edit(this._disabled[moduleId]) };
    }
    this._dirty = true;
  }

  #setLevel(moduleId, level) {
    if (this._selected) {
      const override = this._overrides[moduleId];
      if (!override) return;
      this._overrides = { ...this._overrides, [moduleId]: { ...override, level } };
    } else {
      this._levels = { ...this._levels, [moduleId]: level };
    }
    this._dirty = true;
  }

  /** The default groups switched off for a product: the saved list, or the module's off-by-default groups when there is none. */
  #defaultDisabled(moduleId, module) {
    return this._disabled[moduleId] ?? new Set((module?.collections ?? []).filter((c) => c.disabledByDefault).map((c) => c.name));
  }

  /** Turning "Use defaults" off starts an override from a copy of the current defaults; turning it on drops the override. */
  #setUseDefaults(product, module, useDefaults) {
    const overrides = { ...this._overrides };
    if (useDefaults) delete overrides[product.id];
    else overrides[product.id] = { disabled: new Set(this.#defaultDisabled(product.id, module)), level: this._levels[product.id] ?? "full" };
    this._overrides = overrides;
    this._dirty = true;
  }

  #save() {
    return this._selected ? this.#saveUser() : this.#saveDefaults();
  }

  async #saveDefaults() {
    this._saving = true;
    // Only modules and names the MCP reported: a name it no longer reports is dropped here.
    const modules = this._data.catalogue.modules;
    const disabledCollections = Object.fromEntries(
      this.#visibleProducts(modules)
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
      this._dirty = false;
      await this.#load();
    } catch (error) {
      this.#notifications?.peek("danger", { data: { headline: "Could not save tool settings", message: error.message } });
    } finally {
      this._saving = false;
    }
  }

  async #saveUser() {
    const key = this._selected;
    const name = this._data.apiUsers?.find((u) => u.key === key)?.name ?? "This API user";
    this._saving = true;
    // Every product whose switch is off. Names the MCP no longer reports are dropped, as for the defaults. A product the
    // catalogue does not list has no card to edit, so its override stays as it was: the PUT replaces them all.
    const modules = this._user.catalogue.modules;
    const detected = new Set(this._data.products.map((p) => p.id));
    const overrides = Object.fromEntries(
      Object.entries(this._overrides)
        .filter(([id]) => detected.has(id))
        .map(([id, o]) => [
          id,
          {
            disabledCollections: modules[id] ? modules[id].collections.map((c) => c.name).filter((n) => o.disabled.has(n)) : [...o.disabled],
            level: o.level,
          },
        ]),
    );
    try {
      await request(this.#auth, "PUT", `tool-settings/users/${key}`, { overrides });
      this.#notifications?.peek("positive", {
        data: { headline: "Tool settings saved", message: `${name}'s MCP server picks this up on its next start.` },
      });
      this._dirty = false;
      // The defaults view names the users that differ, so refresh that list too.
      await this.#load();
      this.#showUser(key, await this.#fetchUser(key));
    } catch (error) {
      this.#notifications?.peek("danger", { data: { headline: "Could not save tool settings", message: error.message } });
    } finally {
      this._saving = false;
    }
  }

  /** The products to show: those the site detects, and those the MCP reported (`modules` is the catalogue being shown). */
  #visibleProducts(modules) {
    return (this._data?.products ?? []).filter((p) => p.installed || modules[p.id]);
  }

  /** In the defaults view: the API users that override a product and so don't follow these defaults. */
  #overrideNote(product) {
    const names = (this._data.apiUsers ?? []).filter((u) => u.overriddenProducts?.includes(product.id)).map((u) => u.name);
    if (names.length === 0) return nothing;
    const who = names.length === 1 ? "1 API user has its own" : `${names.length} API users have their own`;
    const follow = names.length === 1 ? "doesn't" : "don't";
    return html`<p>${who} ${product.displayName} settings and ${follow} follow these defaults: ${names.join(", ")}.</p>`;
  }

  /** One product card, for the defaults view and the user view alike. */
  #renderProduct(product, modules) {
    const module = modules[product.id];
    const user = this._selected !== "";
    const note = user ? nothing : this.#overrideNote(product);
    if (!module) {
      return html`<uui-box headline=${product.displayName}>
        ${note}
        <p>Not reported yet. Start the MCP server once; if it has started, call get-mcp-health in your AI tool to see why this product did not load.</p>
      </uui-box>`;
    }
    // In the user view a product without an override shows the defaults, dimmed and read-only.
    const override = user ? this._overrides[product.id] : null;
    const editable = !user || !!override;
    const disabled = override ? override.disabled : user ? this.#defaultDisabled(product.id, module) : (this._disabled[product.id] ?? new Set());
    const level = (override ? override.level : this._levels[product.id]) ?? "full";
    const total = module.collections.reduce((sum, c) => sum + c.toolCount, 0);
    // A switched-off group loses all its tools; a switched-on one loses those the level removes.
    const off = module.collections.reduce(
      (sum, c) => sum + (disabled.has(c.name) ? c.toolCount : c.toolCount - (this.#keptCount(c, level) ?? c.toolCount)),
      0,
    );
    const suffix = level === "readOnly" ? " · read-only" : level === "noDestructive" ? " · no destructive tools" : "";
    const olderServer =
      level === "noDestructive" && module.collections.length > 0 && !module.collections.some((c) => typeof c.nonDestructiveToolCount === "number");
    return html`<uui-box headline=${product.displayName}>
      <span slot="header-actions">${off} of ${total} tools off${suffix}</span>
      ${note}
      ${user
        ? html`<uui-toggle
            label="Use defaults"
            ?checked=${!override}
            ?disabled=${this._saving}
            @change=${(e) => this.#setUseDefaults(product, module, e.target.checked)}
          ></uui-toggle>`
        : nothing}
      ${module.siteSettingsIgnored
        ? html`<p class="warning">
            Your MCP server's environment sets collection filters for this product, so the group settings are ignored there.
            The tool level still applies.
          </p>`
        : nothing}
      <div class=${editable ? "" : "dimmed"}>
        <uui-radio-group
          class="level"
          .value=${level}
          ?disabled=${!editable}
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
              ?checked=${!disabled.has(c.name)}
              ?disabled=${!editable}
              @change=${(e) => this.#toggle(product.id, c.name, e.target.checked)}
            ></uui-checkbox>`,
          )}
        </div>
      </div>
    </uui-box>`;
  }

  /** "12", or "4 of 12" under read-only or no destructive tools; reports from older MCP servers lack those counts. */
  #toolCount(collection, level) {
    const kept = this.#keptCount(collection, level);
    return kept === null ? `${collection.toolCount}` : `${kept} of ${collection.toolCount}`;
  }

  /** The group's tools left under read-only or no destructive tools; null at full access or when an older MCP server did not report the count. */
  #keptCount(collection, level) {
    const kept =
      level === "readOnly" ? collection.readOnlyToolCount : level === "noDestructive" ? collection.nonDestructiveToolCount : null;
    return typeof kept === "number" ? kept : null;
  }

  #pickerLabel(user) {
    const ids = user.clientIds?.length ? ` (${user.clientIds.join(", ")})` : "";
    return `${user.name}${ids}${STATE_SUFFIX[user.state] ?? ""}`;
  }

  #renderPicker() {
    const users = this._data.apiUsers ?? [];
    if (users.length === 0) return nothing;
    const options = [
      { name: "All API users (defaults)", value: DEFAULTS, selected: this._selected === "" },
      ...users.map((u) => ({ name: this.#pickerLabel(u), value: u.key, selected: this._selected === u.key })),
    ];
    return html`<uui-select
      label="API user"
      .options=${options}
      ?disabled=${this._saving || this._busy}
      @change=${this.#pick}
    ></uui-select>`;
  }

  /** The version of the MCP server the shown catalogue comes from, and a note when the counts are another user's. */
  #renderCatalogueNotes() {
    const addonVersion = this._data.addonVersion;
    const user = this._selected !== "";
    const source = this._user?.catalogueSource;
    // In the user view only the user's own report says which umbrella-mcp that user runs.
    const umbrellaVersion = user ? (source?.kind === "user" ? this._user.catalogue?.umbrellaVersion : null) : this._data.catalogue.umbrellaVersion;
    const when = source?.reportedAt ? formatDate(source.reportedAt) : null;
    return html`
      ${addonVersion && umbrellaVersion && umbrellaVersion !== addonVersion
        ? html`<p class="warning">
            The add-on is ${addonVersion}, but the MCP server ran umbrella-mcp ${umbrellaVersion}. The two are released
            together: set umbrella-mcp@${addonVersion} in your AI tool's MCP configuration.
          </p>`
        : nothing}
      ${user && source?.kind === "latest"
        ? html`<p>
            ${source.userName
              ? `Counts are from ${source.userName}'s last start${when ? ` on ${when}` : ""} and may differ for this user.`
              : `Counts are from the most recent start on this site${when ? ` (${when})` : ""} and may differ for this user.`}
          </p>`
        : nothing}
    `;
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
    const user = this._selected !== "";
    const modules = (user ? this._user?.catalogue?.modules : this._data.catalogue.modules) ?? {};
    const userName = this._data.apiUsers?.find((u) => u.key === this._selected)?.name;

    return html`
      <uui-box headline="Umbrella – MCP tool groups">
        ${this.#renderPicker()}
        ${this.#renderCatalogueNotes()}
        <p>
          ${user
            ? `Settings for ${userName ?? "this API user"}. Changes apply the next time this API user's MCP server starts. Reconnect it in the AI tool.`
            : "Changes apply the next time the MCP server starts. Reconnect it in your AI tool."}
        </p>
      </uui-box>
      ${this.#visibleProducts(modules).map((p) => this.#renderProduct(p, modules))}
      <div class="actions">
        <uui-button
          look="primary"
          color="positive"
          label="Save"
          ?disabled=${this._saving || this._busy}
          @click=${this.#save}
        ></uui-button>
      </div>
    `;
  }

  static styles = [
    UmbTextStyles,
    css`
      :host { display: block; padding: var(--uui-size-layout-1); }
      uui-box { margin-bottom: var(--uui-size-space-5); }
      uui-select { min-width: 20rem; max-width: 100%; margin-bottom: var(--uui-size-space-4); }
      uui-toggle { display: block; margin-bottom: var(--uui-size-space-4); }
      .groups { display: grid; grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr)); gap: var(--uui-size-space-3); }
      .warning { color: var(--uui-color-warning-standalone); }
      .level { display: flex; flex-direction: column; margin-bottom: var(--uui-size-space-4); }
      .dimmed { opacity: 0.55; }
      .actions { display: flex; justify-content: flex-end; }
    `,
  ];
}

customElements.define("umbrella-tool-groups", UmbrellaToolGroupsElement);
export default UmbrellaToolGroupsElement;
