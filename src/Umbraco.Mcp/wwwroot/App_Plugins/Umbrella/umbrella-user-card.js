import { css, html, nothing } from "@umbraco-cms/backoffice/external/lit";
import { UmbLitElement } from "@umbraco-cms/backoffice/lit-element";
import { UmbTextStyles } from "@umbraco-cms/backoffice/style";
import { formatDate } from "./umbrella-api.js";

const STATE_TAGS = { disabled: "Disabled", lockedOut: "Locked out" };
const ACCESS_LABELS = { full: "Full", noDestructive: "No deletes", readOnly: "Read-only", off: "Off" };

const tools = (n) => `${n} ${n === 1 ? "tool" : "tools"}`;

/**
 * One API user an MCP server connected as, on the Overview: who it is, when it last connected, and per product the
 * access its server gets. It holds no state; "Edit permissions" and "Forget" are events for the Overview.
 *
 * Events (bubbling, composed): `edit-permissions` { key } and `forget` { key }.
 */
export class UmbrellaUserCardElement extends UmbLitElement {
  static properties = {
    user: { attribute: false },
    busy: { attribute: false },
  };

  constructor() {
    super();
    this.user = null;
    this.busy = false;
  }

  #emit(type) {
    this.dispatchEvent(new CustomEvent(type, { detail: { key: this.user.key }, bubbles: true, composed: true }));
  }

  /** One chip per product: its access and how many tools the user's last start got with it. Own settings are outlined. */
  #renderChip(a) {
    const level = ACCESS_LABELS[a.level] ?? ACCESS_LABELS.full;
    const count = a.level === "off" || a.toolCount === null || a.toolCount === undefined ? "" : ` · ${a.toolCount}`;
    const own = a.scope === "user";
    return html`<uui-tag
      class=${a.level === "off" ? "off" : ""}
      look=${own ? "outline" : "secondary"}
      title=${`${a.displayName}: ${level}${count ? `, ${tools(a.toolCount)}` : ""} (${own ? "own settings" : "defaults"})`}
      >${a.displayName.replace(/^Umbraco /, "")} · ${level}${count}</uui-tag
    >`;
  }

  #renderMeta(u) {
    const parts = [
      u.clientIds?.length ? u.clientIds.join(", ") : null,
      `last connected ${formatDate(u.lastConnected)}`,
      u.serverVersion ? `umbrella-mcp ${u.serverVersion}` : null,
    ].filter(Boolean);
    return html`<p class="meta">${parts.join(" · ")}</p>`;
  }

  render() {
    const u = this.user;
    if (!u) return nothing;
    const custom = (u.access ?? []).some((a) => a.scope === "user");
    const popover = `more-${u.key}`;
    return html`<div class="card">
      <div class="head">
        <div class="who">
          <strong>${u.name}</strong>
          ${custom ? html`<uui-tag look="secondary">custom</uui-tag>` : nothing}
          ${STATE_TAGS[u.state] ? html`<uui-tag color="warning" look="primary">${STATE_TAGS[u.state]}</uui-tag>` : nothing}
        </div>
        <div class="actions">
          <uui-button look="secondary" label="Edit permissions" @click=${() => this.#emit("edit-permissions")}></uui-button>
          <uui-button look="secondary" compact label="More actions" popovertarget=${popover}>
            <uui-symbol-more></uui-symbol-more>
          </uui-button>
          <uui-popover-container id=${popover} placement="bottom-end">
            <umb-popover-layout>
              <uui-menu-item label="Forget connection" ?disabled=${this.busy} @click-label=${() => this.#emit("forget")}>
                <umb-icon slot="icon" name="icon-trash"></umb-icon>
              </uui-menu-item>
            </umb-popover-layout>
          </uui-popover-container>
        </div>
      </div>
      ${this.#renderMeta(u)}
      ${u.access?.length
        ? html`<div class="chips">${u.access.map((a) => this.#renderChip(a))}</div>`
        : html`<p class="muted">Tool access appears after this user's MCP server has started with this add-on version.</p>`}
      ${u.toolCount === null || u.toolCount === undefined ? nothing : html`<p class="muted total">${tools(u.toolCount)} in total</p>`}
      ${u.unreachable?.length
        ? html`<p class="warning">
            <umb-icon name="icon-alert"></umb-icon>
            Can't reach ${u.unreachable.join(", ")}: none of its user groups grant the section.
          </p>`
        : nothing}
    </div>`;
  }

  static styles = [
    UmbTextStyles,
    css`
      :host { display: block; }
      .card {
        padding: var(--uui-size-space-4) var(--uui-size-space-5);
        border: 1px solid var(--uui-color-border);
        border-radius: var(--uui-border-radius);
        background: var(--uui-color-surface);
      }
      .head { display: flex; align-items: center; justify-content: space-between; gap: var(--uui-size-space-3); flex-wrap: wrap; }
      .who { display: flex; align-items: center; gap: var(--uui-size-space-2); flex-wrap: wrap; min-width: 0; }
      .actions { display: flex; align-items: center; gap: var(--uui-size-space-2); }
      .meta { margin: var(--uui-size-space-1) 0 var(--uui-size-space-3); color: var(--uui-color-text-alt); font-size: var(--uui-type-small-size); overflow-wrap: anywhere; }
      .chips { display: flex; flex-wrap: wrap; gap: var(--uui-size-space-2); }
      uui-tag.off { opacity: 0.6; }
      .muted { color: var(--uui-color-text-alt); margin: 0; }
      .total { margin-top: var(--uui-size-space-2); font-size: var(--uui-type-small-size); }
      .warning { display: flex; align-items: center; gap: var(--uui-size-space-2); margin: var(--uui-size-space-3) 0 0; color: var(--uui-color-warning-standalone); }
    `,
  ];
}

customElements.define("umbrella-user-card", UmbrellaUserCardElement);
export default UmbrellaUserCardElement;
