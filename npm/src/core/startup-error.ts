/**
 * Turns the error from the first call to the site (the credentials check in `server.ts`) into a message that names
 * the likely cause. `showDetails` is false when the message already says everything the raw error would.
 */

/** Socket errors that mean nothing answered at the URL: the site is down, or the host or port is wrong. */
const UNREACHABLE_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH"]);

/** TLS errors where the site answered but its certificate was not trusted. */
const CERTIFICATE_CODES = new Set([
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "CERT_HAS_EXPIRED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

const TOKEN_FAILED = /^Token request failed: (\d{3})/;

export function describeStartupError(error: unknown, baseUrl: string): { message: string; showDetails: boolean } {
  const code = networkErrorCode(error);
  if (code && UNREACHABLE_CODES.has(code)) {
    return {
      message: `Could not reach Umbraco at ${baseUrl} (${code}). Is the site running, and is UMBRACO_BASE_URL right?`,
      showDetails: false,
    };
  }
  if (code && CERTIFICATE_CODES.has(code)) {
    return {
      message:
        `Could not connect to Umbraco at ${baseUrl}: its HTTPS certificate was not accepted (${code}). ` +
        "For a local site with a development certificate, set NODE_TLS_REJECT_UNAUTHORIZED=0; otherwise trust the certificate with NODE_EXTRA_CA_CERTS.",
      showDetails: false,
    };
  }
  const status = error instanceof Error ? TOKEN_FAILED.exec(error.message)?.[1] : undefined;
  if (status) {
    return {
      message:
        `Umbraco refused the API user's token request (HTTP ${status}). Check UMBRACO_CLIENT_ID and UMBRACO_CLIENT_SECRET, ` +
        "that the API user is not disabled, and that UMBRACO_BASE_URL starts with https://.",
      showDetails: false,
    };
  }
  return {
    message: "Could not authenticate against Umbraco. Check UMBRACO_BASE_URL, UMBRACO_CLIENT_ID and UMBRACO_CLIENT_SECRET.",
    showDetails: true,
  };
}

/** Node's fetch throws `TypeError("fetch failed")` with the socket or TLS error as `cause`, sometimes an AggregateError. */
function networkErrorCode(error: unknown): string | undefined {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
    if (current instanceof AggregateError) {
      const inner = current.errors.map((e) => (e as { code?: unknown })?.code).find((c) => typeof c === "string");
      if (typeof inner === "string") return inner;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}
