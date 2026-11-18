import { css, html, nothing } from "@umbraco-cms/backoffice/external/lit";
import { UmbModalBaseElement } from "@umbraco-cms/backoffice/modal";
import { UmbTextStyles } from "@umbraco-cms/backoffice/style";
import { formatDate } from "./umbrella-api.js";
import { LEVEL_LABELS, formatRelative, glyphStyles, levelGlyph, tools } from "./umbrella-access.js";
import { formatApproxTokens, formatSizeTooltip } from "./umbrella-tool-size.js";

const STATES = { active: "Active", disabled: "Disabled", lockedOut: "Locked out" };

/** A section name for people: "Umb.Section.Forms" → "Forms", "Ua.Section.Automate" → "Automate". */
const sectionLabel = (name) => name.replace(/^[A-Za-z]+\.Section\./, "");

/** The backoffice address of a user's edit page (Umbraco's user workspace). */
export const userEditPath = (key) => `/umbraco/section/user-management/workspace/user/edit/${encodeURIComponent(key)}`;

/**
 * Info for one API user in the Overview's access table: how it signs in, its connection, and what it can use.
 * Data: `{ user, products, addonVersion }` (an Overview API user row, the Overview's products and the add-on version).
 * Read-only; it only closes.
 */
export class UmbrellaApiUserInfoModalElement extends UmbModalBaseElement {
  #renderState(user) {
    if (!user.connected) return html`<uui-tag look="secondary">Not connected yet</uui-tag>`;
    const color = user.state === "active" ? "positive" : "warning";
    return html`<uui-tag color=${color} look="primary">${STATES[user.state] ?? user.state}</uui-tag>`;
  }

  #renderConnection(user, addonVersion) {
    if (!user.connected) {
      return html`<div><dt>Last connected</dt><dd>Not connected yet. Appears here once its MCP server starts.</dd></div>`;
    }
    return html`<div>
        <dt>Last connected</dt>
        <dd>${formatRelative(user.lastConnected)} <span class="muted">(${formatDate(user.lastConnected)})</span></dd>
      </div>
      <div>
        <dt>MCP server</dt>
        <dd>
          ${user.serverVersion
            ? html`<code>umbrella-mcp ${user.serverVersion}</code>
                ${user.serverVersion === addonVersion
                  ? html`<uui-tag class="compact-tag" look="secondary" color="positive">Matches add-on</uui-tag>`
                  : html`<uui-tag class="compact-tag" color="warning" look="primary">Add-on is ${addonVersion}</uui-tag>`}`
            : html`<span class="muted">Not reported yet</span>`}
        </dd>
      </div>
      ${user.lastReportedAt
        ? html`<div><dt>Last reported tools</dt><dd>${formatRelative(user.lastReportedAt)} <span class="muted">(${formatDate(user.lastReportedAt)})</span></dd></div>`
        : nothing}`;
  }

  #renderAccess(user, products) {
    const names = Object.fromEntries((products ?? []).map((p) => [p.id, p.displayName]));
    if (!user.access?.length) return html`<p class="muted">No products reported for this API user yet.</p>`;
    return html`<ul class="access">
      ${user.access.map((a) => {
        const level = a.sectionAccess === false ? "off" : a.level;
        return html`<li class="access-card">
          <div class="access-top">
            <span class="product">${names[a.productId] ?? a.displayName}</span>
            <span class="level">${a.sectionAccess === false ? nothing : html`${levelGlyph(level)}${LEVEL_LABELS[a.level] ?? a.level}`}</span>
          </div>
          <span class="muted small">
            ${a.sectionAccess === false ? "No access: no user group grants its section" : a.scope === "user" ? "Own settings" : "Defaults"}
            ${a.disabledToolCount > 0 && a.level !== "off" && a.sectionAccess !== false ? ` · ${a.disabledToolCount} ${a.disabledToolCount === 1 ? "tool" : "tools"} switched off` : nothing}
            ${a.toolCount === null || a.toolCount === undefined || a.level === "off" || a.sectionAccess === false
              ? nothing
              : html` · <strong>${tools(a.toolCount)}</strong>${a.sizeBytes !== null && a.sizeBytes !== undefined
                  ? html` <span title=${formatSizeTooltip(a.sizeBytes)}>· ${formatApproxTokens(a.sizeBytes, { unit: true })}</span>`
                  : nothing}`}
          </span>
        </li>`;
      })}
    </ul>
    ${user.toolCount === null || user.toolCount === undefined
      ? nothing
      : html`<p class="total-line muted small">
          <strong>${tools(user.toolCount)}</strong>${user.sizeBytes !== null && user.sizeBytes !== undefined
            ? html` (<span title=${formatSizeTooltip(user.sizeBytes)}>${formatApproxTokens(user.sizeBytes, { unit: true })}</span>)`
            : nothing} in total at its last start.
        </p>`}`;
  }

  render() {
    const { user, products, addonVersion } = this.data ?? {};
    if (!user) return nothing;
    return html`<umb-body-layout headline=${user.name}>
      <div class="content">
        <uui-box>
          <div class="profile-head">
            <uui-avatar class="large" name=${user.name}></uui-avatar>
            <div class="profile-meta">
              <div class="profile-row">
                <strong>${user.name}</strong>
                ${this.#renderState(user)}
              </div>
              <span class="mono muted small">${user.clientIds?.length ? user.clientIds.join(", ") : "No client credentials"}</span>
            </div>
          </div>
        </uui-box>
        <uui-box headline="Sign-in & Connection">
          <dl>
            <div><dt>Client id</dt><dd class="mono">${user.clientIds?.length ? user.clientIds.join(", ") : "None"}</dd></div>
            <div><dt>Account state</dt><dd>${STATES[user.state] ?? user.state}</dd></div>
            ${this.#renderConnection(user, addonVersion)}
          </dl>
        </uui-box>
        <uui-box headline="Permissions & Products">
          <dl>
            <div>
              <dt>User groups</dt>
              <dd>${user.groups?.length ? user.groups.map((g) => html`<uui-tag class="compact-tag" look="secondary">${g}</uui-tag>`) : "None"}</dd>
            </div>
            <div>
              <dt>Granted sections</dt>
              <dd>${user.sections?.length ? user.sections.map((s) => html`<uui-tag class="compact-tag" look="secondary">${sectionLabel(s)}</uui-tag>`) : "None"}</dd>
            </div>
          </dl>
          <h4>Tools per product</h4>
          ${this.#renderAccess(user, products)}
        </uui-box>
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
      .content {
        display: flex;
        flex-direction: column;
        gap: var(--uui-size-space-4);
      }
      .muted {
        color: var(--uui-color-text-alt);
      }
      .small {
        font-size: var(--uui-type-small-size);
      }
      .mono,
      code {
        font-family: var(--uui-font-monospace, ui-monospace, Menlo, Consolas, monospace);
        font-size: 0.9em;
      }
      .profile-head {
        display: flex;
        align-items: center;
        gap: var(--uui-size-space-4);
      }
      uui-avatar.large {
        width: 3rem;
        height: 3rem;
        font-size: 1rem;
        flex: none;
      }
      .profile-meta {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
      }
      .profile-row {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: var(--uui-size-space-2);
        font-size: var(--uui-type-h5-size, 1.1rem);
      }
      dl {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
        gap: var(--uui-size-space-4);
        margin: 0;
      }
      dt {
        font-size: var(--uui-type-small-size);
        color: var(--uui-color-text-alt);
      }
      dd {
        margin: 4px 0 0;
        overflow-wrap: anywhere;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--uui-size-space-2);
        font-weight: 500;
      }
      h4 {
        margin: var(--uui-size-space-5) 0 var(--uui-size-space-3);
        padding-top: var(--uui-size-space-4);
        border-top: 1px solid var(--uui-color-divider);
        font-size: var(--uui-type-default-size);
      }
      .access {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: var(--uui-size-space-2);
      }
      .access-card {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: var(--uui-size-space-3);
        border-radius: var(--uui-border-radius);
        background: var(--uui-color-surface-alt);
        border: 1px solid var(--uui-color-divider);
      }
      .access-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--uui-size-space-3);
      }
      .access .product {
        font-weight: 600;
      }
      .access .level {
        display: inline-flex;
        align-items: center;
        gap: var(--uui-size-space-2);
        font-weight: 600;
      }
      .total-line {
        margin: var(--uui-size-space-3) 0 0;
      }
      uui-tag.compact-tag {
        flex: none;
        --uui-tag-font-size: 0.7rem;
        --uui-tag-padding: 0 6px;
      }
    `,
  ];
}

customElements.define("umbrella-api-user-info-modal", UmbrellaApiUserInfoModalElement);
export default UmbrellaApiUserInfoModalElement;
