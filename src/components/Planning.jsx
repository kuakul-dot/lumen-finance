import { useState } from 'react'
import { PageHead, Icon } from './Nav'
import { LineChart } from './Charts'
import { GoalRing } from './Dashboard'
import { LUMEN_FMT, LUMEN_GOALS, LUMEN_FX } from '../data'


export function PlanningPage({ t, lang, ccy }) {
  const FMT = LUMEN_FMT;
  const goals = LUMEN_GOALS;
  const [selectedId, setSelectedId] = useState(goals[0].id);
  const selected = goals.find(g => g.id === selectedId) || goals[0];

  // Projection chart
  const months = 24;
  const projection = Array.from({ length: months }, (_, i) => {
    const baseline = selected.current + selected.monthly * i;
    const optimistic = selected.current + selected.monthly * i + (selected.monthly * i * 0.06);
    return {
      x: i,
      baseline,
      optimistic,
      label: i % 4 === 0 ? `${["Jun","Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar","Apr","May"][i % 12]} '${26 + Math.floor(i / 12)}` : "",
    };
  });

  const series = [
    {
      name: lang === "th" ? "เป้าหมาย" : "Target",
      color: "var(--ink-4)",
      dashed: true,
      data: projection.map(p => ({ x: p.x, y: selected.target, label: p.label })),
    },
    {
      name: lang === "th" ? "ออมเดือนละ + 6%" : "+ 6% returns",
      color: "var(--accent)",
      fill: true,
      data: projection.map(p => ({ x: p.x, y: p.optimistic, label: p.label })),
    },
    {
      name: lang === "th" ? "ออมเดือนละเฉย ๆ" : "Cash only",
      color: "var(--ink-3)",
      data: projection.map(p => ({ x: p.x, y: p.baseline, label: p.label })),
    },
  ];

  const totalNetWorth = window.LUMEN_DERIVE().net;
  const goalsValue = goals.reduce((a, b) => a + b.current, 0);
  const totalTarget = goals.reduce((a, b) => a + b.target, 0);

  return (
    <div className="shell fade-in" data-screen-label="Planning">
      <PageHead
        kicker={lang === "th" ? "วางแผน" : "Planning"}
        title={t.planning.heading}
        sub={t.planning.sub}
        right={
          <button className="btn btn-sm">
            <Icon name="plus" size={14} /> {t.planning.add}
          </button>
        }
      />

      {/* Summary strip */}
      <section className="card" style={{ padding: "28px 32px", marginBottom: 24 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr", gap: 32, alignItems: "center" }}>
          <div>
            <div className="label-up" style={{ marginBottom: 8 }}>{lang === "th" ? "เงินที่จัดสรรไว้สำหรับเป้าหมาย" : "Allocated to goals"}</div>
            <div className="display" style={{ fontSize: 36, lineHeight: 1 }}>{FMT.money(goalsValue, ccy, { compact: true })}</div>
            <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
              <span className="mono">{((goalsValue / totalTarget) * 100).toFixed(1)}%</span> {lang === "th" ? "ของเป้ารวม" : "of total target"}
            </div>
          </div>
          <Kpi label={lang === "th" ? "เป้าหมายรวม" : "Total target"} value={FMT.money(totalTarget, ccy, { compact: true })} sub={`${goals.length} ${lang === "th" ? "เป้าหมาย" : "goals"}`} />
          <Kpi label={lang === "th" ? "ออมต่อเดือน" : "Monthly contribution"} value={FMT.money(goals.reduce((a, b) => a + b.monthly, 0), ccy, { compact: true })} sub={lang === "th" ? "อัตโนมัติทุกวันที่ 1" : "auto on the 1st"} />
          <Kpi label={lang === "th" ? "ครบเป้าแล้ว" : "Goals on track"} value={`${goals.filter(g => g.current >= g.target).length}/${goals.length}`} sub={lang === "th" ? "เกษียณ · ยังเร็ว" : "retirement on pace"} />
        </div>
      </section>

      <div className="grid grid-12" style={{ gap: 16 }}>
        {/* Goals rail */}
        <aside className="col-span-4" style={{ display: "grid", gap: 12, alignContent: "start" }}>
          {goals.map(g => {
            const pct = Math.min(100, (g.current / g.target) * 100);
            const sel = g.id === selectedId;
            return (
              <button
                key={g.id}
                onClick={() => setSelectedId(g.id)}
                style={{
                  textAlign: "left", width: "100%",
                  padding: 20, borderRadius: 14,
                  background: sel ? "var(--ink)" : "var(--card)",
                  color: sel ? "var(--bg)" : "var(--ink)",
                  border: "1px solid " + (sel ? "var(--ink)" : "var(--line)"),
                  transition: "background 0.15s, color 0.15s",
                  cursor: "pointer",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: 10,
                    background: sel ? "rgba(255,255,255,0.1)" : "var(--bg-2)",
                    color: sel ? "var(--bg)" : "var(--ink-2)",
                    display: "grid", placeItems: "center",
                  }}>
                    <Icon name={g.icon} size={18} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500, fontSize: 14 }}>{t.planning[g.nameKey]}</div>
                    <div style={{ fontSize: 11, opacity: sel ? 0.7 : 1, color: sel ? "" : "var(--ink-3)", marginTop: 2 }}>
                      {g.eta === "Complete"
                        ? (lang === "th" ? "ครบแล้ว ✓" : "Complete ✓")
                        : (g.eta + (lang === "th" ? "" : ""))}
                    </div>
                  </div>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: 22, letterSpacing: "-0.02em" }}>
                    {Math.round(pct)}%
                  </div>
                </div>
                <div style={{
                  marginTop: 14,
                  height: 4, borderRadius: 999,
                  background: sel ? "rgba(255,255,255,0.18)" : "var(--bg-2)",
                  overflow: "hidden",
                }}>
                  <div style={{
                    height: "100%", width: pct + "%",
                    background: sel ? "var(--bg)" : g.color,
                    borderRadius: 999, transition: "width 0.6s",
                  }} />
                </div>
                <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", fontSize: 11, opacity: sel ? 0.7 : 1, color: sel ? "" : "var(--ink-3)" }}>
                  <span className="mono">{FMT.money(g.current, ccy, { compact: true })}</span>
                  <span className="mono">{FMT.money(g.target, ccy, { compact: true })}</span>
                </div>
              </button>
            );
          })}
        </aside>

        {/* Goal detail */}
        <main className="col-span-8" style={{ display: "grid", gap: 16 }}>
          <div className="card">
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
              <div>
                <div className="label-up" style={{ marginBottom: 8 }}>
                  {lang === "th" ? "เป้าหมาย" : "Goal"} · {selected.eta}
                </div>
                <h2 className="h2" style={{ margin: 0, fontSize: 40 }}>{t.planning[selected.nameKey]}</h2>
                <p className="muted" style={{ fontSize: 13, marginTop: 8, maxWidth: 480 }}>
                  {goalBlurb(selected.id, lang)}
                </p>
              </div>
              <GoalRing pct={Math.min(100, (selected.current / selected.target) * 100)} color="var(--ink)" size={96} stroke={8} />
            </div>

            <div className="grid grid-3" style={{ gap: 16, marginTop: 12 }}>
              <Stat label={t.planning.target}  value={FMT.money(selected.target, ccy, { compact: true })} />
              <Stat label={t.planning.now}     value={FMT.money(selected.current, ccy, { compact: true })} accent />
              <Stat label={t.planning.monthly} value={selected.monthly > 0 ? FMT.money(selected.monthly, ccy, { compact: true }) : "—"} sub={selected.monthly > 0 ? (lang === "th" ? "ออมอัตโนมัติ" : "auto-invested") : ""} />
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
              <button className="btn">
                <Icon name="plus" size={14} /> {t.planning.contribute}
              </button>
              <button className="btn btn-outline">{lang === "th" ? "ปรับเป้า" : "Edit goal"}</button>
              <button className="btn btn-ghost" style={{ marginLeft: "auto" }}>
                {lang === "th" ? "ดูประวัติ" : "Activity"} <Icon name="chevron" size={12} />
              </button>
            </div>
          </div>

          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 className="section-title">{lang === "th" ? "การคาดการณ์ 24 เดือนข้างหน้า" : "24-month projection"}</h3>
              <div style={{ display: "flex", gap: 12, fontSize: 12, alignItems: "center" }}>
                <span><span className="dot" style={{ background: "var(--accent)" }}/> {lang === "th" ? "ลงทุน +6%" : "Invested"}</span>
                <span><span className="dot" style={{ background: "var(--ink-3)" }}/> {lang === "th" ? "เงินสด" : "Cash only"}</span>
                <span><span className="dot" style={{ background: "var(--ink-4)" }}/> {lang === "th" ? "เป้า" : "Target"}</span>
              </div>
            </div>
            <LineChart series={series} height={260} fmt={v => FMT.money(v, ccy, { compact: true })} />
          </div>

          {/* Suggested actions */}
          <div className="card">
            <h3 className="section-title" style={{ marginBottom: 16 }}>{lang === "th" ? "ข้อแนะนำเพื่อให้ถึงเป้าเร็วขึ้น" : "Suggested actions"}</h3>
            <div style={{ display: "grid", gap: 10 }}>
              {suggestedActions(selected, lang).map((s, i) => (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 14, padding: "12px 16px", background: "var(--bg)", borderRadius: 10 }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: 8, background: "var(--accent-soft)",
                    color: "var(--accent-ink)", display: "grid", placeItems: "center", flexShrink: 0
                  }}>
                    <Icon name={s.icon} size={14} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{s.title}</div>
                    <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{s.body}</div>
                  </div>
                  <button className="btn btn-outline btn-sm">{s.cta}</button>
                </div>
              ))}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub }) {
  return (
    <div>
      <div className="label-up" style={{ marginBottom: 6 }}>{label}</div>
      <div className="display" style={{ fontSize: 22, lineHeight: 1 }}>{value}</div>
      <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{sub}</div>
    </div>
  );
}

