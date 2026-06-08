/* ─────────────────────────────────────────────
   LUMEN · demo data + i18n
   ───────────────────────────────────────────── */

export const LUMEN_I18N = {
  en: {
    brand: "Lumen",
    nav: {
      dashboard: "Dashboard",
      portfolio: "Portfolio",
      analytics: "Analytics",
      tools: "Tools",
      planning: "Planning",
      watchlist: "Watchlist",
      dca: "DCA",
    },
    common: {
      total: "Total",
      gain: "Gain",
      loss: "Loss",
      today: "Today",
      thisMonth: "This month",
      thisYear: "This year",
      allTime: "All time",
      annually: "annually",
      monthly: "monthly",
      addInvestment: "Add investment",
      seeAll: "See all",
      cancel: "Cancel",
      save: "Save",
      next: "Continue",
      back: "Back",
      search: "Search",
      filter: "Filter",
    },
    onboarding: {
      welcome: "Welcome to Lumen",
      kicker: "Get started",
      title: "Bring your finances into focus.",
      subtitle: "Pick how you'd like to add your first investments. You can change this later.",
      connect: "Connect a brokerage",
      connectSub: "Sync trades automatically via Plaid, Yodlee or SnapTrade. New transactions are pulled in nightly.",
      enter: "Enter holdings manually",
      enterSub: "Add positions one by one. Great for a quick look at allocation and dividends.",
      upload: "Upload a statement",
      uploadSub: "Drop in a CSV or PDF from your broker. We support 25+ brokers and Binance API.",
      demo: "Try a demo portfolio",
      demoSub: "Explore the app with a sample portfolio. You can start your own anytime.",
      guide: "Not sure which to pick? Read the getting started guide.",
      step: "Step",
    },
    dashboard: {
      heading: "Good evening, Mintra",
      sub: "Here's where your money stands tonight.",
      netWorth: "Net worth",
      invested: "Invested",
      cash: "Cash",
      liabilities: "Liabilities",
      changeToday: "Today's change",
      allocation: "Asset allocation",
      topMovers: "Today's movers",
      goals: "Goals on track",
      goalsSub: "Progress toward your big targets",
      activity: "Recent activity",
      upcoming: "Upcoming dividends",
      insights: "Insights",
      seeDetails: "See details",
    },
    portfolio: {
      heading: "Portfolio",
      sub: "All your positions, in one ledger.",
      holding: "Holding",
      shares: "Shares",
      cost: "Cost basis",
      value: "Market value",
      day: "Today",
      pl: "P/L",
      weight: "Weight",
      total: "Portfolio total",
    },
    analytics: {
      heading: "Analytics",
      sub: "How your portfolio is really performing.",
      tabs: {
        common: "Common",
        diversification: "Diversification",
        dividends: "Dividends",
        growth: "Growth",
        metrics: "Metrics",
      },
      timeRange: { "7d": "7d", "1m": "1m", "3m": "3m", "6m": "6m", ytd: "YTD", "1y": "1y", "5y": "5y", all: "All" },
      twr: "Portfolio return",
      pe: "Portfolio P/E",
      beta: "Volatility · β",
      sharpe: "Sharpe ratio",
      sortino: "Sortino ratio",
      drawdown: "Max drawdown",
      yield: "Dividend yield",
      payout: "Annual payout",
      yieldOnCost: "yield on cost",
      vsBench: "vs. S&P 500",
      byAsset: "By asset class",
      bySector: "By sector",
      byRegion: "By region",
    },
    tools: {
      heading: "Tools",
      sub: "Quick math to rebalance, plan, and stress-test.",
      rebalance: "Rebalance",
      rebalanceSub: "Suggest the cleanest buys (or sells) to hit your target allocation.",
      deposit: "Deposit",
      withdraw: "Withdraw",
      amount: "Amount",
      allowSales: "Allow sales",
      run: "Calculate",
      suggestion: "Suggested trades",
      target: "Target",
      current: "Current",
      drift: "Drift",
      action: "Action",
    },
    planning: {
      heading: "Financial planning",
      sub: "Long-horizon goals, broken into monthly steps.",
      goalsTitle: "Goals",
      add: "Add a goal",
      retirement: "Retirement",
      house: "House down payment",
      emergency: "Emergency fund",
      education: "Kid's education",
      target: "Target",
      now: "Today",
      monthly: "Suggested monthly",
      eta: "On track for",
      complete: "Complete",
      contribute: "Contribute",
    },
    tweaks: {
      title: "Tweaks",
      accent: "Accent color",
      density: "Density",
      compact: "Compact",
      cozy: "Cozy",
      airy: "Airy",
      data: "Data state",
      empty: "Empty",
      demo: "Demo",
      type: "Display type",
      classic: "Editorial",
      modern: "Modern",
    },
  },
  th: {
    brand: "Lumen",
    nav: {
      dashboard: "หน้าหลัก",
      portfolio: "พอร์ตของฉัน",
      analytics: "วิเคราะห์",
      tools: "เครื่องมือ",
      planning: "วางแผน",
      watchlist: "Watchlist",
      dca: "DCA",
    },
    common: {
      total: "รวม",
      gain: "กำไร",
      loss: "ขาดทุน",
      today: "วันนี้",
      thisMonth: "เดือนนี้",
      thisYear: "ปีนี้",
      allTime: "ทั้งหมด",
      annually: "ต่อปี",
      monthly: "ต่อเดือน",
      addInvestment: "เพิ่มการลงทุน",
      seeAll: "ดูทั้งหมด",
      cancel: "ยกเลิก",
      save: "บันทึก",
      next: "ถัดไป",
      back: "ย้อนกลับ",
      search: "ค้นหา",
      filter: "กรอง",
    },
    onboarding: {
      welcome: "ยินดีต้อนรับสู่ Lumen",
      kicker: "เริ่มต้นใช้งาน",
      title: "ทำให้การเงินของคุณชัดเจน",
      subtitle: "เลือกวิธีเพิ่มการลงทุนแรกของคุณ — เปลี่ยนได้ตลอด",
      connect: "เชื่อมต่อโบรกเกอร์",
      connectSub: "ซิงค์รายการซื้อขายอัตโนมัติผ่าน Plaid, Yodlee หรือ SnapTrade — ดึงข้อมูลใหม่ทุกคืน",
      enter: "กรอกพอร์ตด้วยตัวเอง",
      enterSub: "เพิ่มหุ้นทีละตัว เหมาะสำหรับดูสัดส่วนและเงินปันผลเร็ว ๆ",
      upload: "อัปโหลด statement",
      uploadSub: "ลาก CSV หรือ PDF จากโบรกของคุณ — รองรับ 25+ โบรกและ Binance API",
      demo: "ลองพอร์ตตัวอย่าง",
      demoSub: "เล่นกับพอร์ตตัวอย่างก่อน เริ่มของจริงทีหลังได้",
      guide: "ยังไม่แน่ใจ? อ่านคู่มือเริ่มต้น",
      step: "ขั้น",
    },
    dashboard: {
      heading: "สวัสดีตอนเย็น มินทรา",
      sub: "นี่คือภาพรวมการเงินคืนนี้",
      netWorth: "มูลค่าสุทธิ",
      invested: "ลงทุนแล้ว",
      cash: "เงินสด",
      liabilities: "หนี้สิน",
      changeToday: "เปลี่ยนแปลงวันนี้",
      allocation: "สัดส่วนสินทรัพย์",
      topMovers: "เคลื่อนไหวเด่นวันนี้",
      goals: "เป้าหมายตามแผน",
      goalsSub: "ความคืบหน้าของเป้าหมายระยะยาว",
      activity: "กิจกรรมล่าสุด",
      upcoming: "เงินปันผลที่จะเข้า",
      insights: "ข้อสังเกต",
      seeDetails: "ดูรายละเอียด",
    },
    portfolio: {
      heading: "พอร์ตของฉัน",
      sub: "ทุกตำแหน่งการลงทุนในที่เดียว",
      holding: "หลักทรัพย์",
      shares: "จำนวน",
      cost: "ต้นทุน",
      value: "มูลค่าตลาด",
      day: "วันนี้",
      pl: "กำไร/ขาดทุน",
      weight: "น้ำหนัก",
      total: "รวมพอร์ต",
    },
    analytics: {
      heading: "วิเคราะห์พอร์ต",
      sub: "พอร์ตคุณเป็นอย่างไรจริง ๆ",
      tabs: {
        common: "ภาพรวม",
        diversification: "การกระจาย",
        dividends: "ปันผล",
        growth: "การเติบโต",
        metrics: "ตัวชี้วัด",
      },
      timeRange: { "7d": "7วัน", "1m": "1ด.", "3m": "3ด.", "6m": "6ด.", ytd: "YTD", "1y": "1ปี", "5y": "5ปี", all: "ทั้งหมด" },
      twr: "ผลตอบแทนพอร์ต",
      pe: "P/E พอร์ต",
      beta: "ความผันผวน · β",
      sharpe: "Sharpe ratio",
      sortino: "Sortino ratio",
      drawdown: "Drawdown สูงสุด",
      yield: "อัตราปันผล",
      payout: "ปันผลต่อปี",
      yieldOnCost: "yield บนทุน",
      vsBench: "เทียบ S&P 500",
      byAsset: "ตามประเภทสินทรัพย์",
      bySector: "ตามอุตสาหกรรม",
      byRegion: "ตามภูมิภาค",
    },
    tools: {
      heading: "เครื่องมือ",
      sub: "คำนวณ rebalance วางแผน และทดสอบความเสี่ยง",
      rebalance: "ปรับสมดุลพอร์ต",
      rebalanceSub: "แนะนำคำสั่งซื้อ (หรือขาย) ที่สะอาดที่สุดเพื่อเข้าเป้า",
      deposit: "ฝาก/ปรับสมดุล",
      withdraw: "ถอน",
      amount: "จำนวนเงิน",
      allowSales: "อนุญาตให้ขาย",
      run: "คำนวณ",
      suggestion: "คำสั่งซื้อขายแนะนำ",
      target: "เป้า",
      current: "ตอนนี้",
      drift: "เบี่ยงเบน",
      action: "ทำ",
    },
    planning: {
      heading: "วางแผนการเงิน",
      sub: "เป้าหมายระยะยาว แบ่งเป็นก้าวรายเดือน",
      goalsTitle: "เป้าหมาย",
      add: "เพิ่มเป้าหมาย",
      retirement: "เกษียณ",
      house: "เงินดาวน์บ้าน",
      emergency: "เงินสำรองฉุกเฉิน",
      education: "การศึกษาบุตร",
      target: "เป้าหมาย",
      now: "ปัจจุบัน",
      monthly: "ออมเดือนละ",
      eta: "ถึงเป้าใน",
      complete: "ครบแล้ว",
      contribute: "ออมเพิ่ม",
    },
    tweaks: {
      title: "ปรับแต่ง",
      accent: "สีเน้น",
      density: "ความหนาแน่น",
      compact: "แน่น",
      cozy: "ปกติ",
      airy: "โปร่ง",
      data: "ข้อมูล",
      empty: "ว่าง",
      demo: "ตัวอย่าง",
      type: "ฟอนต์ใหญ่",
      classic: "Editorial",
      modern: "Modern",
    },
  },
};

