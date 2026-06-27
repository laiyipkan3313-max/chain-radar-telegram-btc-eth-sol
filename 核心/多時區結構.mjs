import { ATR, 限制範圍 } from "./技術分析.mjs";

const 最後 = (陣列, 數量 = 1) => 陣列.at(-數量) ?? null;
const 平均 = (陣列) => 陣列.length ? 陣列.reduce((總, 值) => 總 + 值, 0) / 陣列.length : 0;

export function 確認轉折(K線, 左 = 8, 右 = 3) {
  const 原始 = [];
  for (let i = 左; i < K線.length - 右; i += 1) {
    const 區段 = K線.slice(i - 左, i + 右 + 1);
    const 是高 = K線[i].high >= Math.max(...區段.map((項目) => 項目.high));
    const 是低 = K線[i].low <= Math.min(...區段.map((項目) => 項目.low));
    if (是高) 原始.push({ kind: "H", price: K線[i].high, index: i, time: K線[i].time });
    if (是低) 原始.push({ kind: "L", price: K線[i].low, index: i, time: K線[i].time });
  }
  原始.sort((甲, 乙) => 甲.index - 乙.index || (甲.kind === "H" ? -1 : 1));
  const 交替 = [];
  for (const 點 of 原始) {
    const 前 = 最後(交替);
    if (!前 || 前.kind !== 點.kind) 交替.push({ ...點 });
    else if ((點.kind === "H" && 點.price >= 前.price) || (點.kind === "L" && 點.price <= 前.price)) 交替[交替.length - 1] = { ...點 };
  }
  const 高點 = [];
  const 低點 = [];
  for (const 點 of 交替) {
    const 同類 = 點.kind === "H" ? 高點 : 低點;
    const 前價 = 最後(同類)?.price;
    點.label = 前價 == null ? 點.kind : 點.kind === "H" ? (點.price > 前價 ? "HH" : "LH") : (點.price > 前價 ? "HL" : "LL");
    同類.push(點);
  }
  return 交替;
}

export function 結構方向(轉折) {
  const 高 = 轉折.filter((點) => 點.kind === "H").slice(-2);
  const 低 = 轉折.filter((點) => 點.kind === "L").slice(-2);
  if (高.length < 2 || 低.length < 2) return 0;
  const 高向 = 高[1].price > 高[0].price ? 1 : -1;
  const 低向 = 低[1].price > 低[0].price ? 1 : -1;
  return 高向 === 1 && 低向 === 1 ? 1 : 高向 === -1 && 低向 === -1 ? -1 : 0;
}

export function 最近結構突破(K線, 轉折, 回看 = 8) {
  let 方向 = 0;
  let 最後事件 = null;
  for (let i = 1; i < K線.length; i += 1) {
    const 已確認 = 轉折.filter((點) => 點.index < i);
    const 高 = 最後(已確認.filter((點) => 點.kind === "H"));
    const 低 = 最後(已確認.filter((點) => 點.kind === "L"));
    const 向上 = 高 && K線[i].close > 高.price && K線[i - 1].close <= 高.price;
    const 向下 = 低 && K線[i].close < 低.price && K線[i - 1].close >= 低.price;
    if (向上) {
      最後事件 = { direction: 1, type: 方向 < 1 ? "CHoCH" : "BOS", level: 高.price, index: i, time: K線[i].time };
      方向 = 1;
    }
    if (向下) {
      最後事件 = { direction: -1, type: 方向 > -1 ? "CHoCH" : "BOS", level: 低.price, index: i, time: K線[i].time };
      方向 = -1;
    }
  }
  return 最後事件 && 最後事件.index >= K線.length - 回看 ? 最後事件 : null;
}

function 區域範圍(K線, 索引, 是供應) {
  const 中 = K線[索引];
  const 左 = K線[Math.max(0, 索引 - 1)];
  const 右 = K線[Math.min(K線.length - 1, 索引 + 1)];
  const 實頂 = Math.max(中.open, 中.close);
  const 實底 = Math.min(中.open, 中.close);
  const 幅度 = Math.max(中.high - 中.low, Number.EPSILON);
  if (是供應) {
    const 下影界 = (中.high - 實頂) / 幅度 >= 0.25 ? 實底 : Math.max(Math.min(左.open, 左.close), Math.min(右.open, 右.close));
    return { top: 中.high, bottom: Math.min(中.high, 下影界) };
  }
  const 上影界 = (實底 - 中.low) / 幅度 >= 0.25 ? 實頂 : Math.min(Math.max(左.open, 左.close), Math.max(右.open, 右.close));
  return { top: Math.max(中.low, 上影界), bottom: 中.low };
}

