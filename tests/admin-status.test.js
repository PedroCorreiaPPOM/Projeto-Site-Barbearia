import test from "node:test";
import assert from "node:assert/strict";
import { handler, bearerToken, authorizeAdmin } from "../netlify/functions/admin-status.mjs";

test("rejects missing or malformed bearer token", async () => {
  assert.equal(bearerToken({}), null);
  assert.equal(bearerToken({ authorization: "Bearer abc def" }), null);
  const response = await handler({ httpMethod: "GET", headers: {} });
  assert.equal(response.statusCode, 401);
});
test("requires configured backend and refuses non-GET methods", async () => {
  assert.equal((await authorizeAdmin("token", "", "")).authorized, false);
  assert.equal((await handler({ httpMethod: "POST", headers: {} })).statusCode, 405);
});

test("rejects an invalid session", async () => {
  const client = { auth: { getUser: async () => ({ data: {}, error: new Error("invalid") }) } };
  assert.equal((await authorizeAdmin("token", "url", "key", () => client)).reason, "unauthenticated");
});
test("rejects an authenticated non-admin", async () => {
  const client = { auth: { getUser: async () => ({ data: { user: { id: "u" } } }) },
    rpc: async () => ({ data: false }) };
  assert.equal((await authorizeAdmin("token", "url", "key", () => client)).reason, "forbidden");
});
test("requires verified MFA for an admin", async () => {
  const client = { auth: { getUser: async () => ({ data: { user: { id: "u" } } }),
    mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: "aal1" } }) } },
    rpc: async () => ({ data: true }) };
  assert.equal((await authorizeAdmin("token", "url", "key", () => client)).reason, "mfa_required");
  client.auth.mfa.getAuthenticatorAssuranceLevel = async () => ({ data: { currentLevel: "aal2" } });
  assert.equal((await authorizeAdmin("token", "url", "key", () => client)).authorized, true);
});
