function 方向值(方向) { return 方向 === "LONG" ? 1 : -1; }

export class 交易追蹤器 {
  constructor({ 市場資料, 儲存庫, Telegram }) {
    this.市場資料 = 市場資料;
    this.儲存庫 = 儲存庫;
    this.Telegram = Telegram;
    this.執行中 = false;
  }

  async 建立入場({ analysis, candidate, aiDecision, source = "live" }) {
    if (!candidate?.entryReady && source === "live") return null;
    const system = candidate.system || analysis.system || (source === "wyckoff" ? "wyckoff" : ["github_live", "night_order", "telegram_live"].includes(source) ? "telegram" : "website_ai");
    if (!aiDecision?.approved || this.儲存庫.有未平倉(analysis.symbol, system)) return null;
    const p = candidate.plan;
    const 訊號 = await this.儲存庫.加入訊號({
      symbol: analysis.symbol,
      direction: candidate.direction,
      strategyType: candidate.type,
      source,
      system,
      price: analysis.price,
      entryPrice: p.entryCenter,
      entryLow: p.entryLow,
      entryHigh: p.entryHigh,
      sl: p.sl,
      tp1: p.tp1,
      tp2: p.tp2,
      primaryPlan: p,
      reversePlan: analysis.reversePlan,
      score: candidate.score,
      aiDecision,
      analysis: analysis.analysis,
      rank: analysis.rank,
      lastCheckedTime: Math.floor(Date.now() / 1000) - 60
    });
    const 發送 = system === "telegram" ? await this.Telegram.發送入場(訊號).catch(() => ({ ok: false })) : { ok: false, skipped: true };
    if (發送?.messageId) await this.儲存庫.更新訊號(訊號.id, { telegramMessageId: 發送.messageId });
    return 訊號;
  }

  async 監察單一(訊號) {
    const K線 = await this.市場資料.取得K線(訊號.symbol, "1m", 30);
    const 新K = K線.filter((棒) => 棒.time > Number(訊號.lastCheckedTime || 0));
    if (!新K.length) return;
    const dir = 方向值(訊號.direction);
    const risk = Math.max(Math.abs(訊號.entryPrice - 訊號.sl), Number.EPSILON);
    let 狀態 = { ...訊號 };
    for (const 棒 of 新K) {
      const favorable = dir === 1 ? (棒.high - 狀態.entryPrice) / risk : (狀態.entryPrice - 棒.low) / risk;
      const adverse = dir === 1 ? (狀態.entryPrice - 棒.low) / risk : (棒.high - 狀態.entryPrice) / risk;
      狀態.maxFavorableR = Math.max(Number(狀態.maxFavorableR || 0), favorable);
      狀態.maxAdverseR = Math.max(Number(狀態.maxAdverseR || 0), adverse);
      const 打SL = dir === 1 ? 棒.low <= (狀態.tp1Hit ? 狀態.entryPrice : 狀態.sl) : 棒.high >= (狀態.tp1Hit ? 狀態.entryPrice : 狀態.sl);
      const 打TP1 = dir === 1 ? 棒.high >= 狀態.tp1 : 棒.low <= 狀態.tp1;
      const 打TP2 = dir === 1 ? 棒.high >= 狀態.tp2 : 棒.low <= 狀態.tp2;
      if (!狀態.tp1Hit && 打SL) {
        狀態 = { ...狀態, status: "closed", result: "loss_sl", realizedR: -1, closedAt: new Date(棒.time * 1000).toISOString(), exitPrice: 狀態.sl };
        break;
      }
      if (!狀態.tp1Hit && 打TP1) 狀態 = { ...狀態, tp1Hit: true, tp1HitAt: new Date(棒.time * 1000).toISOString() };
      if (狀態.tp1Hit && 打TP2) {
        狀態 = { ...狀態, status: "closed", result: "win_tp2", realizedR: 2.5, closedAt: new Date(棒.time * 1000).toISOString(), exitPrice: 狀態.tp2 };
        break;
      }
      if (狀態.tp1Hit && 打SL) {
        狀態 = { ...狀態, status: "closed", result: "win_tp1", realizedR: 1, closedAt: new Date(棒.time * 1000).toISOString(), exitPrice: 狀態.entryPrice };
        break;
      }
    }
    狀態.lastCheckedTime = 新K.at(-1).time;
    const 更新後 = await this.儲存庫.更新訊號(訊號.id, 狀態);
    if (訊號.status === "open" && 更新後?.status === "closed" && 更新後.system === "telegram") await this.Telegram.發送結果(更新後).catch(() => {});
  }

  async 監察持倉() {
    if (this.執行中) return;
    this.執行中 = true;
    try {
      for (const 訊號 of this.儲存庫.取得未平倉()) await this.監察單一(訊號);
      await this.監察夜更掛單();
    } finally { this.執行中 = false; }
  }

  async 監察夜更掛單() {
    for (const 掛單 of this.儲存庫.取得有效掛單()) {
      if (Date.now() >= new Date(掛單.expiresAt).getTime()) {
        await this.儲存庫.更新掛單(掛單.id, { status: "expired", closedAt: new Date().toISOString() });
        continue;
      }
      if (this.儲存庫.有未平倉(掛單.symbol, 掛單.system)) continue;
      const K線 = await this.市場資料.取得K線(掛單.symbol, "1m", 3);
      const 最新 = K線.at(-1);
      const 有觸及 = 最新.low <= 掛單.plan.entryHigh && 最新.high >= 掛單.plan.entryLow;
      if (!有觸及) continue;
      const analysis = { symbol: 掛單.symbol, system: 掛單.system, price: 掛單.plan.entryCenter, rank: 掛單.rank, analysis: 掛單.analysis, reversePlan: { score: 0 } };
      const candidate = { system: 掛單.system, type: 掛單.strategyType || "trend", direction: 掛單.direction, score: 掛單.score, entryReady: true, plan: 掛單.plan };
      const source = 掛單.source === "website_scan" ? "website_order" : "night_order";
      const 訊號 = await this.建立入場({ analysis, candidate, aiDecision: 掛單.aiDecision, source });
      if (訊號) await this.儲存庫.更新掛單(掛單.id, { status: "filled", filledAt: new Date().toISOString(), signalId: 訊號.id });
    }
  }
}