export const LUMEN_FX = { THB_per_USD: 36.4 };

// Live FX rate updated by App.jsx when fetchFxRate resolves
let _liveRate = LUMEN_FX.THB_per_USD;
export function setLiveFxRate(rate) {
  if (rate > 20 && rate < 100) _liveRate = rate;
}

export const LUMEN_HOLDINGS = [
  { ticker: "KBANK",  name: "Kasikornbank",            sector: "Financials", region: "TH", cls: "Equity",    shares: 800,  cost: 132.5,  price: 158.5,  divYield: 4.1, ccy: "THB" },
  { ticker: "PTT",    name: "PTT Public Company",      sector: "Energy",     region: "TH", cls: "Equity",    shares: 1500, cost: 32.5,   price: 35.25,  divYield: 5.6, ccy: "THB" },
  { ticker: "AOT",    name: "Airports of Thailand",    sector: "Industrials",region: "TH", cls: "Equity",    shares: 600,  cost: 65.0,   price: 58.5,   divYield: 0.9, ccy: "THB" },
  { ticker: "CPALL",  name: "CP All",                  sector: "Consumer",   region: "TH", cls: "Equity",    shares: 700,  cost: 58.0,   price: 64.25,  divYield: 1.8, ccy: "THB" },
  { ticker: "ADVANC", name: "Advanced Info Service",   sector: "Telecom",    region: "TH", cls: "Equity",    shares: 300,  cost: 195.0,  price: 256.0,  divYield: 3.2, ccy: "THB" },
  { ticker: "VOO",    name: "Vanguard S&P 500 ETF",    sector: "ETF",        region: "US", cls: "Equity",    shares: 8,    cost: 405.0,  price: 528.4,  divYield: 1.3, ccy: "USD" },
  { ticker: "QQQ",    name: "Invesco QQQ Trust",       sector: "ETF",        region: "US", cls: "Equity",    shares: 4,    cost: 380.0,  price: 506.2,  divYield: 0.6, ccy: "USD" },
  { ticker: "AAPL",   name: "Apple Inc.",              sector: "Tech",       region: "US", cls: "Equity",    shares: 12,   cost: 158.5,  price: 212.4,  divYield: 0.5, ccy: "USD" },
  { ticker: "NVDA",   name: "NVIDIA Corp.",            sector: "Tech",       region: "US", cls: "Equity",    shares: 6,    cost: 92.0,   price: 138.6,  divYield: 0.0, ccy: "USD" },
  { ticker: "MSFT",   name: "Microsoft Corp.",         sector: "Tech",       region: "US", cls: "Equity",    shares: 5,    cost: 290.0,  price: 442.8,  divYield: 0.7, ccy: "USD" },
  { ticker: "GOLD",   name: "Gold (oz, XAU)",          sector: "Commodity",  region: "—",  cls: "Commodity", shares: 3,    cost: 60000,  price: 84500,  divYield: 0,   ccy: "THB" },
  { ticker: "BTC",    name: "Bitcoin",                 sector: "Crypto",     region: "—",  cls: "Crypto",    shares: 0.08, cost: 38000,  price: 67200,  divYield: 0,   ccy: "USD" },
  { ticker: "GB10Y",  name: "Thai Gov Bond 10Y",       sector: "Bonds",      region: "TH", cls: "Bond",      shares: 1,    cost: 250000, price: 254800, divYield: 2.8, ccy: "THB" },
];

