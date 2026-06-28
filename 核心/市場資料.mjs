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
    try {
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
    } catch (錯誤) {
      console.warn(`${symbol} ${interval} 改用 Coinbase 公開行情：${錯誤.message}`);
      return this.取得CoinbaseK線(symbol, interval, limit);
    }
  }

  async 取得CoinbaseK線(symbol, interval, limit) {
    const 基礎幣 = String(symbol).toUpperCase().replace(/USDT$/, "");
    if (!["BTC", "ETH", "SOL"].includes(基礎幣)) throw new Error(`Coinbase 後備來源不支援 ${symbol}`);
    const product = `${基礎幣}-USD`;
    const 需要聚合4H = interval === "4h";
    const 秒數 = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600 }[需要聚合4H ? "1h" : interval];
    if (!秒數) throw new Error(`Coinbase 後備來源不支援週期 ${interval}`);
    const 請求數量 = Math.min(300, 需要聚合4H ? limit * 4 + 8 : limit);
    const 結束 = new Date();
    const 開始 = new Date(結束.getTime() - 請求數量 * 秒數 * 1000);
    const 網址 = `https://api.exchange.coinbase.com/products/${encodeURIComponent(product)}/candles?granularity=${秒數}&start=${encodeURIComponent(開始.toISOString())}&end=${encodeURIComponent(結束.toISOString())}`;
    const 回應 = await fetch(網址, { headers: { "User-Agent": "Chain-Pulse-Radar/1.0", Accept: "application/json" } });
    if (!回應.ok) throw new Error(`Coinbase 回應 ${回應.status}`);
    const 原始 = await 回應.json();
    const K線 = 原始.map((項目) => ({
      time: Number(項目[0]), low: Number(項目[1]), high: Number(項目[2]),
      open: Number(項目[3]), close: Number(項目[4]), volume: Number(項目[5]),
      closeTime: (Number(項目[0]) + 秒數) * 1000 - 1
    })).sort((甲, 乙) => 甲.time - 乙.time);
    if (!需要聚合4H) return K線.slice(-limit);
    const 分組 = new Map();
    for (const 棒 of K線) {
      const bucket = Math.floor(棒.time / 14400) * 14400;
      const 現有 = 分組.get(bucket);
      if (!現有) 分組.set(bucket, { ...棒, time: bucket, closeTime: (bucket + 14400) * 1000 - 1 });
      else {
        現有.high = Math.max(現有.high, 棒.high);
        現有.low = Math.min(現有.low, 棒.low);
        現有.close = 棒.close;
        現有.volume += 棒.volume;
      }
    }
    return [...分組.values()].sort((甲, 乙) => 甲.time - 乙.time).slice(-limit);
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
