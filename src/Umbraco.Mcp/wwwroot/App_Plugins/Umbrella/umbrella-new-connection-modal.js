import { css, html, nothing, repeat } from "@umbraco-cms/backoffice/external/lit";
import { UMB_AUTH_CONTEXT } from "@umbraco-cms/backoffice/auth";
import { UmbModalBaseElement, umbConfirmModal } from "@umbraco-cms/backoffice/modal";
import { UMB_NOTIFICATION_CONTEXT } from "@umbraco-cms/backoffice/notification";
import { UmbTextStyles } from "@umbraco-cms/backoffice/style";
import { request } from "./umbrella-api.js";
import { LEVELS, LEVEL_LABELS, glyphStyles, levelGlyph } from "./umbrella-access.js";
import {
  CLIENT_ID_PREFIX,
  buildOverrides,
  effectiveLevel,
  generateSecret,
  missingSections,
  suggestGroups,
  suggestSuffix,
  validateSuffix,
} from "./umbrella-connection-logic.js";
import { addClientCredentials, createApiUser, getCurrentUser, getUser, listUserGroups } from "./umbrella-users-api.js";
import "./umbrella-client-setup.js";

const STEPS = [
  { id: "details", label: "Details" },
  { id: "access", label: "Access" },
  { id: "review", label: "Review" },
];

/** Umbraco's built-in Administrators group. */
const ADMIN_ALIAS = "admin";

/** McpProducts.RequiredId: CMS can't be switched off. */
const REQUIRED_ID = "cms";

const POLL_MS = 5000;

const sectionLabel = (name) => name.replace(/^[A-Za-z]+\.Section\./, "");

/** What each create step leaves missing when it fails after the user exists. */
const MISSING = {
  recorded: "The user isn't listed in Access per API user until its MCP server first connects.",
  settings: "Its access per product isn't saved. Set it on Tool Permissions.",
};

/**
 * New connection: creates an API user, its client credentials and its access in one panel, then hands over the config
 * for the person's AI tool and waits for it to connect. Users and credentials are created through Umbraco's own
 * Management API, so Umbraco decides what the signed-in user may do. The secret is made here and shown once.
 *
 * Data: `{ products, takenClientIds }` (the Overview's installed and enabled products, and every API user's client
 * ids). Submits `{ userKey }` on Done.
 */
export class UmbrellaNewConnectionModalElement extends UmbModalBaseElement {
  static properties = {
    _step: { state: true },
    _loadError: { state: true },
    _groups: { state: true },
    _name: { state: true },
    _suffix: { state: true },
    _choices: { state: true },
    _selected: { state: true },
    _failedStep: { state: true },
    _error: { state: true },
    _setup: { state: true },
    _connected: { state: true },
    _secretCopied: { state: true },
  };

  #auth;
  #notifications;
  #me = null;
  #defaultsDisabled = {};
  #defaultsTools = {};
  #suffixEdited = false;
  #groupsEdited = false;
  #userKey = crypto.randomUUID();
  #secret = null;
  #done = new Set();
  #attempted = false;
  #poll = null;

