import test from "node:test";
import assert from "node:assert/strict";
import { 建立夜更保底結果, 夜更到期時間, 夜更目標日期, 夜更已完整產生 } from "../核心/夜更掛單.mjs";
import { 驗證夜更掛單決策 } from "../核心/AI分析.mjs";

test("凌晨補發仍歸入前一晚", () => {
  assert.equal(夜更目標日期({ date: "2026-06-30", year: 2026, month: 6, day: 30, hour: 0 }), "2026-06-29");
  assert.equal(夜更到期時間("2026-06-29", 8), "2026-06-30T00:00:00.000Z");
});

test("夜更拒絕NO_TRADE", () => {
  assert.throws(() => 驗證夜更掛單決策({ action: "NO_TRADE", direction: "NONE", plan: null }), /WAIT_LIMIT/);
});

test("零張掛單唔可以再標記成夜更完成", () => {
  assert.equal(夜更已完整產生({ lastNightPlanDate: "2026-06-29", lastNightPlanCount: 0 }, "2026-06-29"), false);
  assert.equal(夜更已完整產生({ lastNightPlanDate: "2026-06-29", lastNightPlanCount: 3 }, "2026-06-29"), true);
});

test("AI異常時仍建立完整保底掛單", () => {
  const 結果 = 建立夜更保底結果({
    symbol: "BTCUSDT", score: 82, analysis: "測試",
    timeframes: { "4h": { structure: "熊結構" } },
    primaryPlan: { direction: "SHORT", entryLow: 60000, entryHigh: 60100, sl: 61000, tp1: 58500, tp2: 57500, rr1: 1.8, rr2: 3 }
  }, "模型失敗");
  assert.equal(結果.decision.action, "WAIT_LIMIT");
  assert.equal(結果.decision.direction, "SHORT");
  assert.equal(結果.decision.plan.source, "規則引擎保底（AI異常時使用）");
});
