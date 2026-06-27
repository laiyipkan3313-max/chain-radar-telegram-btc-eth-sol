const 穩定幣 = new Set([
  "USDT", "USDC", "FDUSD", "TUSD", "USDP", "DAI", "BUSD", "USDE", "USTC"
]);

const 延遲 = (毫秒) => new Promise((resolve) => setTimeout(resolve, 毫秒));

export class 市場資料服務 {
  constructor({ 基礎網址 = "https://fapi.binance.com", 重試次數 = 2 } = {}) {
    this.基礎網址 = 基礎網址.replace(/\/$/, "");
    this.重試次數 = 重試次數;
    this.合約資料 = null;
    this.合約更新時間 = 0;
  }

  async 取得JSON(路徑) {
    let 最後錯誤;
    for (let 次數 = 0; 次數 <= this.重試次數; 次數 += 1) {
      const 控制器 = new AbortController();
      const 計時器 = setTimeout(() => 控制器.abort(), 15000);
      try {
        const 回應 = await fetch(`${this.基礎網址}${路徑}`, {
          signal: 控制器.signal,
          headers: { "User-Agent": "Chain-Pulse-Radar/1.0" }
        });
        if (!回應.ok) throw new Error(`Binance 回應 ${回應.status}`);
        return await 回應.json();
      } catch (錯誤) {
        最後錯誤 = 錯誤;
        if (次數 < this.重試次數) await 延遲(500 * (次數 + 1));
      } finally {
        clearTimeout(計時器);
      }
    }
    throw 最後錯誤;
  }

  async 取得合約資料() {
    const 現在 = Date.now();
    if (this.合約資料 && 現在 - this.合約更新時間 < 6 * 60 * 60 * 1000) {
      return this.合約資料;
    }
    this.合約資料 = await this.取得JSON("/fapi/v1/exchangeInfo");
    this.合約更新時間 = 現在;
    return this.合約資料;
  }

  async 取得成交額排行(數量 = 100) {
    const [合約資料, 報價資料] = await Promise.all([
      this.取得合約資料(),
      this.取得JSON("/fapi/v1/ticker/24hr")
    ]);
    const 可交易 = new Map(
      合約資料.symbols
        .filter((項目) =>
          項目.contractType === "PERPETUAL" &&
          項目.status === "TRADING" &&
          項目.quoteAsset === "USDT" &&
          !穩定幣.has(項目.baseAsset) &&
          !項目.baseAsset.endsWith("UP") &&
          !項目.baseAsset.endsWith("DOWN") &&
          !項目.baseAsset.endsWith("BULL") &&
          !項目.baseAsset.endsWith("BEAR")
        )
        .map((項目) => [項目.symbol, 項目])
    );

    return 報價資料
      .filter((項目) => 可交易.has(項目.symbol))
      .map((項目) => ({
        symbol: 項目.symbol,
        baseAsset: 可交易.get(項目.symbol).baseAsset,
        price: Number(項目.lastPrice),
        changePercent: Number(項目.priceChangePercent),
        quoteVolume: Number(項目.quoteVolume),
        high: Number(項目.highPrice),
        low: Number(項目.lowPrice)
      }))
      .filter((項目) => Number.isFinite(項目.quoteVolume) && 項目.quoteVolume > 0)
      .sort((甲, 乙) => 乙.quoteVolume - 甲.quoteVolume)
      .slice(0, 數量)
      .map((項目, 索引) => ({ ...項目, rank: 索引 + 1 }));
  }

  async 取得K線(symbol, interval, limit = 200) {
    const 安全標的 = encodeURIComponent(symbol.toUpperCase());
    const 安全週期 = encodeURIComponent(interval);
    const 資料 = await this.取得JSON(
      `/fapi/v1/klines?symbol=${安全標的}&interval=${安全週期}&limit=${limit}`
    );
    return 資料.map((項目) => ({
      time: Math.floor(Number(項目[0]) / 1000),
      open: Number(項目[1]),
      high: Number(項目[2]),
      low: Number(項目[3]),
      close: Number(項目[4]),
      volume: Number(項目[5]),
      closeTime: Number(項目[6])
    }));
  }
}

export function 建立快速市場評分(排行) {
  const BTC = 排行.find((項目) => 項目.symbol === "BTCUSDT");
  const BTC升跌 = BTC?.changePercent ?? 0;
  const 總數 = Math.max(排行.length, 1);
  return 排行.map((項目) => {
    const 相對BTC = 項目.changePercent - BTC升跌;
    const 方向 = 相對BTC >= 0 ? "LONG" : "SHORT";
    const 流動性分 = Math.max(0, 10 - ((項目.rank - 1) / 總數) * 10);
    const 動能分 = Math.min(20, Math.abs(項目.changePercent) * 1.6);
    const 相對分 = Math.min(15, Math.abs(相對BTC) * 2);
    const score = Math.round(Math.min(95, 48 + 流動性分 + 動能分 + 相對分));
    return { ...項目, relativeToBtc: 相對BTC, direction: 方向, score };
  });
}
