import { 分析時間框架, 報酬率, 限制範圍 } from "./技術分析.mjs";
import { 分析多時區策略 } from "./多時區結構.mjs";

const 週期設定 = [
  { key: "4h", label: "4H", weight: 0.25, lookback: 18 },
  { key: "1h", label: "1H", weight: 0.40, lookback: 24 },
  { key: "15m", label: "15m", weight: 0.20, lookback: 16 },
  { key: "5m", label: "5m", weight: 0.15, lookback: 12 }
];

const 小數位 = (價格) => {
  if (價格 >= 1000) return 0;
  if (價格 >= 10) return 2;
  if (價格 >= 1) return 3;
  if (價格 >= 0.01) return 5;
  return 7;
};

const 四捨五入 = (價格) => Number(價格.toFixed(小數位(價格)));

const 精簡數字 = (數值, 位數 = 4) => Number.isFinite(數值) ? Number(數值.toFixed(位數)) : null;

function 建立客觀市場資料(K線, 分析) {
  const 保留數量 = { "4h": 24, "1h": 36, "15m": 36, "5m": 36 };
  return Object.fromEntries(週期設定.map(({ key, label }) => {
    const 序列 = K線[key];
    const 最近 = 序列.slice(-Math.min(保留數量[key], 序列.length));
    const 區間樣本 = 序列.slice(-Math.min(key === "4h" ? 42 : 80, 序列.length));
    const 區間高 = Math.max(...區間樣本.map((項目) => 項目.high));
    const 區間低 = Math.min(...區間樣本.map((項目) => 項目.low));
    const 最新 = 序列.at(-1);
    const 前一 = 序列.at(-2) || 最新;
    const 全幅 = Math.max(latestRange(最新), Number.EPSILON);
    const 上影比例 = (最新.high - Math.max(最新.open, 最新.close)) / 全幅;
    const 下影比例 = (Math.min(最新.open, 最新.close) - 最新.low) / 全幅;
    const 實體比例 = Math.abs(最新.close - 最新.open) / 全幅;
    const 位置 = 區間高 === 區間低 ? 0.5 : (最新.close - 區間低) / (區間高 - 區間低);
    const 技術 = 分析[key];
    return [key, {
      label,
      indicatorReference: {
        ema20: 精簡數字(技術.ema20), ema50: 精簡數字(技術.ema50),
        rsi14: 精簡數字(技術.rsi, 2), macdHistogram: 精簡數字(技術.macd.histogram),
        atr14: 精簡數字(技術.atr), adx14: 精簡數字(技術.adx, 2),
        plusDI: 精簡數字(技術.plusDI, 2), minusDI: 精簡數字(技術.minusDI, 2),
        volumeRatio20: 精簡數字(技術.volumeRatio, 2)
      },
      objectiveRange: {
        high: 精簡數字(區間高), low: 精簡數字(區間低),
        position0to1: 精簡數字(位置, 3), midpoint: 精簡數字((區間高 + 區間低) / 2)
      },
      latestCandle: {
        bodyRatio: 精簡數字(實體比例, 3), upperWickRatio: 精簡數字(上影比例, 3),
        lowerWickRatio: 精簡數字(下影比例, 3),
        closeChangePercent: 前一.close ? 精簡數字((最新.close - 前一.close) / 前一.close * 100, 3) : 0
      },
      candles: 最近.map((項目) => [項目.time, 精簡數字(項目.open), 精簡數字(項目.high), 精簡數字(項目.low), 精簡數字(項目.close), 精簡數字(Number(項目.volume) || 0, 2)])
    }];
  }));
}

function latestRange(K線) {
  return Math.max(0, Number(K線?.high) - Number(K線?.low));
}

