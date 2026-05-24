import { useState, useMemo } from 'react'
import { PageHead, Delta, Icon } from './Nav'
import { LineChart, Donut, StackBar, BarChart, Sparkline } from './Charts'
import { LUMEN_FMT, LUMEN_DERIVE, LUMEN_HISTORY, LUMEN_BENCH, LUMEN_INSIGHTS } from '../data'


export function AnalyticsPage({ t, lang, ccy, dataState }) {
  const FMT = LUMEN_FMT;
  const [tab, setTab] = useState("common");

  if (dataState === "empty") {
    return (
      <div className="shell fade-in">
        <PageHead title={t.analytics.heading} sub={t.analytics.sub} />
        <div className="card empty">
          <h2 className="display" style={{ fontSize: 28 }}>{lang === "th" ? "ยังไม่มีข้อมูลให้วิเคราะห์" : "Nothing to analyze yet"}</h2>
          <p>{lang === "th" ? "เพิ่มหลักทรัพย์เพื่อปลดล็อกการวิเคราะห์" : "Add holdings to unlock analytics"}</p>
        </div>
      </div>
    );
  }

  const tabs = [
    { id: "common",         label: t.analytics.tabs.common,         icon: "spark" },
    { id: "diversification",label: t.analytics.tabs.diversification,icon: "filter" },
    { id: "dividends",      label: t.analytics.tabs.dividends,      icon: "dividend" },
    { id: "growth",         label: t.analytics.tabs.growth,         icon: "play" },
    { id: "metrics",        label: t.analytics.tabs.metrics,        icon: "info" },
  ];

  return (
    <div className="shell fade-in" data-screen-label="Analytics">
      <PageHead
        title={t.analytics.heading}
        sub={t.analytics.sub}
        right={
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button className="btn btn-outline btn-sm">
              <Icon name="filter" size={14} />
              {lang === "th" ? "ทุกหลักทรัพย์" : "All holdings"}
              <Icon name="down" size={12} />
            </button>
          </div>
        }
      />

      <div className="tabs">
        {tabs.map(tb => (
          <button key={tb.id} className={"tab" + (tab === tb.id ? " active" : "")} onClick={() => setTab(tb.id)}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Icon name={tb.icon} size={13} /> {tb.label}
            </span>
          </button>
        ))}
      </div>

      {tab === "common" && <AnalyticsCommon t={t} lang={lang} ccy={ccy} />}
      {tab === "diversification" && <AnalyticsDiv t={t} lang={lang} ccy={ccy} />}
      {tab === "dividends" && <AnalyticsDiv2 t={t} lang={lang} ccy={ccy} />}
      {tab === "growth" && <AnalyticsGrowth t={t} lang={lang} ccy={ccy} />}
      {tab === "metrics" && <AnalyticsMetrics t={t} lang={lang} ccy={ccy} />}
    </div>
  );
}

