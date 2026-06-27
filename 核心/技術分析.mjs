const 有效數字 = (值) => Number.isFinite(值);
export const 限制範圍 = (值, 最小 = 0, 最大 = 100) => Math.min(最大, Math.max(最小, 值));

export function SMA(數列, 週期) {
  if (數列.length < 週期) return null;
  const 區段 = 數列.slice(-週期);
  return 區段.reduce((總和, 值) => 總和 + 值, 0) / 週期;
}

export function EMA數列(數列, 週期) {
  if (數列.length < 週期) return [];
  const 乘數 = 2 / (週期 + 1);
  const 結果 = new Array(週期 - 1).fill(null);
  let 前值 = 數列.slice(0, 週期).reduce((總和, 值) => 總和 + 值, 0) / 週期;
  結果.push(前值);
  for (let 索引 = 週期; 索引 < 數列.length; 索引 += 1) {
    前值 = 數列[索引] * 乘數 + 前值 * (1 - 乘數);
    結果.push(前值);
  }
  return 結果;
}

export function EMA(數列, 週期) {
  return EMA數列(數列, 週期).at(-1) ?? null;
}

export function RSI(數列, 週期 = 14) {
  if (數列.length <= 週期) return null;
  const 最近 = 數列.slice(-(週期 + 1));
  let 升 = 0;
  let 跌 = 0;
  for (let 索引 = 1; 索引 < 最近.length; 索引 += 1) {
    const 差值 = 最近[索引] - 最近[索引 - 1];
    if (差值 >= 0) 升 += 差值;
    else 跌 += Math.abs(差值);
  }
  const 平均升 = 升 / 週期;
  const 平均跌 = 跌 / 週期;
  if (平均跌 === 0) return 100;
  const RS = 平均升 / 平均跌;
  return 100 - 100 / (1 + RS);
}

export function ATR(K線, 週期 = 14) {
  if (K線.length <= 週期) return null;
  const TR = [];
  for (let 索引 = 1; 索引 < K線.length; 索引 += 1) {
    const 本期 = K線[索引];
    const 前收 = K線[索引 - 1].close;
    TR.push(Math.max(
      本期.high - 本期.low,
      Math.abs(本期.high - 前收),
      Math.abs(本期.low - 前收)
    ));
  }
  return SMA(TR, 週期);
}

export function Stoch(K線, 週期 = 14) {
  if (K線.length < 週期) return null;
  const 最近 = K線.slice(-週期);
  const 最高 = Math.max(...最近.map((項目) => 項目.high));
  const 最低 = Math.min(...最近.map((項目) => 項目.low));
  if (最高 === 最低) return 50;
  return ((最近.at(-1).close - 最低) / (最高 - 最低)) * 100;
}

export function MACD(數列) {
  const 快線 = EMA數列(數列, 12);
  const 慢線 = EMA數列(數列, 26);
  if (!快線.length || !慢線.length) return { macd: null, signal: null, histogram: null, rising: false };
  const MACD數列 = 數列.map((_, 索引) => {
    const 快 = 快線[索引];
    const 慢 = 慢線[索引];
    return 有效數字(快) && 有效數字(慢) ? 快 - 慢 : null;
  });
  const 有效MACD = MACD數列.filter(有效數字);
  const 訊號數列 = EMA數列(有效MACD, 9);
  const macd = 有效MACD.at(-1) ?? null;
  const signal = 訊號數列.at(-1) ?? null;
  const 前macd = 有效MACD.at(-2) ?? macd;
  const 前signal = 訊號數列.at(-2) ?? signal;
  return {
    macd,
    signal,
    histogram: 有效數字(macd) && 有效數字(signal) ? macd - signal : null,
    rising: 有效數字(macd) && 有效數字(signal) && macd > signal && 前macd <= 前signal
  };
}

function 判斷結構(K線) {
  if (K線.length < 45) return { label: "資料不足", value: 0 };
  const 舊段 = K線.slice(-45, -25);
  const 新段 = K線.slice(-25, -5);
  const 舊高 = Math.max(...舊段.map((項目) => 項目.high));
  const 舊低 = Math.min(...舊段.map((項目) => 項目.low));
  const 新高 = Math.max(...新段.map((項目) => 項目.high));
  const 新低 = Math.min(...新段.map((項目) => 項目.low));
  const 最新收 = K線.at(-1).close;
  if (最新收 > 新高) return { label: "Bullish BOS", value: 1 };
  if (最新收 < 新低) return { label: "Bearish BOS", value: -1 };
  if (新高 > 舊高 && 新低 > 舊低) return { label: "HH／HL 牛結構", value: 0.8 };
  if (新高 < 舊高 && 新低 < 舊低) return { label: "LH／LL 熊結構", value: -0.8 };
  return { label: "區間整理", value: 0 };
}

export function 分析時間框架(K線) {
  const 收市 = K線.map((項目) => 項目.close);
  const close = 收市.at(-1);
  const ema10 = EMA(收市, 10);
  const ema20 = EMA(收市, 20);
  const ema50 = EMA(收市, 50);
  const sma50 = SMA(收市, 50);
  const rsi = RSI(收市, 14);
  const stoch = Stoch(K線, 14);
  const macd = MACD(收市);
  const atr = ATR(K線, 14);
  const 結構 = 判斷結構(K線);
  let 趨勢 = 0;
  if (有效數字(ema20) && 有效數字(ema50)) {
    if (close > ema20 && ema20 > ema50) 趨勢 = 1;
    else if (close < ema20 && ema20 < ema50) 趨勢 = -1;
    else 趨勢 = close >= ema20 ? 0.35 : -0.35;
  }
  const 綜合方向 = 限制範圍((趨勢 * 0.6 + 結構.value * 0.4 + 1) * 50, 0, 100);
  const rating = 綜合方向 >= 68 ? "Buy" : 綜合方向 <= 32 ? "Sell" : "Neutral";
  return {
    close, ema10, ema20, ema50, sma50, rsi, stoch, macd, atr,
    structure: 結構.label,
    structureValue: 結構.value,
    trendValue: 趨勢,
    rating
  };
}

export function 報酬率(K線, 回看數量) {
  if (!K線?.length) return 0;
  const 起點 = K線[Math.max(0, K線.length - 1 - 回看數量)]?.close;
  const 終點 = K線.at(-1)?.close;
  if (!起點 || !終點) return 0;
  return ((終點 - 起點) / 起點) * 100;
}
