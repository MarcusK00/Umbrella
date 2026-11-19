import { css, html, nothing } from "@umbraco-cms/backoffice/external/lit";
import { UmbModalBaseElement } from "@umbraco-cms/backoffice/modal";
import { UmbTextStyles } from "@umbraco-cms/backoffice/style";
import { formatDate } from "./umbrella-api.js";
import { LEVEL_LABELS, formatRelative, glyphStyles, levelGlyph, tools } from "./umbrella-access.js";
import { buildAccessSizeSegments, formatApproxTokens, formatSizeTooltip } from "./umbrella-tool-size.js";

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

    const footprint = buildAccessSizeSegments(user.access);
    const totalTitle = user.sizeBytes !== null && user.sizeBytes !== undefined ? formatSizeTooltip(user.sizeBytes) : "";

    return html`<div class="access-head">
        <h4>Tools per product</h4>
        ${user.toolCount !== null && user.toolCount !== undefined
          ? html`<span class="access-total muted small" title=${totalTitle || nothing}>
              <strong>${tools(user.toolCount)}</strong> total
            </span>`
          : nothing}
      </div>
      ${footprint
        ? html`<div class="footprint-bar" role="img" aria-label="Context size breakdown across products">
            ${footprint.segments.map((seg) => {
              const name = names[seg.productId] ?? seg.displayName;
              const pct = Math.max(1, Math.round(seg.pctOfTotal));
              return html`<span
                class="footprint-seg ${seg.colorIndex >= 0 ? `seg-${seg.colorIndex}` : "seg-other"}"
                style="width: ${seg.pctOfTotal.toFixed(2)}%"
                title="${name} · ${pct}% (${formatApproxTokens(seg.bytes, { unit: true })})"
              ></span>`;
            })}
          </div>`
        : nothing}
      <ul class="access">
        ${user.access.map((a) => {
          const isNoAccess = a.sectionAccess === false;
          const isOff = !isNoAccess && a.level === "off";
          const inactive = isNoAccess || isOff;
          const level = isNoAccess ? "off" : a.level;
          const seg = footprint?.byProduct.get(a.productId) ?? null;
          const segClass = seg ? (seg.colorIndex >= 0 ? `seg-${seg.colorIndex}` : "seg-other") : "";
          const name = names[a.productId] ?? a.displayName;
          const cardTitle = seg
            ? `${name} · ${Math.max(1, Math.round(seg.pctOfTotal))}% (${formatSizeTooltip(seg.bytes)})`
            : "";

          return html`<li class="access-card ${inactive ? "is-inactive" : ""}" title=${cardTitle || nothing}>
            <div class="access-top">
              <span class="product">
                ${seg ? html`<span class="product-dot ${segClass}" aria-hidden="true"></span>` : nothing}
                <span>${name}</span>
                ${!isNoAccess && a.scope === "user" ? html`<uui-tag class="compact-tag" look="secondary">Own</uui-tag>` : nothing}
              </span>
              <span class="level ${inactive ? "is-muted" : ""}">
                ${isNoAccess ? html`<span>No access</span>` : html`${levelGlyph(level)}<span>${LEVEL_LABELS[a.level] ?? a.level}</span>`}
              </span>
            </div>
            <div class="access-bottom muted small">
              <span>
                ${isNoAccess
                  ? "No user group grants its section"
                  : isOff
                    ? "Not loaded"
                    : a.scope === "user"
                      ? "Own settings"
                      : "Follows defaults"}${a.disabledToolCount > 0 && !inactive
                  ? ` · ${a.disabledToolCount} switched off`
                  : ""}
              </span>
              ${!inactive && a.toolCount !== null && a.toolCount !== undefined
                ? html`<span class="access-count">${tools(a.toolCount)}</span>`
                : nothing}
            </div>
            ${seg
              ? html`<span class="access-weight ${segClass}" style="width: ${Math.max(seg.pctOfTotal, 1.5).toFixed(2)}%" aria-hidden="true"></span>`
              : nothing}
          </li>`;
        })}
      </ul>`;
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
      :host {
        --umbrella-seg-0: var(--uui-color-interactive-emphasis, #2152a3);
        --umbrella-seg-1: #2a9d8f;
        --umbrella-seg-2: #e09f3e;
        --umbrella-seg-3: #8b6cc1;
        --umbrella-seg-other: var(--uui-color-border-emphasis, #a1a1aa);
      }
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
      .access-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: var(--uui-size-space-3);
        margin: var(--uui-size-space-5) 0 var(--uui-size-space-3);
        padding-top: var(--uui-size-space-4);
        border-top: 1px solid var(--uui-color-divider);
      }
      .access-head h4 {
        margin: 0;
        font-size: var(--uui-type-default-size);
      }
      .access-total {
        font-variant-numeric: tabular-nums;
      }
      .access-total strong {
        color: var(--uui-color-text);
      }
      .footprint-bar {
        display: flex;
        gap: 2px;
        height: 8px;
        margin-bottom: var(--uui-size-space-3);
        border-radius: 4px;
        background: var(--uui-color-surface-emphasis);
        overflow: hidden;
      }
      .footprint-seg {
        display: block;
        height: 100%;
        min-width: 3px;
      }
      .seg-0 {
        background: var(--umbrella-seg-0);
      }
      .seg-1 {
        background: var(--umbrella-seg-1);
      }
      .seg-2 {
        background: var(--umbrella-seg-2);
      }
      .seg-3 {
        background: var(--umbrella-seg-3);
      }
      .seg-other {
        background: var(--umbrella-seg-other);
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
        position: relative;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: var(--uui-size-space-3);
        border-radius: var(--uui-border-radius);
        background: var(--uui-color-surface-alt);
        border: 1px solid var(--uui-color-divider);
      }
      .access-card.is-inactive {
        opacity: 0.72;
      }
      .access-top,
      .access-bottom {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--uui-size-space-3);
      }
      .access .product {
        display: inline-flex;
        align-items: center;
        gap: var(--uui-size-space-2);
        font-weight: 600;
      }
      .product-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex: none;
      }
      .access .level {
        display: inline-flex;
        align-items: center;
        gap: var(--uui-size-space-2);
        font-weight: 600;
      }
      .access .level.is-muted {
        color: var(--uui-color-text-alt);
        font-weight: normal;
      }
      .access-count {
        flex: none;
        font-weight: 600;
        color: var(--uui-color-text);
        font-variant-numeric: tabular-nums;
      }
      .access-weight {
        position: absolute;
        left: 0;
        bottom: 0;
        height: 2px;
        opacity: 0.75;
        pointer-events: none;
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
