import { UmbModalToken } from "@umbraco-cms/backoffice/modal";

/**
 * The Umbrella dashboard's sidebars. Each alias has a "modal" entry in umbraco-package.json pointing at its element.
 * Open one with `umbOpenModal(host, TOKEN, { data })`; it resolves with the submitted value and rejects when closed.
 */

/** Data `{ products, takenClientIds }`; submits `{ userKey }` once the user is created. */
export const UMBRELLA_NEW_CONNECTION_MODAL = new UmbModalToken("Umbrella.Modal.NewConnection", {
  modal: { type: "sidebar", size: "medium" },
});

/** Data `{ user, products, addonVersion }`; read-only. */
export const UMBRELLA_API_USER_INFO_MODAL = new UmbModalToken("Umbrella.Modal.ApiUserInfo", {
  modal: { type: "sidebar", size: "medium" },
});

/** Data `{ user, takenClientIds }`; submits `{ clientId }` once the new secret is set. */
export const UMBRELLA_NEW_SECRET_MODAL = new UmbModalToken("Umbrella.Modal.NewSecret", {
  modal: { type: "sidebar", size: "small" },
});
