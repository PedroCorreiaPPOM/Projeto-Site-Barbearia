import test from "node:test";
import assert from "node:assert/strict";
import { runAction, handler } from "../netlify/functions/admin-api.mjs";

test("rejects unauthenticated API calls before querying data", async () => {
  const result = await handler({ httpMethod: "GET", headers: {} });
  assert.equal(result.statusCode, 401);
});
test("rejects invalid mutations without touching the database", async () => {
  const db = { from() { throw new Error("database accessed"); } };
  await assert.rejects(runAction(db, "save_service", { name: "Corte", price: -1, duration_minutes: 30 }), /inválidos/);
  await assert.rejects(runAction(db, "update_appointment", { id: "bad", status: "confirmed" }), /inválido/);
  await assert.rejects(runAction(db, "save_block", { barber_id: "bad" }), /inválido/);
  await assert.rejects(runAction(db, "unknown"), /desconhecida/);
});
