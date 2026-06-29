import { 市場資料服務 } from "../核心/市場資料.mjs";
import { 訊號分析引擎 } from "../核心/訊號引擎.mjs";
import { 資料儲存庫 } from "../核心/資料儲存.mjs";
import { Telegram機械人 } from "../核心/Telegram機械人.mjs";
import { AI分析服務 } from "../核心/AI分析.mjs";
import { 交易追蹤器 } from "../核心/交易追蹤.mjs";
import { 分析威科夫 } from "../核心/威科夫掃描.mjs";
import { 建立夜更保底結果, 夜更到期時間, 夜更目標日期, 夜更已完整產生 } from "../核心/夜更掛單.mjs";
import { fileURLToPath } from "node:url";

const 模式 = process.argv[2] || "scan";
const 必要 = ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "OPENROUTER_API_KEY"];
const 缺少 = 必要.filter((鍵) => !process.env[鍵]);
if (缺少.length) throw new Error(`缺少 GitHub Secrets：${缺少.join(", ")}`);

const 狀態檔 = fileURLToPath(new URL("../資料/github自動化狀態.json", import.meta.url));
const 儲存庫 = await new 資料儲存庫(狀態檔).初始化();
const 市場資料 = new 市場資料服務({ 基礎網址: process.env.BINANCE_FUTURES_API });
const 引擎 = new 訊號分析引擎(市場資料);
const Telegram = new Telegram機械人({ token: process.env.TELEGRAM_BOT_TOKEN, chatId: process.env.TELEGRAM_CHAT_ID, 儲存庫 });
const AI = new AI分析服務({ apiKey: process.env.OPENROUTER_API_KEY, model: process.env.AI_MODEL, fallbackModels: process.env.AI_FALLBACK_MODELS, baseUrl: process.env.PUBLIC_BASE_URL });
const 追蹤器 = new 交易追蹤器({ 市場資料, 儲存庫, Telegram });
const 固定標的 = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
let AI配額鎖 = Promise.resolve();

function HKT資料(日期 = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(日期).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour), minute: Number(parts.minute) };
}

async function 登記AI請求(symbol, 類型 = "live") {
  let 可執行 = false;
  AI配額鎖 = AI配額鎖.catch(() => {}).then(async () => {
    const hkt = HKT資料();
    const 設定 = 儲存庫.取得設定();
    const 同日 = 設定.aiUsageDate === hkt.date;
    const 已用 = 同日 ? Number(設定.aiUsageCount || 0) : 0;
    const slots = 同日 && 設定.aiReviewSlots && typeof 設定.aiReviewSlots === "object" ? { ...設定.aiReviewSlots } : {};
    if (類型 === "live") {
      const slot = `${hkt.date}:${Math.floor(hkt.hour / 2)}`;
      if (slots[symbol] === slot || 已用 >= 36) return;
      slots[symbol] = slot;
    } else if (已用 >= 39) return;
    await 儲存庫.更新設定({ aiUsageDate: hkt.date, aiUsageCount: 已用 + 1, aiReviewSlots: slots });
    可執行 = true;
  });
  await AI配額鎖;
  return 可執行;
}

async function 分批(項目, 限制, 工作) {
  const 結果 = new Array(項目.length);
  let 索引 = 0;
  async function 工作者() {
    while (索引 < 項目.length) {
      const 當前 = 索引++;
      try { 結果[當前] = await 工作(項目[當前]); }
      catch (錯誤) { 結果[當前] = { error: 錯誤.message, item: 項目[當前] }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(限制, 項目.length) }, 工作者));
  return 結果;
}

function 最近已發送(symbol, direction, source, 小時 = 4) {
  const 界線 = Date.now() - 小時 * 60 * 60 * 1000;
  return 儲存庫.取得訊號(300).some((項目) => 項目.symbol === symbol && 項目.direction === direction && 項目.source === source && new Date(項目.enteredAt).getTime() >= 界線);
}

