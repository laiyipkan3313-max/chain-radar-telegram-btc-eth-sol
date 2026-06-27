import { ATR } from "./技術分析.mjs";

const 平均 = (數列) => 數列.length ? 數列.reduce((總, 值) => 總 + Number(值 || 0), 0) / 數列.length : 0;
const 限制 = (值, 最小, 最大) => Math.max(最小, Math.min(最大, 值));

function 建立方案({ direction, entryCenter, atr, support, resistance }) {
  const 緩衝 = Math.max(atr * 0.28, entryCenter * 0.0015);
  const entryLow = entryCenter - 緩衝;
  const entryHigh = entryCenter + 緩衝;
  const sl = direction === "LONG"
    ? Math.min(support - atr * 0.35, entryCenter - atr * 1.25)
    : Math.max(resistance + atr * 0.35, entryCenter + atr * 1.25);
  const risk = Math.max(Math.abs(entryCenter - sl), entryCenter * 0.002);
  return {
    direction,
    entryLow,
    entryHigh,
    entryCenter,
    sl,
    tp1: direction === "LONG" ? entryCenter + risk * 2 : entryCenter - risk * 2,
    tp2: direction === "LONG" ? entryCenter + risk * 3 : entryCenter - risk * 3,
    rr1: 2,
    rr2: 3,
    source: "Wyckoff 1H 結構",
    inEntryZone: true
  };
}

export function 分析威科夫(K線, 市場 = {}) {
  if (!Array.isArray(K線) || K線.length < 80) return null;
  const 最新 = K線.at(-1);
  const atr = ATR(K線, 14) || 最新.close * 0.01;
  const 基準段 = K線.slice(-55, -5);
  const 近期 = K線.slice(-5);
  const support = Math.min(...基準段.map((棒) => 棒.low));
  const resistance = Math.max(...基準段.map((棒) => 棒.high));
  const range = Math.max(resistance - support, atr);
  const position = 限制((最新.close - support) / range, 0, 1);
  const avgVolume = 平均(K線.slice(-35, -5).map((棒) => 棒.volume));
  const volumeRatio = avgVolume ? 最新.volume / avgVolume : 1;
  const spring = 近期.find((棒) => 棒.low < support - atr * 0.08 && 棒.close > support);
  const upthrust = 近期.find((棒) => 棒.high > resistance + atr * 0.08 && 棒.close < resistance);
  const sos = 最新.close > resistance + atr * 0.06 && volumeRatio >= 1.05;
  const sow = 最新.close < support - atr * 0.06 && volumeRatio >= 1.05;
  const 舊平均 = 平均(K線.slice(-80, -55).map((棒) => 棒.close));
  const 新平均 = 平均(K線.slice(-35, -10).map((棒) => 棒.close));
  const 先前趨勢 = 新平均 > 舊平均 * 1.01 ? 1 : 新平均 < 舊平均 * 0.99 ? -1 : 0;

  let 多分 = 42;
  let 空分 = 42;
  if (position <= 0.35) 多分 += 12;
  if (position >= 0.65) 空分 += 12;
  if (先前趨勢 < 0) 多分 += 8;
  if (先前趨勢 > 0) 空分 += 8;
  if (spring) 多分 += 25;
  if (upthrust) 空分 += 25;
  if (sos) 多分 += 24;
  if (sow) 空分 += 24;
  if (volumeRatio >= 1.25) { 多分 += 5; 空分 += 5; }

  const direction = 多分 >= 空分 ? "LONG" : "SHORT";
  const score = Math.round(限制(Math.max(多分, 空分), 0, 95));
  let event = direction === "LONG" ? "吸籌區間" : "派發區間";
  if (spring && direction === "LONG") event = "Spring 假跌破回收";
  else if (sos && direction === "LONG") event = "SOS 強勢突破";
  else if (upthrust && direction === "SHORT") event = "Upthrust 假突破回落";
  else if (sow && direction === "SHORT") event = "SOW 弱勢跌破";
  const triggered = Boolean(direction === "LONG" ? (spring || sos) : (upthrust || sow));
  const strategyType = /Spring|Upthrust/.test(event) ? "counter" : "trend";
  const entryCenter = direction === "LONG"
    ? (sos ? resistance : Math.max(support + atr * 0.35, 最新.close))
    : (sow ? support : Math.min(resistance - atr * 0.35, 最新.close));

  return {
    symbol: 市場.symbol,
    rank: 市場.rank,
    price: 最新.close,
    changePercent: 市場.changePercent,
    quoteVolume: 市場.quoteVolume,
    direction,
    strategyType,
    event,
    phase: direction === "LONG" ? "吸籌／Markup 準備" : "派發／Markdown 準備",
    score,
    triggered,
    qualified: triggered && score >= 70,
    volumeRatio: Number(volumeRatio.toFixed(2)),
    rangePosition: Number((position * 100).toFixed(1)),
    support,
    resistance,
    plan: 建立方案({ direction, entryCenter, atr, support, resistance }),
    updatedAt: new Date().toISOString()
  };
}

