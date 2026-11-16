import { describeStartupError } from "../startup-error.js";

const baseUrl = "https://localhost:44399";

/** What Node's fetch throws when nothing listens on the port: a TypeError whose cause holds the socket error(s). */
function fetchFailed(code: string, aggregate = false): TypeError {
  const socketError = Object.assign(new Error(`connect ${code}`), { code });
  const cause = aggregate
    ? Object.assign(new AggregateError([socketError, socketError]), { code })
    : socketError;
  return new TypeError("fetch failed", { cause });
}

describe("describeStartupError", () => {
  it("says the site is not reachable when the connection is refused", () => {
    const result = describeStartupError(fetchFailed("ECONNREFUSED", true), baseUrl);
    expect(result.message).toBe(
      "Could not reach Umbraco at https://localhost:44399 (ECONNREFUSED). Is the site running, and is UMBRACO_BASE_URL right?",
    );
    expect(result.showDetails).toBe(false);
  });

  it("finds the code on the AggregateError's inner errors when the aggregate has none", () => {
    const socketError = Object.assign(new Error("connect"), { code: "ECONNREFUSED" });
    const error = new TypeError("fetch failed", { cause: new AggregateError([socketError]) });
    expect(describeStartupError(error, baseUrl).message).toContain("(ECONNREFUSED)");
  });

  it.each(["ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "ECONNRESET", "EHOSTUNREACH"])("treats %s as not reachable", (code) => {
    expect(describeStartupError(fetchFailed(code), baseUrl).message).toBe(
      `Could not reach Umbraco at https://localhost:44399 (${code}). Is the site running, and is UMBRACO_BASE_URL right?`,
    );
  });

  it.each(["DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "CERT_HAS_EXPIRED"])(
    "explains a rejected certificate (%s)",
    (code) => {
      const result = describeStartupError(fetchFailed(code), baseUrl);
      expect(result.message).toBe(
        `Could not connect to Umbraco at https://localhost:44399: its HTTPS certificate was not accepted (${code}). ` +
          "For a local site with a development certificate, set NODE_TLS_REJECT_UNAUTHORIZED=0; otherwise trust the certificate with NODE_EXTRA_CA_CERTS.",
      );
      expect(result.showDetails).toBe(false);
    },
  );

  it("points at the credentials when the token request is refused", () => {
    const result = describeStartupError(new Error("Token request failed: 401 Unauthorized"), baseUrl);
    expect(result.message).toBe(
      "Umbraco refused the API user's token request (HTTP 401). Check UMBRACO_CLIENT_ID and UMBRACO_CLIENT_SECRET, " +
        "that the API user is not disabled, and that UMBRACO_BASE_URL starts with https://.",
    );
    expect(result.showDetails).toBe(false);
  });

  it("keeps the general message and the details for anything else", () => {
    const result = describeStartupError(new Error("something odd"), baseUrl);
    expect(result.message).toBe(
      "Could not authenticate against Umbraco. Check UMBRACO_BASE_URL, UMBRACO_CLIENT_ID and UMBRACO_CLIENT_SECRET.",
    );
    expect(result.showDetails).toBe(true);
  });

  it("does not treat an unknown network code as unreachable", () => {
    expect(describeStartupError(fetchFailed("EWEIRD"), baseUrl).showDetails).toBe(true);
  });
});
