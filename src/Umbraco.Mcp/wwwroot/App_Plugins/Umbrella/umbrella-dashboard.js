import { css, html } from "@umbraco-cms/backoffice/external/lit";
import { UmbLitElement } from "@umbraco-cms/backoffice/lit-element";
import { UmbTextStyles } from "@umbraco-cms/backoffice/style";
import "./umbrella-overview.js";
import "./umbrella-tool-groups.js";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "tool-groups", label: "Tool Permissions" },
];

/** Settings → Umbrella: the Overview and Tool Permissions tabs. */
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
      // The tab group already marked the clicked tab active; put the marker back on the tab still shown.
      this.shadowRoot.querySelectorAll("uui-tab").forEach((t, i) => (t.active = TABS[i].id === this._tab));
      return;
    }
    this._tab = tab;
    // Settings changed on Tool Permissions show in the Overview's MCP Users table.
    if (tab === "overview") this.shadowRoot?.querySelector("umbrella-overview")?.reload();
  }

  /** The Overview's "Edit permissions": open Tool Permissions with that API user selected. */
  #editPermissions(e) {
    this.#show("tool-groups");
    this.shadowRoot?.querySelector("umbrella-tool-groups")?.selectUser(e.detail.key);
  }

  render() {
    return html`
      <uui-tab-group>
        ${TABS.map((t) => html`<uui-tab label=${t.label} ?active=${this._tab === t.id} @click=${() => this.#show(t.id)}></uui-tab>`)}
      </uui-tab-group>
      <umbrella-overview ?hidden=${this._tab !== "overview"} @umbrella-edit-permissions=${this.#editPermissions}></umbrella-overview>
      <umbrella-tool-groups ?hidden=${this._tab !== "tool-groups"}></umbrella-tool-groups>
    `;
  }

  static styles = [
    UmbTextStyles,
    css`
      :host { display: block; }
      [hidden] { display: none; }
      uui-tab-group { padding: 0 var(--uui-size-layout-1); border-bottom: 1px solid var(--uui-color-divider-standalone); }
    `,
  ];
}

customElements.define("umbrella-dashboard", UmbrellaDashboardElement);
export default UmbrellaDashboardElement;