function Stat({ label, value, sub, accent }) {
  return (
    <div style={{ padding: 16, background: "var(--bg)", borderRadius: 10 }}>
      <div className="label-up" style={{ marginBottom: 6 }}>{label}</div>
      <div className="display" style={{ fontSize: 26, lineHeight: 1, color: accent ? "var(--accent-ink)" : "var(--ink)" }}>{value}</div>
      {sub ? <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{sub}</div> : null}
    </div>
  );
}

function goalBlurb(id, lang) {
  const en = {
    retire:    "Comfortable retirement at age 55. Target is 25x annual spending, invested 70/30 equities/bonds.",
    house:     "Down payment for a Bangkok condo in 2027. Holding in low-volatility ladder of T-bills + HYSA.",
    emergency: "Six months of essential expenses, parked in a HYSA. Already fully funded — reviewing quarterly.",
    education: "International undergraduate degree for one child starting 2038. Long horizon, equity-heavy.",
  };
  const th = {
    retire:    "เกษียณสบายอายุ 55 — เป้าคือ 25 เท่าของค่าใช้จ่ายต่อปี ลงทุนหุ้น 70% ตราสารหนี้ 30%",
    house:     "เงินดาวน์คอนโดในกรุงเทพภายในปี 2027 — เก็บไว้ในตราสารหนี้ระยะสั้น + ออมทรัพย์ดอกเบี้ยสูง",
    emergency: "ค่าใช้จ่ายจำเป็น 6 เดือน เก็บใน HYSA — เต็มแล้ว ทบทวนทุกไตรมาส",
    education: "ค่าเรียนปริญญาตรีต่างประเทศ ลูกเริ่มปี 2038 — ระยะยาว เน้นหุ้น",
  };
  return (lang === "th" ? th : en)[id] || "";
}

