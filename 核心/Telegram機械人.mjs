const 模式 = {
  quiet: { name: "安靜", minScore: 82, minRr: 2, cooldownMinutes: 120, hourlyLimit: 3 },
  balanced: { name: "平衡", minScore: 75, minRr: 1.8, cooldownMinutes: 60, hourlyLimit: 6 },
  aggressive: { name: "積極", minScore: 68, minRr: 1.5, cooldownMinutes: 30, hourlyLimit: 12 }
};

const HTML跳脫 = (文字) => String(文字)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;");

function 價格文字(數值) {
  if (數值 >= 1000) return `$${數值.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (數值 >= 1) return `$${數值.toLocaleString("en-US", { maximumFractionDigits: 3 })}`;
  return `$${數值.toLocaleString("en-US", { maximumFractionDigits: 7 })}`;
}

export function 格式化Telegram訊號(訊號) {
  const 方案 = 訊號.primaryPlan;
  const 是多單 = 方案.direction === "LONG";
  const 做法 = 是多單 ? "做多" : "做空";
  const 類型 = 訊號.strategyType === "counter" ? "逆勢交易" : "順勢交易";
  const 來源 = 訊號.source === "night_order" ? "夜更掛單成交" : 訊號.source === "wyckoff" ? "威科夫掃描" : "多時間框架";
  const 逆向 = Number(訊號.reversePlan?.score || 0) >= 68
    ? `\n另一方向參考：${訊號.reversePlan.direction === "LONG" ? "做多" : "做空"}，評分 ${訊號.reversePlan.score}`
    : "\n另一方向參考：暫未成立";
  const AI = 訊號.aiDecision ? `\nAI 審核：${訊號.aiDecision.score}/100\nAI 意見：${訊號.aiDecision.reason}` : "";
  return `${是多單 ? "🟢" : "🔴"} ${做法}｜${類型}\n${訊號.symbol}\n訂單編號：${訊號.orderId || 訊號.id}\n\n訊號來源：${來源}\n現價：${價格文字(訊號.price)}\nAI評分：${訊號.score}/100${AI}\n\n入場區：${價格文字(方案.entryLow)} 至 ${價格文字(方案.entryHigh)}\n止損價：${價格文字(方案.sl)}\n第一目標：${價格文字(方案.tp1)}（${方案.rr1.toFixed(1)}R）\n第二目標：${價格文字(方案.tp2)}（${方案.rr2.toFixed(1)}R）\n\n分析：\n${訊號.analysis}${逆向}\n\n⚠️ 技術分析參考，非投資建議`;
}

function 建立指紋(訊號) {
  const 方案 = 訊號.primaryPlan;
  const 比例 = Math.max(訊號.price * 0.0025, 1e-8);
  const 離散 = (值) => Math.round(值 / 比例);
  return [訊號.symbol, 方案.direction, 離散(方案.entryCenter), 離散(方案.sl), 離散(方案.tp1)].join(":");
}

export class Telegram機械人 {
  constructor({ token, chatId, 儲存庫, 啟動即發送 = false }) {
    this.token = token;
    this.chatId = String(chatId || "");
    this.儲存庫 = 儲存庫;
    this.啟用 = Boolean(token && chatId);
    this.已武裝 = 啟動即發送;
    this.最後指紋 = new Map();
    this.最後發送 = new Map();
    this.每小時紀錄 = [];
    this.updateOffset = 0;
  }

  async API(方法, body = {}) {
    if (!this.啟用) return null;
    const 回應 = await fetch(`https://api.telegram.org/bot${this.token}/${方法}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    const 結果 = await 回應.json();
    if (!結果.ok) throw new Error(`Telegram：${結果.description || "未知錯誤"}`);
    return 結果.result;
  }

  目前模式() {
    const 設定 = this.儲存庫.取得設定();
    return 模式[設定.mode] ?? 模式.balanced;
  }

  async 考慮發送(訊號) {
    if (!this.啟用 || this.儲存庫.取得設定().paused) return false;
    if (!this.已武裝) return false;
    const 規則 = this.目前模式();
    if (訊號.score < 規則.minScore || 訊號.primaryPlan.rr1 < 規則.minRr) return false;
    const key = `${訊號.symbol}:${訊號.direction}`;
    const 指紋 = 建立指紋(訊號);
    if (this.最後指紋.get(key) === 指紋) return false;
    const 現在 = Date.now();
    const 冷卻 = 規則.cooldownMinutes * 60 * 1000;
    if (現在 - (this.最後發送.get(key) ?? 0) < 冷卻) return false;
    this.每小時紀錄 = this.每小時紀錄.filter((時間) => 現在 - 時間 < 60 * 60 * 1000);
    if (this.每小時紀錄.length >= 規則.hourlyLimit) return false;

    await this.API("sendMessage", {
      chat_id: this.chatId,
      text: 格式化Telegram訊號(訊號),
      disable_web_page_preview: true
    });
    this.最後指紋.set(key, 指紋);
    this.最後發送.set(key, 現在);
    this.每小時紀錄.push(現在);
    await this.儲存庫.加入訊號({ ...訊號, sentAt: new Date().toISOString(), channel: "telegram" });
    return true;
  }

  完成首次掃描() {
    this.已武裝 = true;
  }

  async 發送測試() {
    if (!this.啟用) {
      const 錯誤 = new Error("Telegram Token 或 Chat ID 尚未設定");
      錯誤.statusCode = 503;
      throw 錯誤;
    }
    const 結果 = await this.API("sendMessage", {
      chat_id: this.chatId,
      text: "鏈勢雷達 Telegram 測試成功。網站與訊號頻道連線正常。"
    });
    return { ok: true, messageId: 結果?.message_id ?? null };
  }

  async 發送入場(訊號) {
    if (!this.啟用) return { ok: false, skipped: true };
    const 結果 = await this.API("sendMessage", { chat_id: this.chatId, text: 格式化Telegram訊號(訊號), disable_web_page_preview: true });
    return { ok: true, messageId: 結果?.message_id ?? null };
  }

  async 發送結果(訊號) {
    if (!this.啟用) return;
    const 標籤 = 訊號.result === "win_tp2" ? "TP2 完成" : 訊號.result === "win_tp1" ? "TP1 後保本離場" : "SL 止損";
    await this.API("sendMessage", {
      chat_id: this.chatId,
      text: `鏈勢雷達｜交易結果\n訂單編號：${訊號.orderId || 訊號.id}\n${訊號.direction === "LONG" ? "🟢 做多" : "🔴 做空"}｜${訊號.strategyType === "counter" ? "逆勢交易" : "順勢交易"}\n${訊號.symbol}｜${標籤}\n實現：${Number(訊號.realizedR || 0).toFixed(2)}R`
    });
  }

  async 發送夜更計劃({ date, plans, skipped, expiresAt }) {
    if (!this.啟用) return;
    const 區塊 = plans.map((項目, 索引) => {
      const p = 項目.plan;
      const 做法 = 項目.direction === "LONG" ? "🟢 做多" : "🔴 做空";
      const 類型 = 項目.strategyType === "counter" ? "逆勢交易" : "順勢交易";
      const 級別 = 項目.quality === "qualified" ? "合格掛單" : "機會掛單";
      return `${索引 + 1}. ${做法}｜${類型}\n${項目.symbol}｜${級別}｜評分 ${項目.score}/100\n掛單編號：${項目.orderId || "建立中"}\n入場區：${價格文字(p.entryLow)} 至 ${價格文字(p.entryHigh)}\n止損價：${價格文字(p.sl)}\n第一目標：${價格文字(p.tp1)}\n第二目標：${價格文字(p.tp2)}\n依據：${p.source}`;
    });
    const 跳過 = skipped.length ? `\n\n跳過：${skipped.map((項目) => `${項目.symbol}（${項目.reason}）`).join("、")}` : "";
    await this.API("sendMessage", {
      chat_id: this.chatId,
      text: `鏈勢雷達｜夜更三個機會掛單 ${date}\n香港時間 23:00｜成交額頭三名\n\n${區塊.join("\n\n")}${跳過}\n\n有效至：${new Date(expiresAt).toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong" })}\n⚠️ 限價機會不等於保證成交或獲利`
    });
  }

  async 處理指令(訊息) {
    if (!訊息?.text || String(訊息.chat?.id) !== this.chatId) return;
    const 指令 = 訊息.text.trim().split(/\s+/)[0].toLowerCase();
    const 對照 = {
      "/安靜": "quiet", "/quiet": "quiet",
      "/平衡": "balanced", "/balanced": "balanced",
      "/積極": "aggressive", "/aggressive": "aggressive"
    };
    if (對照[指令]) {
      await this.儲存庫.更新設定({ mode: 對照[指令], paused: false });
      await this.API("sendMessage", { chat_id: this.chatId, text: `已切換至${模式[對照[指令]].name}模式。` });
    } else if (["/暫停", "/pause"].includes(指令)) {
      await this.儲存庫.更新設定({ paused: true });
      await this.API("sendMessage", { chat_id: this.chatId, text: "Telegram 新訊號已暫停。" });
    } else if (["/恢復", "/resume"].includes(指令)) {
      await this.儲存庫.更新設定({ paused: false });
      await this.API("sendMessage", { chat_id: this.chatId, text: "Telegram 新訊號已恢復。" });
    } else if (["/狀態", "/status"].includes(指令)) {
      const 設定 = this.儲存庫.取得設定();
      await this.API("sendMessage", {
        chat_id: this.chatId,
        text: `模式：${模式[設定.mode]?.name ?? "平衡"}\n狀態：${設定.paused ? "暫停" : "運作中"}`
      });
    }
  }

  async 開始指令輪詢() {
    if (!this.啟用) return;
    const 輪詢 = async () => {
      try {
        const 更新 = await this.API("getUpdates", { offset: this.updateOffset, timeout: 20, allowed_updates: ["message"] });
        for (const 項目 of 更新 ?? []) {
          this.updateOffset = 項目.update_id + 1;
          await this.處理指令(項目.message);
        }
      } catch (錯誤) {
        console.error("Telegram 指令輪詢失敗：", 錯誤.message);
      } finally {
        setTimeout(輪詢, 3000);
      }
    };
    輪詢();
  }
}