export const LUMEN_OTHER = {
  cash: 185000,
  liabilities: 320000,
};

export const LUMEN_TARGETS = {
  "TH Equity":  0.28,
  "US Equity":  0.32,
  "Bonds":      0.15,
  "Gold":       0.10,
  "Crypto":     0.05,
  "Cash":       0.10,
};

export const LUMEN_GOALS = [
  { id: "retire",    nameKey: "retirement", target: 15000000, current: 2480000, monthly: 18000, eta: "2046",      icon: "leaf",   color: "var(--c1)" },
  { id: "house",     nameKey: "house",      target:  2000000, current: 1240000, monthly: 32000, eta: "Q3 2027",   icon: "home",   color: "var(--c2)" },
  { id: "emergency", nameKey: "emergency",  target:   600000, current:  600000, monthly: 0,     eta: "Complete",  icon: "shield", color: "var(--c5)" },
  { id: "education", nameKey: "education",  target:  5000000, current:  430000, monthly: 12000, eta: "2038",      icon: "book",   color: "var(--c4)" },
];

export const LUMEN_ACTIVITY = [
  { date: "May 23", type: "Buy",      ticker: "VOO",   shares: 1,    price: 528.4, ccy: "USD" },
  { date: "May 21", type: "Dividend", ticker: "PTT",   shares: 1500, amount: 1485, ccy: "THB" },
  { date: "May 18", type: "Buy",      ticker: "NVDA",  shares: 2,    price: 138.6, ccy: "USD" },
  { date: "May 15", type: "Deposit",  ticker: null,    amount: 25000, ccy: "THB" },
  { date: "May 10", type: "Dividend", ticker: "KBANK", shares: 800,  amount: 2080, ccy: "THB" },
  { date: "May 02", type: "Sell",     ticker: "AOT",   shares: 100,  price: 60.5,  ccy: "THB" },
];

