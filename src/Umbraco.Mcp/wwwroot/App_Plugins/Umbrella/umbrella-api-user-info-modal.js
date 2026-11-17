import { css, html, nothing } from "@umbraco-cms/backoffice/external/lit";
import { UmbModalBaseElement } from "@umbraco-cms/backoffice/modal";
import { UmbTextStyles } from "@umbraco-cms/backoffice/style";
import { formatDate } from "./umbrella-api.js";
import { LEVEL_LABELS, formatRelative, glyphStyles, levelGlyph, tools } from "./umbrella-access.js";

const STATES = { active: "Active", disabled: "Disabled", lockedOut: "Locked out" };

/** A section name for people: "Umb.Section.Forms" → "Forms", "Ua.Section.Automate" → "Automate". */
const sectionLabel = (name) => name.replace(/^[A-Za-z]+\.Section\./, "");

/** The backoffice address of a user's edit page (Umbraco's user workspace). */
export const userEditPath = (key) => `/umbraco/section/user-management/workspace/user/edit/${encodeURIComponent(key)}`;

/**
 * Info for one API user in the Overview's access table: how it signs in, its connection, and what it can use.
 * Data: `{ user, products, addonVersion }` (an Overview API user row, the Overview's products and the add-on version).
 * Submits `{ action: "edit-permissions" }` or `{ action: "show-config", clientId }`; the Overview acts on it.
 */
export class UmbrellaApiUserInfoModalElement extends UmbModalBaseElement {
  #submit(value) {
    this.value = value;
    this._submitModal();
  }

  #renderState(user) {
    if (!user.connected) return html`<uui-tag look="secondary">Not connected yet</uui-tag>`;
    const color = user.state === "active" ? "positive" : "warning";
    return html`<uui-tag color=${color} look="primary">${STATES[user.state] ?? user.state}</uui-tag>`;
  }

  #renderConnection(user, addonVersion) {
    if (!user.connected) {
      return html`<div><dt>Last connected</dt><dd>Not connected yet. It shows here once its MCP server starts.</dd></div>`;
    }
    return html`<div>
        <dt>Last connected</dt>
        <dd>${formatRelative(user.lastConnected)} <span class="muted">(${formatDate(user.lastConnected)})</span></dd>
      </div>
      <div>
        <dt>MCP server</dt>
        <dd>
          ${user.serverVersion
            ? html`umbrella-mcp ${user.serverVersion}
                ${user.serverVersion === addonVersion
                  ? html`<span class="muted">, the add-on's version</span>`
                  : html`<uui-tag color="warning" look="primary">Add-on is ${addonVersion}</uui-tag>`}`
            : html`<span class="muted">Not reported yet</span>`}
        </dd>
      </div>
      ${user.lastReportedAt
        ? html`<div><dt>Last reported its tools</dt><dd>${formatRelative(user.lastReportedAt)} <span class="muted">(${formatDate(user.lastReportedAt)})</span></dd></div>`
        : nothing}`;
  }

  #renderAccess(user, products) {
    const names = Object.fromEntries((products ?? []).map((p) => [p.id, p.displayName]));
    if (!user.access?.length) return html`<p class="muted">No products reported for this API user yet.</p>`;
    return html`<ul class="access">
      ${user.access.map((a) => {
        const level = a.sectionAccess === false ? "off" : a.level;
        return html`<li>
          <span class="product">${names[a.productId] ?? a.displayName}</span>
          <span class="level">${levelGlyph(level)}${a.sectionAccess === false ? "No access" : LEVEL_LABELS[a.level] ?? a.level}</span>
          <span class="muted small">
            ${a.sectionAccess === false ? "No user group grants its section" : a.scope === "user" ? "Own settings" : "Defaults"}
            ${a.toolCount === null || a.toolCount === undefined || a.level === "off" || a.sectionAccess === false ? nothing : html` · ${tools(a.toolCount)}`}
          </span>
        </li>`;
      })}
    </ul>
    ${user.toolCount === null || user.toolCount === undefined ? nothing : html`<p class="muted small">${tools(user.toolCount)} in all at its last start.</p>`}`;
  }

  render() {
    const { user, products, addonVersion } = this.data ?? {};
    if (!user) return nothing;
    const clientId = user.clientIds?.[0];
    return html`<umb-body-layout headline=${user.name}>
      <div class="content">
        <div class="state">${this.#renderState(user)}</div>
        <uui-box headline="Sign-in">
          <dl>
            <div><dt>Client id</dt><dd class="mono">${user.clientIds?.length ? user.clientIds.join(", ") : "None"}</dd></div>
            <div><dt>State</dt><dd>${STATES[user.state] ?? user.state}</dd></div>
          </dl>
        </uui-box>
        <uui-box headline="Connection">
          <dl>${this.#renderConnection(user, addonVersion)}</dl>
        </uui-box>
        <uui-box headline="Access">
          <dl>
            <div><dt>User groups</dt><dd>${user.groups?.length ? user.groups.join(", ") : "None"}</dd></div>
            <div><dt>Sections</dt><dd>${user.sections?.length ? user.sections.map(sectionLabel).join(", ") : "None"}</dd></div>
          </dl>
          <h4>Tools per product</h4>
          ${this.#renderAccess(user, products)}
        </uui-box>
        <div class="links">
          <uui-button look="secondary" label="Edit permissions" @click=${() => this.#submit({ action: "edit-permissions" })}></uui-button>
          ${clientId
            ? html`<uui-button look="secondary" label="Show config" @click=${() => this.#submit({ action: "show-config", clientId })}></uui-button>`
            : nothing}
          <uui-button look="secondary" label="Open in Users" href=${userEditPath(user.key)}></uui-button>
        </div>
      </div>
      <div slot="actions">
        <uui-button look="primary" label="Close" @click=${() => this._rejectModal()}></uui-button>
      </div>
    </umb-body-layout>`;
  }

  static styles = [
    UmbTextStyles,
    glyphStyles,
    css`
      .content { display: flex; flex-direction: column; gap: var(--uui-size-space-5); }
      .muted { color: var(--uui-color-text-alt); }
      .small { font-size: var(--uui-type-small-size); }
      .mono { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 0.9em; }
      dl { display: flex; flex-direction: column; gap: var(--uui-size-space-3); margin: 0; }
      dt { font-size: var(--uui-type-small-size); color: var(--uui-color-text-alt); }
      dd { margin: 2px 0 0; overflow-wrap: anywhere; display: flex; flex-wrap: wrap; align-items: center; gap: var(--uui-size-space-2); }
      h4 { margin: var(--uui-size-space-5) 0 var(--uui-size-space-3); font-size: var(--uui-type-default-size); }
      .access { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--uui-size-space-3); }
      .access li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px var(--uui-size-space-3); }
      .access .product { font-weight: 600; }
      .access .level { display: inline-flex; align-items: center; gap: var(--uui-size-space-2); justify-self: end; }
      .access .muted { grid-column: 1 / -1; }
      .access p { margin: 0; }
      .links { display: flex; flex-wrap: wrap; gap: var(--uui-size-space-2); }
    `,
  ];
}

customElements.define("umbrella-api-user-info-modal", UmbrellaApiUserInfoModalElement);
export default UmbrellaApiUserInfoModalElement;
