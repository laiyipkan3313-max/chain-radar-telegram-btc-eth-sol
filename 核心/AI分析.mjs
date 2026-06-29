const 延遲 = (毫秒) => new Promise((resolve) => setTimeout(resolve, 毫秒));
const 限制 = (值, 最小, 最大) => Math.min(最大, Math.max(最小, 值));
const 有效價格 = (值) => Number.isFinite(Number(值)) && Number(值) > 0;

function 擷取JSON(文字) {
  const 清理 = String(文字 || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try { return JSON.parse(清理); } catch {}
  for (let 開始 = 0; 開始 < 清理.length; 開始 += 1) {
    if (清理[開始] !== "{") continue;
    let 深度 = 0;
    let 字串中 = false;
    let 跳脫 = false;
    for (let 索引 = 開始; 索引 < 清理.length; 索引 += 1) {
      const 字元 = 清理[索引];
      if (字串中) {
        if (跳脫) 跳脫 = false;
        else if (字元 === "\\") 跳脫 = true;
        else if (字元 === '"') 字串中 = false;
        continue;
      }
      if (字元 === '"') 字串中 = true;
      else if (字元 === "{") 深度 += 1;
      else if (字元 === "}") {
        深度 -= 1;
        if (深度 === 0) {
          try { return JSON.parse(清理.slice(開始, 索引 + 1)); } catch { break; }
        }
      }
    }
  }
  throw new Error("AI 沒有回傳有效 JSON");
}

function 短文字(值, 預設 = "未有足夠證據") {
  return String(值 || 預設).replace(/\s+/g, " ").trim().slice(0, 500);
}

function 市場輸入(分析) {
  return {
    symbol: 分析.symbol,
    currentPrice: 分析.price,
    rank: 分析.rank,
    quoteVolume: 分析.quoteVolume,
    changePercent24h: 分析.changePercent,
    relativeToBtc: 分析.relativeToBtc,
    dataSchema: 分析.aiDataSchema,
    marketData: 分析.aiMarketData,
    nonAuthoritativeReferences: {
      note: "以下為舊規則／Pine邏輯產生的參考，不是答案；可以反對、忽略或判定無交易。",
      timeframes: 分析.timeframes,
      structureFrames: 分析.structureFrames,
      ruleCandidates: 分析.strategyCandidates,
      wyckoffScan: 分析.wyckoffReference || null
    }
  };
}

function 正規方向(值) {
  const 方向 = String(值 || "NONE").toUpperCase();
  return ["LONG", "SHORT", "NONE"].includes(方向) ? 方向 : "NONE";
}

function 正規行動(值) {
  const 行動 = String(值 || "NO_TRADE").toUpperCase();
  return ["ENTER_NOW", "WAIT_LIMIT", "WAIT_TRIGGER", "NO_TRADE"].includes(行動) ? 行動 : "NO_TRADE";
}

function 驗證價位(決策, 分析, 模式) {
  const direction = 正規方向(決策.direction);
  const action = 正規行動(決策.action);
  if (direction === "NONE" || action === "NO_TRADE") return { valid: true, plan: null, rr1: null, rr2: null };
  const entryLow = Number(決策.entryLow);
  const entryHigh = Number(決策.entryHigh);
  const sl = Number(決策.sl);
  const tp1 = Number(決策.tp1);
  const tp2 = Number(決策.tp2);
  if (![entryLow, entryHigh, sl, tp1, tp2].every(有效價格) || entryLow > entryHigh) return { valid: false, reason: "AI 價位格式無效" };
  const center = (entryLow + entryHigh) / 2;
  const longOrder = direction === "LONG" && sl < entryLow && tp1 > entryHigh && tp2 > tp1;
  const shortOrder = direction === "SHORT" && sl > entryHigh && tp1 < entryLow && tp2 < tp1;
  if (!longOrder && !shortOrder) return { valid: false, reason: "AI Entry／SL／TP 排列不合理" };
  const risk = Math.abs(center - sl);
  const rr1 = risk ? Math.abs(tp1 - center) / risk : 0;
  const rr2 = risk ? Math.abs(tp2 - center) / risk : 0;
  if (rr1 < (模式 === "night" ? 1.35 : 1.2) || rr2 <= rr1) return { valid: false, reason: "AI 方案盈虧比不足" };
  const current = Number(分析.price);
  const atr = Number(分析.aiMarketData?.["1h"]?.indicatorReference?.atr14) || current * 0.015;
  const 最大距離 = Math.max(atr * 12, current * 0.18);
  if ([entryLow, entryHigh, sl, tp1, tp2].some((值) => Math.abs(值 - current) > 最大距離)) return { valid: false, reason: "AI 價位偏離現價過遠" };
  if (action === "ENTER_NOW") {
    const 容差 = atr * 0.12;
    if (current < entryLow - 容差 || current > entryHigh + 容差) return { valid: false, reason: "AI 聲稱立即入場，但現價未進入 Entry 區" };
  }
  return {
    valid: true,
    rr1: Number(rr1.toFixed(2)), rr2: Number(rr2.toFixed(2)),
    plan: { direction, entryLow, entryHigh, entryCenter: center, sl, tp1, tp2, rr1: Number(rr1.toFixed(2)), rr2: Number(rr2.toFixed(2)), inEntryZone: current >= entryLow && current <= entryHigh, source: "AI自主判讀" }
  };
}

export function 驗證AI自主決策(原始, 分析, { 模式 = "live" } = {}) {
  const direction = 正規方向(原始?.direction);
  const action = 正規行動(原始?.action);
  const strategyType = ["trend", "counter", "none"].includes(String(原始?.strategyType)) ? String(原始.strategyType) : "none";
  const 價位 = 驗證價位({ ...原始, direction, action }, 分析, 模式);
  if (!價位.valid) throw new Error(價位.reason);
  const 最終方向 = action === "NO_TRADE" ? "NONE" : direction;
  if (action !== "NO_TRADE" && direction === "NONE") throw new Error("AI 有交易行動但沒有方向");
  return {
    marketRegime: 短文字(原始.marketRegime),
    higherTimeframeBias: 短文字(原始.higherTimeframeBias),
    location: ["premium", "discount", "equilibrium"].includes(String(原始.location)) ? String(原始.location) : "equilibrium",
    direction: 最終方向,
    strategyType: 最終方向 === "NONE" ? "none" : strategyType,
    action,
    score: Math.round(限制(Number(原始.score) || 0, 0, 100)),
    topDown: {
      "4h": 短文字(原始.topDown?.["4h"]), "1h": 短文字(原始.topDown?.["1h"]),
      "15m": 短文字(原始.topDown?.["15m"]), "5m": 短文字(原始.topDown?.["5m"])
    },
    liquidity: {
      buySide: Array.isArray(原始.liquidity?.buySide) ? 原始.liquidity.buySide.filter(有效價格).slice(0, 3).map(Number) : [],
      sellSide: Array.isArray(原始.liquidity?.sellSide) ? 原始.liquidity.sellSide.filter(有效價格).slice(0, 3).map(Number) : []
    },
    primaryScenario: 短文字(原始.primaryScenario),
    counterScenario: 短文字(原始.counterScenario),
    triggers: Array.isArray(原始.triggers) ? 原始.triggers.slice(0, 6).map((值) => 短文字(值)) : [],
    invalidation: 短文字(原始.invalidation),
    noTradeReason: 最終方向 === "NONE" || action !== "ENTER_NOW" ? 短文字(原始.noTradeReason, "尚未滿足即時進場條件") : "",
    reason: 短文字(原始.reason),
    riskFlags: Array.isArray(原始.riskFlags) ? 原始.riskFlags.slice(0, 8).map((值) => 短文字(值)) : [],
    plan: 價位.plan,
    rr1: 價位.rr1,
    rr2: 價位.rr2
  };
}

export function 格式化AI報告(決策) {
  const 方向 = 決策.direction === "LONG" ? "做多" : 決策.direction === "SHORT" ? "做空" : "暫不交易";
  const 類型 = 決策.strategyType === "trend" ? "順勢" : 決策.strategyType === "counter" ? "逆勢" : "觀望";
  const 位置 = { premium: "溢價區", discount: "折價區", equilibrium: "中軸／無主之地" }[決策.location];
  const 行動 = { ENTER_NOW: "可即時入場", WAIT_LIMIT: "等待限價區", WAIT_TRIGGER: "等待觸發", NO_TRADE: "不交易" }[決策.action];
  const 流動性 = (陣列) => 陣列.length ? 陣列.join("、") : "未確認";
  const 行 = [
    `結論：${方向}｜${類型}｜${行動}｜AI評分 ${決策.score}`,
    `市場狀態：${決策.marketRegime}`,
    `目前位置：${位置}；高週期偏向：${決策.higherTimeframeBias}`,
    "",
    "1. 多週期結構分析",
    `4H：${決策.topDown["4h"]}`,
    `1H：${決策.topDown["1h"]}`,
    `15m：${決策.topDown["15m"]}`,
    `5m：${決策.topDown["5m"]}`,
    "",
    "2. 流動性目標",
    `上方 BSL：${流動性(決策.liquidity.buySide)}`,
    `下方 SSL：${流動性(決策.liquidity.sellSide)}`,
    "",
    "3. 交易劇本",
    `主劇本：${決策.primaryScenario}`,
    `逆向／備用劇本：${決策.counterScenario}`
  ];
  if (決策.plan) {
    行.push(`Entry：${決策.plan.entryLow} - ${決策.plan.entryHigh}`, `SL：${決策.plan.sl}`, `TP1：${決策.plan.tp1}｜TP2：${決策.plan.tp2}`, `RR：${決策.rr1}／${決策.rr2}`);
  }
  if (決策.triggers.length) 行.push(`觸發條件：${決策.triggers.join("；")}`);
  行.push(`失效條件：${決策.invalidation}`);
  if (決策.noTradeReason) 行.push(`目前未直接入場原因：${決策.noTradeReason}`);
  行.push(`判斷依據：${決策.reason}`);
  return 行.join("\n");
}

const 系統提示 = `你是自主判斷的加密貨幣價格行為分析員。程式只供應客觀 OHLCV、指標和非權威參考，方向及交易劇本必須由你自己從數據判斷；不得照抄規則候選，也不得因候選有分數就批准。
使用 Top-Down：4H只定宏觀環境，1H判斷主要結構與趨勢／震盪，15m找Setup，5m只確認精確觸發。必須辨認趨勢、區間、熊旗／牛旗、慢升壓縮、放量位移、影線拒絕、BOS／CHoCH、FVG／OB、BSL／SSL及區間中軸。
優先回答「現在是否有優勢」。價格在中軸、證據衝突或5m未觸發時，應選 WAIT_TRIGGER 或 NO_TRADE，不能勉強出單。順勢和逆勢要分開；逆勢必須有流動性掃蕩及結構反轉證據。嚴禁幻想未出現在數據內的價格。
只回傳一個 JSON 物件，不要 Markdown。欄位：
{"marketRegime":"","higherTimeframeBias":"","location":"premium|discount|equilibrium","direction":"LONG|SHORT|NONE","strategyType":"trend|counter|none","action":"ENTER_NOW|WAIT_LIMIT|WAIT_TRIGGER|NO_TRADE","score":0,"topDown":{"4h":"","1h":"","15m":"","5m":""},"liquidity":{"buySide":[價格],"sellSide":[價格]},"primaryScenario":"","counterScenario":"","entryLow":null,"entryHigh":null,"sl":null,"tp1":null,"tp2":null,"triggers":[""],"invalidation":"","noTradeReason":"","reason":"","riskFlags":[""]}。
若 NO_TRADE，所有價位可以 null。若有交易，價位次序及盈虧比必須合理。用繁體中文。`;

const 夜更強制提示 = `
你而家執行香港時間23:00睡前限價部署，唔係判斷即時入場。必須為標的選擇 LONG 或 SHORT 其中一個方向，action 必須係 WAIT_LIMIT，並提供完整 entryLow、entryHigh、sl、tp1、tp2。即使現價位於中軸或訊號衝突，都要比較兩邊後選擇風險較低、等待價格到位先成交嘅方案；可以降低 score、擴大等待距離並列出風險，但唔可以回覆 NONE、NO_TRADE、WAIT_TRIGGER 或空白價位。不得假裝5m已觸發。`;

export function 驗證夜更掛單決策(決策) {
  if (!決策?.plan || 決策.action !== "WAIT_LIMIT" || !["LONG", "SHORT"].includes(決策.direction)) {
    throw new Error("夜更 AI 未有產生完整 WAIT_LIMIT 掛單");
  }
  return 決策;
}

export class AI分析服務 {
  constructor({ apiKey, model, fallbackModels, baseUrl }) {
    this.apiKey = apiKey || "";
    this.model = model || "openai/gpt-oss-120b:free";
    this.fallbackModels = String(fallbackModels || "openrouter/free").split(",").map((項目) => 項目.trim()).filter(Boolean);
    this.baseUrl = baseUrl || "http://localhost:3300";
    this.請求紀錄 = [];
  }

  get 已設定() { return Boolean(this.apiKey); }

  async 等候配額() {
    const 現在 = Date.now();
    this.請求紀錄 = this.請求紀錄.filter((時間) => 現在 - 時間 < 60_000);
    if (this.請求紀錄.length >= 5) await 延遲(Math.max(500, 60_000 - (現在 - this.請求紀錄[0])));
    this.請求紀錄.push(Date.now());
  }

  async 呼叫自主模型(模型, 分析, { 模式 = "live" } = {}) {
    await this.等候配額();
    const 控制器 = new AbortController();
    const 計時器 = setTimeout(() => 控制器.abort(), 75_000);
    let 回應;
    try {
      回應 = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json", "http-referer": this.baseUrl, "x-title": "Chain Pulse Radar" },
      signal: 控制器.signal,
      body: JSON.stringify({
        model: 模型,
        messages: [
          { role: "system", content: 模式 === "night" ? `${系統提示}\n${夜更強制提示}` : 系統提示 },
          { role: "user", content: JSON.stringify({ mode: 模式 === "night" ? "香港時間夜更限價部署" : "即時分析", instruction: 模式 === "night" ? "必須輸出一張 WAIT_LIMIT 掛單，LONG／SHORT 二選一；不可選擇不交易。" : "只有現價已進Entry且5m確認才可ENTER_NOW。", ...市場輸入(分析) }) }
        ],
        response_format: { type: "json_object" },
        reasoning: { effort: "low", exclude: true },
        max_tokens: 3200,
        temperature: 0.2
      })
      });
    } finally { clearTimeout(計時器); }
    const 結果 = await 回應.json();
    if (!回應.ok) throw new Error(結果?.error?.message || `OpenRouter 回應 ${回應.status}`);
    const 原始 = 擷取JSON(結果.choices?.[0]?.message?.content);
    const decision = 驗證AI自主決策(原始, 分析, { 模式 });
    if (模式 === "night") 驗證夜更掛單決策(decision);
    return { model: 模型, decision, content: 格式化AI報告(decision), generatedAt: new Date().toISOString() };
  }

  async 自主策略分析(市場分析, 選項 = {}) {
    if (!this.已設定) {
      const 錯誤 = new Error("OpenRouter API Key 尚未設定");
      錯誤.statusCode = 503;
      throw 錯誤;
    }
    let 最後錯誤;
    for (const 模型 of [this.model, ...this.fallbackModels]) {
      try { return await this.呼叫自主模型(模型, 市場分析, 選項); }
      catch (錯誤) { 最後錯誤 = 錯誤; }
    }
    throw 最後錯誤 || new Error("AI 自主分析暫時不可用");
  }

  async 分析(市場分析) { return this.自主策略分析(市場分析, { 模式: "live" }); }

  async 審核策略(候選, 市場分析, { 夜更 = false } = {}) {
    try {
      const 結果 = await this.自主策略分析(市場分析, { 模式: 夜更 ? "night" : "live" });
      const 決策 = 結果.decision;
      const 行動合格 = 夜更 ? ["WAIT_LIMIT", "ENTER_NOW"].includes(決策.action) : 決策.action === "ENTER_NOW";
      const 方向相符 = 決策.direction === 候選.direction;
      const threshold = Number(候選.threshold || (夜更 ? 80 : 75));
      return {
        approved: 行動合格 && 方向相符 && 決策.score >= threshold && Boolean(決策.plan),
        score: 決策.score,
        reason: 方向相符 ? 決策.reason : `AI自主方向為 ${決策.direction}，不同於規則候選 ${候選.direction}`,
        riskFlags: 決策.riskFlags,
        model: 結果.model,
        reviewedAt: 結果.generatedAt,
        autonomousDecision: 決策
      };
    } catch (錯誤) {
      return { approved: false, score: 0, reason: 錯誤.message, riskFlags: ["AI_ERROR"] };
    }
  }
}