export const LUMEN_UPCOMING = [
  { date: "Jun 04", ticker: "VOO",    amount: 6.2,  ccy: "USD" },
  { date: "Jun 12", ticker: "ADVANC", amount: 1296, ccy: "THB" },
  { date: "Jun 21", ticker: "AAPL",   amount: 2.9,  ccy: "USD" },
  { date: "Jul 03", ticker: "CPALL",  amount: 798,  ccy: "THB" },
];

export const LUMEN_HISTORY = (() => {
  const months = 36;
  const start = 1100;
  const out = [];
  let v = start;
  for (let i = 0; i < months; i++) {
    const drift = 0.012 + Math.sin(i / 4) * 0.006;
    const noise = (Math.sin(i * 13.37) + Math.cos(i * 7.7)) * 0.018;
    v = v * (1 + drift + noise);
    out.push({ m: i, v: Math.round(v) });
  }
  return out;
})();

export const LUMEN_BENCH = (() => {
  const out = [];
  let v = 1100;
  for (let i = 0; i < 36; i++) {
    const drift = 0.009 + Math.sin(i / 5 + 1) * 0.005;
    const noise = (Math.sin(i * 11.1) + Math.cos(i * 5.5)) * 0.014;
    v = v * (1 + drift + noise);
    out.push({ m: i, v: Math.round(v) });
  }
  return out;
})();

