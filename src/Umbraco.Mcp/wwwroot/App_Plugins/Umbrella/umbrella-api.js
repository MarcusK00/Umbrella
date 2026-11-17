const MANAGEMENT_BASE = "/umbraco/management/api/v1/";

/**
 * Calls Umbraco's Management API as the signed-in backoffice user. `path` is the part after
 * `/umbraco/management/api/v1/`, for example "user/current". Returns the parsed JSON, `{ location }` for a 201 (the
 * created item's address), or null for any other empty response. Throws with the problem's detail, else its title,
 * else a sentence for a bare 401/403, else "HTTP <status>".
 */
export async function managementRequest(auth, method, path, body) {
  const config = auth.getOpenApiConfiguration();
  const response = await fetch(`${config.base}${MANAGEMENT_BASE}${path}`, {
    method,
    credentials: config.credentials,
    headers: {
      Authorization: `Bearer ${await config.token()}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const problem = await response.json().catch(() => null);
    // Umbraco answers a refused permission check with a bare 401 or 403, for example a user group the caller isn't in.
    const refused =
      response.status === 401 || response.status === 403
        ? `Umbraco refused this (HTTP ${response.status}). Your user may not be allowed to do it, for example to give a user group it isn't a member of, or your session has expired.`
        : null;
    throw new Error(problem?.detail || problem?.title || refused || `HTTP ${response.status}`);
  }
  if (response.status === 201) return { location: response.headers.get("Location") };
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

/**
 * Calls the add-on's management API as the signed-in backoffice user.
 * `path` is the part after `/umbraco/management/api/v1/mcp/`, for example "overview".
 * Returns the parsed JSON, or null for an empty response. Throws with the problem's detail, or "HTTP <status>".
 */
export function request(auth, method, path, body) {
  return managementRequest(auth, method, `mcp/${path}`, body);
}

const pad = (n) => String(n).padStart(2, "0");

/** DD-MM-YYYY HH:mm in the browser's time zone. */
export function formatDate(iso) {
  const d = new Date(iso);
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