async function 夜更(市場) {
  const hkt = HKT資料();
  const 設定 = 儲存庫.取得設定();
  const 目標日期 = 夜更目標日期(hkt);
  const expiresAt = 夜更到期時間(目標日期, Number(設定.nightExpiryHourHkt ?? 8));
  const 已有掛單 = 儲存庫.取得掛單("telegram").filter((項目) => 項目.source === "night_plan" && 項目.nightDate === 目標日期);
  if (夜更已完整產生(設定, 目標日期)) return console.log("今日三張夜更掛單已完整產生，跳過重複執行。");
  const plans = [...已有掛單];
  const skipped = [];
  for (const row of 市場.slice(0, 3)) {
    if (plans.some((項目) => 項目.symbol === row.symbol)) continue;
    try {
      const 分析 = await 引擎.分析(row.symbol, row);
      let AI結果;
      let AI錯誤 = "";
      if (await 登記AI請求(row.symbol, "night")) {
        try { AI結果 = await AI.自主策略分析(分析, { 模式: "night" }); }
        catch (錯誤) { AI錯誤 = 錯誤.message; }
      } else {
        AI錯誤 = "今日免費 AI 配額已預留完畢";
      }
      if (!AI結果) AI結果 = 建立夜更保底結果(分析, AI錯誤 || "AI未能完成夜更判斷");
      const 決策 = AI結果.decision;
      if (!決策.plan || !["WAIT_LIMIT", "ENTER_NOW"].includes(決策.action)) {
        throw new Error("夜更分析未能建立完整掛單");
      }
      const aiDecision = { approved: true, score: 決策.score, reason: 決策.reason, riskFlags: 決策.riskFlags, model: AI結果.model, reviewedAt: AI結果.generatedAt, fallback: Boolean(AI結果.fallback) };
      let 完整 = {
        system: "telegram", source: "night_plan", symbol: row.symbol, rank: row.rank, direction: 決策.direction, strategyType: 決策.strategyType,
        score: 決策.score, quality: 決策.score >= Number(設定.nightThreshold ?? 80) ? "qualified" : "opportunity",
        plan: 決策.plan, aiDecision, analysis: AI結果.content, nightDate: 目標日期, expiresAt
      };
      完整 = await 儲存庫.加入掛單(完整);
      plans.push(完整);
    } catch (錯誤) { skipped.push({ symbol: row.symbol, reason: 錯誤.message }); }
  }
  await Telegram.發送夜更計劃({ date: 目標日期, plans, skipped, expiresAt });
  if (plans.length < 3) throw new Error(`夜更未完成：只有 ${plans.length}/3 張掛單，保留未完成狀態等待下一次重試`);
  await 儲存庫.更新設定({ lastNightPlanDate: 目標日期, lastNightPlanCount: plans.length });
  console.log(`夜更完成：${plans.length} 張掛單，${skipped.length} 個錯誤。`);
}

async function 即時多時間掃描(市場) {
  const 設定 = 儲存庫.取得設定();
  const 結果 = await 分批(市場, 3, async (row) => {
    const 分析 = await 引擎.分析(row.symbol, row);
    if (儲存庫.有未平倉(row.symbol)) return null;
    if (!await 登記AI請求(row.symbol, "live")) return { symbol: row.symbol, action: "TRACK_ONLY" };
    const 威科夫 = 分析威科夫(await 市場資料.取得K線(row.symbol, "1h", 120), row);
    分析.wyckoffReference = 威科夫;
    const AI結果 = await AI.自主策略分析(分析, { 模式: "live" });
    const 決策 = AI結果.decision;
    const threshold = 決策.strategyType === "counter" ? Number(設定.counterThreshold ?? 85) : Number(設定.trendThreshold ?? 75);
    if (決策.action !== "ENTER_NOW" || !決策.plan || 決策.score < threshold) return { symbol: row.symbol, action: 決策.action, wyckoff: 威科夫 };
    if (最近已發送(row.symbol, 決策.direction, "github_live", 4)) return null;
    const 候選 = { system: "telegram", type: 決策.strategyType, direction: 決策.direction, score: 決策.score, threshold, trigger: true, entryReady: true, plan: 決策.plan };
    const aiDecision = { approved: true, score: 決策.score, reason: 決策.reason, riskFlags: 決策.riskFlags, model: AI結果.model, reviewedAt: AI結果.generatedAt };
    return await 追蹤器.建立入場({ analysis: { ...分析, system: "telegram", analysis: AI結果.content }, candidate: 候選, aiDecision, source: "github_live" });
  });
  const 錯誤項目 = 結果.filter((項目) => 項目?.error);
  for (const 項目 of 錯誤項目) console.error(`${項目.item?.symbol || "未知標的"} 掃描失敗：${項目.error}`);
  const 成功項目 = 結果.filter((項目) => 項目 && !項目.error);
  if (錯誤項目.length === 市場.length) throw new Error("BTC／ETH／SOL 全部掃描失敗");
  return { entries: 成功項目.filter((項目) => 項目?.id).length, decisions: 成功項目.length, errors: 錯誤項目.length };
}

await 追蹤器.監察持倉();
const 自動市場 = 固定標的.map((symbol, 索引) => ({ symbol, rank: 索引 + 1, quoteVolume: null, changePercent: null, relativeToBtc: 0 }));
const 今日 = new Date().toISOString().slice(0, 10);
if (儲存庫.取得設定().automationHeartbeatDate !== 今日) await 儲存庫.更新設定({ automationHeartbeatDate: 今日 });
if (模式 === "night") {
  await 夜更(自動市場);
} else {
  const 掃描 = await 即時多時間掃描(自動市場);
  await 追蹤器.監察持倉();
  console.log(`BTC／ETH／SOL AI自主掃描完成：有效判斷 ${掃描.decisions}，錯誤 ${掃描.errors}，即時入場 ${掃描.entries}。`);
}