  constructor() {
    super();
    this._step = "details";
    this._loadError = null;
    this._groups = null;
    this._name = "";
    this._suffix = "";
    this._choices = {};
    this._selected = new Set();
    this._failedStep = null;
    this._error = null;
    this._setup = null;
    this._connected = null;
    this._secretCopied = false;
    this.consumeContext(UMB_NOTIFICATION_CONTEXT, (ctx) => (this.#notifications = ctx));
    this.consumeContext(UMB_AUTH_CONTEXT, (ctx) => {
      if (!ctx || this.#auth) return;
      this.#auth = ctx;
      this.#load();
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    clearInterval(this.#poll);
  }

  get #products() {
    return this.data?.products ?? [];
  }

  async #load() {
    this._choices = Object.fromEntries(this.#products.map((p) => [p.id, "defaults"]));
    try {
      const [me, groups, settings] = await Promise.all([
        getCurrentUser(this.#auth),
        listUserGroups(this.#auth),
        request(this.#auth, "GET", "tool-settings"),
      ]);
      this.#me = me;
      this.#defaultsDisabled = settings?.disabledCollections ?? {};
      this.#defaultsTools = settings?.disabledTools ?? {};
      this._groups = groups;
      this.#suggest();
    } catch (error) {
      this._loadError = error.message;
    }
  }

  /** Preselects the groups for the products that end up on, until the person picks groups themselves. */
  #suggest() {
    if (this.#groupsEdited || !this._groups) return;
    this._selected = suggestGroups(this.#products, this._choices, this._groups, {
      isAdmin: this.#me?.isAdmin === true,
      ownGroupIds: this.#me?.userGroupIds ?? [],
    });
  }

  get #clientId() {
    return CLIENT_ID_PREFIX + this._suffix;
  }

  get #suffixError() {
    return validateSuffix(this._suffix, this.data?.takenClientIds ?? []);
  }

  #canNext() {
    if (this._step === "details") return this._name.trim().length > 0 && this.#suffixError === null;
    if (this._step === "access") return this._selected.size > 0;
    return false;
  }

  #go(step) {
    this._step = step;
    this.updateComplete.then(() => this.shadowRoot.querySelector(".content")?.scrollTo?.({ top: 0 }));
  }

  // --- Creating -------------------------------------------------------------------------------------------------------

  async #create() {
    this._step = "creating";
    this._error = null;
    try {
      if (!this.#done.has("user")) {
        this._failedStep = "user";
        // A retry after a lost response: the user may already be there.
        if (!(this.#attempted && (await getUser(this.#auth, this.#userKey)))) {
          this.#attempted = true;
          await createApiUser(this.#auth, {
            id: this.#userKey,
            name: this._name.trim(),
            clientId: this.#clientId,
            groupIds: [...this._selected],
          });
        }
        this.#done.add("user");
      }
      if (!this.#done.has("recorded")) {
        this._failedStep = "recorded";
        await request(this.#auth, "POST", `created-users/${encodeURIComponent(this.#userKey)}`);
        this.#done.add("recorded");
      }
      if (!this.#done.has("credentials")) {
        this._failedStep = "credentials";
        this.#secret ??= generateSecret();
        await addClientCredentials(this.#auth, this.#userKey, this.#clientId, this.#secret);
        this.#done.add("credentials");
      }
      if (!this.#done.has("settings")) {
        this._failedStep = "settings";
        const overrides = buildOverrides(this._choices, this.#defaultsDisabled, this.#defaultsTools);
        if (Object.keys(overrides).length > 0) {
          await request(this.#auth, "PUT", `tool-settings/users/${encodeURIComponent(this.#userKey)}`, { overrides });
        }
        this.#done.add("settings");
      }
      await this.#showResult();
    } catch (error) {
      this._error = error.message;
      this._step = "failed";
    }
  }

  /** Back to an earlier step after the user could not be created; nothing exists yet, so everything can change. */
  #back(step) {
    this.#attempted = false;
    this._error = null;
    this.#go(step);
  }

  async #showResult() {
    this._step = "result";
    try {
      this._setup = await request(this.#auth, "GET", `client-setup?clientId=${encodeURIComponent(this.#clientId)}`);
    } catch (error) {
      this.#notifications?.peek("danger", { data: { headline: "Could not load the config", message: error.message } });
    }
    this.#checkConnected();
    this.#poll = setInterval(() => this.#checkConnected(), POLL_MS);
  }

  /** Polls the Overview until this user's MCP server has connected and reported its tools. */
  async #checkConnected() {
    try {
      const overview = await request(this.#auth, "GET", "overview");
      const user = overview?.apiUsers?.find((u) => u.key === this.#userKey);
      if (user?.connected) {
        this._connected = user;
        if (user.serverVersion) clearInterval(this.#poll);
      }
    } catch {
      // Try again on the next tick.
    }
  }

  async #copySecret() {
    try {
      await navigator.clipboard.writeText(this.#secret);
      this._secretCopied = true;
      this.#notifications?.peek("positive", { data: { message: "Copied" } });
    } catch {
      this.#notifications?.peek("danger", { data: { message: "Could not copy. Select the text and copy it by hand." } });
    }
  }

  async #finish() {
    if (!this._secretCopied) {
      try {
        await umbConfirmModal(this, {
          headline: "Close without copying the secret?",
          content: "The secret won't be shown again. New secret in the row's menu makes another one.",
          confirmLabel: "Close",
          color: "danger",
        });
      } catch {
        return;
      }
    }
    this.value = { userKey: this.#userKey };
    this._submitModal();
  }

  async #cancel() {
    if (this.#done.has("user") && !this.#done.has("credentials")) {
      try {
        await umbConfirmModal(this, {
          headline: "Close without credentials?",
          content: `${this._name.trim()} exists but has no client secret yet, so its AI tool can't sign in. New secret in the row's menu adds one later.`,
          confirmLabel: "Close",
          color: "danger",
        });
      } catch {
        return;
      }
    }
    this._rejectModal();
  }

  // --- Rendering ------------------------------------------------------------------------------------------------------

  #renderSteps() {
    const index = STEPS.findIndex((s) => s.id === this._step);
    return html`<ol class="steps">
      ${STEPS.map(
        (s, i) => html`<li class=${i < index ? "done" : ""} aria-current=${i === index ? "step" : "false"}><span class="dot">${i + 1}</span>${s.label}</li>`,
      )}
    </ol>`;
  }

  #renderDetails() {
    const error = this._suffix ? this.#suffixError : null;
    return html`
      <div class="field">
        <uui-label for="name" required>Name of MCP client</uui-label>
        <uui-input
          id="name"
          label="Name"
          placeholder="A person or an agent"
          .value=${this._name}
          @input=${(e) => {
            this._name = e.target.value;
            if (!this.#suffixEdited) this._suffix = suggestSuffix(this._name);
          }}
        ></uui-input>
        <p class="muted small">Shown in the access table, and in Umbraco's history next to what its AI tool changes.</p>
      </div>
      <div class="field">
        <uui-label for="suffix" required>Client id</uui-label>
        <uui-input
          id="suffix"
          label="Client id"
          .value=${this._suffix}
          @input=${(e) => {
            this.#suffixEdited = true;
            this._suffix = e.target.value;
          }}
        >
          <span slot="prepend" class="prefix">${CLIENT_ID_PREFIX}</span>
        </uui-input>
        ${error
          ? html`<p class="error small"><umb-icon name="icon-alert"></umb-icon>${error}</p>`
          : html`<p class="muted small">Suggested from the name. Their AI tool signs in with it.</p>`}
      </div>
    `;
  }

  #renderLevels(p) {
    const choice = this._choices[p.id] ?? "defaults";
    const options = [
      { value: "defaults", label: `Defaults (${LEVEL_LABELS[p.access] ?? LEVEL_LABELS.full})` },
      ...LEVELS.filter((l) => !(p.id === REQUIRED_ID && l.value === "off")),
    ];
    return html`<uui-button-group role="group" aria-label="Access for ${p.displayName}">
      ${options.map(
        (o) => html`<uui-button
          compact
          look=${choice === o.value ? "primary" : "outline"}
          label=${o.label}
          aria-pressed=${choice === o.value ? "true" : "false"}
          @click=${() => {
            this._choices = { ...this._choices, [p.id]: o.value };
            this.#suggest();
          }}
        >${o.label}</uui-button>`,
      )}
    </uui-button-group>`;
  }

  #renderAccess() {
    if (this._loadError) return html`<p class="error"><umb-icon name="icon-alert"></umb-icon>Could not load the user groups: ${this._loadError}</p>`;
    if (!this._groups) return html`<uui-loader></uui-loader>`;
    const isAdmin = this.#me?.isAdmin === true;
    const own = new Set(this.#me?.userGroupIds ?? []);
    const missing = missingSections(this.#products, this._choices, this._groups, this._selected);
    const adminPicked = this._groups.some((g) => g.alias === ADMIN_ALIAS && this._selected.has(g.id));
    return html`
      <div>
        <h3>What may ${this._name.trim() || "it"} use?</h3>
        <p class="muted small">The same steps as Tool Permissions. Defaults follows the site's defaults, also when they change later; any other step is saved as this API user's own setting.</p>
      </div>
      ${this.#products.map(
        (p) => html`<div class="product">
          <div class="product-name">
            <strong>${p.displayName}</strong>
            ${p.sectionAlias ? html`<span class="muted small">needs the ${sectionLabel(p.sectionAlias)} section</span>` : nothing}
          </div>
          ${this.#renderLevels(p)}
        </div>`,
      )}
      <div class="field">
        <h3>User groups</h3>
        <p class="muted small">Preselected so every product that is on has its section. Start nodes and document permissions come from the groups too.</p>
        <div class="groups">
          ${repeat(
            this._groups,
            (g) => g.id,
            (g) => html`<uui-checkbox
              label=${g.name}
              .checked=${this._selected.has(g.id)}
              @change=${(e) => {
                const next = new Set(this._selected);
                e.target.checked ? next.add(g.id) : next.delete(g.id);
                this.#groupsEdited = true;
                this._selected = next;
              }}
            >
              <span class="group"
                >${g.name} <span class="muted small">${g.sections.map(sectionLabel).join(", ") || "No sections"}</span>
                ${!isAdmin && !own.has(g.id) ? html`<span class="hint small">You can't assign this group</span>` : nothing}</span
              >
            </uui-checkbox>`,
          )}
        </div>
        ${this._selected.size === 0 ? html`<p class="muted small">Pick at least one group.</p>` : nothing}
      </div>
      ${adminPicked
        ? html`<div class="note warning"><umb-icon name="icon-alert"></umb-icon><span>Administrators gives the AI tool every section and permission. Tool settings are guardrails, not access control.</span></div>`
        : nothing}
      ${missing.map(
        (m) => html`<div class="note warning">
          <umb-icon name="icon-alert"></umb-icon>
          <span>No selected group grants the ${sectionLabel(m.section)} section. Its MCP server would leave out ${m.product.displayName}.</span>
        </div>`,
      )}
    `;
  }

  #levelSummary(p) {
    const choice = this._choices[p.id] ?? "defaults";
    return choice === "defaults"
      ? `Defaults (${LEVEL_LABELS[p.access] ?? LEVEL_LABELS.full})`
      : `${LEVEL_LABELS[choice]}, own setting`;
  }

  #renderReview() {
    const groups = (this._groups ?? []).filter((g) => this._selected.has(g.id)).map((g) => g.name);
    return html`
      <div>
        <h3>Check and create</h3>
        <p class="muted small">Creates the API user, its client credentials and its access. The client secret is made here and shown once.</p>
      </div>
      <dl class="summary">
        <dt>Name</dt><dd><strong>${this._name.trim()}</strong></dd>
        <dt>Client id</dt><dd class="mono">${this.#clientId}</dd>
        <dt>User groups</dt><dd>${groups.join(", ")}</dd>
        ${this.#products.map((p) => html`<dt>${p.displayName.replace(/^Umbraco /, "")}</dt><dd>${levelGlyph(effectiveLevel(this._choices[p.id] ?? "defaults", p.access))} ${this.#levelSummary(p)}</dd>`)}
      </dl>
    `;
  }

  #renderFailed() {
    const step = this._failedStep;
    const userExists = this.#done.has("user");
    return html`
      <div class="note danger">
        <umb-icon name="icon-alert"></umb-icon>
        <span>
          ${step === "user"
            ? html`The API user could not be created: ${this._error}`
            : step === "credentials"
              ? html`${this._name.trim()} is created, but its client credentials could not be added: ${this._error}`
              : html`${this._name.trim()} is created and can sign in, but this step failed: ${this._error}`}
        </span>
      </div>
      ${step === "credentials"
        ? html`<div class="field">
            <uui-label for="retry-suffix">Client id</uui-label>
            <uui-input id="retry-suffix" label="Client id" .value=${this._suffix} @input=${(e) => (this._suffix = e.target.value)}>
              <span slot="prepend" class="prefix">${CLIENT_ID_PREFIX}</span>
            </uui-input>
            ${this._suffix && this.#suffixError
              ? html`<p class="error small"><umb-icon name="icon-alert"></umb-icon>${this.#suffixError}</p>`
              : html`<p class="muted small">Change it if another API user has it, then try again. The user is listed in Access per API user, where New secret adds credentials later.</p>`}
          </div>`
        : nothing}
      ${MISSING[step] && userExists ? html`<p class="muted">${MISSING[step]}</p>` : nothing}
    `;
  }

  #renderStatus() {
    const u = this._connected;
    if (!u) {
      return html`<div class="waiting">
        <h3>Waiting for ${this._name.trim()}'s AI tool</h3>
        <uui-loader-bar></uui-loader-bar>
        <p class="muted small">You can close this panel. The row in Access per API user says "Not connected yet" until its MCP server starts.</p>
      </div>`;
    }
    const names = Object.fromEntries(this.#products.map((p) => [p.id, p.displayName]));
    return html`<div class="note positive">
        <umb-icon name="icon-check"></umb-icon>
        <span>${u.serverVersion ? `Connected with umbrella-mcp ${u.serverVersion}.` : "Connected."}</span>
      </div>
      <dl class="summary">
        ${(u.access ?? []).map(
          (a) => html`<dt>${(names[a.productId] ?? a.displayName).replace(/^Umbraco /, "")}</dt>
            <dd>
              ${a.level === "off"
                ? html`<span class="muted">Off, not loaded</span>`
                : a.sectionAccess === false
                  ? "Not loaded: no group grants its section"
                  : a.toolCount === 0
                    ? "Not loaded at its start. Ask the AI to call get-mcp-health for why."
                    : html`Loaded · ${LEVEL_LABELS[a.level]}${a.toolCount ? ` · ${a.toolCount} tools` : ""}`}
            </dd>`,
        )}
      </dl>`;
  }

  #renderResult() {
    return html`
      <div class="note positive">
        <umb-icon name="icon-check"></umb-icon>
        <span><strong>${this._name.trim()}</strong> is created, with its credentials and access.</span>
      </div>
      <div class="field">
        <uui-label for="secret">Client secret</uui-label>
        <div class="secret-row">
          <uui-input id="secret" label="Client secret" readonly .value=${this.#secret ?? ""}></uui-input>
          <uui-button look="secondary" label="Copy" @click=${this.#copySecret}></uui-button>
        </div>
        <div class="note warning">
          <umb-icon name="icon-alert"></umb-icon>
          <span>Copy it now. It is shown once: Umbraco stores only its hash, and Umbrella doesn't store it at all. Send it separately from the config.</span>
        </div>
      </div>
      <h3>Hand over the config</h3>
      ${this._setup
        ? html`<umbrella-client-setup stacked hide-secret-step .setup=${this._setup} .userName=${this._name.trim()} .firstStep=${1}></umbrella-client-setup>`
        : html`<uui-loader></uui-loader>`}
      <h3>Connection</h3>
      ${this.#renderStatus()}
    `;
  }

  #renderBody() {
    switch (this._step) {
      case "details":
        return this.#renderDetails();
      case "access":
        return this.#renderAccess();
      case "review":
        return this.#renderReview();
      case "creating":
        return html`<div class="waiting"><h3>Creating ${this._name.trim()}…</h3><uui-loader-bar></uui-loader-bar></div>`;
      case "failed":
        return this.#renderFailed();
      default:
        return this.#renderResult();
    }
  }

  #renderActions() {
    const cancel = html`<uui-button look="secondary" label="Cancel" @click=${this.#cancel}></uui-button>`;
    switch (this._step) {
      case "details":
        return html`${cancel}<uui-button look="primary" label="Next" ?disabled=${!this.#canNext()} @click=${() => this.#go("access")}></uui-button>`;
      case "access":
        return html`${cancel}<uui-button look="secondary" label="Back" @click=${() => this.#go("details")}></uui-button>
          <uui-button look="primary" label="Next" ?disabled=${!this.#canNext()} @click=${() => this.#go("review")}></uui-button>`;
      case "review":
        return html`${cancel}<uui-button look="secondary" label="Back" @click=${() => this.#go("access")}></uui-button>
          <uui-button look="primary" color="positive" label="Create API user" @click=${this.#create}></uui-button>`;
      case "creating":
        return nothing;
      case "failed":
        return html`${cancel}
          ${this._failedStep === "user"
            ? html`<uui-button look="secondary" label="Back to Details" @click=${() => this.#back("details")}></uui-button>
                <uui-button look="secondary" label="Back to Access" @click=${() => this.#back("access")}></uui-button>`
            : nothing}
          ${this._failedStep === "recorded" || this._failedStep === "settings"
            ? html`<uui-button
                look="secondary"
                label="Continue"
                @click=${() => {
                  this.#done.add(this._failedStep);
                  this.#create();
                }}
              ></uui-button>`
            : nothing}
          <uui-button
            look="primary"
            label="Try again"
            ?disabled=${this._failedStep === "credentials" && this.#suffixError !== null}
            @click=${this.#create}
          ></uui-button>`;
      default:
        return html`<uui-button look="primary" label="Done" @click=${this.#finish}></uui-button>`;
    }
  }

  render() {
    const inSteps = STEPS.some((s) => s.id === this._step);
    return html`<umb-body-layout headline="New connection">
      <div class="content">
        ${inSteps ? this.#renderSteps() : nothing}
        ${this.#renderBody()}
      </div>
      <div slot="actions">${this.#renderActions()}</div>
    </umb-body-layout>`;
  }

  static styles = [
    UmbTextStyles,
    glyphStyles,
    css`
      .content { display: flex; flex-direction: column; gap: var(--uui-size-space-5); }
      h3 { margin: 0; font-size: var(--uui-type-default-size); }
      p { margin: 0; }
      .muted { color: var(--uui-color-text-alt); }
      .small { font-size: var(--uui-type-small-size); }
      .mono { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 0.9em; }
      .prefix { padding-left: var(--uui-size-space-3); color: var(--uui-color-text-alt); font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 0.85em; white-space: nowrap; }
      .field { display: flex; flex-direction: column; gap: var(--uui-size-space-2); }
      uui-input { width: 100%; }
      .error { display: flex; align-items: center; gap: var(--uui-size-space-2); color: var(--uui-color-danger-standalone); }

      .steps { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: var(--uui-size-space-2) var(--uui-size-space-5); }
      .steps li { display: flex; align-items: center; gap: var(--uui-size-space-2); color: var(--uui-color-text-alt); font-size: var(--uui-type-small-size); }
      .steps .dot {
        display: inline-grid; place-items: center; width: 1.4rem; height: 1.4rem; border-radius: 50%;
        border: 1px solid var(--uui-color-border); font-weight: 700;
      }
      .steps li.done .dot { background: var(--uui-color-positive); border-color: var(--uui-color-positive); color: var(--uui-color-positive-contrast); }
      .steps li[aria-current="step"] { color: var(--uui-color-text); font-weight: 700; }
      .steps li[aria-current="step"] .dot { background: var(--uui-color-selected); border-color: var(--uui-color-selected); color: var(--uui-color-selected-contrast); }

      .product { display: flex; flex-direction: column; gap: var(--uui-size-space-2); padding-bottom: var(--uui-size-space-4); border-bottom: 1px solid var(--uui-color-divider); }
      .product-name { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--uui-size-space-2); }
      uui-button-group { flex-wrap: wrap; }
      .groups { display: flex; flex-direction: column; gap: var(--uui-size-space-2); }
      .group { display: inline-flex; flex-wrap: wrap; align-items: baseline; gap: var(--uui-size-space-2); }
      .hint { color: var(--uui-color-warning-standalone); }

      .note { display: flex; gap: var(--uui-size-space-2); align-items: flex-start; padding: var(--uui-size-space-3); border-radius: var(--uui-border-radius); }
      .note umb-icon { flex: none; margin-top: 2px; }
      .note.positive { background: var(--uui-color-positive); color: var(--uui-color-positive-contrast); }
      .note.warning { background: var(--uui-color-warning); color: var(--uui-color-warning-contrast); }
      .note.danger { background: var(--uui-color-danger); color: var(--uui-color-danger-contrast); }

      .summary { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: var(--uui-size-space-2) var(--uui-size-space-5); margin: 0; }
      .summary dt { color: var(--uui-color-text-alt); }
      .summary dd { margin: 0; overflow-wrap: anywhere; display: flex; align-items: center; gap: var(--uui-size-space-2); }
      .secret-row { display: flex; gap: var(--uui-size-space-2); align-items: center; }
      .secret-row uui-input { flex: 1; min-width: 0; font-family: ui-monospace, Menlo, Consolas, monospace; }
      .waiting { display: flex; flex-direction: column; gap: var(--uui-size-space-3); }
    `,
  ];
}

customElements.define("umbrella-new-connection-modal", UmbrellaNewConnectionModalElement);
export default UmbrellaNewConnectionModalElement;
