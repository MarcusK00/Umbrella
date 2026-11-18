import { css, html } from "@umbraco-cms/backoffice/external/lit";
import { UmbLitElement } from "@umbraco-cms/backoffice/lit-element";
import { UmbTextStyles } from "@umbraco-cms/backoffice/style";
import "./umbrella-overview.js";
import "./umbrella-tool-groups.js";

const VIEWS = [
  { id: "overview", label: "Overview", icon: "icon-grid" },
  { id: "tool-groups", label: "Tool Permissions", icon: "icon-lock" },
];

/** Settings → Umbrella: minimal view switcher between Overview and Tool Permissions. */
export class UmbrellaDashboardElement extends UmbLitElement {
  static properties = {
    _tab: { state: true },
  };

  constructor() {
    super();
    this._tab = "overview";
  }

  async #show(tab) {
    if (tab === this._tab) return;
    // Leaving Tool Permissions with unsaved changes asks first.
    if (this._tab === "tool-groups" && (await this.shadowRoot?.querySelector("umbrella-tool-groups")?.confirmLeave()) === false) {
      return;
    }
    this._tab = tab;
    this.updateComplete.then(this.#measureLayout);
    // Settings changed on Tool Permissions show in the Overview's MCP Users table.
    if (tab === "overview") this.shadowRoot?.querySelector("umbrella-overview")?.reload();
  }

  /**
   * Fills the backoffice's scroll area, so Tool Permissions' footer sits at the bottom even when the page is short.
   */
  #scrollArea = null;
  #resizeObserver = new ResizeObserver(() => this.#measureLayout());

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("resize", this.#measureLayout);
    if (this.hasUpdated) this.#observeScrollArea();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("resize", this.#measureLayout);
    this.#resizeObserver.disconnect();
    this.#scrollArea = null;
  }

  firstUpdated() {
    const seg = this.shadowRoot?.querySelector(".segmented");
    if (seg) this.#resizeObserver.observe(seg);
    this.#observeScrollArea();
  }

  #observeScrollArea() {
    this.#scrollArea = this.#findScrollArea();
    if (this.#scrollArea) this.#resizeObserver.observe(this.#scrollArea);
    this.#measureLayout();
  }

  /** The nearest ancestor that scrolls, across shadow roots and slots (Umbraco's uui-scroll-container). */
  #findScrollArea() {
    let node = this;
    while ((node = node.assignedSlot ?? (node.parentNode instanceof ShadowRoot ? node.parentNode.host : node.parentElement))) {
      if (/(auto|scroll)/.test(getComputedStyle(node).overflowY)) return node;
    }
    return null;
  }

  #measureLayout = () => {
    this.#measureHeight();
    this.#measureSubnav();
  };

  #measureSubnav() {
    const seg = this.shadowRoot?.querySelector(".segmented");
    if (!seg) return;
    const height = Math.ceil(seg.getBoundingClientRect().height);
    if (height > 0) this.style.setProperty("--umbrella-subnav-offset", `${height + 16}px`);
  }

  #measureHeight = () => {
    const area = this.#scrollArea;
    const height = area
      ? area.clientHeight - (this.getBoundingClientRect().top - area.getBoundingClientRect().top + area.scrollTop)
      : window.innerHeight - Math.max(0, this.getBoundingClientRect().top);
    this.style.setProperty("--umbrella-height", `${Math.max(0, Math.round(height))}px`);
  };

  /** The Overview's "Edit permissions": open Tool Permissions with that API user (and optional product) selected. */
  async #editPermissions(e) {
    await this.#show("tool-groups");
    const toolGroups = this.shadowRoot?.querySelector("umbrella-tool-groups");
    await toolGroups?.selectUser(e.detail.key, e.detail.productId);
    toolGroups?.focusEditor();
  }

  render() {
    return html`
      <div class="subnav ${this._tab === "tool-groups" ? "is-tool-groups" : ""}" role="navigation" aria-label="Umbrella views">
        <div class="segmented" role="group" aria-label="View selector">
          ${VIEWS.map((v) => {
            const active = this._tab === v.id;
            return html`<button
              type="button"
              class="seg-btn"
              aria-pressed=${active ? "true" : "false"}
              @click=${() => this.#show(v.id)}
            >
              <umb-icon name=${v.icon}></umb-icon>
              <span>${v.label}</span>
            </button>`;
          })}
        </div>
      </div>
      <umbrella-overview ?hidden=${this._tab !== "overview"} @umbrella-edit-permissions=${this.#editPermissions}></umbrella-overview>
      <umbrella-tool-groups ?hidden=${this._tab !== "tool-groups"}></umbrella-tool-groups>
    `;
  }

  static styles = [
    UmbTextStyles,
    css`
      :host {
        position: relative;
        display: flex;
        flex-direction: column;
        min-height: var(--umbrella-height, auto);
      }
      [hidden] {
        display: none !important;
      }
      .subnav {
        display: flex;
        align-items: center;
        padding: var(--uui-size-layout-1) var(--uui-size-layout-1) 0;
      }
      /* On Tool Permissions, dock the view switcher above the 18rem sidebar so the right editor aligns with the top. */
      .subnav.is-tool-groups {
        position: absolute;
        top: var(--uui-size-layout-1);
        left: var(--uui-size-layout-1);
        width: 18rem;
        padding: 0;
        z-index: 2;
      }
      @media (max-width: 56rem) {
        .subnav.is-tool-groups {
          position: static;
          width: auto;
          padding: var(--uui-size-layout-1) var(--uui-size-layout-1) 0;
        }
      }
      .segmented {
        display: flex;
        align-items: center;
        width: 18rem;
        max-width: 100%;
        box-sizing: border-box;
        gap: 4px;
        padding: 4px;
        background: var(--uui-color-surface);
        border: 1px solid var(--uui-color-border);
        border-radius: var(--uui-border-radius);
        box-shadow: var(--uui-shadow-depth-1);
      }
      .seg-btn {
        flex: 1;
        justify-content: center;
        display: inline-flex;
        align-items: center;
        gap: var(--uui-size-space-2);
        padding: var(--uui-size-space-2) var(--uui-size-space-3);
        border: 0;
        border-radius: calc(var(--uui-border-radius) - 1px);
        background: transparent;
        font: inherit;
        font-weight: 600;
        color: var(--uui-color-text-alt);
        cursor: pointer;
        white-space: nowrap;
        transition: background-color 120ms ease, color 120ms ease;
      }
      .seg-btn:hover {
        color: var(--uui-color-text);
        background: var(--uui-color-surface-alt);
      }
      .seg-btn:focus-visible {
        outline: 2px solid var(--uui-color-focus);
        outline-offset: 1px;
      }
      .seg-btn[aria-pressed="true"] {
        background: var(--uui-color-current);
        color: var(--uui-color-current-contrast);
      }
      umbrella-tool-groups {
        flex: 1;
      }
    `,
  ];
}

customElements.define("umbrella-dashboard", UmbrellaDashboardElement);
export default UmbrellaDashboardElement;
