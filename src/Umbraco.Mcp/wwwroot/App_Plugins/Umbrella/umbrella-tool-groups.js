import { css, html, nothing } from "@umbraco-cms/backoffice/external/lit";
import { UmbLitElement } from "@umbraco-cms/backoffice/lit-element";
import { UMB_AUTH_CONTEXT } from "@umbraco-cms/backoffice/auth";
import { umbConfirmModal } from "@umbraco-cms/backoffice/modal";
import { UMB_NOTIFICATION_CONTEXT } from "@umbraco-cms/backoffice/notification";
import { UmbTextStyles } from "@umbraco-cms/backoffice/style";
import { LEVEL_LABELS, glyphStyles, levelGlyph } from "./umbrella-access.js";
import { request } from "./umbrella-api.js";
import "./umbrella-product-card.js";
import { groupKeptCount, pruneDisabledTools } from "./umbrella-tool-logic.js";
import { UmbrellaUnsavedGuard } from "./umbrella-unsaved-guard.js";

/** The product the MCP server signs in through; the add-on refuses to switch it off. */
const REQUIRED_PRODUCT = "cms";
const STATE_TAGS = { disabled: "Disabled", lockedOut: "Locked out" };

/**
 * Settings → Umbrella → Tool Permissions.
 * Left sidebar: who is being edited (Defaults or an active API user).
 * Right workspace: compact target header, stretching product boxes, and the active product's permission editor.
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
    _activeProduct: { state: true },
    _userFilter: { state: true },
  };

  #auth;
  #notifications;
  #pendingUser = null;
  #pendingProduct = null;
  #snapshot = "";

  constructor() {
    super();
    this._data = null;
    this._error = null;
    this._saving = false;
    this._busy = false;
    this._selected = "";
    this._user = null;
    this._edit = { disabled: {}, levels: {}, tools: {} };
    this._activeProduct = "";
    this._userFilter = "";
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
    if (this.#pendingUser !== null) {
      const key = this.#pendingUser;
      const productId = this.#pendingProduct;
      this.#pendingUser = null;
      this.#pendingProduct = null;
      await this.selectUser(key, productId);
    }
  }

  /** The saved defaults, as editable state. */
  #savedDefaults() {
    const modules = this._data.catalogue?.modules ?? {};
    const saved = this._data.disabledCollections ?? {};
    const disabled = {};
    for (const [id, m] of Object.entries(modules)) {
      disabled[id] = new Set(id in saved ? saved[id] : (m.collections ?? []).filter((c) => c.disabledByDefault).map((c) => c.name));
    }
    for (const [id, names] of Object.entries(saved)) disabled[id] ??= new Set(names);
    const levels = {};
    for (const id of this._data.noDestructiveModules ?? []) levels[id] = "noDestructive";
    for (const id of this._data.readOnlyModules ?? []) levels[id] = "readOnly";
    for (const id of this._data.offModules ?? []) levels[id] = "off";
    const toolsMap = {};
    for (const [id, names] of Object.entries(this._data.disabledTools ?? {})) toolsMap[id] = new Set(names);
    return { disabled, levels, tools: toolsMap };
  }

  /** The saved defaults for one product: what a user follows, and what "Customise" starts from. */
  #defaultsFor(id) {
    const { disabled, levels, tools: toolsMap } = this.#savedDefaults();
    return { disabled: new Set(disabled[id] ?? []), level: levels[id] ?? "full", tools: new Set(toolsMap[id] ?? []) };
  }

  #ensureActiveProduct(preferredId) {
    const visible = this.#visibleProducts();
    if (!visible.length) {
      this._activeProduct = "";
      return;
    }
    if (preferredId && visible.some((p) => p.id === preferredId)) {
      this._activeProduct = preferredId;
      return;
    }
    if (!visible.some((p) => p.id === this._activeProduct)) {
      this._activeProduct = visible[0].id;
    }
  }

  #showDefaults(preferredProductId) {
    this._selected = "";
    this._user = null;
    this._edit = this.#savedDefaults();
    this.#snapshot = JSON.stringify(this.#body());
    this.#ensureActiveProduct(preferredProductId);
  }

  /** Shows an API user's settings, with nothing unsaved. */
  #showUser(key, user, preferredProductId) {
    this._selected = key;
    this._user = user;
    this._edit = {
      overrides: Object.fromEntries(
        Object.entries(user.overrides ?? {}).map(([id, o]) => [
          id,
          { disabled: new Set(o.disabledCollections ?? []), level: o.level ?? "full", tools: new Set(o.disabledTools ?? []) },
        ]),
      ),
    };
    this.#snapshot = JSON.stringify(this.#body());
    this.#ensureActiveProduct(preferredProductId);
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
  async selectUser(key, productId) {
    if (!this._data) {
      this.#pendingUser = key;
      this.#pendingProduct = productId ?? null;
      return;
    }
    if (key === this._selected) {
      if (productId) this.#ensureActiveProduct(productId);
      return;
    }
    if (this._busy) {
      this.#pendingUser = key;
      this.#pendingProduct = productId ?? null;
      return;
    }
    if (!(await this.confirmLeave())) return;
    if (key && !this._data.apiUsers?.some((u) => u.key === key)) await this.#load();
    if (key && !this.#listedUsers().some((u) => u.key === key)) key = "";
    if (key === this._selected) {
      if (productId) this.#ensureActiveProduct(productId);
      return;
    }
    if (key === "") {
      this.#showDefaults(productId);
      return;
    }
    this._busy = true;
    try {
      this.#showUser(key, await request(this.#auth, "GET", `tool-settings/users/${key}`), productId);
    } catch (error) {
      this.#notifications?.peek("danger", { data: { headline: "Could not load the API user's tool settings", message: error.message } });
    } finally {
      this._busy = false;
    }
    const next = this.#pendingUser;
    const nextProduct = this.#pendingProduct;
    this.#pendingUser = null;
    this.#pendingProduct = null;
    if (next !== null) await this.selectUser(next, nextProduct);
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

  #showCounts(id) {
    if (!this._selected) return true;
    return this._user?.catalogueSource?.kind === "user" && !!this._user.catalogue?.modules?.[id];
  }

  /** The PUT body for the current edits. Built the same way for the snapshot, so equal state gives an equal body. */
  #body() {
    const detected = this._data.products.map((p) => p.id);
    const names = (id, disabled) => {
      const module = this.#moduleFor(id);
      return module ? module.collections.map((c) => c.name).filter((n) => disabled.has(n)) : [...disabled].sort();
    };
    const toolNames = (id, set) => [...pruneDisabledTools(set ?? new Set(), this._data.catalogue?.modules?.[id])].sort();
    if (this._selected) {
      const overrides = this._edit.overrides ?? {};
      return {
        overrides: Object.fromEntries(
          detected
            .filter((id) => overrides[id])
            .map((id) => [
              id,
              { disabledCollections: names(id, overrides[id].disabled), disabledTools: toolNames(id, overrides[id].tools), level: overrides[id].level },
            ]),
        ),
      };
    }
    const { disabled = {}, levels = {}, tools: toolsMap = {} } = this._edit;
    const reported = this._data.catalogue?.modules ?? {};
    return {
      disabledCollections: Object.fromEntries(detected.filter((id) => reported[id]).map((id) => [id, names(id, disabled[id] ?? new Set())])),
      disabledTools: Object.fromEntries(detected.map((id) => [id, toolNames(id, toolsMap[id])]).filter(([, list]) => list.length > 0)),
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

  #setTools(id, names, enabled) {
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
      this._edit = { overrides: { ...this._edit.overrides, [id]: { ...override, tools: edit(override.tools) } } };
    } else {
      this._edit = { ...this._edit, tools: { ...this._edit.tools, [id]: edit(this._edit.tools?.[id]) } };
    }
  }

  #setOverride(id, customise) {
    if (this._busy || this._saving) return;
    const overrides = { ...this._edit.overrides };
    if (customise) overrides[id] = this.#defaultsFor(id);
    else delete overrides[id];
    this._edit = { overrides };
  }

  async #save() {
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
        await this.#load();
        this.#showUser(key, await request(this.#auth, "GET", `tool-settings/users/${key}`), this._activeProduct);
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

  #visibleProducts() {
    const noAccess = this._selected ? (this._user?.noSectionAccess ?? []) : [];
    return (this._data?.products ?? []).filter((p) => p.installed && !noAccess.includes(p.id));
  }

  #listedUsers() {
    return (this._data?.apiUsers ?? []).filter((u) => u.state !== "disabled");
  }

  #productState(product) {
    const id = product.id;
    if (this._selected) {
      const override = this._edit.overrides?.[id];
      const mode = override ? "custom" : "follows";
      const state = override ?? this.#defaultsFor(id);
      return { state, mode };
    }
    return {
      mode: "defaults",
      state: {
        disabled: this._edit.disabled[id] ?? new Set(),
        level: this._edit.levels[id] ?? "full",
        tools: this._edit.tools?.[id] ?? new Set(),
      },
    };
  }

  #productToolSummary(product, state) {
    if (state.level === "off") return null;
    if (!this.#showCounts(product.id)) return null;
    const module = this.#moduleFor(product.id);
    if (!module?.collections?.length) return null;
    const total = module.collections.reduce((sum, c) => sum + c.toolCount, 0);
    const kept = module.collections.reduce(
      (sum, c) =>
        sum +
        groupKeptCount(c, {
          level: state.level,
          groupOn: !state.disabled.has(c.name),
          disabledTools: state.tools ?? new Set(),
        }),
      0,
    );
    return { kept, total };
  }

  /**
   * Stretching product boxes inside the header box. When fewer products are available (e.g. due to section access),
   * the boxes grow to fill the available row width; when more products are added in the future, they wrap and fill cleanly.
   */
  #renderProductTabs(products) {
    return html`<div class="product-tabs-bar">
      <div class="product-tabs" role="tablist" aria-label="Products">
        ${products.map((p) => {
          const active = p.id === this._activeProduct;
          const { state, mode } = this.#productState(p);
          const counts = this.#productToolSummary(p, state);
          const shortName = p.displayName.replace(/^Umbraco /, "");
          const levelLabel = LEVEL_LABELS[state.level] ?? LEVEL_LABELS.full;
          const follows = mode === "follows";
          return html`<button
            type="button"
            role="tab"
            class="product-tab ${state.level === "off" ? "is-off" : ""} ${follows ? "is-follows" : ""} ${mode === "custom" ? "is-custom" : ""}"
            aria-selected=${active ? "true" : "false"}
            title=${follows ? `Follows site default (${levelLabel})` : nothing}
            @click=${() => (this._activeProduct = p.id)}
          >
            ${mode === "custom" ? html`<span class="custom-notch">Custom</span>` : nothing}
            <div class="product-tab-top">
              <span class="product-tab-name">${shortName}</span>
            </div>
            <div class="product-tab-meta">
              ${follows
                ? html`<span class="product-tab-level is-follows">
                    <umb-icon class="glyph" aria-hidden="true" name="icon-settings"></umb-icon>
                    <span>Follows default</span>
                  </span>`
                : html`<span class="product-tab-level">
                    ${levelGlyph(state.level)}
                    <span>${levelLabel}</span>
                  </span>`}
              ${counts ? html`<span class="product-tab-count-slot"><span class="product-tab-count">${counts.kept}/${counts.total}</span></span>` : nothing}
            </div>
          </button>`;
        })}
      </div>
    </div>`;
  }

  #renderCard(product) {
    const id = product.id;
    const module = this.#moduleFor(id);
    const userName = this.#userName();
    const { state, mode } = this.#productState(product);
    return html`<umbrella-product-card
      .product=${product}
      .module=${module}
      .level=${state.level}
      .disabled=${state.disabled}
      .disabledTools=${state.tools ?? new Set()}
      .editable=${mode !== "follows" && !this._saving && !this._busy}
      .locked=${this._saving || this._busy}
      .showCounts=${this.#showCounts(id)}
      .mode=${mode}
      .userKey=${this._selected}
      .userName=${userName}
      .defaultLevel=${this._selected ? this.#defaultsFor(id).level : null}
      .isRequired=${id === REQUIRED_PRODUCT}
      .notes=${[]}
    ></umbrella-product-card>`;
  }

  #userName() {
    return this._data.apiUsers?.find((u) => u.key === this._selected)?.name ?? "this API user";
  }

  #renderList() {
    const users = this.#listedUsers();
    const needle = this._userFilter.trim().toLowerCase();
    const filteredUsers = needle
      ? users.filter((u) => u.name.toLowerCase().includes(needle) || (u.clientIds ?? []).some((id) => id.toLowerCase().includes(needle)))
      : users;

    const entry = (key, name, sub, avatar, tag) => html`<li>
      <button
        type="button"
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
      <div class="list-section">
        <span class="list-heading">Site-wide</span>
        <ul>
          ${entry(
            "",
            "Defaults",
            "Shared by default",
            html`<span class="defaults-icon"><umb-icon name="icon-settings"></umb-icon></span>`,
          )}
        </ul>
      </div>
      <div class="list-section">
        <div class="list-heading-row">
          <span class="list-heading">API users</span>
          ${users.length ? html`<span class="trailing-slot"><uui-tag class="compact-tag" look="secondary">${users.length}</uui-tag></span>` : nothing}
        </div>
        ${users.length > 3
          ? html`<uui-input
              class="user-filter"
              label="Filter API users"
              placeholder="Filter users..."
              .value=${this._userFilter}
              @input=${(e) => (this._userFilter = e.target.value)}
            >
              <umb-icon slot="prepend" name="icon-search"></umb-icon>
            </uui-input>`
          : nothing}
        ${users.length
          ? filteredUsers.length
            ? html`<ul>
                ${filteredUsers.map((u) => {
                  const own = u.overriddenProducts?.length ?? 0;
                  const hasTags = !!STATE_TAGS[u.state] || own > 0;
                  const tag = hasTags
                    ? html`<span class="entry-tags">
                        ${STATE_TAGS[u.state] ? html`<uui-tag class="compact-tag" look="secondary" color="warning">${STATE_TAGS[u.state]}</uui-tag>` : nothing}
                        ${own
                          ? html`<span class="trailing-slot">
                              <span
                                class="custom-dot"
                                title=${`Custom settings for ${own} ${own === 1 ? "product" : "products"}`}
                                aria-label=${`Custom settings for ${own} ${own === 1 ? "product" : "products"}`}
                              ></span>
                            </span>`
                          : nothing}
                      </span>`
                    : nothing;
                  return entry(u.key, u.name, null, html`<uui-avatar name=${u.name}></uui-avatar>`, tag);
                })}
              </ul>`
            : html`<p class="list-empty">No API user matches "${this._userFilter}".</p>`
          : html`<p class="list-empty">No API users yet.</p>`}
      </div>
    </nav>`;
  }

  /** Compact target header + product selector boxes inside one top card. */
  #renderEditorHead(visibleProducts) {
    if (!this._selected) {
      return html`<uui-box class="target-box">
        <div class="editor-head">
          <span class="defaults-icon large"><umb-icon name="icon-settings"></umb-icon></span>
          <div class="editor-title">
            <div class="title-row">
              <h2 tabindex="-1">Defaults</h2>
            </div>
          </div>
        </div>
        ${visibleProducts.length > 0 ? this.#renderProductTabs(visibleProducts) : nothing}
      </uui-box>`;
    }
    const user = this._data.apiUsers?.find((u) => u.key === this._selected);
    return html`<uui-box class="target-box">
      <div class="editor-head">
        <uui-avatar class="large" name=${user?.name ?? ""}></uui-avatar>
        <div class="editor-title">
          <div class="title-row">
            <h2 tabindex="-1">${user?.name ?? "API user"}</h2>
            ${STATE_TAGS[user?.state] ? html`<uui-tag look="secondary" color="warning">${STATE_TAGS[user.state]}</uui-tag>` : nothing}
            ${user?.clientIds?.length ? html`<span class="client-pill">${user.clientIds.join(", ")}</span>` : nothing}
          </div>
        </div>
      </div>
      ${visibleProducts.length > 0 ? this.#renderProductTabs(visibleProducts) : nothing}
    </uui-box>`;
  }

  /** Save and discard, pinned to the bottom like a workspace footer. */
  #renderFooter() {
    const dirty = this.dirty;
    const who = this._selected ? `${this.#userName()}'s settings` : "the defaults";
    return html`<footer class="footer">
      <span class="footer-status" role="status">
        ${dirty
          ? html`<span class="unsaved"><span class="dot"></span>Unsaved changes to ${who}</span>`
          : nothing}
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
    if (this._error) return html`<uui-box class="error-box" headline="Umbrella"><p>Could not load the tool permissions: ${this._error}</p></uui-box>`;
    if (!this._data) return html`<div class="loader-wrap"><uui-loader></uui-loader></div>`;
    if (Object.keys(this._data.catalogue?.modules ?? {}).length === 0) {
      return html`<uui-box class="empty-box">
        <div class="empty">
          <span class="empty-icon"><umb-icon name="icon-lock"></umb-icon></span>
          <p><strong>No tool groups reported yet</strong></p>
          <p class="muted">Start your MCP client once so it reports its tool groups to this site.</p>
        </div>
      </uui-box>`;
    }
    const visible = this.#visibleProducts();
    const activeProduct = visible.find((p) => p.id === this._activeProduct) ?? visible[0] ?? null;
    const activeMode = activeProduct ? this.#productState(activeProduct).mode : null;

    return html`
      <div class="layout ${activeMode === "follows" ? "is-follows" : ""}">
        <div class="sidebar-col">${this.#renderList()}</div>
        <div
          class="editor"
          @level-change=${(e) => this.#setLevel(e.detail.productId, e.detail.level)}
          @groups-change=${(e) => this.#setGroups(e.detail.productId, e.detail.names, e.detail.enabled)}
          @tools-change=${(e) => this.#setTools(e.detail.productId, e.detail.names, e.detail.enabled)}
          @customise=${(e) => this.#setOverride(e.detail.productId, true)}
          @reset=${(e) => this.#setOverride(e.detail.productId, false)}
        >
          ${this._busy ? html`<uui-loader-bar></uui-loader-bar>` : nothing}
          ${this.#renderEditorHead(visible)}
          ${activeProduct ? this.#renderCard(activeProduct) : nothing}
        </div>
      </div>
      ${this.#renderFooter()}
    `;
  }

  static styles = [
    UmbTextStyles,
    glyphStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        padding: var(--uui-size-layout-1) var(--uui-size-layout-1) 0;
      }
      h2 {
        margin: 0;
      }
      .muted {
        color: var(--uui-color-text-alt);
        margin: 0;
      }
      .loader-wrap {
        display: flex;
        justify-content: center;
        margin-top: var(--umbrella-subnav-offset, 0px);
        padding: var(--uui-size-layout-2);
      }
      .empty-box,
      .error-box {
        margin-top: var(--umbrella-subnav-offset, 0px);
        margin-bottom: var(--uui-size-layout-1);
      }
      .layout {
        display: grid;
        grid-template-columns: 18rem minmax(0, 1fr);
        gap: var(--uui-size-layout-1);
        align-items: stretch;
        margin-bottom: var(--uui-size-layout-1);
      }
      .sidebar-col {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      .layout.is-follows .list,
      .layout.is-follows umbrella-product-card {
        flex: 1;
      }
      @media (max-width: 56rem) {
        .layout {
          grid-template-columns: minmax(0, 1fr);
        }
        .layout.is-follows .list,
        .layout.is-follows umbrella-product-card {
          flex: none;
        }
        .loader-wrap,
        .empty-box,
        .error-box {
          margin-top: 0;
        }
      }

      .list {
        position: sticky;
        top: var(--uui-size-layout-1);
        margin-top: var(--umbrella-subnav-offset, 0px);
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        gap: var(--uui-size-space-4);
        padding: var(--uui-size-space-4);
        border-radius: var(--uui-border-radius);
        background: var(--uui-color-surface);
        box-shadow: var(--uui-shadow-depth-1);
      }
      @media (max-width: 56rem) {
        .list {
          position: static;
          margin-top: 0;
        }
      }
      .list-section {
        display: flex;
        flex-direction: column;
        gap: var(--uui-size-space-2);
      }
      .list-section + .list-section {
        padding-top: var(--uui-size-space-3);
        border-top: 1px solid var(--uui-color-divider);
      }
      .list-heading-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 calc(var(--uui-size-space-3) + 1px) 0 var(--uui-size-space-2);
      }
      .list-heading {
        padding: 0 var(--uui-size-space-2);
        font-size: var(--uui-type-small-size);
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--uui-color-text-alt);
      }
      .list-heading-row .list-heading {
        padding: 0;
      }
      .user-filter {
        width: 100%;
      }
      .user-filter umb-icon {
        margin-left: var(--uui-size-space-3);
        color: var(--uui-color-text-alt);
      }
      .list ul {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .list-empty {
        margin: var(--uui-size-space-2);
        color: var(--uui-color-text-alt);
        font-size: var(--uui-type-small-size);
      }
      .entry {
        display: flex;
        align-items: center;
        gap: var(--uui-size-space-3);
        width: 100%;
        padding: var(--uui-size-space-2) var(--uui-size-space-3);
        border: 1px solid transparent;
        border-radius: var(--uui-border-radius);
        background: none;
        font: inherit;
        color: inherit;
        text-align: left;
        cursor: pointer;
        transition: background-color 120ms ease, border-color 120ms ease;
      }
      .entry:hover {
        background: var(--uui-color-surface-alt);
        border-color: var(--uui-color-border);
      }
      .entry:focus-visible {
        outline: 2px solid var(--uui-color-focus);
        outline-offset: 1px;
      }
      .entry[aria-current="true"] {
        background: var(--uui-color-current);
        color: var(--uui-color-current-contrast);
      }
      .entry:disabled {
        cursor: default;
      }
      .entry-text {
        display: flex;
        flex-direction: column;
        min-width: 0;
        flex: 1;
      }
      .entry-name {
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .entry-sub {
        font-size: var(--uui-type-small-size);
        opacity: 0.78;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .entry-tags {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        flex: none;
      }
      .trailing-slot {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 1.5rem;
        flex: none;
      }
      .custom-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        flex: none;
        background: var(--uui-color-interactive-emphasis, #2152a3);
      }
      uui-tag.compact-tag {
        flex: none;
        --uui-tag-font-size: 0.6875rem;
        --uui-tag-padding: 0 6px;
      }
      uui-avatar {
        flex: none;
        width: 2rem;
        height: 2rem;
        font-size: 0.75rem;
      }
      uui-avatar.large {
        width: 2.25rem;
        height: 2.25rem;
        font-size: 0.85rem;
      }
      .defaults-icon {
        display: inline-grid;
        place-items: center;
        flex: none;
        width: 2rem;
        height: 2rem;
        border-radius: 50%;
        background: var(--uui-color-surface-emphasis);
        color: var(--uui-color-text-alt);
      }
      .entry[aria-current="true"] .defaults-icon {
        background: rgba(255, 255, 255, 0.18);
        color: var(--uui-color-current-contrast);
      }
      .defaults-icon.large {
        width: 2.25rem;
        height: 2.25rem;
        font-size: 1.05rem;
      }

      .editor {
        position: relative;
        display: flex;
        flex-direction: column;
        gap: var(--uui-size-space-4);
        min-width: 0;
      }
      .editor > uui-loader-bar {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        z-index: 1;
        pointer-events: none;
      }
      .editor-head {
        display: flex;
        align-items: center;
        gap: var(--uui-size-space-3);
        flex-wrap: wrap;
        min-height: 2.25rem;
      }
      .editor-title {
        flex: 1 1 16rem;
        min-width: 0;
      }
      .title-row {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: var(--uui-size-space-3);
      }
      .editor-title h2:focus {
        outline: none;
      }
      .editor-title h2 {
        font-size: var(--uui-type-h5-size, 1.15rem);
      }
      .client-pill {
        display: inline-block;
        padding: 2px var(--uui-size-space-3);
        border-radius: 999px;
        background: var(--uui-color-surface-alt);
        border: 1px solid var(--uui-color-divider);
        font-family: var(--uui-font-monospace, ui-monospace, Menlo, Consolas, monospace);
        font-size: var(--uui-type-small-size);
        color: var(--uui-color-text-alt);
      }

      .product-tabs-bar {
        margin-top: var(--uui-size-space-4);
        padding-top: var(--uui-size-space-4);
        border-top: 1px solid var(--uui-color-divider);
      }
      .product-tabs {
        display: flex;
        flex-wrap: wrap;
        gap: var(--uui-size-space-3);
      }
      .product-tab {
        position: relative;
        flex: 1 1 11rem;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        gap: 6px;
        padding: var(--uui-size-space-3) var(--uui-size-space-4);
        border: 1px solid var(--uui-color-border);
        border-radius: var(--uui-border-radius);
        background: var(--uui-color-surface-alt);
        font: inherit;
        color: inherit;
        text-align: left;
        cursor: pointer;
        transition: border-color 120ms ease, background-color 120ms ease, box-shadow 120ms ease;
      }
      .custom-notch {
        position: absolute;
        top: 0;
        right: var(--uui-size-space-4);
        width: 4.5rem;
        box-sizing: border-box;
        padding: 3px 0 4px;
        border: 1px solid rgba(33, 82, 163, 0.24);
        border-top: 0;
        border-radius: 0 0 7px 7px;
        background: rgba(33, 82, 163, 0.12);
        color: var(--uui-color-interactive-emphasis, #2152a3);
        font-size: 0.75rem;
        font-weight: 700;
        line-height: 1.25;
        text-align: center;
        white-space: nowrap;
        pointer-events: none;
      }
      .product-tab[aria-selected="true"] .custom-notch {
        top: 1px;
      }
      .product-tab.is-custom .product-tab-top {
        padding-right: 5rem;
      }
      .product-tab:hover {
        border-color: var(--uui-color-border-emphasis);
        background: var(--uui-color-surface);
      }
      .product-tab:focus-visible {
        outline: 2px solid var(--uui-color-focus);
        outline-offset: 2px;
      }
      .product-tab.is-follows {
        border-style: dashed;
      }
      .product-tab[aria-selected="true"] {
        border-style: solid;
        border-color: var(--uui-color-selected);
        background: var(--uui-color-surface);
        box-shadow: inset 0 0 0 1px var(--uui-color-selected);
      }
      .product-tab-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--uui-size-space-2);
        min-height: 1.35rem;
      }
      .product-tab-name {
        font-weight: 700;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .product-tab[aria-selected="true"] .product-tab-name {
        color: var(--uui-color-selected);
      }
      .product-tab-meta {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--uui-size-space-2);
      }
      .product-tab-level {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: var(--uui-type-small-size);
        font-weight: 600;
        color: var(--uui-color-text);
      }
      .product-tab.is-off .product-tab-level,
      .product-tab-level.is-follows {
        color: var(--uui-color-text-alt);
        font-weight: 500;
      }
      .product-tab-count-slot {
        display: inline-flex;
        justify-content: center;
        min-width: 4.5rem;
        flex: none;
      }
      .product-tab-count {
        padding: 1px var(--uui-size-space-2);
        border-radius: 999px;
        background: var(--uui-color-surface-emphasis);
        color: var(--uui-color-text-alt);
        font-size: var(--uui-type-small-size);
        font-variant-numeric: tabular-nums;
      }

      .footer {
        position: sticky;
        bottom: 0;
        z-index: 2;
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: var(--uui-size-space-3);
        margin: auto calc(var(--uui-size-layout-1) * -1) 0;
        padding: var(--uui-size-space-3) var(--uui-size-layout-1);
        background: var(--uui-color-surface);
        box-shadow: var(--uui-shadow-depth-2, var(--uui-shadow-depth-1));
        border-top: 1px solid var(--uui-color-divider);
      }
      .footer-status {
        margin-right: auto;
      }
      .unsaved {
        display: inline-flex;
        align-items: center;
        gap: var(--uui-size-space-2);
        font-weight: 600;
      }
      .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        color: var(--uui-color-warning-standalone);
        background: currentColor;
      }

      .empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        gap: var(--uui-size-space-2);
        padding: var(--uui-size-layout-2) var(--uui-size-space-5);
      }
      .empty-icon {
        display: inline-grid;
        place-items: center;
        width: 3.5rem;
        height: 3.5rem;
        border-radius: 50%;
        background: var(--uui-color-surface-alt);
        color: var(--uui-color-text-alt);
        font-size: 1.75rem;
        margin-bottom: var(--uui-size-space-2);
      }
      .empty p {
        margin: 0;
        max-width: 55ch;
      }
    `,
  ];
}

customElements.define("umbrella-tool-groups", UmbrellaToolGroupsElement);
export default UmbrellaToolGroupsElement;