export function 供需區(K線, 左 = 15, 右 = 7) {
  const 轉折 = 確認轉折(K線, 左, 右);
  const 區域 = [];
  for (const 點 of 轉折) {
    const 是供應 = 點.kind === "H";
    const 範圍 = 區域範圍(K線, 點.index, 是供應);
    const 後續 = K線.slice(點.index + 右 + 1);
    const 已失效 = 是供應 ? 後續.some((棒) => 棒.close >= 範圍.top) : 後續.some((棒) => 棒.close <= 範圍.bottom);
    if (!已失效 && 範圍.top > 範圍.bottom) 區域.push({ ...範圍, poi: (範圍.top + 範圍.bottom) / 2, side: 是供應 ? "supply" : "demand", time: 點.time, fresh: true });
  }
  return {
    supply: 區域.filter((項目) => 項目.side === "supply").slice(-3).reverse(),
    demand: 區域.filter((項目) => 項目.side === "demand").slice(-3).reverse()
  };
}

export function 新鮮訂單塊(K線, 方向, 轉折, 事件) {
  if (!事件 || 事件.direction !== 方向) return null;
  const 起點候選 = 轉折.filter((點) => 點.index < 事件.index && 點.kind === (方向 === 1 ? "H" : "L"));
  const 起點 = 最後(起點候選)?.index ?? Math.max(0, 事件.index - 20);
  const 區段 = K線.slice(Math.max(0, 起點), 事件.index);
  if (!區段.length) return null;
  let 原棒 = 區段[0];
  for (const 棒 of 區段) {
    if (方向 === 1 && Math.min(棒.open, 棒.close) < Math.min(原棒.open, 原棒.close)) 原棒 = 棒;
    if (方向 === -1 && Math.max(棒.open, 棒.close) > Math.max(原棒.open, 原棒.close)) 原棒 = 棒;
  }
  const top = Math.max(原棒.open, 原棒.close);
  const bottom = Math.min(原棒.open, 原棒.close);
  const 後續 = K線.slice(事件.index + 1);
  const 已失效 = 方向 === 1 ? 後續.some((棒) => 棒.close < bottom) : 後續.some((棒) => 棒.close > top);
  return 已失效 ? null : { top, bottom, side: 方向 === 1 ? "bullish" : "bearish", time: 原棒.time, fresh: true };
}

export function Fib結構(轉折, 方向) {
  if (!方向) return null;
  const 最後端 = 最後(轉折.filter((點) => 點.kind === (方向 === 1 ? "H" : "L")));
  if (!最後端) return null;
  const 起端 = 最後(轉折.filter((點) => 點.index < 最後端.index && 點.kind === (方向 === 1 ? "L" : "H")));
  if (!起端) return null;
  const high = Math.max(起端.price, 最後端.price);
  const low = Math.min(起端.price, 最後端.price);
  const range = high - low;
  const 價 = (比例) => 方向 === 1 ? high - range * 比例 : low + range * 比例;
  const p618 = 價(0.618);
  const p705 = 價(0.705);
  return { direction: 方向, high, low, p50: 價(0.5), p618, p705, oteLow: Math.min(p618, p705), oteHigh: Math.max(p618, p705) };
}

export function 流動性位置(K線, 轉折) {
  const 波幅 = 平均(K線.slice(-100).map((棒, i, 全部) => i ? Math.max(Math.abs(棒.high - 全部[i - 1].high), Math.abs(棒.low - 全部[i - 1].low)) : 0).filter(Boolean));
  const 容差 = 波幅 * 0.5;
  const 找 = (kind) => {
    const 點 = 轉折.filter((項目) => 項目.kind === kind).slice(-12);
    for (let i = 點.length - 1; i > 0; i -= 1) {
      for (let j = i - 1; j >= 0; j -= 1) {
        if (Math.abs(點[i].price - 點[j].price) <= 容差) return { level: (點[i].price + 點[j].price) / 2, count: 2, kind: kind === "H" ? "EQH" : "EQL" };
      }
    }
    return null;
  };
  return { eqh: 找("H"), eql: 找("L") };
}

export function 時框快照(K線, { swing = 8, right = 3, includeZones = true } = {}) {
  const 轉折 = 確認轉折(K線, swing, right);
  const bias = 結構方向(轉折);
  const event = 最近結構突破(K線, 轉折, 8);
  const zones = includeZones ? 供需區(K線, 15, 7) : { supply: [], demand: [] };
  return { bias, event, pivots: 轉折.slice(-12), zones, liquidity: 流動性位置(K線, 轉折), atr: ATR(K線, 14), close: 最後(K線)?.close };
}

function 在區內(價格, 區, 緩衝 = 0) { return 區 && 價格 >= 區.bottom - 緩衝 && 價格 <= 區.top + 緩衝; }
function 方向文字(方向) { return 方向 === 1 ? "LONG" : "SHORT"; }

