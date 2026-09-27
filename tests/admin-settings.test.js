import test from "node:test";
import assert from "node:assert/strict";
import { formatMinutes, REMINDER_OPTIONS } from "../src/admin/durations.js";
import { runAction } from "../netlify/functions/admin-api.mjs";

test("formats reminder boundaries and existing nonstandard values", () => {
  for (const [minutes, expected] of [[15,"15 minutos"],[60,"1 hora"],[90,"1 hora e 30 minutos"],[1440,"1 dia"],[2160,"1 dia e 12 horas"],[10080,"7 dias"]]) assert.equal(formatMinutes(minutes), expected);
  assert.ok(REMINDER_OPTIONS.every((n) => n >= 15 && n <= 10080));
});
test("settings retain API limits and store minutes and days", async () => {
  let saved;
  const db = { from(table) { assert.equal(table, "notification_settings"); return { update(fields) { saved = fields; return { eq() { return { select() { return { single: async () => ({data: fields}) }; } }; } }; } }; } };
  for (const minutes of [10, 10081, 15.5]) await assert.rejects(runAction(db, "save_settings", {reminder_minutes:minutes, inactivity_days:30}), /inválidas/);
  for (const days of [0,366,1.5]) await assert.rejects(runAction(db, "save_settings", {reminder_minutes:90, inactivity_days:days}), /inválidas/);
  await runAction(db, "save_settings", {enabled:false, reminder_minutes:"90", inactivity_days:"45"});
  assert.equal(saved.reminder_minutes,90); assert.equal(saved.inactivity_days,45); assert.equal(saved.enabled,false);
});
