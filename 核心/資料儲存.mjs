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

  取得訊號(數量 = 100) {
    return this.資料.signals.slice(0, 數量);
  }

  async 加入訊號(訊號) {
    const 完整 = { id: 訊號.id || `${Date.now()}-${訊號.symbol}`, status: "open", enteredAt: new Date().toISOString(), tp1Hit: false, maxFavorableR: 0, maxAdverseR: 0, ...訊號 };
    this.資料.signals.unshift(完整);
    this.資料.signals = this.資料.signals.slice(0, 1000);
    await this.儲存();
    return 完整;
  }

  取得未平倉() { return this.資料.signals.filter((項目) => 項目.status === "open"); }
  有未平倉(symbol) { return this.資料.signals.some((項目) => 項目.symbol === symbol && 項目.status === "open"); }
  async 更新訊號(id, 更新) {
    const 索引 = this.資料.signals.findIndex((項目) => 項目.id === id);
    if (索引 < 0) return null;
    this.資料.signals[索引] = { ...this.資料.signals[索引], ...更新 };
    await this.儲存();
    return this.資料.signals[索引];
  }

  取得掛單() { return this.資料.pendingOrders.slice(); }
  取得有效掛單() { return this.資料.pendingOrders.filter((項目) => 項目.status === "pending"); }
  async 加入掛單(掛單) {
    const 完整 = { id: 掛單.id || `night-${Date.now()}-${掛單.symbol}`, status: "pending", createdAt: new Date().toISOString(), ...掛單 };
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

  取得統計() {
    const 完成 = this.資料.signals.filter((項目) => 項目.status === "closed");
    const wins = 完成.filter((項目) => ["win_tp1", "win_tp2"].includes(項目.result)).length;
    const losses = 完成.filter((項目) => 項目.result === "loss_sl").length;
    const totalR = 完成.reduce((總, 項目) => 總 + Number(項目.realizedR || 0), 0);
    return {
      totalEntries: this.資料.signals.length,
      open: this.取得未平倉().length,
      closed: 完成.length,
      wins,
      losses,
      winRate: 完成.length ? Number((wins / 完成.length * 100).toFixed(2)) : 0,
      totalR: Number(totalR.toFixed(2)),
      averageR: 完成.length ? Number((totalR / 完成.length).toFixed(2)) : 0,
      pendingNightOrders: this.取得有效掛單().length
    };
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
