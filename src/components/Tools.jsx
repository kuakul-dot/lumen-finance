import { useState, useMemo } from 'react'
import { PageHead, Delta, Icon } from './Nav'
import { LUMEN_FMT, LUMEN_DERIVE, LUMEN_TARGETS, LUMEN_FX } from '../data'


export function ToolsPage({ t, lang, ccy, dataState }) {
  const FMT = LUMEN_FMT;
  const [mode, setMode] = useState("deposit");
  const [amount, setAmount] = useState("50000");
  const [allowSales, setAllowSales] = useState(false);
  const [showResult, setShowResult] = useState(false);

  if (dataState === "empty") {
    return (
      <div className="shell fade-in">
        <PageHead title={t.tools.heading} sub={t.tools.sub} />
        <div className="card empty">
          <h2 className="display" style={{ fontSize: 28 }}>{lang === "th" ? "ตั้งค่าหมวดและเป้าหมายก่อน" : "Set up categories first"}</h2>
          <p>{lang === "th" ? "เครื่องมือ rebalance ทำงานบนเป้าสัดส่วนที่คุณตั้งไว้" : "The rebalancing tool uses your target allocations"}</p>
        </div>
      </div>
    );
  }

  const derived = useMemo(() => LUMEN_DERIVE(), []);
  const { rows, value, cash } = derived;
  const total = value + cash;

  // current by class
  const currentByClass = useMemo(() => {
    const map = { "TH Equity": 0, "US Equity": 0, "Bonds": 0, "Gold": 0, "Crypto": 0, "Cash": cash };
    rows.forEach(r => {
      const k = r.cls === "Equity" ? (r.region === "TH" ? "TH Equity" : "US Equity")
              : r.cls === "Bond" ? "Bonds"
              : r.cls === "Commodity" ? "Gold"
              : r.cls === "Crypto" ? "Crypto" : "Cash";
      map[k] = (map[k] || 0) + r.value;
    });
    return map;
  }, [rows, cash]);

  const dep = parseFloat(amount) || 0;
  const newTotal = mode === "deposit" ? total + dep : total - dep;

  // Compute drift & suggested action per class
  const suggestions = useMemo(() => {
    return Object.entries(LUMEN_TARGETS).map(([k, tgt]) => {
      const cur = currentByClass[k] || 0;
      const targetValue = newTotal * tgt;
      const delta = targetValue - cur;
      return { name: k, current: cur, target: targetValue, delta, curPct: (cur / total) * 100, tgtPct: tgt * 100 };
    });
  }, [currentByClass, newTotal, total]);

  // Suggested trades (pick top representative for each class needing buys)
  const trades = useMemo(() => {
    const out = [];
    const sample = {
      "TH Equity": rows.filter(r => r.region === "TH" && r.cls === "Equity"),
      "US Equity": rows.filter(r => r.region === "US" && r.cls === "Equity"),
      "Bonds":     rows.filter(r => r.cls === "Bond"),
      "Gold":      rows.filter(r => r.cls === "Commodity"),
      "Crypto":    rows.filter(r => r.cls === "Crypto"),
    };
    suggestions.forEach(s => {
      if (s.name === "Cash") return;
      const candidates = sample[s.name] || [];
      if (candidates.length === 0) return;
      if (s.delta > 0) {
        // buy — split across smallest-weight candidates
        const sorted = [...candidates].sort((a, b) => a.value - b.value);
        const split = Math.min(2, sorted.length);
        sorted.slice(0, split).forEach(c => {
          const amt = s.delta / split;
          const fx = c.ccy === "USD" ? LUMEN_FX.THB_per_USD : 1;
          const sharesNeeded = Math.floor(amt / (c.price * fx));
          if (sharesNeeded > 0) {
            out.push({ action: "Buy", ticker: c.ticker, name: c.name, shares: sharesNeeded, price: c.price, ccy: c.ccy, amount: sharesNeeded * c.price * fx, cls: s.name });
          }
        });
      } else if (allowSales && s.delta < -total * 0.005) {
        // sell — pick highest weight
        const sorted = [...candidates].sort((a, b) => b.value - a.value);
        const c = sorted[0];
        if (c) {
          const fx = c.ccy === "USD" ? LUMEN_FX.THB_per_USD : 1;
          const sharesNeeded = Math.floor(Math.abs(s.delta) / (c.price * fx));
          if (sharesNeeded > 0) {
            out.push({ action: "Sell", ticker: c.ticker, name: c.name, shares: sharesNeeded, price: c.price, ccy: c.ccy, amount: sharesNeeded * c.price * fx, cls: s.name });
          }
        }
      }
    });
    return out;
  }, [suggestions, allowSales, rows, total]);

  const handleCalc = () => setShowResult(true);

  return (
    <div className="shell fade-in" data-screen-label="Tools">
      <PageHead
        kicker={lang === "th" ? "เครื่องมือ" : "Tools"}
        title={t.tools.heading}
        sub={t.tools.sub}
        right={<button className="btn btn-outline btn-sm"><Icon name="info" size={14} /> {lang === "th" ? "ดูคู่มือ" : "See tutorial"}</button>}
      />

      {/* Picker rail */}
      <div className="grid grid-3" style={{ marginBottom: 24, gap: 12 }}>
        <ToolCard active title={t.tools.rebalance} sub={t.tools.rebalanceSub} icon="filter" />
        <ToolCard locked title={lang === "th" ? "เครื่องคำนวณเกษียณ" : "Retirement projector"} sub={lang === "th" ? "ดูว่าเงินจะถึงเมื่อไหร่ ถ้ายังออมเท่านี้" : "Project when you'll reach your retirement number"} icon="leaf" />
        <ToolCard locked title={lang === "th" ? "Tax-loss harvesting" : "Tax-loss harvesting"} sub={lang === "th" ? "หาคู่ wash-sale-safe จากตำแหน่งที่ขาดทุน" : "Find wash-sale-safe pairs in your losers"} icon="info" />
      </div>

      <div className="grid grid-12">
        {/* Input panel */}
        <div className="card col-span-5" style={{ height: "fit-content" }}>
          <h3 className="section-title" style={{ marginBottom: 4 }}>{t.tools.rebalance}</h3>
          <p className="muted" style={{ fontSize: 13, marginTop: 0, marginBottom: 22 }}>
            {lang === "th" ? "ใส่จำนวนเงินที่จะฝาก/ถอน เราจะแนะนำการซื้อขายที่สะอาดที่สุด" : "Enter how much you'll deposit or withdraw. We'll suggest the cleanest trades."}
          </p>

          <div className="segmented" style={{ width: "100%", padding: 4 }}>
            <button className={mode === "deposit" ? "on" : ""} style={{ flex: 1, padding: "8px 16px" }} onClick={() => setMode("deposit")}>
              {t.tools.deposit}
            </button>
            <button className={mode === "withdraw" ? "on" : ""} style={{ flex: 1, padding: "8px 16px" }} onClick={() => setMode("withdraw")}>
              {t.tools.withdraw}
            </button>
          </div>

          <label style={{ display: "block", marginTop: 22 }}>
            <div className="label-up" style={{ marginBottom: 8 }}>{t.tools.amount} ({ccy})</div>
            <div style={{ position: "relative" }}>
              <input
                type="number" value={amount} onChange={e => setAmount(e.target.value)}
                style={{
                  width: "100%", padding: "16px 18px", fontSize: 28,
                  fontFamily: "var(--font-display)", letterSpacing: "-0.02em",
                  background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 12,
                }}
              />
              <div style={{ position: "absolute", right: 16, top: "50%", transform: "translateY(-50%)", color: "var(--ink-3)", fontSize: 13 }}>{ccy}</div>
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
              {[10000, 25000, 50000, 100000].map(q => (
                <button key={q} className="chip" style={{ cursor: "pointer" }} onClick={() => setAmount(String(q))}>
                  {FMT.money(q, ccy, { compact: true })}
                </button>
              ))}
            </div>
          </label>

          <label style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 22, cursor: "pointer" }}>
            <Switch on={allowSales} onChange={setAllowSales} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{t.tools.allowSales}</div>
              <div className="muted" style={{ fontSize: 11 }}>
                {lang === "th" ? "อนุญาตให้ขายตำแหน่งที่เกินเป้า" : "Allow selling overweight positions to rebalance"}
              </div>
            </div>
          </label>

          <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
            <button className="btn" onClick={handleCalc} style={{ flex: 1, padding: "12px 20px" }}>
              <Icon name="play" size={14} /> {t.tools.run}
            </button>
            <button className="btn btn-outline" onClick={() => setShowResult(false)}>{lang === "th" ? "รีเซ็ต" : "Reset"}</button>
          </div>
        </div>

        {/* Result panel */}
        <div className="col-span-7" style={{ display: "grid", gap: 16 }}>
          {/* Drift table */}
          <div className="card">
            <h3 className="section-title" style={{ marginBottom: 16 }}>{lang === "th" ? "เป้าหมาย vs. หลังปรับ" : "Target vs. after rebalance"}</h3>
            <div style={{ display: "grid", gap: 10 }}>
              {suggestions.map(s => {
                const after = (s.target / newTotal) * 100;
                const before = s.curPct;
                return (
                  <div key={s.name} style={{ display: "grid", gridTemplateColumns: "120px 60px 1fr 80px 80px", alignItems: "center", gap: 14, padding: "10px 0", borderTop: "1px solid var(--line)" }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{s.name}</div>
                    <div className="mono muted" style={{ fontSize: 11 }}>{s.tgtPct.toFixed(0)}%</div>
                    <div style={{ position: "relative", height: 16 }}>
                      <div style={{ position: "absolute", inset: 0, background: "var(--bg-2)", borderRadius: 999 }} />
                      <div style={{ position: "absolute", height: "100%", background: "var(--ink-4)", width: before + "%", opacity: 0.6, borderRadius: 999 }} title="current" />
                      <div style={{ position: "absolute", height: "100%", background: "var(--accent)", width: after + "%", borderRadius: 999 }} title="after" />
                    </div>
                    <div className="mono" style={{ fontSize: 12, textAlign: "right", color: "var(--ink-3)" }}>{before.toFixed(1)}%</div>
                    <div className="mono" style={{ fontSize: 12, textAlign: "right" }}>→ {after.toFixed(1)}%</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Suggested trades */}
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 className="section-title">{t.tools.suggestion}</h3>
              <span className="chip">{trades.length} {lang === "th" ? "รายการ" : "trades"}</span>
            </div>
            {trades.length === 0 ? (
              <div className="empty" style={{ padding: "40px 16px" }}>
                <p>{lang === "th" ? "ใส่จำนวนเงินและกด Calculate" : "Enter an amount and click Calculate"}</p>
              </div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>{t.tools.action}</th>
                    <th>{t.portfolio.holding}</th>
                    <th className="num">{t.portfolio.shares}</th>
                    <th className="num">{lang === "th" ? "ราคา" : "Price"}</th>
                    <th className="num">{lang === "th" ? "จำนวนเงิน" : "Amount"}</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((tr, i) => (
                    <tr key={i}>
                      <td>
                        <span className={"chip " + (tr.action === "Buy" ? "chip-gain" : "chip-loss")} style={{ fontWeight: 500, fontSize: 11 }}>
                          {tr.action === "Buy" ? <Icon name="buy" size={11} /> : <Icon name="sell" size={11} />}
                          {tr.action === "Buy" ? (lang === "th" ? "ซื้อ" : "Buy") : (lang === "th" ? "ขาย" : "Sell")}
                        </span>
                      </td>
                      <td>
                        <div className="ticker">
                          <div className="ticker-mark">{tr.ticker.slice(0, 2)}</div>
                          <div>
                            <div style={{ fontWeight: 500, fontSize: 13 }}>{tr.ticker}</div>
                            <div className="muted" style={{ fontSize: 11 }}>{tr.cls}</div>
                          </div>
                        </div>
                      </td>
                      <td className="num">{tr.shares}</td>
                      <td className="num">{tr.ccy === "USD" ? "$" : "฿"}{tr.price.toFixed(2)}</td>
                      <td className="num" style={{ fontWeight: 500 }}>{FMT.money(tr.amount, ccy, { compact: true })}</td>
                    </tr>
                  ))}
                  <tr style={{ background: "var(--bg)", fontWeight: 500 }}>
                    <td colSpan="4" className="label-up">{lang === "th" ? "เงินสดคงเหลือ" : "Cash remaining"}</td>
                    <td className="num">{FMT.money(Math.max(0, dep - trades.reduce((a, b) => a + (b.action === "Buy" ? b.amount : -b.amount), 0)), ccy, { compact: true })}</td>
                  </tr>
                </tbody>
              </table>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
              <button className="btn btn-outline btn-sm">{lang === "th" ? "ส่งออก CSV" : "Export CSV"}</button>
              <button className="btn btn-sm">{lang === "th" ? "บันทึกเป็น Watchlist" : "Save as plan"}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ToolCard({ active, locked, title, sub, icon }) {
  return (
    <div className="card" style={{
      padding: 22,
      border: active ? "1.5px solid var(--ink)" : "1px solid var(--line)",
      background: active ? "var(--card)" : locked ? "var(--bg)" : "var(--card)",
      opacity: locked ? 0.55 : 1,
      position: "relative",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8,
          background: active ? "var(--ink)" : "var(--bg-2)",
          color: active ? "var(--bg)" : "var(--ink-2)",
          display: "grid", placeItems: "center",
        }}>
          <Icon name={icon} size={16} />
        </div>
        <div style={{ fontSize: 14, fontWeight: 500 }}>{title}</div>
        {locked && <span className="chip" style={{ marginLeft: "auto", fontSize: 10 }}>Coming soon</span>}
        {active && <span className="chip chip-soft" style={{ marginLeft: "auto", fontSize: 10 }}>Active</span>}
      </div>
      <p className="muted" style={{ fontSize: 12, lineHeight: 1.5, margin: 0 }}>{sub}</p>
    </div>
  );
}

function Switch({ on, onChange }) {
  return (
    <button
      onClick={() => onChange(!on)}
      style={{
        width: 34, height: 20, borderRadius: 999,
        background: on ? "var(--ink)" : "var(--bg-3)",
        position: "relative", transition: "background 0.15s",
      }}
    >
      <span style={{
        position: "absolute", top: 2, left: on ? 16 : 2,
        width: 16, height: 16, borderRadius: 50,
        background: "white",
        transition: "left 0.15s",
        boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
      }} />
    </button>
  );
}


