import { css, html, nothing, repeat } from "@umbraco-cms/backoffice/external/lit";
import { UmbLitElement } from "@umbraco-cms/backoffice/lit-element";
import { UMB_AUTH_CONTEXT } from "@umbraco-cms/backoffice/auth";
import { umbConfirmModal } from "@umbraco-cms/backoffice/modal";
import { UMB_NOTIFICATION_CONTEXT } from "@umbraco-cms/backoffice/notification";
import { UmbTextStyles } from "@umbraco-cms/backoffice/style";
import { request } from "./umbrella-api.js";
import "./umbrella-product-card.js";
import { UmbrellaUnsavedGuard } from "./umbrella-unsaved-guard.js";

/** The product the MCP server signs in through; the add-on refuses to switch it off. */
const REQUIRED_PRODUCT = "cms";
const STATE_TAGS = { disabled: "Disabled", lockedOut: "Locked out" };

/**
 * Settings → Umbrella → Tool Permissions. On the left, who is being edited: the defaults (every API user) or one API
 * user. On the right, who that is, then one card per product with its access level (off, read-only, no deletes or full)
 * and its tool groups. An API user can override a product, all-or-nothing, with its own level and groups. Save and
 * discard sit in a footer pinned to the bottom, as in Umbraco's workspaces.
 *
 * Unsaved changes are what differs from the last saved state, so changing something back makes the page clean again.
 * Every way of leaving with unsaved changes asks first (`confirmLeave`).
 */
export class UmbrellaToolGroupsElement extends UmbLitElement {
  static properties = {
    _data: { state: true },
    _error: { state: true },
    _saving: { state: true },
    _busy: { state: true },
    _selected: { state: true },
    _user: { state: true },
    _edit: { state: true },
  };

  #auth;
  #notifications;
  // An API user the Overview asked to open before the settings had loaded.
  #pendingUser = null;
  // The PUT body of the state as last saved; `dirty` compares the current edits with it.
  #snapshot = "";

  constructor() {
    super();
    this._data = null;
    this._error = null;
    this._saving = false;
    this._busy = false;
    // "" is the defaults view; otherwise the key of the API user being edited.
    this._selected = "";
    // The user's GET response in the user view.
    this._user = null;
    // Defaults view: { disabled: { [id]: Set }, levels: { [id]: level } }.
    // User view: { overrides: { [id]: { disabled: Set, level } } } for the products the user overrides.
    this._edit = { disabled: {}, levels: {} };
    new UmbrellaUnsavedGuard(this, { isDirty: () => this.dirty, confirm: () => this.confirmLeave() });
    this.consumeContext(UMB_NOTIFICATION_CONTEXT, (ctx) => (this.#notifications = ctx));
    this.consumeContext(UMB_AUTH_CONTEXT, (ctx) => {
      if (!ctx) return;
      this.#auth = ctx;
      this.#load();
    });
  }

  /** Whether the page differs from what is saved. */
  get dirty() {
    return !!this._data && JSON.stringify(this.#body()) !== this.#snapshot;
  }

  async #load() {
    try {
      this._data = await request(this.#auth, "GET", "tool-settings");
      this._error = null;
      if (!this._selected) this.#showDefaults();
    } catch (error) {
      this._error = error.message;
    }
    if (this.#pendingUser) {
      const key = this.#pendingUser;
      this.#pendingUser = null;
      await this.selectUser(key);
    }
  }

  /** The saved defaults, as editable state. */
  #savedDefaults() {
    const modules = this._data.catalogue?.modules ?? {};
    const saved = this._data.disabledCollections ?? {};
    const disabled = {};
    // A product without a saved list starts from the groups its module keeps off by default.
    for (const [id, m] of Object.entries(modules)) {
      disabled[id] = new Set(id in saved ? saved[id] : (m.collections ?? []).filter((c) => c.disabledByDefault).map((c) => c.name));
    }
    for (const [id, names] of Object.entries(saved)) disabled[id] ??= new Set(names);
    // One level per product; off wins, then read-only.
    const levels = {};
    for (const id of this._data.noDestructiveModules ?? []) levels[id] = "noDestructive";
    for (const id of this._data.readOnlyModules ?? []) levels[id] = "readOnly";
    for (const id of this._data.offModules ?? []) levels[id] = "off";
    return { disabled, levels };
  }

  /** The saved defaults for one product: what a user follows, and what "Customise" starts from. */
  #defaultsFor(id) {
    const { disabled, levels } = this.#savedDefaults();
    return { disabled: disabled[id] ?? new Set(), level: levels[id] ?? "full" };
  }

  #showDefaults() {
    this._selected = "";
    this._user = null;
    this._edit = this.#savedDefaults();
    this.#snapshot = JSON.stringify(this.#body());
  }

