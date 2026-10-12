import { css, html } from "@umbraco-cms/backoffice/external/lit";
import { UmbLitElement } from "@umbraco-cms/backoffice/lit-element";
import { UmbTextStyles } from "@umbraco-cms/backoffice/style";
import "./umbrella-overview.js";
import "./umbrella-tool-groups.js";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "tool-groups", label: "Tool groups" },
];

/** Settings → Umbrella: the Overview and Tool groups tabs. */
export class UmbrellaDashboardElement extends UmbLitElement {
  static properties = {
    _tab: { state: true },
  };

  constructor() {
    super();
    this._tab = "overview";
  }

  render() {
    return html`
      <uui-tab-group>
        ${TABS.map(
          (t) => html`<uui-tab label=${t.label} ?active=${this._tab === t.id} @click=${() => (this._tab = t.id)}></uui-tab>`,
        )}
      </uui-tab-group>
      <umbrella-overview ?hidden=${this._tab !== "overview"}></umbrella-overview>
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