/* ─── Common tab ─── */
function AnalyticsCommon({ t, lang, ccy }) {
  const FMT = LUMEN_FMT;
  const d = LUMEN_DERIVE();
  const { rows, value, cost, pl, plPct } = d;
  const monthLabels = ["Jun","Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar","Apr","May"];
  const series = [
    {
      name: lang === "th" ? "พอร์ตของคุณ" : "Your portfolio",
      color: "var(--ink)",
      fill: true,
      data: LUMEN_HISTORY.map((p, i) => ({ x: i, y: p.v * 1000, label: monthLabels[i % 12] + " '" + (24 + Math.floor(i / 12)) })),
    },
    {
      name: "S&P 500",
      color: "var(--accent)",
      data: LUMEN_BENCH.map((p, i) => ({ x: i, y: p.v * 1000, label: monthLabels[i % 12] + " '" + (24 + Math.floor(i / 12)) })),
    },
  ];

  return (
    <div className="fade-in">
      <div className="grid grid-12" style={{ marginBottom: 16 }}>
        <BigKpi className="col-span-3" label={lang === "th" ? "มูลค่า" : "Value"}      value={FMT.money(value, ccy)} sub={FMT.money(cost, ccy, { compact: true }) + " " + (lang === "th" ? "ทุน" : "invested")} />
        <BigKpi className="col-span-3" label={lang === "th" ? "กำไรรวม" : "Total profit"} value={(pl >= 0 ? "+" : "") + FMT.money(pl, ccy, { compact: true })} sub={<Delta value={plPct} />} tone="gain" />
        <BigKpi className="col-span-3" label={t.analytics.yield} value={FMT.pct(rows.reduce((a, b) => a + b.value * b.divYield / 100, 0) / value * 100, 2)} sub={lang === "th" ? "ปันผลกระแสรายปี" : "annual income"} />
        <BigKpi className="col-span-3" label={t.analytics.twr} value={"+18.3%"} sub={lang === "th" ? "12 เดือนล่าสุด" : "trailing 12-mo"} tone="gain" />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 16 }}>
          <div>
            <h3 className="section-title">{lang === "th" ? "มูลค่าพอร์ต vs. S&P 500" : "Portfolio value vs. S&P 500"}</h3>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              <span className="dot" style={{ background: "var(--ink)" }}/> {lang === "th" ? "พอร์ตของคุณ" : "Your portfolio"}
              <span style={{ marginLeft: 12 }}><span className="dot" style={{ background: "var(--accent)" }}/> S&P 500</span>
            </div>
          </div>
          <div className="segmented">
            {["1m","3m","6m","ytd","1y","5y","all"].map(k => (
              <button key={k} className={k === "all" ? "on" : ""}>{t.analytics.timeRange[k]}</button>
            ))}
          </div>
        </div>
        <LineChart series={series} height={340} fmt={v => "฿" + (v / 1_000_000).toFixed(2) + "M"} />
      </div>

      <div className="grid grid-2">
        <div className="card">
          <h3 className="section-title" style={{ marginBottom: 16 }}>{lang === "th" ? "ผลงานรายตัว" : "Top performers"}</h3>
          <div style={{ display: "grid", gap: 10 }}>
            {[...rows].sort((a, b) => b.plPct - a.plPct).slice(0, 4).map(r => (
              <PerfRow key={r.ticker} r={r} ccy={ccy} />
            ))}
          </div>
        </div>
        <div className="card">
          <h3 className="section-title" style={{ marginBottom: 16 }}>{lang === "th" ? "ผลงานที่แย่ที่สุด" : "Underperformers"}</h3>
          <div style={{ display: "grid", gap: 10 }}>
            {[...rows].sort((a, b) => a.plPct - b.plPct).slice(0, 4).map(r => (
              <PerfRow key={r.ticker} r={r} ccy={ccy} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function PerfRow({ r, ccy }) {
  const FMT = LUMEN_FMT;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto auto", gap: 12, alignItems: "center", padding: "8px 0", borderTop: "1px solid var(--line)" }}>
      <div className="ticker-mark">{r.ticker.slice(0, 2)}</div>
      <div>
        <div style={{ fontWeight: 500, fontSize: 13 }}>{r.ticker}</div>
        <div className="muted" style={{ fontSize: 11 }}>{r.name}</div>
      </div>
      <div className="mono" style={{ fontSize: 13 }}>{FMT.money(r.value, ccy, { compact: true })}</div>
      <div style={{ textAlign: "right" }}>
        <div style={{ color: r.pl >= 0 ? "var(--gain)" : "var(--loss)", fontVariant: "tabular-nums", fontSize: 13 }}>
          {r.pl >= 0 ? "+" : ""}{FMT.money(r.pl, ccy, { compact: true })}
        </div>
        <Delta value={r.plPct} size={11} />
      </div>
    </div>
  );
}

/* ─── Diversification tab ─── */
function AnalyticsDiv({ t, lang, ccy }) {
  const FMT = LUMEN_FMT;
  const d = LUMEN_DERIVE();
  const { rows, value, cash } = d;
  const total = value + cash;

  const byClass = bucket(rows, r => r.cls === "Equity" ? (r.region === "TH" ? "TH Equity" : "US Equity") : r.cls, total, cash);
  const bySector = bucket(rows, r => r.sector, total);
  const byRegion = bucket(rows, r => r.region === "—" ? "Global" : r.region, total);

  return (
    <div className="fade-in grid grid-12">
      <DivCard className="col-span-4" title={t.analytics.byAsset} data={byClass} />
      <DivCard className="col-span-4" title={t.analytics.bySector} data={bySector} />
      <DivCard className="col-span-4" title={t.analytics.byRegion} data={byRegion} />

      <div className="card col-span-12" style={{ gridColumn: "span 12" }}>
        <h3 className="section-title" style={{ marginBottom: 16 }}>{lang === "th" ? "เป้าหมาย vs. ปัจจุบัน" : "Target vs. current"}</h3>
        <div style={{ display: "grid", gap: 14 }}>
          {Object.entries(window.LUMEN_TARGETS).map(([k, tgt]) => {
            const found = byClass.find(b => b.name === k) || (k === "Cash" ? { value: cash } : { value: 0 });
            const cur = (found.value / total) * 100;
            const target = tgt * 100;
            const drift = cur - target;
            return (
              <div key={k} style={{ display: "grid", gridTemplateColumns: "150px 1fr 80px 100px", gap: 20, alignItems: "center" }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{k}</div>
                <div style={{ position: "relative", height: 24 }}>
                  <div style={{ position: "absolute", inset: 0, background: "var(--bg-2)", borderRadius: 999 }} />
                  <div style={{ position: "absolute", height: "100%", background: "var(--accent)", borderRadius: 999, width: cur + "%", opacity: 0.85 }} />
                  <div style={{ position: "absolute", height: "100%", borderLeft: "2px dashed var(--ink)", left: target + "%" }} />
                  <div style={{ position: "absolute", left: target + "%", top: -16, fontSize: 10, color: "var(--ink-2)", transform: "translateX(-50%)" }}>{target.toFixed(0)}%</div>
                </div>
                <div className="mono" style={{ fontSize: 13, textAlign: "right" }}>{cur.toFixed(1)}%</div>
                <div style={{ textAlign: "right" }}>
                  <span className={"chip " + (Math.abs(drift) < 2 ? "chip-gain" : Math.abs(drift) < 5 ? "" : "chip-loss")}>
                    {drift >= 0 ? "+" : ""}{drift.toFixed(1)}pp
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function bucket(rows, keyFn, total, extraCash) {
  const map = {};
  rows.forEach(r => {
    const k = keyFn(r);
    map[k] = (map[k] || 0) + r.value;
  });
  if (extraCash) map["Cash"] = extraCash;
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value], i) => ({ name, value, color: paletteColor(i) }));
}
function paletteColor(i) { return ["var(--c1)","var(--c2)","var(--c3)","var(--c4)","var(--c5)","var(--c6)","var(--c7)"][i % 7]; }

function DivCard({ title, data, className }) {
  const total = data.reduce((a, b) => a + b.value, 0);
  return (
    <div className={"card " + className}>
      <h3 className="section-title" style={{ marginBottom: 16 }}>{title}</h3>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
        <Donut data={data} size={170} thickness={22} />
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {data.map((s, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 10, alignItems: "center", fontSize: 12 }}>
            <span className="dot" style={{ background: s.color }} />
            <span>{s.name}</span>
            <span className="mono">{((s.value / total) * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Dividends tab ─── */
function AnalyticsDiv2({ t, lang, ccy }) {
  const FMT = LUMEN_FMT;
  const d = LUMEN_DERIVE();
  const { rows, value } = d;
  const annual = rows.reduce((a, b) => a + b.value * b.divYield / 100, 0);
  const yieldOnPort = (annual / value) * 100;

  // monthly payouts (synthetic)
  const months = ["Jun","Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar","Apr","May"];
  const monthlyData = months.map((m, i) => ({ label: m, value: (annual / 12) * (1 + Math.sin(i) * 0.3 + Math.cos(i * 1.7) * 0.18) }));

  const payers = rows.filter(r => r.divYield > 0).map(r => ({ ...r, annual: r.value * r.divYield / 100 })).sort((a, b) => b.annual - a.annual);

  return (
    <div className="fade-in grid grid-12">
      <BigKpi className="col-span-3" label={t.analytics.yield}        value={FMT.pct(yieldOnPort, 2)} sub={lang === "th" ? "บนมูลค่าตลาด" : "on market value"} />
      <BigKpi className="col-span-3" label={t.analytics.payout}       value={FMT.money(annual, ccy, { compact: true })} sub={FMT.money(annual / 12, ccy, { compact: true }) + " " + (lang === "th" ? "ต่อเดือน" : "/mo")} tone="gain" />
      <BigKpi className="col-span-3" label={lang === "th" ? "เติบโต 5 ปี" : "5y div growth"} value="+8.2% CAGR" sub={lang === "th" ? "เฉลี่ยถ่วงน้ำหนัก" : "weighted avg"} />
      <BigKpi className="col-span-3" label={lang === "th" ? "ครอบคลุมพอร์ต" : "Payers"} value={payers.length + "/" + rows.length} sub={lang === "th" ? "หลักทรัพย์จ่ายปันผล" : "income-producing"} />

      <div className="card col-span-7">
        <h3 className="section-title" style={{ marginBottom: 16 }}>{lang === "th" ? "ปันผลรายเดือน (ประมาณ 12 เดือนถัดไป)" : "Estimated monthly payouts (next 12 months)"}</h3>
        <BarChart data={monthlyData} height={220} color="var(--accent-ink)" fmt={v => FMT.money(v, ccy, { compact: true })} />
      </div>

      <div className="card col-span-5">
        <h3 className="section-title" style={{ marginBottom: 16 }}>{lang === "th" ? "ผู้จ่ายปันผลสูงสุด" : "Top dividend payers"}</h3>
        <div style={{ display: "grid", gap: 6 }}>
          {payers.slice(0, 6).map(p => (
            <div key={p.ticker} style={{ display: "grid", gridTemplateColumns: "auto 1fr auto auto", gap: 10, alignItems: "center", padding: "8px 0", borderTop: "1px solid var(--line)" }}>
              <div className="ticker-mark">{p.ticker.slice(0, 2)}</div>
              <div>
                <div style={{ fontWeight: 500, fontSize: 13 }}>{p.ticker}</div>
                <div className="muted" style={{ fontSize: 11 }}>{FMT.pct(p.divYield, 1)} yield</div>
              </div>
              <div className="mono" style={{ fontSize: 12, color: "var(--ink-3)" }}>{FMT.money(p.value, ccy, { compact: true })}</div>
              <div className="mono" style={{ fontSize: 13, color: "var(--accent-ink)" }}>+{FMT.money(p.annual, ccy, { compact: true })}/y</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Growth tab ─── */
function AnalyticsGrowth({ t, lang, ccy }) {
  const FMT = LUMEN_FMT;
  const monthLabels = ["Jun","Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar","Apr","May"];
  // cumulative returns %
  const port = LUMEN_HISTORY;
  const bench = LUMEN_BENCH;
  const v0 = port[0].v, b0 = bench[0].v;
  const series = [
    {
      name: lang === "th" ? "พอร์ตของคุณ" : "Your portfolio",
      color: "var(--ink)",
      fill: true,
      data: port.map((p, i) => ({ x: i, y: (p.v / v0 - 1) * 100, label: monthLabels[i % 12] + " '" + (24 + Math.floor(i / 12)) })),
    },
    {
      name: "S&P 500",
      color: "var(--accent)",
      dashed: true,
      data: bench.map((p, i) => ({ x: i, y: (p.v / b0 - 1) * 100, label: monthLabels[i % 12] + " '" + (24 + Math.floor(i / 12)) })),
    },
  ];

  const yrs = [
    { label: "2023", port: 12.4, bench: 24.2 },
    { label: "2024", port: 18.9, bench: 23.3 },
    { label: "2025", port: 22.1, bench: 14.0 },
    { label: "2026 YTD", port: 8.4, bench: 5.1 },
  ];

  return (
    <div className="fade-in">
      <div className="grid grid-12" style={{ marginBottom: 16 }}>
        <BigKpi className="col-span-3" label={lang === "th" ? "ผลตอบแทนรวม" : "Total return"} value="+58.7%" sub={lang === "th" ? "ตั้งแต่เริ่ม" : "since inception"} tone="gain" />
        <BigKpi className="col-span-3" label="CAGR" value="+16.6%" sub={lang === "th" ? "3 ปีถ่วงเวลา" : "3-yr annualized"} tone="gain" />
        <BigKpi className="col-span-3" label={t.analytics.vsBench} value="+4.2pp" sub={lang === "th" ? "ดีกว่า S&P 500" : "outperforming"} tone="gain" />
        <BigKpi className="col-span-3" label={t.analytics.drawdown} value="-9.8%" sub={lang === "th" ? "ก.ค. 2024" : "Jul 2024"} tone="loss" />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 16 }}>
          <h3 className="section-title">{lang === "th" ? "ผลตอบแทนสะสม (เริ่มที่ 0%)" : "Cumulative return (rebased to 0%)"}</h3>
          <div className="segmented">
            {["3m","6m","ytd","1y","3y","all"].map(k => (
              <button key={k} className={k === "all" ? "on" : ""}>{t.analytics.timeRange[k] || k.toUpperCase()}</button>
            ))}
          </div>
        </div>
        <LineChart series={series} height={320} fmt={v => v.toFixed(0) + "%"} />
      </div>

      <div className="card">
        <h3 className="section-title" style={{ marginBottom: 16 }}>{lang === "th" ? "ผลตอบแทนรายปี" : "Annual returns"}</h3>
        <div className="grid grid-4" style={{ gap: 14 }}>
          {yrs.map(y => (
            <div key={y.label} style={{ padding: 16, border: "1px solid var(--line)", borderRadius: 12 }}>
              <div className="label-up" style={{ marginBottom: 8 }}>{y.label}</div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 6 }}>
                <div className="display" style={{ fontSize: 24, color: y.port > y.bench ? "var(--gain)" : "var(--loss)" }}>+{y.port}%</div>
                <div className="mono muted" style={{ fontSize: 12 }}>S&P {y.bench >= 0 ? "+" : ""}{y.bench}%</div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <div className="bar" style={{ flex: 1, height: 4 }}>
                  <span style={{ width: Math.min(100, y.port / 30 * 100) + "%", background: "var(--ink)" }} />
                </div>
                <div className="bar" style={{ flex: 1, height: 4 }}>
                  <span style={{ width: Math.min(100, y.bench / 30 * 100) + "%", background: "var(--accent)" }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Metrics tab ─── */
function AnalyticsMetrics({ t, lang }) {
  const metrics = [
    { key: "twr",      value: "+18.3%", scale: 0.61, min: "-50%", max: "+50%",   sub: t.analytics.twr,     ok: true },
    { key: "pe",       value: "21.4x",  scale: 0.31, min: "0x",   max: "70x",    sub: t.analytics.pe,      ok: true },
    { key: "beta",     value: "0.92",   scale: 0.46, min: "0",    max: "2.0",    sub: t.analytics.beta,    ok: true },
    { key: "sharpe",   value: "1.42",   scale: 0.71, min: "0",    max: "2.0",    sub: t.analytics.sharpe,  ok: true },
    { key: "sortino",  value: "1.95",   scale: 0.65, min: "0",    max: "3.0",    sub: t.analytics.sortino, ok: true },
    { key: "drawdown", value: "-9.8%",  scale: 0.19, min: "-50%", max: "0%",     sub: t.analytics.drawdown, ok: true, inverse: true },
  ];
  const labels = {
    twr:      lang === "th" ? "วัดผลพอร์ตจริงโดยตัดผลของกระแสเงินสด"          : "Measures portfolio's true performance excluding cash flows",
    pe:       lang === "th" ? "ค่าเฉลี่ยถ่วงน้ำหนักของ P/E ตามน้ำหนักในพอร์ต" : "Weighted average P/E across all individual stocks",
    beta:     lang === "th" ? "ความผันผวนเทียบกับตลาด (S&P 500)"                : "Volatility relative to the market (S&P 500)",
    sharpe:   lang === "th" ? "วัดผลตอบแทนต่อความเสี่ยงรวม"                     : "How well profitability compensates for total risk",
    sortino:  lang === "th" ? "วัดผลตอบแทนต่อความเสี่ยงขาลงเท่านั้น"           : "How well profitability compensates for downside risk",
    drawdown: lang === "th" ? "การลดลงสูงสุดจากจุดสูงสุดในประวัติ"              : "Largest peak-to-trough decline observed",
  };

  return (
    <div className="fade-in grid grid-2" style={{ gap: 16 }}>
      {metrics.map(m => (
        <div key={m.key} className="card" style={{ padding: 28 }}>
          <h4 style={{ margin: 0, fontSize: 14, fontWeight: 500, display: "flex", alignItems: "center", gap: 6 }}>
            {m.sub} <Icon name="info" size={13} />
          </h4>
          <p className="muted" style={{ fontSize: 12, marginTop: 6, marginBottom: 22 }}>{labels[m.key]}</p>
          <div className="display" style={{ fontSize: 56, lineHeight: 1, color: m.inverse ? "var(--loss)" : "var(--ink)" }}>{m.value}</div>

          <div style={{ marginTop: 24, position: "relative", height: 8, background: "var(--bg-2)", borderRadius: 999 }}>
            <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: (m.scale * 100) + "%", background: m.inverse ? "var(--loss)" : "var(--accent)", borderRadius: 999 }} />
            <div style={{ position: "absolute", left: (m.scale * 100) + "%", top: -2, width: 2, height: 12, background: "var(--ink)" }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--font-mono)" }}>
            <span>{m.min}</span>
            <span>{m.max}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── BigKpi ─── */
function BigKpi({ label, value, sub, tone, className }) {
  const color = tone === "gain" ? "var(--gain)" : tone === "loss" ? "var(--loss)" : "var(--ink)";
  return (
    <div className={"card " + (className || "")}>
      <div className="label-up" style={{ marginBottom: 8 }}>{label}</div>
      <div className="display" style={{ fontSize: 32, color, lineHeight: 1 }}>{value}</div>
      <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>{sub}</div>
    </div>
  );
}