  /** Shows an API user's settings, with nothing unsaved. */
  #showUser(key, user) {
    this._selected = key;
    this._user = user;
    this._edit = {
      overrides: Object.fromEntries(
        Object.entries(user.overrides ?? {}).map(([id, o]) => [id, { disabled: new Set(o.disabledCollections ?? []), level: o.level ?? "full" }]),
      ),
    };
    this.#snapshot = JSON.stringify(this.#body());
  }

  /** Puts the saved state back. */
  #discard() {
    if (this._selected && this._user) this.#showUser(this._selected, this._user);
    else this.#showDefaults();
  }

  /**
   * Resolves true when there is nothing unsaved, or when the user chose to discard it (it is then discarded); false when
   * the user wants to keep editing.
   */
  async confirmLeave() {
    if (!this.dirty) return true;
    const name = this._data.apiUsers?.find((u) => u.key === this._selected)?.name;
    try {
      await umbConfirmModal(this, {
        headline: "Discard unsaved changes?",
        content: `Your changes to ${this._selected ? `${name ?? "this API user"}'s settings` : "the defaults"} haven't been saved.`,
        confirmLabel: "Discard changes",
        cancelLabel: "Keep editing",
        color: "danger",
      });
    } catch {
      return false;
    }
    this.#discard();
    return true;
  }

  /** Opens an API user's settings, or the defaults for "" (the side list, and the Overview's "Edit permissions"). */
  async selectUser(key) {
    if (!this._data) {
      this.#pendingUser = key;
      return;
    }
    if (key === this._selected) return;
    // A user asked for while another loads opens after it.
    if (this._busy) {
      this.#pendingUser = key;
      return;
    }
    if (!(await this.confirmLeave())) return;
    // An API user that connected after this page loaded: load the list again so it shows up.
    if (key && !this._data.apiUsers?.some((u) => u.key === key)) await this.#load();
    if (key === "") {
      this.#showDefaults();
      return;
    }
    this._busy = true;
    try {
      this.#showUser(key, await request(this.#auth, "GET", `tool-settings/users/${key}`));
    } catch (error) {
      this.#notifications?.peek("danger", { data: { headline: "Could not load the API user's tool settings", message: error.message } });
    } finally {
      this._busy = false;
    }
    const next = this.#pendingUser;
    this.#pendingUser = null;
    if (next !== null) await this.selectUser(next);
  }

  /** Moves focus to the heading of who is being edited, after the Overview handed over with "Edit permissions". */
  async focusEditor() {
    await this.updateComplete;
    this.shadowRoot?.querySelector(".editor-title h2")?.focus();
  }

  /** The catalogue entry to show for a product: in the user view the user's own report, else the defaults' one. */
  #moduleFor(id) {
    const own = this._selected ? this._user?.catalogue?.modules?.[id] : null;
    return own ?? this._data.catalogue?.modules?.[id] ?? null;
  }

  /**
   * Counts belong to the user being shown only when its own MCP server reported them for this product; another user's
   * report would show that user's permissions. The defaults always show the highest counts any API user reported.
   */
  #showCounts(id) {
    if (!this._selected) return true;
    return this._user?.catalogueSource?.kind === "user" && !!this._user.catalogue?.modules?.[id];
  }

  /** The PUT body for the current edits. Built the same way for the snapshot, so equal state gives an equal body. */
  #body() {
    const detected = this._data.products.map((p) => p.id);
    // Only names the MCP reported: a name it no longer reports is dropped.
    const names = (id, disabled) => {
      const module = this.#moduleFor(id);
      return module ? module.collections.map((c) => c.name).filter((n) => disabled.has(n)) : [...disabled].sort();
    };
    if (this._selected) {
      const overrides = this._edit.overrides ?? {};
      return {
        overrides: Object.fromEntries(
          detected.filter((id) => overrides[id]).map((id) => [id, { disabledCollections: names(id, overrides[id].disabled), level: overrides[id].level }]),
        ),
      };
    }
    const { disabled = {}, levels = {} } = this._edit;
    const reported = this._data.catalogue?.modules ?? {};
    // A level only removes tools, so it is kept for every product the site detects, reported or not.
    return {
      disabledCollections: Object.fromEntries(detected.filter((id) => reported[id]).map((id) => [id, names(id, disabled[id] ?? new Set())])),
      readOnlyModules: detected.filter((id) => levels[id] === "readOnly"),
      noDestructiveModules: detected.filter((id) => levels[id] === "noDestructive"),
      offModules: detected.filter((id) => levels[id] === "off"),
    };
  }

  #setLevel(id, level) {
    if (this._busy || this._saving) return;
    if (this._selected) {
      const override = this._edit.overrides[id];
      if (!override) return;
      this._edit = { overrides: { ...this._edit.overrides, [id]: { ...override, level } } };
    } else {
      this._edit = { ...this._edit, levels: { ...this._edit.levels, [id]: level } };
    }
  }

  /** Switches tool groups on or off: one from its toggle, or every shown one from "Switch all on/off". */
  #setGroups(id, names, enabled) {
    if (this._busy || this._saving) return;
    const edit = (current) => {
      const set = new Set(current ?? []);
      for (const name of names) {
        if (enabled) set.delete(name);
        else set.add(name);
      }
      return set;
    };
    if (this._selected) {
      const override = this._edit.overrides[id];
      if (!override) return;
      this._edit = { overrides: { ...this._edit.overrides, [id]: { ...override, disabled: edit(override.disabled) } } };
    } else {
      this._edit = { ...this._edit, disabled: { ...this._edit.disabled, [id]: edit(this._edit.disabled[id]) } };
    }
  }

  /** "Customise for …" starts an override from a copy of the saved defaults; "Reset to defaults" drops it. */
  #setOverride(id, customise) {
    if (this._busy || this._saving) return;
    const overrides = { ...this._edit.overrides };
    if (customise) overrides[id] = this.#defaultsFor(id);
    else delete overrides[id];
    this._edit = { overrides };
  }

  /** "Use the defaults for everything": drops every override of the user being shown. */
  #resetAll() {
    if (this._busy || this._saving) return;
    this._edit = { overrides: {} };
  }

  async #save() {
    // While another user loads, the page is about to be replaced: nothing is edited or saved then.
    if (!this.dirty || this._saving || this._busy) return;
    const key = this._selected;
    const name = this._data.apiUsers?.find((u) => u.key === key)?.name ?? "This API user";
    this._saving = true;
    try {
      if (key) {
        await request(this.#auth, "PUT", `tool-settings/users/${key}`, this.#body());
        this.#notifications?.peek("positive", {
          data: { headline: "Tool settings saved", message: `${name}'s MCP server picks this up on its next start. Reconnect it in the AI tool.` },
        });
        // The side list tags the users with their own settings, so refresh that too.
        await this.#load();
        this.#showUser(key, await request(this.#auth, "GET", `tool-settings/users/${key}`));
      } else {
        await request(this.#auth, "PUT", "tool-settings", this.#body());
        this.#notifications?.peek("positive", {
          data: { headline: "Tool settings saved", message: "Changes apply the next time the MCP server starts. Reconnect it in your AI tool." },
        });
        await this.#load();
      }
    } catch (error) {
      this.#notifications?.peek("danger", { data: { headline: "Could not save tool settings", message: error.message } });
    } finally {
      this._saving = false;
    }
  }

  /**
   * The products to show: those the site detects as installed. A catalogue entry alone is not enough, as the shared
   * catalogue keeps a product after it is uninstalled. A user view also leaves out the products whose section none of the
   * user's groups grant: its MCP server doesn't load them, so there is nothing to set.
   */
  #visibleProducts() {
    const noAccess = this._selected ? (this._user?.noSectionAccess ?? []) : [];
    return (this._data?.products ?? []).filter((p) => p.installed && !noAccess.includes(p.id));
  }

  /** In the defaults view: the API users that override a product and so don't follow these defaults. */
  #overrideNote(product) {
    const names = (this._data.apiUsers ?? []).filter((u) => u.overriddenProducts?.includes(product.id)).map((u) => u.name);
    if (names.length === 0) return null;
    return names.length === 1
      ? `1 API user has its own ${product.displayName} settings: ${names[0]}.`
      : `${names.length} API users have their own ${product.displayName} settings: ${names.join(", ")}.`;
  }

  #notesFor(product, module, level) {
    const notes = [];
    if (!this._selected) notes.push(this.#overrideNote(product));
    if (this._selected && module && !this._user?.catalogue?.modules?.[product.id] && this._user?.catalogueSource?.kind === "user") {
      notes.push(`Counts appear after this user's MCP server starts with ${product.displayName} on.`);
    }
    if (module?.siteSettingsIgnored) {
      notes.push(
        `Your MCP server's environment sets collection filters for ${product.displayName}, so the groups are ignored there. The access level still applies.`,
      );
    }
    const olderServer =
      this.#showCounts(product.id) &&
      level === "noDestructive" &&
      module?.collections?.length > 0 &&
      !module.collections.some((c) => typeof c.nonDestructiveToolCount === "number");
    if (olderServer) notes.push("The MCP server that last started is older and still includes destructive tools.");
    return notes.filter(Boolean);
  }

  #renderCard(product) {
    const id = product.id;
    const module = this.#moduleFor(id);
    const userName = this.#userName();
    let state;
    let mode = "defaults";
    if (this._selected) {
      const override = this._edit.overrides?.[id];
      mode = override ? "custom" : "follows";
      state = override ?? this.#defaultsFor(id);
    } else {
      state = { disabled: this._edit.disabled[id] ?? new Set(), level: this._edit.levels[id] ?? "full" };
    }
    return html`<umbrella-product-card
      .product=${product}
      .module=${module}
      .level=${state.level}
      .disabled=${state.disabled}
      .editable=${mode !== "follows" && !this._saving && !this._busy}
      .locked=${this._saving || this._busy}
      .showCounts=${this.#showCounts(id)}
      .mode=${mode}
      .userName=${userName}
      .defaultLevel=${this._selected ? this.#defaultsFor(id).level : null}
      .isRequired=${id === REQUIRED_PRODUCT}
      .notes=${this.#notesFor(product, module, state.level)}
    ></umbrella-product-card>`;
  }

  #userName() {
    return this._data.apiUsers?.find((u) => u.key === this._selected)?.name ?? "this API user";
  }

  #renderList() {
    const users = this._data.apiUsers ?? [];
    const entry = (key, name, sub, avatar, tag) => html`<li>
      <button
        class="entry"
        aria-current=${this._selected === key ? "true" : "false"}
        ?disabled=${this._saving || this._busy}
        @click=${() => this.selectUser(key)}
      >
        ${avatar}
        <span class="entry-text">
          <span class="entry-name">${name}</span>
          ${sub ? html`<span class="entry-sub">${sub}</span>` : nothing}
        </span>
        ${tag ?? nothing}
      </button>
    </li>`;
    return html`<nav class="list" aria-label="Whose tool permissions">
      <ul>
        ${entry(
          "",
          "Defaults",
          "All API users",
          html`<span class="defaults-icon"><umb-icon name="icon-settings"></umb-icon></span>`,
        )}
      </ul>
      ${users.length
        ? html`<h3 class="list-heading">API users</h3>
            <ul>
              ${users.map((u) => {
                const own = u.overriddenProducts?.length ?? 0;
                const tag = html`${STATE_TAGS[u.state] ? html`<uui-tag look="secondary" color="warning">${STATE_TAGS[u.state]}</uui-tag>` : nothing}
                ${own
                  ? html`<uui-tag look="secondary" title=${`Own settings for ${own} ${own === 1 ? "product" : "products"}`}>${own} own</uui-tag>`
                  : nothing}`;
                return entry(u.key, u.name, u.clientIds?.join(", "), html`<uui-avatar name=${u.name}></uui-avatar>`, tag);
              })}
            </ul>`
        : html`<p class="list-empty">API users appear here once you create one in Users.</p>`}
    </nav>`;
  }

  /** Who is being edited, and what that means; in the user view also the way back to the defaults for everything. */
  #renderEditorHead() {
    if (!this._selected) {
      const following = (this._data.apiUsers ?? []).filter((u) => !u.overriddenProducts?.length).length;
      return html`<div class="editor-head">
        <span class="defaults-icon large"><umb-icon name="icon-settings"></umb-icon></span>
        <div class="editor-title">
          <h2 tabindex="-1">Defaults</h2>
          <p class="muted">
            What every API user's MCP server gets, unless the user has its own settings for a product.
            ${following ? html`${following} of ${this._data.apiUsers.length} API users follow these for every product.` : nothing}
          </p>
        </div>
      </div>
      ${this.#renderCatalogueNote()}`;
    }
    const user = this._data.apiUsers?.find((u) => u.key === this._selected);
    const own = Object.keys(this._edit.overrides ?? {}).length;
    return html`<div class="editor-head">
        <uui-avatar class="large" name=${user?.name ?? ""}></uui-avatar>
        <div class="editor-title">
          <h2 tabindex="-1">
            ${user?.name ?? "API user"}
            ${STATE_TAGS[user?.state] ? html`<uui-tag look="secondary" color="warning">${STATE_TAGS[user.state]}</uui-tag>` : nothing}
          </h2>
          <p class="muted">
            ${user?.clientIds?.length ? html`Client id ${user.clientIds.join(", ")}. ` : nothing}
            ${own
              ? `Own settings for ${own} ${own === 1 ? "product" : "products"}; the rest follow the defaults.`
              : "Follows the defaults for every product. Customise a product to give this user its own settings."}
          </p>
        </div>
        ${own
          ? html`<uui-button
              look="secondary"
              label="Use the defaults for everything"
              ?disabled=${this._saving || this._busy}
              @click=${this.#resetAll}
            ></uui-button>`
          : nothing}
      </div>
      ${this.#renderCatalogueNote()}`;
  }

  /** Where the counts come from; in the user view also the version that user's server ran. */
  #renderCatalogueNote() {
    if (!this._selected) {
      return html`<p class="note">
        <umb-icon name="icon-info"></umb-icon>
        <span>Tool counts are the highest any API user's MCP server reported. Each user's own counts depend on its Umbraco permissions.</span>
      </p>`;
    }
    if (this._user?.catalogueSource?.kind !== "user") {
      return html`<p class="note"><umb-icon name="icon-info"></umb-icon><span>Counts appear after this user's MCP server has started once.</span></p>`;
    }
    const addonVersion = this._data.addonVersion;
    const umbrellaVersion = this._user.catalogue?.umbrellaVersion;
    return addonVersion && umbrellaVersion && umbrellaVersion !== addonVersion
      ? html`<p class="note warning">
          <umb-icon name="icon-alert"></umb-icon>
          <span>
            The add-on is ${addonVersion}, but this user's MCP server ran umbrella-mcp ${umbrellaVersion}. The two are released
            together: set umbrella-mcp@${addonVersion} in the AI tool's MCP configuration.
          </span>
        </p>`
      : nothing;
  }

  /** Save and discard, pinned to the bottom like a workspace footer. */
  #renderFooter() {
    const dirty = this.dirty;
    const who = this._selected ? `${this.#userName()}'s settings` : "the defaults";
    return html`<footer class="footer">
      <span class="footer-status" role="status">
        ${dirty
          ? html`<span class="unsaved"><span class="dot"></span>Unsaved changes to ${who}</span>`
          : html`<span class="muted">Saved changes apply the next time the MCP server starts.</span>`}
      </span>
      ${dirty
        ? html`<uui-button look="secondary" label="Discard changes" ?disabled=${this._saving || this._busy} @click=${this.#discard}></uui-button>`
        : nothing}
      <uui-button
        look="primary"
        color="positive"
        label="Save"
        .state=${this._saving ? "waiting" : undefined}
        ?disabled=${!dirty || this._saving || this._busy}
        @click=${this.#save}
      ></uui-button>
    </footer>`;
  }

  render() {
    if (this._error) return html`<uui-box headline="Umbrella"><p>Could not load the tool permissions: ${this._error}</p></uui-box>`;
    if (!this._data) return html`<uui-loader></uui-loader>`;
    if (Object.keys(this._data.catalogue?.modules ?? {}).length === 0) {
      return html`<uui-box>
        <div class="empty">
          <umb-icon name="icon-lock"></umb-icon>
          <p><strong>No tool groups reported yet</strong></p>
          <p class="muted">Start your MCP client once (it runs umbrella-mcp). Its tool groups are reported to this site, and you can set them here after reloading the page.</p>
        </div>
      </uui-box>`;
    }
    return html`
      <div class="layout">
        ${this.#renderList()}
        <div
          class="editor"
          @level-change=${(e) => this.#setLevel(e.detail.productId, e.detail.level)}
          @groups-change=${(e) => this.#setGroups(e.detail.productId, e.detail.names, e.detail.enabled)}
          @customise=${(e) => this.#setOverride(e.detail.productId, true)}
          @reset=${(e) => this.#setOverride(e.detail.productId, false)}
        >
          ${this._busy ? html`<uui-loader-bar></uui-loader-bar>` : nothing}
          ${this.#renderEditorHead()}
          ${repeat(
            this.#visibleProducts(),
            // A new card per user, so an open group list or a filter does not carry over to the next user.
            (p) => `${this._selected}:${p.id}`,
            (p) => this.#renderCard(p),
          )}
        </div>
      </div>
      ${this.#renderFooter()}
    `;
  }

  static styles = [
    UmbTextStyles,
    css`
      :host { display: flex; flex-direction: column; padding: var(--uui-size-layout-1) var(--uui-size-layout-1) 0; }
      h2 { margin: 0; }
      .muted { color: var(--uui-color-text-alt); margin: 0; }
      .layout {
        display: grid; grid-template-columns: 17rem minmax(0, 1fr); gap: var(--uui-size-layout-1); align-items: start;
        margin-bottom: var(--uui-size-layout-1);
      }
      @media (max-width: 48rem) { .layout { grid-template-columns: minmax(0, 1fr); } }

      .list {
        position: sticky; top: var(--uui-size-layout-1);
        padding: var(--uui-size-space-3); border-radius: var(--uui-border-radius);
        background: var(--uui-color-surface); box-shadow: var(--uui-shadow-depth-1);
      }
      @media (max-width: 48rem) { .list { position: static; } }
      .list ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
      .list-heading { margin: var(--uui-size-space-4) 0 var(--uui-size-space-2); padding: 0 var(--uui-size-space-3); font-size: var(--uui-type-small-size); color: var(--uui-color-text-alt); }
      .list-empty { margin: var(--uui-size-space-4) var(--uui-size-space-3) var(--uui-size-space-2); color: var(--uui-color-text-alt); font-size: var(--uui-type-small-size); }
      .entry {
        display: flex; align-items: center; gap: var(--uui-size-space-3); width: 100%;
        padding: var(--uui-size-space-2) var(--uui-size-space-3); border: 0; border-radius: var(--uui-border-radius);
        background: none; font: inherit; color: inherit; text-align: left; cursor: pointer;
      }
      .entry:hover { background: var(--uui-color-surface-emphasis); }
      .entry:focus-visible { outline: 2px solid var(--uui-color-focus); outline-offset: 1px; }
      .entry[aria-current="true"] { background: var(--uui-color-current); color: var(--uui-color-current-contrast); }
      .entry:disabled { cursor: default; }
      .entry-text { display: flex; flex-direction: column; min-width: 0; flex: 1; }
      .entry-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .entry-sub { font-size: var(--uui-type-small-size); opacity: 0.75; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      uui-avatar { flex: none; width: 2rem; height: 2rem; font-size: 0.75rem; }
      uui-avatar.large { width: 3rem; height: 3rem; font-size: 1rem; }
      .defaults-icon {
        display: inline-grid; place-items: center; flex: none; width: 2rem; height: 2rem; border-radius: 50%;
        background: var(--uui-color-surface-emphasis); color: var(--uui-color-text-alt);
      }
      .defaults-icon.large { width: 3rem; height: 3rem; font-size: 1.25rem; }

      .editor { display: flex; flex-direction: column; gap: var(--uui-size-space-5); min-width: 0; }
      .editor-head { display: flex; align-items: center; gap: var(--uui-size-space-4); flex-wrap: wrap; }
      .editor-title { flex: 1 1 20rem; min-width: 0; }
      .editor-title h2:focus { outline: none; }
      .editor-title h2 { display: flex; align-items: center; gap: var(--uui-size-space-3); font-size: var(--uui-type-h4-size, 1.5rem); }
      .editor-title p { margin-top: var(--uui-size-space-1); max-width: 75ch; }
      .note { display: flex; gap: var(--uui-size-space-2); align-items: baseline; margin: calc(var(--uui-size-space-3) * -1) 0 0; color: var(--uui-color-text-alt); max-width: 85ch; }
      .note umb-icon { flex: none; }
      .note.warning umb-icon { color: var(--uui-color-warning-standalone); }
      .note.warning { color: var(--uui-color-text); }

      .footer {
        position: sticky; bottom: 0; z-index: 1;
        display: flex; align-items: center; justify-content: flex-end; gap: var(--uui-size-space-3);
        margin: auto calc(var(--uui-size-layout-1) * -1) 0;
        padding: var(--uui-size-space-3) var(--uui-size-layout-1);
        background: var(--uui-color-surface); box-shadow: var(--uui-shadow-depth-1);
      }
      .footer-status { margin-right: auto; }
      .unsaved { display: inline-flex; align-items: center; gap: var(--uui-size-space-2); font-weight: 600; }
      .dot { color: var(--uui-color-warning-standalone); }
      .dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }

      .empty { display: flex; flex-direction: column; align-items: center; text-align: center; gap: var(--uui-size-space-2); padding: var(--uui-size-layout-2) var(--uui-size-space-5); }
      .empty > umb-icon { font-size: 2rem; color: var(--uui-color-text-alt); }
      .empty p { margin: 0; max-width: 55ch; }
    `,
  ];
}

customElements.define("umbrella-tool-groups", UmbrellaToolGroupsElement);
export default UmbrellaToolGroupsElement;
