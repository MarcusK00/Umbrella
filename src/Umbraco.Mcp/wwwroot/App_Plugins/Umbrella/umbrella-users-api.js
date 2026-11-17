import { managementRequest } from "./umbrella-api.js";

/**
 * Umbraco's own user endpoints (Management API v1, Umbraco 17.0.0), called as the signed-in backoffice user. Umbraco
 * decides who may do what; these only shape the requests. Every function takes the auth context first and throws with
 * Umbraco's message when it refuses.
 */

/** API users need an email and a username; `.invalid` is a reserved domain, so mail to it never goes anywhere. */
const apiUserEmail = (clientId) => `${clientId}@umbrella.invalid`;

const ids = (list) => (list ?? []).map((x) => (typeof x === "string" ? x : x.id));

/** The signed-in user: `{ isAdmin, userGroupIds, allowedSections }`. */
export async function getCurrentUser(auth) {
  const user = await managementRequest(auth, "GET", "user/current");
  return { isAdmin: user?.isAdmin === true, userGroupIds: ids(user?.userGroupIds), allowedSections: user?.allowedSections ?? [] };
}

/** Every user group, sorted by name: `[{ id, name, alias, sections }]`. */
export async function listUserGroups(auth) {
  const page = await managementRequest(auth, "GET", "user-group?skip=0&take=1000");
  return (page?.items ?? [])
    .map((g) => ({ id: g.id, name: g.name, alias: g.alias, sections: g.sections ?? [] }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Creates an API user with the given key, so a retry after a lost response finds the same user. */
export function createApiUser(auth, { id, name, clientId, groupIds }) {
  return managementRequest(auth, "POST", "user", {
    id,
    name,
    email: apiUserEmail(clientId),
    userName: apiUserEmail(clientId),
    kind: "Api",
    userGroupIds: groupIds.map((g) => ({ id: g })),
  });
}

export function addClientCredentials(auth, userId, clientId, secret) {
  return managementRequest(auth, "POST", `user/${encodeURIComponent(userId)}/client-credentials`, { clientId, clientSecret: secret });
}

export function deleteClientCredentials(auth, userId, clientId) {
  return managementRequest(auth, "DELETE", `user/${encodeURIComponent(userId)}/client-credentials/${encodeURIComponent(clientId)}`);
}

export function disableUser(auth, userId) {
  return managementRequest(auth, "POST", "user/disable", { userIds: [{ id: userId }] });
}

export function enableUser(auth, userId) {
  return managementRequest(auth, "POST", "user/enable", { userIds: [{ id: userId }] });
}
