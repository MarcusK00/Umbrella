import { css, html, nothing } from "@umbraco-cms/backoffice/external/lit";
import { UMB_AUTH_CONTEXT } from "@umbraco-cms/backoffice/auth";
import { UmbModalBaseElement } from "@umbraco-cms/backoffice/modal";
import { UMB_NOTIFICATION_CONTEXT } from "@umbraco-cms/backoffice/notification";
import { UmbTextStyles } from "@umbraco-cms/backoffice/style";
import { CLIENT_ID_PREFIX, generateSecret, suggestSuffix, validateSuffix } from "./umbrella-connection-logic.js";
import { addClientCredentials, deleteClientCredentials } from "./umbrella-users-api.js";
import { PLUGIN_ID, SECRET_VARIABLE } from "./umbrella-client-setup.js";

/**
 * Replaces a lost or leaked client secret for one API user, or adds credentials to a user that has none. The new
 * secret is made in the browser, sent only to Umbraco's client-credentials endpoint and shown once.
 * Data: `{ user, takenClientIds }`. Submits `{ clientId }` when done.
 */
export class UmbrellaNewSecretModalElement extends UmbModalBaseElement {
  static properties = {
    _clientId: { state: true },
    _suffix: { state: true },
    _error: { state: true },
    _busy: { state: true },
    _secret: { state: true },
  };

  #auth;
  #notifications;
  #deleted = false;

  constructor() {
    super();
    this._clientId = null;
    this._suffix = "";
    this._error = null;
    this._busy = false;
    this._secret = null;
    this.consumeContext(UMB_AUTH_CONTEXT, (ctx) => (this.#auth = ctx));
    this.consumeContext(UMB_NOTIFICATION_CONTEXT, (ctx) => (this.#notifications = ctx));
  }

  connectedCallback() {
    super.connectedCallback();
    const user = this.data?.user;
    this._clientId = user?.clientIds?.[0] ?? null;
    this._suffix = suggestSuffix(user?.name);
  }

  get #replacing() {
    return (this.data?.user?.clientIds?.length ?? 0) > 0;
  }

  async #run() {
    const user = this.data.user;
    let clientId = this._clientId ?? user.clientIds?.[0];
    if (!this.#replacing) {
      const invalid = validateSuffix(this._suffix, this.data.takenClientIds ?? []);
      if (invalid) {
        this._error = invalid;
        return;
      }
      clientId = CLIENT_ID_PREFIX + this._suffix;
    }
    this._busy = true;
    this._error = null;
    const secret = generateSecret();
    try {
      if (this.#replacing && !this.#deleted) {
        await deleteClientCredentials(this.#auth, user.key, clientId);
        this.#deleted = true;
      }
      await addClientCredentials(this.#auth, user.key, clientId, secret);
      this._clientId = clientId;
      this._secret = secret;
    } catch (error) {
      this._error = this.#deleted
        ? `The old secret is removed, but the new one could not be added: ${error.message}`
        : error.message;
    } finally {
      this._busy = false;
    }
  }

  async #copy() {
    try {
      await navigator.clipboard.writeText(this._secret);
      this.#notifications?.peek("positive", { data: { message: "Copied" } });
    } catch {
      this.#notifications?.peek("danger", { data: { message: "Could not copy. Select the text and copy it by hand." } });
    }
  }

  #done() {
    this.value = { clientId: this._clientId };
    this._submitModal();
  }

  #renderChoose(user) {
    const ids = user.clientIds ?? [];
    return html`<uui-box>
      <div class="stack">
        ${this.#replacing
          ? html`<p>Generating a new secret immediately invalidates the previous one. Their AI tool will stop connecting until the new secret is configured.</p>
              ${ids.length > 1
                ? html`<div class="field">
                    <uui-label for="client">Client id</uui-label>
                    <uui-select
                      id="client"
                      label="Client id"
                      ?disabled=${this.#deleted}
                      .options=${ids.map((id) => ({ name: id, value: id, selected: id === this._clientId }))}
                      @change=${(e) => (this._clientId = e.target.value)}
                    ></uui-select>
                  </div>`
                : html`<div class="client-box">
                    <span class="muted small">Client id</span>
                    <code class="mono">${ids[0]}</code>
                  </div>`}`
          : html`<p>${user.name} has no client credentials yet. Their AI tool will sign in with this client id and the generated secret.</p>
              <div class="field">
                <uui-label for="suffix" required>Client id</uui-label>
                <uui-input id="suffix" label="Client id" .value=${this._suffix} @input=${(e) => (this._suffix = e.target.value)}>
                  <span slot="prepend" class="prefix">${CLIENT_ID_PREFIX}</span>
                </uui-input>
              </div>`}
        ${this._error ? html`<p class="error"><umb-icon name="icon-alert"></umb-icon>${this._error}</p>` : nothing}
      </div>
    </uui-box>`;
  }

  #renderSecret() {
    return html`
      <div class="note positive">
        <umb-icon name="icon-check"></umb-icon>
        <span>The new secret is set for <code class="mono">${this._clientId}</code>.</span>
      </div>
      <uui-box headline="Client secret">
        <div class="stack">
          <div class="secret-row">
            <uui-input id="secret" label="Client secret" readonly .value=${this._secret}></uui-input>
            <uui-button look="primary" label="Copy" @click=${this.#copy}>
              <umb-icon name="icon-documents"></umb-icon> Copy
            </uui-button>
          </div>
          <div class="note warning">
            <umb-icon name="icon-alert"></umb-icon>
            <span>Copy it now. It is shown once: Umbraco stores only its hash, and Umbrella doesn't store it at all. Send it separately from the config.</span>
          </div>
        </div>
      </uui-box>
      <uui-box headline="Put it into the AI tool">
        <ul>
          <li><strong>Claude Code (plugin):</strong> run <code>/plugin configure ${PLUGIN_ID}</code> in Claude Code.</li>
          <li><strong>Claude Code (.mcp.json) & Cursor:</strong> set <code>${SECRET_VARIABLE}</code> to it, then restart the tool.</li>
          <li><strong>VS Code:</strong> prompts for the secret the next time it starts the server.</li>
          <li><strong>Other clients:</strong> replace the secret in its configuration file or command.</li>
        </ul>
      </uui-box>
    `;
  }

