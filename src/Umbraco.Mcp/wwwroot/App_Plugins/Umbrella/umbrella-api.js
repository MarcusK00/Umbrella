const API_BASE = "/umbraco/management/api/v1/mcp/";

/**
 * Calls the add-on's management API as the signed-in backoffice user.
 * `path` is the part after `/umbraco/management/api/v1/mcp/`, for example "overview".
 * Returns the parsed JSON, or null for 204. Throws with the problem's detail, or "HTTP <status>".
 */
export async function request(host, auth, method, path, body) {
  const config = auth.getOpenApiConfiguration();
  const response = await fetch(`${config.base}${API_BASE}${path}`, {
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
    throw new Error(problem?.detail ?? `HTTP ${response.status}`);
  }
  return response.status === 204 ? null : response.json();
}

const pad = (n) => String(n).padStart(2, "0");

/** DD-MM-YYYY HH:mm in the browser's time zone. */
export function formatDate(iso) {
  const d = new Date(iso);
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