export const LUMEN_INSIGHTS = {
  en: [
    { tone: "neutral", title: "Tech weight is creeping up.",      body: "Tech sits at 28% of equities — up from 22% in February. Consider trimming if your target was 25%." },
    { tone: "good",    title: "Emergency fund is fully funded.",  body: "You've held ฿600,000 in HYSA for 4 months straight. Excess could earn 1.4% more in T-bills." },
    { tone: "warn",    title: "AOT is your biggest drag YTD.",    body: "Down 10.0% on cost. Travel-sector earnings revisions are mixed; review thesis." },
  ],
  th: [
    { tone: "neutral", title: "น้ำหนัก Tech กำลังเพิ่มขึ้น",     body: "Tech อยู่ที่ 28% ของหุ้น เพิ่มจาก 22% เมื่อ ก.พ. ถ้าเป้าคือ 25% อาจพิจารณาตัดทอน" },
    { tone: "good",    title: "เงินสำรองฉุกเฉินครบแล้ว",         body: "เก็บ ฿600,000 ใน HYSA ต่อเนื่อง 4 เดือน อาจย้ายไป T-bills เพื่อรับเพิ่ม 1.4%" },
    { tone: "warn",    title: "AOT ฉุดพอร์ตมากสุดตั้งแต่ต้นปี", body: "ขาดทุน 10.0% จากทุน Outlook กลุ่มเดินทางยังผันผวน — ลองทบทวน thesis" },
  ],
};

export const LUMEN_FMT = {
  money(value, ccy, opts = {}) {
    const inUSD = ccy === "USD";
    // opts.fxRate overrides live rate; fallback to _liveRate (updated from Yahoo Finance)
    const rate = opts.fxRate ?? _liveRate;
    const v = inUSD ? value / rate : value;
    // Always show full numbers with 2 decimals — no K/M abbreviation.
    const decimals = opts.decimals ?? 2;
    const symbol = inUSD ? "$" : "฿";
    const sign = v < 0 ? "-" : "";
    const abs = Math.abs(v);
    const str = abs.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    return sign + symbol + str;
  },
  // Format a price that is already in its native currency (no FX conversion).
  // Use for per-share price/cost columns where the value should display as-is.
  moneyNative(value, ccy, opts = {}) {
    const symbol = ccy === 'USD' ? '$' : '฿'
    // Always show full numbers with 2 decimals — no K/M abbreviation.
    const decimals = opts.decimals ?? 2
    const sign = value < 0 ? '-' : ''
    const abs = Math.abs(value)
    const str = abs.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    return sign + symbol + str
  },
  pct(value, decimals = 1, withSign = false) {
    const sign = withSign ? (value > 0 ? "+" : value < 0 ? "" : "") : "";
    return sign + value.toFixed(decimals) + "%";
  },
  num(value, decimals = 0) {
    return value.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  },
};

export function LUMEN_DERIVE() {
  const fx = LUMEN_FX.THB_per_USD;
  const rows = LUMEN_HOLDINGS.map(h => {
    const mult = h.ccy === "USD" ? fx : 1;
    const value = h.shares * h.price * mult;
    const cost  = h.shares * h.cost  * mult;
    const pl    = value - cost;
    const plPct = cost > 0 ? (pl / cost) * 100 : 0;
    return { ...h, value, cost, pl, plPct };
  });
  const value = rows.reduce((a, b) => a + b.value, 0);
  const cost  = rows.reduce((a, b) => a + b.cost,  0);
  const cash  = LUMEN_OTHER.cash;
  const liab  = LUMEN_OTHER.liabilities;
  const net   = value + cash - liab;
  rows.forEach(r => r.weight = (r.value / (value + cash)) * 100);
  return { rows, value, cost, pl: value - cost, plPct: ((value - cost) / cost) * 100, cash, liab, net };
}