function 建立交易方案(方向, 分析, K線) {
  const 一小時 = 分析["1h"];
  const 最新價 = 一小時.close;
  const atr = 一小時.atr || 最新價 * 0.012;
  const ema20 = 一小時.ema20 || 最新價;
  const 中心 = 方向 === "LONG"
    ? Math.min(最新價, ema20 + atr * 0.15)
    : Math.max(最新價, ema20 - atr * 0.15);
  const 區間半徑 = atr * 0.18;
  const 最近 = K線["1h"].slice(-24);
  const 波段低 = Math.min(...最近.map((項目) => 項目.low));
  const 波段高 = Math.max(...最近.map((項目) => 項目.high));
  let sl;
  let 風險;
  if (方向 === "LONG") {
    sl = Math.min(波段低 - atr * 0.2, 中心 - atr * 0.9);
    風險 = Math.max(中心 - sl, atr * 0.75);
  } else {
    sl = Math.max(波段高 + atr * 0.2, 中心 + atr * 0.9);
    風險 = Math.max(sl - 中心, atr * 0.75);
  }
  const 符號 = 方向 === "LONG" ? 1 : -1;
  return {
    direction: 方向,
    entryLow: 四捨五入(中心 - 區間半徑),
    entryHigh: 四捨五入(中心 + 區間半徑),
    entryCenter: 四捨五入(中心),
    sl: 四捨五入(sl),
    tp1: 四捨五入(中心 + 符號 * 風險 * 1.8),
    tp2: 四捨五入(中心 + 符號 * 風險 * 3),
    rr1: 1.8,
    rr2: 3
  };
}

function 建立分析文字(方向, 分析, 相對強弱) {
  const 主要 = 分析["1h"];
  const 高週期 = 分析["4h"];
  const 動詞 = 方向 === "LONG" ? "回調" : "反彈";
  const 相對描述 = 相對強弱 >= 0 ? "強於 BTC" : "弱於 BTC";
  return `${主要.structure}，4H 為 ${高週期.rating}，標的${相對描述}；等待${動詞}至 Entry 區並由 5m 結構確認，避免現價追單。`;
}

function 評分({ 方向, 分析, 相對強弱, rank = 100 }) {
  const 方向值 = 方向 === "LONG" ? 1 : -1;
  const 多框架 = 週期設定.reduce((總和, 週期) => {
    const 項目 = 分析[週期.key];
    return 總和 + (項目.trendValue * 0.6 + 項目.structureValue * 0.4) * 週期.weight;
  }, 0);
  const 結構分 = 限制範圍(15 + 15 * 多框架 * 方向值, 0, 30);
  const 相對分 = 限制範圍(12.5 + 相對強弱 * 方向值 * 2.2, 0, 25);
  const 一小時 = 分析["1h"];
  const 距離EMA = Math.abs(一小時.close - 一小時.ema20) / Math.max(一小時.atr || 1, 1e-9);
  const 入場分 = 限制範圍(20 - 距離EMA * 4, 5, 20);
  const rsi適合 = 方向 === "LONG"
    ? 限制範圍(15 - Math.abs((一小時.rsi ?? 50) - 58) * 0.35, 2, 15)
    : 限制範圍(15 - Math.abs((一小時.rsi ?? 50) - 42) * 0.35, 2, 15);
  const 流動性分 = 限制範圍(10 - ((rank - 1) / 99) * 7, 3, 10);
  return {
    total: Math.round(限制範圍(結構分 + 相對分 + 入場分 + rsi適合 + 流動性分)),
    structure: Math.round(結構分),
    btcRelative: Math.round(相對分),
    entry: Math.round(入場分),
    momentum: Math.round(rsi適合),
    liquidity: Math.round(流動性分)
  };
}

export class 訊號分析引擎 {
  constructor(市場資料) {
    this.市場資料 = 市場資料;
  }

  async 取得多週期K線(symbol) {
    const 結果 = await Promise.all(
      週期設定.map(async (週期) => [週期.key, await this.市場資料.取得K線(symbol, 週期.key, 200)])
    );
    return Object.fromEntries(結果);
  }

