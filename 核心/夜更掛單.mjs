const 限制 = (值, 最小, 最大) => Math.min(最大, Math.max(最小, 值));

export function 夜更目標日期(hkt) {
  if (Number(hkt.hour) >= 2) return hkt.date;
  return new Date(Date.UTC(hkt.year, hkt.month - 1, hkt.day - 1)).toISOString().slice(0, 10);
}

export function 夜更到期時間(目標日期, 到期小時 = 8) {
  const [年, 月, 日] = 目標日期.split("-").map(Number);
  return new Date(Date.UTC(年, 月 - 1, 日 + 1, Number(到期小時) - 8, 0, 0)).toISOString();
}

export function 夜更已完整產生(設定, 目標日期) {
  return 設定?.lastNightPlanDate === 目標日期 && Number(設定?.lastNightPlanCount || 0) >= 3;
}

export function 建立夜更保底結果(分析, 原因 = "AI 夜更分析暫時不可用") {
  const 原方案 = 分析?.primaryPlan;
  if (!原方案 || !["LONG", "SHORT"].includes(原方案.direction)) {
    throw new Error(`${分析?.symbol || "標的"} 缺少可用保底方案`);
  }
  const plan = { ...原方案, source: "規則引擎保底（AI異常時使用）" };
  const score = Math.round(限制(Number(分析.score) || 60, 50, 79));
  const decision = {
    marketRegime: "AI暫時不可用，改用多時間框架規則保底",
    higherTimeframeBias: 分析.timeframes?.["4h"]?.structure || "未確認",
    location: "equilibrium",
    direction: plan.direction,
    strategyType: "trend",
    action: "WAIT_LIMIT",
    score,
    topDown: {}, liquidity: { buySide: [], sellSide: [] },
    primaryScenario: 分析.analysis || "等待價格到達Entry區",
    counterScenario: "今次只保留一張保底掛單",
    triggers: ["價格到達Entry區先成交"],
    invalidation: `價格觸及SL ${plan.sl} 後失效`,
    noTradeReason: "",
    reason: `${原因}；為避免夜間完全冇覆蓋，使用規則引擎保底掛單。`,
    riskFlags: ["AI_FALLBACK", String(原因).slice(0, 180)],
    plan
  };
  return {
    model: "RULE_ENGINE_FALLBACK",
    decision,
    content: `夜更保底：${分析.symbol} ${plan.direction}｜Entry ${plan.entryLow}-${plan.entryHigh}｜SL ${plan.sl}｜TP1 ${plan.tp1}｜TP2 ${plan.tp2}｜原因：${原因}`,
    generatedAt: new Date().toISOString(),
    fallback: true
  };
}
