import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export class 資料儲存庫 {
  constructor(檔案路徑 = "./資料/訊號紀錄.json") {
    this.檔案路徑 = resolve(檔案路徑);
    this.資料 = { signals: [], pendingOrders: [], settings: { mode: "balanced", paused: false, trendThreshold: 75, counterThreshold: 85, nightThreshold: 80, nightHourHkt: 23, nightExpiryHourHkt: 8, lastNightPlanDate: null } };
    this.寫入序列 = Promise.resolve();
  }

  async 初始化() {
    await mkdir(dirname(this.檔案路徑), { recursive: true });
    try {
      this.資料 = JSON.parse(await readFile(this.檔案路徑, "utf8"));
      this.資料.signals ??= [];
      this.資料.pendingOrders ??= [];
      this.資料.settings = { mode: "balanced", paused: false, trendThreshold: 75, counterThreshold: 85, nightThreshold: 80, nightHourHkt: 23, nightExpiryHourHkt: 8, lastNightPlanDate: null, ...(this.資料.settings ?? {}) };
      this.資料.settings.orderSequences ??= {};
      this.資料.signals = this.資料.signals.map((項目) => {
        const system = 項目.system || this.推斷系統(項目.source);
        return { ...項目, system, orderId: 項目.orderId || this.建立訂單編號(system) };
      });
      this.資料.pendingOrders = this.資料.pendingOrders.map((項目) => {
        const system = 項目.system || (項目.source === "website_scan" ? "website_ai" : "telegram");
        return { ...項目, system, orderId: 項目.orderId || this.建立訂單編號(system) };
      });
      await this.儲存();
    } catch {
      await this.儲存();
    }
    return this;
  }

  async 儲存() {
    this.寫入序列 = this.寫入序列.then(() =>
      writeFile(this.檔案路徑, JSON.stringify(this.資料, null, 2), "utf8")
    );
    return this.寫入序列;
  }

  推斷系統(source) {
    if (source === "wyckoff") return "wyckoff";
    if (["github_live", "night_order", "telegram_live"].includes(source)) return "telegram";
    return "website_ai";
  }

  建立訂單編號(system) {
    this.資料.settings ??= {};
    this.資料.settings.orderSequences ??= {};
    const 前綴 = { telegram: "TG", website_ai: "AI", wyckoff: "WY" }[system] || "OR";
    const 日期 = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Hong_Kong" }).replaceAll("-", "");
    const key = `${前綴}-${日期}`;
    const 下一個 = Number(this.資料.settings.orderSequences[key] || 0) + 1;
    this.資料.settings.orderSequences[key] = 下一個;
    return `${key}-${String(下一個).padStart(4, "0")}`;
  }

  取得訊號(數量 = 100, system = null) {
    const 清單 = system ? this.資料.signals.filter((項目) => 項目.system === system) : this.資料.signals;
    return 清單.slice(0, 數量);
  }

  async 加入訊號(訊號) {
    const system = 訊號.system || this.推斷系統(訊號.source);
    const 完整 = { id: 訊號.id || `${Date.now()}-${訊號.symbol}`, status: "open", enteredAt: new Date().toISOString(), tp1Hit: false, maxFavorableR: 0, maxAdverseR: 0, ...訊號, system, orderId: 訊號.orderId || this.建立訂單編號(system) };
    this.資料.signals.unshift(完整);
    this.資料.signals = this.資料.signals.slice(0, 1000);
    await this.儲存();
    return 完整;
  }

  取得未平倉(system = null) { return this.資料.signals.filter((項目) => 項目.status === "open" && (!system || 項目.system === system)); }
  有未平倉(symbol, system = null) { return this.資料.signals.some((項目) => 項目.symbol === symbol && 項目.status === "open" && (!system || 項目.system === system)); }
  async 更新訊號(id, 更新) {
    const 索引 = this.資料.signals.findIndex((項目) => 項目.id === id);
    if (索引 < 0) return null;
    this.資料.signals[索引] = { ...this.資料.signals[索引], ...更新 };
    await this.儲存();
    return this.資料.signals[索引];
  }

  取得掛單(system = null) { return this.資料.pendingOrders.filter((項目) => !system || 項目.system === system).slice(); }
  取得有效掛單(system = null) { return this.資料.pendingOrders.filter((項目) => 項目.status === "pending" && (!system || 項目.system === system)); }
  有有效掛單(symbol, system, direction = null) { return this.資料.pendingOrders.some((項目) => 項目.status === "pending" && 項目.symbol === symbol && 項目.system === system && (!direction || 項目.direction === direction)); }
  async 加入掛單(掛單) {
    const system = 掛單.system || (掛單.source === "website_scan" ? "website_ai" : "telegram");
    const 完整 = { id: 掛單.id || `order-${Date.now()}-${掛單.symbol}`, status: "pending", createdAt: new Date().toISOString(), ...掛單, system, orderId: 掛單.orderId || this.建立訂單編號(system) };
    this.資料.pendingOrders.unshift(完整);
    this.資料.pendingOrders = this.資料.pendingOrders.slice(0, 300);
    await this.儲存();
    return 完整;
  }
  async 更新掛單(id, 更新) {
    const 索引 = this.資料.pendingOrders.findIndex((項目) => 項目.id === id);
    if (索引 < 0) return null;
    this.資料.pendingOrders[索引] = { ...this.資料.pendingOrders[索引], ...更新 };
    await this.儲存();
    return this.資料.pendingOrders[索引];
  }

  取得統計(system = null) {
    const 全部 = this.資料.signals.filter((項目) => !system || 項目.system === system);
    const 完成 = 全部.filter((項目) => 項目.status === "closed");
    const wins = 完成.filter((項目) => ["win_tp1", "win_tp2"].includes(項目.result)).length;
    const losses = 完成.filter((項目) => 項目.result === "loss_sl").length;
    const totalR = 完成.reduce((總, 項目) => 總 + Number(項目.realizedR || 0), 0);
    return {
      system,
      totalEntries: 全部.length,
      open: 全部.filter((項目) => 項目.status === "open").length,
      closed: 完成.length,
      wins,
      losses,
      winRate: 完成.length ? Number((wins / 完成.length * 100).toFixed(2)) : 0,
      totalR: Number(totalR.toFixed(2)),
      averageR: 完成.length ? Number((totalR / 完成.length).toFixed(2)) : 0,
      tp1Reached: 全部.filter((項目) => 項目.tp1Hit).length,
      tp2Reached: 全部.filter((項目) => 項目.result === "win_tp2").length,
      pendingOrders: this.取得有效掛單(system).length
    };
  }

  取得全部系統統計() {
    return Object.fromEntries(["telegram", "website_ai", "wyckoff"].map((system) => [system, this.取得統計(system)]));
  }

  取得設定() {
    return { ...this.資料.settings };
  }

  async 更新設定(更新) {
    this.資料.settings = { ...this.資料.settings, ...更新 };
    await this.儲存();
    return this.取得設定();
  }
}