function 建立價位(方向, frames, currentPrice) {
  const 五分 = frames["5m"];
  const 十五 = frames["15m"];
  const 一小時 = frames["1h"];
  const ob = 新鮮訂單塊(frames.raw["5m"], 方向, 五分.allPivots, 五分.event);
  const sd = 方向 === 1 ? 十五.zones.demand[0] : 十五.zones.supply[0];
  const fib = 一小時.fib;
  let zone = ob ? { bottom: ob.bottom, top: ob.top, source: "5m OB" } : sd ? { bottom: sd.bottom, top: sd.top, source: "15m SD" } : fib ? { bottom: fib.oteLow, top: fib.oteHigh, source: "1H Fib OTE" } : null;
  if (!zone) {
    const atr = 五分.atr || currentPrice * 0.006;
    zone = { bottom: currentPrice - atr * 0.25, top: currentPrice + atr * 0.25, source: "5m ATR" };
  }
  const entryLow = Math.min(zone.bottom, zone.top);
  const entryHigh = Math.max(zone.bottom, zone.top);
  const entryCenter = (entryLow + entryHigh) / 2;
  const atr = 五分.atr || currentPrice * 0.006;
  const sl = 方向 === 1 ? entryLow - atr * 0.5 : entryHigh + atr * 0.5;
  const risk = Math.max(Math.abs(entryCenter - sl), atr * 0.5);
  return { direction: 方向文字(方向), entryLow, entryHigh, entryCenter, sl, tp1: entryCenter + 方向 * risk * 2, tp2: entryCenter + 方向 * risk * 3, rr1: 2, rr2: 3, source: zone.source, inEntryZone: 在區內(currentPrice, zone, atr * 0.08) };
}

function 趨勢候選(frames, currentPrice) {
  const 方向 = frames["1h"].bias;
  if (!方向) return null;
  const plan = 建立價位(方向, frames, currentPrice);
  const trigger = frames["5m"].event?.direction === 方向;
  let score = 25;
  score += frames["15m"].bias === 方向 ? 20 : frames["15m"].bias === 0 ? 10 : 0;
  score += trigger ? 20 : frames["5m"].bias === 方向 ? 12 : 0;
  score += plan.source === "5m OB" ? 15 : plan.source === "15m SD" ? 12 : plan.source === "1H Fib OTE" ? 10 : 5;
  const fib = frames["1h"].fib;
  if (fib && currentPrice >= fib.oteLow && currentPrice <= fib.oteHigh) score += 10;
  score += frames["4h"].bias === 方向 ? 10 : frames["4h"].bias === 0 ? 6 : 2;
  score = Math.round(限制範圍(score));
  return { type: "trend", label: "順勢", direction: 方向文字(方向), directionValue: 方向, score, threshold: 75, trigger, entryReady: score >= 75 && trigger && plan.inEntryZone, plan };
}

function 逆勢候選(frames, currentPrice) {
  const 主方向 = frames["1h"].bias;
  if (!主方向) return null;
  const 方向 = -主方向;
  const 一小時極端 = 方向 === 1 ? frames["1h"].zones.demand[0] : frames["1h"].zones.supply[0];
  const 接近極端 = 在區內(currentPrice, 一小時極端, (frames["1h"].atr || 0) * 0.15);
  const 十五轉勢 = frames["15m"].event?.direction === 方向 && frames["15m"].event?.type === "CHoCH";
  const 五分觸發 = frames["5m"].event?.direction === 方向;
  const 流動性 = 方向 === 1 ? frames["1h"].liquidity.eql : frames["1h"].liquidity.eqh;
  const 掃流動性 = 流動性 ? Math.abs(currentPrice - 流動性.level) <= (frames["1h"].atr || currentPrice * 0.01) * 0.35 : false;
  const plan = 建立價位(方向, frames, currentPrice);
  let score = 接近極端 ? 25 : 0;
  score += 掃流動性 ? 20 : 0;
  score += 十五轉勢 ? 20 : 0;
  score += 五分觸發 ? 20 : frames["5m"].bias === 方向 ? 10 : 0;
  score += plan.source === "5m OB" ? 15 : plan.source === "15m SD" ? 12 : 5;
  score += frames["4h"].bias === 方向 ? 10 : 4;
  score = Math.round(限制範圍(score));
  return { type: "counter", label: "逆勢", direction: 方向文字(方向), directionValue: 方向, score, threshold: 85, trigger: 十五轉勢 && 五分觸發, entryReady: score >= 85 && 接近極端 && 十五轉勢 && 五分觸發 && plan.inEntryZone, plan, evidence: { nearExtreme: 接近極端, liquiditySweep: 掃流動性 } };
}

export function 分析多時區策略(K線組, currentPrice) {
  const frames = { raw: K線組 };
  for (const [key, K線] of Object.entries(K線組)) {
    const snap = 時框快照(K線, { swing: key === "4h" ? 6 : key === "5m" ? 7 : 8, right: 3 });
    frames[key] = { ...snap, allPivots: 確認轉折(K線, key === "4h" ? 6 : key === "5m" ? 7 : 8, 3) };
  }
  frames["1h"].fib = Fib結構(frames["1h"].allPivots, frames["1h"].bias);
  const trend = 趨勢候選(frames, currentPrice);
  const counter = 逆勢候選(frames, currentPrice);
  return {
    roles: { "4h": "環境參考", "1h": "主要方向", "15m": "Setup確認", "5m": "入場觸發" },
    frames: Object.fromEntries(["4h", "1h", "15m", "5m"].map((key) => [key, { bias: frames[key].bias, event: frames[key].event, zones: frames[key].zones, liquidity: frames[key].liquidity, fib: frames[key].fib ?? null }])),
    candidates: { trend, counter }
  };
}
