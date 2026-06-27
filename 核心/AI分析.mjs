const 延遲 = (毫秒) => new Promise((resolve) => setTimeout(resolve, 毫秒));

function 分析摘要(分析) {
  const 時框 = Object.values(分析.timeframes)
    .map((項目) => `${項目.label}(${項目.role}):${項目.rating}/${項目.structure}/${項目.structureEvent?.type ?? "等待"}`)
    .join("；");
  const 候選 = [分析.strategyCandidates?.trend, 分析.strategyCandidates?.counter].filter(Boolean).sort((甲, 乙) => 乙.score - 甲.score)[0];
  const 方案 = 分析.primaryPlan;
  return {
    symbol: 分析.symbol,
    price: 分析.price,
    direction: 分析.direction,
    score: 分析.score,
    relativeToBtc: 分析.relativeToBtc,
    timeframes: 時框,
    roles: { "4h": "環境參考", "1h": "主要方向", "15m": "Setup確認", "5m": "入場觸發" },
    strategyCandidate: 候選,
    structureFrames: 分析.structureFrames,
    entry: [方案.entryLow, 方案.entryHigh],
    stopLoss: 方案.sl,
    takeProfit1: 方案.tp1,
    takeProfit2: 方案.tp2,
    riskReward: [方案.rr1, 方案.rr2]
  };
}

export class AI分析服務 {
  constructor({ apiKey, model, fallbackModels, baseUrl }) {
    this.apiKey = apiKey || "";
    this.model = model || "openai/gpt-oss-120b:free";
    this.fallbackModels = String(fallbackModels || "openrouter/free").split(",").map((項目) => 項目.trim()).filter(Boolean);
    this.baseUrl = baseUrl || "http://localhost:3200";
    this.請求紀錄 = [];
  }

  get 已設定() { return Boolean(this.apiKey); }

  async 等候配額() {
    const 現在 = Date.now();
    this.請求紀錄 = this.請求紀錄.filter((時間) => 現在 - 時間 < 60_000);
    if (this.請求紀錄.length >= 5) {
      await 延遲(Math.max(500, 60_000 - (現在 - this.請求紀錄[0])));
    }
    this.請求紀錄.push(Date.now());
  }

  async 呼叫模型(模型, 分析) {
    await this.等候配額();
    const 回應 = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
        "http-referer": this.baseUrl,
        "x-title": "Chain Pulse Radar"
      },
      body: JSON.stringify({
        model: 模型,
        messages: [
          {
            role: "system",
            content: "你是謹慎的加密貨幣技術分析員。必須按固定時間壓制判讀：4H只作環境參考、1H決定主方向、15m確認Setup、5m負責入場觸發；順勢與逆勢要分開處理。只可解讀規則引擎提供的候選，不可修改方向、Entry、SL、TP或幻想數據。用繁體中文，指出失效條件。回覆三段：多時區判讀、候選計劃、風險提示。"
          },
          { role: "user", content: JSON.stringify(分析摘要(分析)) }
        ],
        max_tokens: 600,
        temperature: 0.25
      })
    });
    const 結果 = await 回應.json();
    if (!回應.ok) throw new Error(結果?.error?.message || `OpenRouter 回應 ${回應.status}`);
    return {
      model: 模型,
      content: 結果.choices?.[0]?.message?.content?.trim() || "模型沒有回傳內容",
      generatedAt: new Date().toISOString()
    };
  }

  async 分析(市場分析) {
    if (!this.已設定) {
      const 錯誤 = new Error("OpenRouter API Key 尚未設定");
      錯誤.statusCode = 503;
      throw 錯誤;
    }
    const 候選 = [市場分析.strategyCandidates?.trend, 市場分析.strategyCandidates?.counter].filter(Boolean).sort((甲, 乙) => 乙.score - 甲.score)[0];
    if (!候選 || 候選.score < 70) {
      const 錯誤 = new Error("尚未形成 70 分以上多時間策略候選，AI 不會分析");
      錯誤.statusCode = 422;
      throw 錯誤;
    }
    let 最後錯誤;
    for (const 模型 of [this.model, ...this.fallbackModels]) {
      try { return await this.呼叫模型(模型, 市場分析); }
      catch (錯誤) { 最後錯誤 = 錯誤; }
    }
    throw 最後錯誤 || new Error("AI 分析暫時不可用");
  }

  async 審核策略(候選, 市場分析, { 夜更 = false } = {}) {
    if (!this.已設定) return { approved: false, score: 0, reason: "OpenRouter 尚未設定", riskFlags: ["NO_AI"] };
    const payload = {
      mode: 夜更 ? "night_limit_order" : "live_entry",
      symbol: 市場分析.symbol,
      currentPrice: 市場分析.price,
      strategy: 候選.type,
      direction: 候選.direction,
      ruleScore: 候選.score,
      threshold: 夜更 ? 80 : 候選.threshold,
      entryReady: 候選.entryReady,
      trigger: 候選.trigger,
      plan: 候選.plan,
      roles: { "4h": "context_only", "1h": "main_bias", "15m": "setup", "5m": 夜更 ? "limit_zone_precision" : "entry_trigger" },
      frames: 市場分析.structureFrames
    };
    const system = `你是鏈勢雷達的風險閘門。候選價位由規則引擎按 Pine 多時區結構計算，你不可修改方向、Entry、SL、TP，亦不可幻想數據。
時間壓制：4H只作環境參考；1H決定主方向；15m確認Setup；5m只負責入場觸發。順勢與逆勢分開評分。逆勢必須有1H極端區、15m CHoCH與5m反向突破。
${夜更 ? "這是香港時間23:00夜更限價掛單，採保守順勢邏輯，不要求當刻5m觸發，但入場區必須有清楚結構依據。" : "這是即時訊號，必須已進入Entry區而且5m觸發成立。"}
只回傳一個JSON物件，不要Markdown：{"approved":boolean,"score":0-100,"reason":"繁體中文短句","riskFlags":["代碼"]}`;
    let 最後錯誤;
    for (const 模型 of [this.model, ...this.fallbackModels]) {
      try {
        await this.等候配額();
        const 回應 = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json", "http-referer": this.baseUrl, "x-title": "Chain Pulse Radar" },
          body: JSON.stringify({ model: 模型, messages: [{ role: "system", content: system }, { role: "user", content: JSON.stringify(payload) }], max_tokens: 320, temperature: 0.1 })
        });
        const 結果 = await 回應.json();
        if (!回應.ok) throw new Error(結果?.error?.message || `OpenRouter 回應 ${回應.status}`);
        const 文字 = 結果.choices?.[0]?.message?.content?.trim() || "";
        const match = 文字.match(/\{[\s\S]*\}/);
        if (!match) throw new Error("AI 沒有回傳有效 JSON");
        const 決策 = JSON.parse(match[0]);
        const threshold = 夜更 ? 80 : 候選.threshold;
        return {
          approved: 決策.approved === true && Number(決策.score) >= threshold,
          score: Math.round(Math.max(0, Math.min(100, Number(決策.score) || 0))),
          reason: String(決策.reason || "AI 未提供原因").slice(0, 240),
          riskFlags: Array.isArray(決策.riskFlags) ? 決策.riskFlags.slice(0, 8).map(String) : [],
          model: 模型,
          reviewedAt: new Date().toISOString()
        };
      } catch (錯誤) { 最後錯誤 = 錯誤; }
    }
    return { approved: false, score: 0, reason: 最後錯誤?.message || "AI 審核失敗", riskFlags: ["AI_ERROR"] };
  }
}
