import { createClient } from "@supabase/supabase-js";

export function bearerToken(headers) {
  const value = headers.authorization || headers.Authorization || "";
  const match = /^Bearer ([^\s]+)$/.exec(value);
  return match?.[1] || null;
}

export async function authorizeAdmin(token, url, key, clientFactory = createClient) {
  if (!token || !url || !key) return { authorized: false, reason: "unauthenticated" };
  const client = clientFactory(url, key, { auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: userData, error: userError } = await client.auth.getUser(token);
  if (userError || !userData.user) return { authorized: false, reason: "unauthenticated" };
  const { data: member, error } = await client.rpc("is_admin_member");
  if (error || member !== true) return { authorized: false, reason: "forbidden" };
  const { data: aal, error: aalError } = await client.auth.mfa.getAuthenticatorAssuranceLevel(token);
  return { authorized: !aalError && aal?.currentLevel === "aal2", reason: aalError || aal?.currentLevel !== "aal2" ? "mfa_required" : null };
}

export async function handler(event) {
  if (event.httpMethod !== "GET") return { statusCode: 405, body: "Method Not Allowed" };
  const token = bearerToken(event.headers || {});
  const result = await authorizeAdmin(token, process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  return { statusCode: result.authorized ? 200 : result.reason === "unauthenticated" ? 401 : 403,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(result) };
}
