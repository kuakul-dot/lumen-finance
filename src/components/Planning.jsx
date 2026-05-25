import { useState, useEffect, useMemo } from 'react'
import { PageHead, Icon } from './Nav'
import { LineChart } from './Charts'
import { GoalRing } from './Dashboard'
import { LUMEN_FMT, LUMEN_GOALS } from '../data'
import { getGoals, upsertGoal, deleteGoal, deriveHoldings } from '../lib/db'

export function PlanningPage({ t, lang, ccy, session, liveHoldings = [], prices = {} }) {
  const th = lang === "th"
  const FMT = LUMEN_FMT
  const isLive = !!session

  // ── Goals state ──────────────────────────────────────────────────────────────
  const [goals, setGoals] = useState(null)   // null = loading
  const [selectedId, setSelectedId] = useState(null)
  const [showAdd, setShowAdd] = useState(false)
  const [showEdit, setShowEdit] = useState(null)

  // ── Portfolio value from live holdings ───────────────────────────────────────
  const portfolioValue = useMemo(() => {
    if (!isLive || liveHoldings.length === 0) return 0
    const rows = deriveHoldings(liveHoldings, ccy, prices)
    return rows.reduce((s, r) => s + r.value, 0)
  }, [isLive, liveHoldings, ccy, prices])

  // ── Load goals ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!session?.user) {
      // Demo mode — normalise LUMEN_GOALS to DB shape
      const demo = LUMEN_GOALS.map(g => ({
        id: g.id,
        name: t.planning[g.nameKey] || g.nameKey,
        icon: g.icon,
        color: g.color,
        target: g.target,
        current: g.current,
        monthly_contribution: g.monthly,
        eta_year: g.eta,
      }))
      setGoals(demo)
      setSelectedId(demo[0]?.id)
      return
    }
    getGoals(session.user.id)
      .then(data => {
        setGoals(data)
        setSelectedId(prev => prev || data[0]?.id || null)
      })
      .catch(() => setGoals([]))
  }, [session?.user?.id])

  const refreshGoals = async () => {
    if (!session?.user) return
    const data = await getGoals(session.user.id)
    setGoals(data)
    if (!selectedId && data.length > 0) setSelectedId(data[0].id)
  }

  const displayGoals = goals || []
  const selected = displayGoals.find(g => g.id === selectedId) || displayGoals[0] || null

  // ── Aggregates ───────────────────────────────────────────────────────────────
  const goalsTotal   = displayGoals.reduce((s, g) => s + (g.current || 0), 0)
  const targetTotal  = displayGoals.reduce((s, g) => s + (g.target || 0), 0)
  const monthlyTotal = displayGoals.reduce((s, g) => s + (g.monthly_contribution || 0), 0)
  const onTrack      = displayGoals.filter(g => (g.current || 0) >= (g.target || 1)).length

  // ── Projection for selected goal ─────────────────────────────────────────────
  const series = useMemo(() => {
    if (!selected) return []
    const months = 24
    const now = new Date()
    const points = Array.from({ length: months }, (_, i) => {
      const base = (selected.current || 0) + (selected.monthly_contribution || 0) * i
      const opt  = (selected.current || 0) + (selected.monthly_contribution || 0) * i * (1 + 0.005 * i)
      const d    = new Date(now.getFullYear(), now.getMonth() + i, 1)
      const label = i % 4 === 0
        ? d.toLocaleDateString('en-US', { month: 'short' }) + " '" + String(d.getFullYear()).slice(2)
        : ""
      return { x: i, base, opt, label }
    })
    return [
      { name: th ? "เป้าหมาย" : "Target",      color: "var(--ink-4)", dashed: true,
        data: points.map(p => ({ x: p.x, y: selected.target || 0, label: p.label })) },
      { name: th ? "ออมเดือนละ + 6%" : "+ 6% p.a.", color: "var(--accent)", fill: true,
        data: points.map(p => ({ x: p.x, y: p.opt, label: p.label })) },
      { name: th ? "ออมเฉย ๆ" : "Cash only",    color: "var(--ink-3)",
        data: points.map(p => ({ x: p.x, y: p.base, label: p.label })) },
    ]
  }, [selected?.id, selected?.current, selected?.monthly_contribution, selected?.target, th])

  // ── Loading state ────────────────────────────────────────────────────────────
  if (goals === null) {
    return (
      <div className="shell fade-in">
        <PageHead title={t.planning.heading} sub={t.planning.sub} />
        <div style={{ padding: 48, textAlign: "center", color: "var(--ink-3)", fontSize: 14 }}>
          {th ? "กำลังโหลด…" : "Loading…"}
        </div>
      </div>
    )
  }

  // ── Empty state (live users only) ────────────────────────────────────────────
  if (isLive && displayGoals.length === 0) {
    return (
      <div className="shell fade-in">
        <PageHead title={t.planning.heading} sub={t.planning.sub} right={
          <button className="btn btn-sm" onClick={() => setShowAdd(true)}>
            <Icon name="plus" size={14} /> {t.planning.add}
          </button>
        } />
        <div className="card empty">
          <h2 className="display" style={{ fontSize: 28, margin: 0 }}>
            {th ? "ยังไม่มีเป้าหมาย" : "No goals yet"}
          </h2>
          <p style={{ marginTop: 8 }}>
            {th
              ? "ตั้งเป้าหมายทางการเงิน เช่น บ้าน เกษียณ หรือฉุกเฉิน"
              : "Set financial goals like home, retirement, or emergency fund"}
          </p>
          <button className="btn" style={{ marginTop: 20 }} onClick={() => setShowAdd(true)}>
            <Icon name="plus" size={14} /> {th ? "เพิ่มเป้าหมายแรก" : "Add your first goal"}
          </button>
        </div>
        {showAdd && (
          <GoalModal lang={lang} userId={session.user.id} ccy={ccy}
            onClose={() => setShowAdd(false)}
            onSaved={async () => { setShowAdd(false); await refreshGoals() }} />
        )}
      </div>
    )
  }

  // ── Main page ────────────────────────────────────────────────────────────────
  return (
    <div className="shell fade-in" data-screen-label="Planning">
      <PageHead
        kicker={th ? "วางแผน" : "Planning"}
        title={t.planning.heading}
        sub={t.planning.sub}
        right={isLive ? (
          <button className="btn btn-sm" onClick={() => setShowAdd(true)}>
            <Icon name="plus" size={14} /> {t.planning.add}
          </button>
        ) : null}
      />

      {/* Summary strip */}
      <section className="card" style={{ padding: "28px 32px", marginBottom: 24 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr", gap: 32, alignItems: "center" }}>
          <div>
            <div className="label-up" style={{ marginBottom: 8 }}>
              {th ? "เงินที่จัดสรรไว้สำหรับเป้าหมาย" : "Allocated to goals"}
              {isLive && portfolioValue > 0 && (
                <span style={{ marginLeft: 8, color: "var(--gain)", fontWeight: 700 }}>● LIVE</span>
              )}
            </div>
            <div className="display" style={{ fontSize: 36, lineHeight: 1 }}>
              {FMT.money(goalsTotal, ccy, { compact: true })}
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
              <span className="mono">
                {targetTotal > 0 ? ((goalsTotal / targetTotal) * 100).toFixed(1) : 0}%
              </span>{" "}
              {th ? "ของเป้ารวม" : "of total target"}
            </div>
          </div>
          <Kpi
            label={th ? "เป้าหมายรวม" : "Total target"}
            value={FMT.money(targetTotal, ccy, { compact: true })}
            sub={`${displayGoals.length} ${th ? "เป้าหมาย" : "goals"}`}
          />
          <Kpi
            label={th ? "ออมต่อเดือน" : "Monthly savings"}
            value={FMT.money(monthlyTotal, ccy, { compact: true })}
            sub={th ? "รวมทุกเป้าหมาย" : "across all goals"}
          />
          <Kpi
            label={th ? "ครบเป้าแล้ว" : "Completed"}
            value={`${onTrack}/${displayGoals.length}`}
            sub={th ? "เป้าหมาย" : "goals on track"}
          />
        </div>
      </section>

      {selected && (
        <div className="grid grid-12" style={{ gap: 16 }}>
          {/* Goals rail */}
          <aside className="col-span-4" style={{ display: "grid", gap: 12, alignContent: "start" }}>
            {displayGoals.map(g => {
              const pct = Math.min(100, ((g.current || 0) / (g.target || 1)) * 100)
              const sel = g.id === selectedId
              return (
                <button key={g.id} onClick={() => setSelectedId(g.id)}
                  style={{
                    textAlign: "left", width: "100%", padding: 20, borderRadius: 14,
                    background: sel ? "var(--ink)" : "var(--card)",
                    color: sel ? "var(--bg)" : "var(--ink)",
                    border: "1px solid " + (sel ? "var(--ink)" : "var(--line)"),
                    transition: "background 0.15s, color 0.15s", cursor: "pointer",
                  }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <div style={{
                      width: 40, height: 40, borderRadius: 10,
                      background: sel ? "rgba(255,255,255,0.1)" : "var(--bg-2)",
                      color: sel ? "var(--bg)" : "var(--ink-2)",
                      display: "grid", placeItems: "center",
                    }}>
                      <Icon name={g.icon || 'target'} size={18} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 500, fontSize: 14 }}>{g.name}</div>
                      <div style={{ fontSize: 11, opacity: sel ? 0.7 : 1, color: sel ? "" : "var(--ink-3)", marginTop: 2 }}>
                        {pct >= 100
                          ? (th ? "ครบแล้ว ✓" : "Complete ✓")
                          : (g.eta_year || "—")}
                      </div>
                    </div>
                    <div style={{ fontFamily: "var(--font-display)", fontSize: 22, letterSpacing: "-0.02em" }}>
                      {Math.round(pct)}%
                    </div>
                  </div>
                  <div style={{
                    marginTop: 14, height: 4, borderRadius: 999,
                    background: sel ? "rgba(255,255,255,0.18)" : "var(--bg-2)", overflow: "hidden",
                  }}>
                    <div style={{
                      height: "100%", width: pct + "%",
                      background: sel ? "var(--bg)" : (g.color || "var(--accent)"),
                      borderRadius: 999, transition: "width 0.6s",
                    }} />
                  </div>
                  <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", fontSize: 11, opacity: sel ? 0.7 : 1, color: sel ? "" : "var(--ink-3)" }}>
                    <span className="mono">{FMT.money(g.current || 0, ccy, { compact: true })}</span>
                    <span className="mono">{FMT.money(g.target || 0, ccy, { compact: true })}</span>
                  </div>
                </button>
              )
            })}
          </aside>

          {/* Goal detail */}
          <main className="col-span-8" style={{ display: "grid", gap: 16 }}>
            {/* Goal header card */}
            <div className="card">
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
                <div>
                  <div className="label-up" style={{ marginBottom: 8 }}>
                    {th ? "เป้าหมาย" : "Goal"}{selected.eta_year ? ` · ${selected.eta_year}` : ""}
                  </div>
                  <h2 className="h2" style={{ margin: 0, fontSize: 38 }}>{selected.name}</h2>
                </div>
                <GoalRing
                  pct={Math.min(100, ((selected.current || 0) / (selected.target || 1)) * 100)}
                  color="var(--ink)" size={96} stroke={8}
                />
              </div>

              <div className="grid grid-3" style={{ gap: 16, marginTop: 12 }}>
                <Stat label={t.planning.target} value={FMT.money(selected.target || 0, ccy, { compact: true })} />
                <Stat label={t.planning.now}    value={FMT.money(selected.current || 0, ccy, { compact: true })} accent />
                <Stat
                  label={t.planning.monthly}
                  value={(selected.monthly_contribution || 0) > 0
                    ? FMT.money(selected.monthly_contribution, ccy, { compact: true })
                    : "—"}
                  sub={(selected.monthly_contribution || 0) > 0
                    ? (th ? "ออมอัตโนมัติ" : "auto-invested")
                    : ""}
                />
              </div>

              {isLive && (
                <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
                  <button className="btn" onClick={() => setShowEdit(selected)}>
                    <Icon name="edit" size={14} /> {th ? "แก้ไข" : "Edit goal"}
                  </button>
                  <button
                    className="btn btn-ghost"
                    style={{ color: "var(--loss)" }}
                    onClick={async () => {
                      if (!window.confirm(th ? "ลบเป้าหมายนี้?" : "Delete this goal?")) return
                      await deleteGoal(selected.id)
                      const rest = displayGoals.filter(g => g.id !== selected.id)
                      setSelectedId(rest[0]?.id || null)
                      await refreshGoals()
                    }}
                  >
                    {th ? "ลบ" : "Delete"}
                  </button>
                </div>
              )}
            </div>

            {/* Projection chart */}
            <div className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <h3 className="section-title">{th ? "การคาดการณ์ 24 เดือนข้างหน้า" : "24-month projection"}</h3>
                <div style={{ display: "flex", gap: 12, fontSize: 12, alignItems: "center" }}>
                  <span><span className="dot" style={{ background: "var(--accent)" }} /> {th ? "ลงทุน +6%" : "Invested"}</span>
                  <span><span className="dot" style={{ background: "var(--ink-3)" }} /> {th ? "เงินสด" : "Cash only"}</span>
                  <span><span className="dot" style={{ background: "var(--ink-4)" }} /> {th ? "เป้า" : "Target"}</span>
                </div>
              </div>
              <LineChart series={series} height={260} fmt={v => FMT.money(v, ccy, { compact: true })} />
            </div>

            {/* Suggested actions */}
            <div className="card">
              <h3 className="section-title" style={{ marginBottom: 16 }}>
                {th ? "ข้อแนะนำเพื่อให้ถึงเป้าเร็วขึ้น" : "Suggested actions"}
              </h3>
              <div style={{ display: "grid", gap: 10 }}>
                {suggestedActions(selected, th).map((s, i) => (
                  <div key={i} style={{
                    display: "flex", alignItems: "flex-start", gap: 14,
                    padding: "12px 16px", background: "var(--bg)", borderRadius: 10,
                  }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: 8, background: "var(--accent-soft)",
                      color: "var(--accent-ink)", display: "grid", placeItems: "center", flexShrink: 0,
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
      )}

      {/* Modals */}
      {showAdd && isLive && (
        <GoalModal lang={lang} userId={session.user.id} ccy={ccy}
          onClose={() => setShowAdd(false)}
          onSaved={async () => { setShowAdd(false); await refreshGoals() }} />
      )}
      {showEdit && isLive && (
        <GoalModal lang={lang} userId={session.user.id} ccy={ccy}
          goal={showEdit}
          onClose={() => setShowEdit(null)}
          onSaved={async () => { setShowEdit(null); await refreshGoals() }} />
      )}
    </div>
  )
}

// ─── Goal Modal (Add / Edit) ──────────────────────────────────────────────────
function GoalModal({ lang, userId, ccy, goal, onClose, onSaved }) {
  const th = lang === "th"
  const isEdit = !!goal
  const [form, setForm] = useState({
    name:                 goal?.name || '',
    icon:                 goal?.icon || 'target',
    color:                goal?.color || 'var(--accent)',
    target:               String(goal?.target ?? ''),
    current:              String(goal?.current ?? ''),
    monthly_contribution: String(goal?.monthly_contribution ?? ''),
    eta_year:             goal?.eta_year || '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const payload = {
      ...(isEdit ? { id: goal.id } : {}),
      name:                 form.name.trim(),
      icon:                 form.icon,
      color:                form.color,
      target:               parseFloat(form.target) || 0,
      current:              parseFloat(form.current) || 0,
      monthly_contribution: parseFloat(form.monthly_contribution) || 0,
      eta_year:             form.eta_year.trim() || null,
      updated_at:           new Date().toISOString(),
    }
    const { error } = await upsertGoal(userId, payload)
    setSaving(false)
    if (error) { setError(error.message); return }
    onSaved()
  }

  const iStyle = {
    padding: "10px 12px", borderRadius: 8, fontSize: 14,
    border: "1.5px solid var(--line)", background: "var(--bg)",
    color: "var(--ink)", outline: "none", width: "100%", boxSizing: "border-box",
  }

  const COLORS = [
    { v: "var(--c1)", hex: "#6EC6A0" },
    { v: "var(--c2)", hex: "#7B9FE0" },
    { v: "var(--c3)", hex: "#F2C45A" },
    { v: "var(--c4)", hex: "#E07B7B" },
    { v: "var(--c5)", hex: "#A97BE0" },
    { v: "var(--accent)", hex: "#52BF9A" },
  ]

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 1000,
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: "var(--bg)", borderRadius: "20px 20px 0 0", padding: "32px 28px 40px",
        width: "100%", maxWidth: 540, boxShadow: "0 -8px 40px rgba(0,0,0,0.12)",
        maxHeight: "90vh", overflowY: "auto", animation: "slideUp 0.2s ease",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <h3 style={{ margin: 0, fontSize: 20, fontFamily: "var(--font-display)" }}>
            {isEdit ? (th ? "แก้ไขเป้าหมาย" : "Edit Goal") : (th ? "เพิ่มเป้าหมาย" : "Add Goal")}
          </h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "var(--ink-3)", lineHeight: 1 }}>×</button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {error && (
            <div style={{ padding: "10px 14px", borderRadius: 8, background: "oklch(0.96 0.05 25)", color: "oklch(0.40 0.12 25)", fontSize: 13 }}>
              {error}
            </div>
          )}

          {/* Name */}
          <GField label={th ? "ชื่อเป้าหมาย" : "Goal name"}>
            <input required value={form.name} onChange={e => set('name', e.target.value)}
              placeholder={th ? "เช่น เงินดาวน์บ้าน" : "e.g. House down payment"} style={iStyle} />
          </GField>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {/* Icon */}
            <GField label={th ? "ไอคอน" : "Icon"}>
              <select value={form.icon} onChange={e => set('icon', e.target.value)} style={iStyle}>
                {[
                  ['target',    th ? '🎯 อื่น ๆ'       : '🎯 Other'],
                  ['home',      th ? '🏠 บ้าน'          : '🏠 Home'],
                  ['leaf',      th ? '🌿 เกษียณ'        : '🌿 Retirement'],
                  ['education', th ? '🎓 การศึกษา'      : '🎓 Education'],
                  ['shield',    th ? '🛡️ ฉุกเฉิน'      : '🛡️ Emergency'],
                  ['spark',     th ? '✨ ลงทุน'         : '✨ Investment'],
                  ['car',       th ? '🚗 รถยนต์'        : '🚗 Vehicle'],
                  ['vacation',  th ? '✈️ ท่องเที่ยว'   : '✈️ Travel'],
                ].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </GField>
            {/* ETA */}
            <GField label={th ? "ปีเป้าหมาย" : "Target year"}>
              <input value={form.eta_year} onChange={e => set('eta_year', e.target.value)}
                placeholder="2028" style={iStyle} />
            </GField>
          </div>

          {/* Color swatches */}
          <GField label={th ? "สี" : "Color"}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {COLORS.map(({ v, hex }) => (
                <button key={v} type="button"
                  onClick={() => set('color', v)}
                  style={{
                    width: 28, height: 28, borderRadius: 999,
                    background: hex, border: form.color === v ? "3px solid var(--ink)" : "3px solid transparent",
                    cursor: "pointer", transition: "border 0.1s",
                  }} />
              ))}
            </div>
          </GField>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <GField label={`${th ? "เป้าหมาย" : "Target"} (${ccy})`}>
              <input required type="number" step="any" min="0" value={form.target}
                onChange={e => set('target', e.target.value)} placeholder="0" style={iStyle} />
            </GField>
            <GField label={`${th ? "ออมแล้ว" : "Saved so far"} (${ccy})`}>
              <input type="number" step="any" min="0" value={form.current}
                onChange={e => set('current', e.target.value)} placeholder="0" style={iStyle} />
            </GField>
          </div>

          <GField label={`${th ? "ออมต่อเดือน" : "Monthly contribution"} (${ccy})`}>
            <input type="number" step="any" min="0" value={form.monthly_contribution}
              onChange={e => set('monthly_contribution', e.target.value)}
              placeholder="0" style={{ ...iStyle, maxWidth: 200 }} />
          </GField>

          <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
            <button type="button" className="btn btn-outline" style={{ flex: 1 }} onClick={onClose}>
              {th ? "ยกเลิก" : "Cancel"}
            </button>
            <button type="submit" className="btn" style={{ flex: 2 }} disabled={saving}>
              {saving
                ? (th ? "กำลังบันทึก…" : "Saving…")
                : isEdit
                  ? (th ? "บันทึกการเปลี่ยนแปลง" : "Save changes")
                  : (th ? "เพิ่มเป้าหมาย" : "Add goal")}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Small helpers ────────────────────────────────────────────────────────────
function GField({ label, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <label style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-2)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
        {label}
      </label>
      {children}
    </div>
  )
}

function Kpi({ label, value, sub }) {
  return (
    <div>
      <div className="label-up" style={{ marginBottom: 6 }}>{label}</div>
      <div className="display" style={{ fontSize: 22, lineHeight: 1 }}>{value}</div>
      <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{sub}</div>
    </div>
  )
}

function Stat({ label, value, sub, accent }) {
  return (
    <div style={{ padding: 16, background: "var(--bg)", borderRadius: 10 }}>
      <div className="label-up" style={{ marginBottom: 6 }}>{label}</div>
      <div className="display" style={{ fontSize: 26, lineHeight: 1, color: accent ? "var(--accent-ink)" : "var(--ink)" }}>
        {value}
      </div>
      {sub ? <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{sub}</div> : null}
    </div>
  )
}

function suggestedActions(g, th) {
  const pct     = (g.target || 1) > 0 ? ((g.current || 0) / (g.target || 1)) * 100 : 0
  const monthly = g.monthly_contribution || 0
  const out     = []

  if (pct >= 100) {
    out.push({
      icon: "shield",
      title: th ? "ย้ายเงินส่วนเกินไป T-bills 90 วัน" : "Move surplus to 90-day T-bills",
      body:  th ? "ดอกเบี้ยสูงกว่า HYSA ~1.4% สำหรับสภาพคล่องที่ใกล้เคียงกัน" : "Picks up ~1.4% more vs. HYSA with similar liquidity",
      cta:   th ? "ดูทางเลือก" : "Review",
    })
    return out
  }

  if (monthly > 0) {
    const bump = Math.max(1000, Math.round(monthly * 0.25 / 1000) * 1000)
    out.push({
      icon: "plus",
      title: th
        ? `เพิ่มออมเดือนละ ${(bump / 1000).toFixed(0)}K จะถึงเป้าเร็วขึ้น ~5 เดือน`
        : `Adding ${(bump / 1000).toFixed(0)}K/mo gets you there ~5 months sooner`,
      body:  th ? "เริ่มเดือนหน้าได้ทันที — เพิ่มรอบหักบัญชีอัตโนมัติ" : "Effective next cycle; adjust auto-transfer now",
      cta:   th ? "เพิ่มออม" : "Adjust",
    })
  }

  out.push({
    icon: "spark",
    title: th ? "ลองโยกพอร์ตเข้า diversified ETF (เช่น VWRA)" : "Consider a diversified ETF (e.g. VWRA)",
    body:  th ? "เพิ่มผลตอบแทนคาดหวัง ~1.2% ต่อปี โดยความผันผวนใกล้เคียง" : "Adds ~1.2%/yr expected return at similar volatility",
    cta:   th ? "ดูแบบจำลอง" : "Model it",
  })
  return out
}