  render() {
    const user = this.data?.user;
    if (!user) return nothing;
    const headline = this.#replacing ? `Replace ${user.name}'s secret?` : `Add a secret for ${user.name}`;
    return html`<umb-body-layout headline=${this._secret ? `New secret for ${user.name}` : headline}>
      <div class="content">${this._secret ? this.#renderSecret() : this.#renderChoose(user)}</div>
      <div slot="actions">
        ${this._secret
          ? html`<uui-button look="primary" label="Done" @click=${this.#done}></uui-button>`
          : html`<uui-button look="secondary" label="Cancel" ?disabled=${this._busy} @click=${() => this._rejectModal()}></uui-button>
              <uui-button
                look="primary"
                color=${this.#replacing ? "danger" : "positive"}
                label=${this._error ? "Try again" : this.#replacing ? "Replace secret" : "Add secret"}
                .state=${this._busy ? "waiting" : undefined}
                ?disabled=${this._busy}
                @click=${this.#run}
              ></uui-button>`}
      </div>
    </umb-body-layout>`;
  }

  static styles = [
    UmbTextStyles,
    css`
      .content,
      .stack {
        display: flex;
        flex-direction: column;
        gap: var(--uui-size-space-4);
      }
      .content p {
        margin: 0;
      }
      .field {
        display: flex;
        flex-direction: column;
        gap: var(--uui-size-space-2);
      }
      .client-box {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: var(--uui-size-space-3);
        border-radius: var(--uui-border-radius);
        background: var(--uui-color-surface-alt);
        border: 1px solid var(--uui-color-divider);
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
      .prefix {
        padding-left: var(--uui-size-space-3);
        color: var(--uui-color-text-alt);
        font-family: var(--uui-font-monospace, ui-monospace, Menlo, Consolas, monospace);
        font-size: 0.85em;
        white-space: nowrap;
      }
      uui-input,
      uui-select {
        width: 100%;
      }
      .secret-row {
        display: flex;
        gap: var(--uui-size-space-2);
        align-items: center;
      }
      .secret-row uui-input {
        flex: 1;
        min-width: 0;
        font-family: var(--uui-font-monospace, ui-monospace, Menlo, Consolas, monospace);
      }
      .error {
        display: flex;
        align-items: center;
        gap: var(--uui-size-space-2);
        color: var(--uui-color-danger-standalone);
      }
      .note {
        display: flex;
        gap: var(--uui-size-space-2);
        align-items: flex-start;
        padding: var(--uui-size-space-3) var(--uui-size-space-4);
        border-radius: var(--uui-border-radius);
      }
      .note umb-icon {
        flex: none;
        margin-top: 2px;
      }
      .note.positive {
        background: var(--uui-color-positive);
        color: var(--uui-color-positive-contrast);
      }
      .note.warning {
        background: var(--uui-color-warning);
        color: var(--uui-color-warning-contrast);
      }
      ul {
        margin: 0;
        padding-left: 1.2em;
        display: flex;
        flex-direction: column;
        gap: var(--uui-size-space-2);
      }
    `,
  ];
}

customElements.define("umbrella-new-secret-modal", UmbrellaNewSecretModalElement);
export default UmbrellaNewSecretModalElement;