function suggestedActions(g, lang) {
  const out = [];
  if (g.current >= g.target) {
    out.push({
      icon: "shield",
      title: lang === "th" ? "ย้ายเงินส่วนเกินไป T-bills 90 วัน" : "Move surplus to 90-day T-bills",
      body:  lang === "th" ? "ดอกเบี้ยสูงกว่า HYSA 1.4% สำหรับสภาพคล่องที่ใกล้เคียงกัน" : "Picks up ~1.4% more vs. HYSA with similar liquidity",
      cta:   lang === "th" ? "ดูทางเลือก" : "Review",
    });
    return out;
  }
  out.push({
    icon: "plus",
    title: lang === "th" ? `เพิ่มออมเดือนละ ${(g.monthly * 0.25 / 1000).toFixed(0)}k จะถึงเป้าเร็วขึ้น ~5 เดือน` : `Adding ${(g.monthly * 0.25 / 1000).toFixed(0)}k/mo gets you there ~5 months sooner`,
    body:  lang === "th" ? "เริ่มเดือนหน้าได้ทันที — เพิ่มรอบหักบัญชีอัตโนมัติ" : "Effective next cycle; auto-transfer can be increased now",
    cta:   lang === "th" ? "เพิ่มออม" : "Adjust",
  });
  out.push({
    icon: "spark",
    title: lang === "th" ? "ลองโยกพอร์ตเข้า diversified ETF (เช่น VWRA)" : "Consider a diversified ETF allocation (e.g. VWRA)",
    body:  lang === "th" ? "เพิ่มผลตอบแทนคาดหวัง ~1.2% ต่อปี โดยความผันผวนใกล้เคียง" : "Adds ~1.2%/yr expected return at similar volatility profile",
    cta:   lang === "th" ? "ดูแบบจำลอง" : "Model it",
  });
  return out;
}