  async 分析(symbol, 排行資料, BTC快取 = null) {
    const 標的 = symbol.toUpperCase();
    const [K線, BTCK線] = await Promise.all([
      this.取得多週期K線(標的),
      標的 === "BTCUSDT" ? Promise.resolve(null) : (BTC快取 ?? this.取得多週期K線("BTCUSDT"))
    ]);
    const 分析 = Object.fromEntries(
      週期設定.map((週期) => [週期.key, 分析時間框架(K線[週期.key])])
    );
    const 趨勢總和 = 週期設定.reduce((總和, 週期) => {
      const 項目 = 分析[週期.key];
      return 總和 + (項目.trendValue * 0.6 + 項目.structureValue * 0.4) * 週期.weight;
    }, 0);
    const 方向 = 趨勢總和 >= 0 ? "LONG" : "SHORT";
    let 相對強弱 = 0;
    if (BTCK線) {
      相對強弱 = 週期設定.reduce((總和, 週期) => {
        const 幣報酬 = 報酬率(K線[週期.key], 週期.lookback);
        const BTC報酬 = 報酬率(BTCK線[週期.key], 週期.lookback);
        return 總和 + (幣報酬 - BTC報酬) * 週期.weight;
      }, 0);
    }
    const 最新價 = 分析["5m"].close;
    const 多時區策略 = 分析多時區策略(K線, 最新價);
    const AI市場資料 = 建立客觀市場資料(K線, 分析);
    const 順勢 = 多時區策略.candidates.trend;
    const 逆勢 = 多時區策略.candidates.counter;
    const 最佳 = [順勢, 逆勢].filter(Boolean).sort((甲, 乙) => 乙.score - 甲.score)[0];
    const 最終方向 = 最佳?.direction ?? 方向;
    const 分數 = 評分({ 方向: 最終方向, 分析, 相對強弱, rank: 排行資料?.rank ?? 1 });
    const 優先方案 = 最佳?.plan ?? 建立交易方案(最終方向, 分析, K線);
    const 逆向方向 = 最終方向 === "LONG" ? "SHORT" : "LONG";
    const 逆向方案 = (最佳?.type === "trend" ? 逆勢?.plan : 順勢?.plan) ?? 建立交易方案(逆向方向, 分析, K線);
    return {
      symbol: 標的,
      price: 最新價,
      rank: 排行資料?.rank ?? null,
      quoteVolume: 排行資料?.quoteVolume ?? null,
      changePercent: 排行資料?.changePercent ?? null,
      direction: 最終方向,
      score: 最佳?.score ?? 分數.total,
      scoreBreakdown: 分數,
      relativeToBtc: Number(相對強弱.toFixed(2)),
      timeframes: Object.fromEntries(
        週期設定.map((週期) => [週期.key, {
          label: 週期.label,
          rating: 分析[週期.key].rating,
          rsi: 分析[週期.key].rsi,
          stoch: 分析[週期.key].stoch,
          structure: 分析[週期.key].structure,
          macd: 分析[週期.key].macd.histogram >= 0 ? "向上" : "向下",
          role: 多時區策略.roles[週期.key],
          structureEvent: 多時區策略.frames[週期.key].event
        }])
      ),
      primaryPlan: 優先方案,
      reversePlan: { ...逆向方案, score: 逆勢?.score ?? Math.max(35, 分數.total - 16) },
      strategyCandidates: 多時區策略.candidates,
      structureFrames: 多時區策略.frames,
      aiMarketData: AI市場資料,
      aiDataSchema: "candles=[unixTime,open,high,low,close,volume]；技術指標及結構結果只屬參考，AI必須自行判讀",
      analysis: `${最佳?.label ?? "結構"}候選：${建立分析文字(最終方向, 分析, 相對強弱)} 4H只作環境參考，1H定方向，15m確認Setup，5m負責入場觸發。`,
      chart: K線["1h"].slice(-120),
      updatedAt: new Date().toISOString()
    };
  }
}
