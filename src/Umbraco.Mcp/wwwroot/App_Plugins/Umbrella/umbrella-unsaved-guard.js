/**
 * Asks before the backoffice navigates away from a page with unsaved changes, the way Umbraco's own workspaces do: the
 * router announces each navigation with a cancellable `willchangestate` event on `window`. The navigation is cancelled,
 * the page asks, and when the user discards, the navigation is replayed. Closing or reloading the browser tab gets the
 * browser's own prompt (`beforeunload`); browsers allow no custom text there.
 */
export class UmbrellaUnsavedGuard {
  #isDirty;
  #confirm;
  // Set while replaying a navigation the user agreed to, so it is not stopped again.
  #bypass = false;
  // Set while the popup is open, so a second navigation does not open another one.
  #asking = false;

  /**
   * @param {import("@umbraco-cms/backoffice/external/lit").ReactiveControllerHost} host
   * @param {{ isDirty: () => boolean, confirm: () => Promise<boolean> }} options `confirm` resolves true when the changes were discarded.
   */
  constructor(host, { isDirty, confirm }) {
    this.#isDirty = isDirty;
    this.#confirm = confirm;
    host.addController(this);
  }

  hostConnected() {
    window.addEventListener("willchangestate", this.#onWillChangeState);
    window.addEventListener("beforeunload", this.#onBeforeUnload);
  }

  hostDisconnected() {
    window.removeEventListener("willchangestate", this.#onWillChangeState);
    window.removeEventListener("beforeunload", this.#onBeforeUnload);
  }

  #onWillChangeState = async (e) => {
    if (this.#bypass) {
      this.#bypass = false;
      return;
    }
    if (!this.#isDirty()) return;
    e.preventDefault();
    if (this.#asking) return;
    this.#asking = true;
    try {
      if (await this.#confirm()) {
        this.#bypass = true;
        history.pushState({}, "", e.detail.url);
      }
    } finally {
      this.#asking = false;
    }
  };

  #onBeforeUnload = (e) => {
    if (!this.#isDirty()) return;
    e.preventDefault();
    e.returnValue = "";
  };
}
