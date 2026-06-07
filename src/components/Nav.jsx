import { useState, useEffect, useRef } from 'react'

export function Brand() {
  return (
    <div className="brand">
      <LumenMark />
      <span>Lumen</span>
    </div>
  )
}

// Shared stock logo with an ordered fallback chain:
//   custom logoUrl → TradingView resolver (US + Thai) → parqet (non-Thai) → initials.
// Each failed source advances to the next; when exhausted we draw coloured initials.
export function TickerLogo({ ticker = "", logoUrl, region, cls, size = 34 }) {
  // GoldTH — gold bar / ingot icon
  if (cls === 'GoldTH') {
    return (
      <svg width={size} height={size} viewBox="0 0 40 40" style={{ flexShrink: 0, display: 'block' }}>
        <defs>
          <linearGradient id="bar-face" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%"   stopColor="oklch(0.92 0.18 90)" />
            <stop offset="45%"  stopColor="oklch(0.82 0.18 84)" />
            <stop offset="100%" stopColor="oklch(0.68 0.14 78)" />
          </linearGradient>
          <linearGradient id="bar-top" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%"   stopColor="oklch(0.96 0.16 92)" />
            <stop offset="100%" stopColor="oklch(0.88 0.17 88)" />
          </linearGradient>
          <linearGradient id="bar-side" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%"   stopColor="oklch(0.60 0.12 76)" />
            <stop offset="100%" stopColor="oklch(0.52 0.10 74)" />
          </linearGradient>
        </defs>
        {/* front face */}
        <rect x="4" y="16" width="28" height="17" rx="2" fill="url(#bar-face)" />
        {/* top face (trapezoid perspective) */}
        <polygon points="4,16 32,16 36,10 8,10" fill="url(#bar-top)" />
        {/* right side face */}
        <polygon points="32,16 36,10 36,27 32,33" fill="url(#bar-side)" />
        {/* engraved inner rect on front */}
        <rect x="7" y="19" width="22" height="11" rx="1.5"
              fill="none" stroke="oklch(0.62 0.13 77)" strokeWidth="0.9" opacity="0.7" />
        {/* "Au" label */}
        <text x="18" y="27.5" textAnchor="middle" fontSize="7.5" fontWeight="800"
              fill="oklch(0.50 0.11 75)" fontFamily="Georgia,serif" letterSpacing="0.3">Au</text>
      </svg>
    )
  }

  const base = String(ticker).replace(/\.BK$/i, "").toUpperCase()
  const isThai = region === "TH"
  const isCrypto = cls === "Crypto"
  // For crypto tickers like BTC-USD, strip the quote currency to get the base coin
  const cryptoBase = isCrypto ? base.replace(/[-/](USD|USDT|USDC|BTC|ETH|BNB)$/i, "").toLowerCase() : ""
  const candidates = []
  if (logoUrl) candidates.push(logoUrl)
  if (isCrypto && cryptoBase) {
    // Open-source crypto icons (spothq) — covers BTC, ETH, and hundreds of others
    candidates.push(`https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/${cryptoBase}.png`)
    // LiveCoinWatch CDN as second fallback
    candidates.push(`https://lcw.nyc3.cdn.digitaloceanspaces.com/production/currencies/64/${cryptoBase}.png`)
  } else {
    if (base) candidates.push(`/api/logo?ticker=${encodeURIComponent(base)}&region=${isThai ? "TH" : "US"}`)
    if (!isThai && base) candidates.push(`https://assets.parqet.com/logos/symbol/${encodeURIComponent(base)}?format=png&size=64`)
  }

  const key = candidates.join("|")
  const [idx, setIdx] = useState(0)
  useEffect(() => { setIdx(0) }, [key])   // restart the chain when the symbol changes

  const initials = (base || "?").slice(0, 2)
  const bg = { Equity: "var(--bg-2)", ETF: "oklch(0.94 0.04 200)", Bond: "oklch(0.94 0.04 280)", Crypto: "oklch(0.94 0.05 65)", Commodity: "oklch(0.94 0.04 90)" }[cls] || "var(--bg-2)"
  const fg = { Equity: "var(--ink-2)", ETF: "var(--c1)", Bond: "var(--c4)", Crypto: "var(--c2)", Commodity: "var(--c7)" }[cls] || "var(--ink-2)"

  const src = candidates[idx]
  if (!src) {
    return <div className="ticker-mark" style={{ width: size, height: size, background: bg, color: fg }}>{initials}</div>
  }
  return (
    <img src={src} alt={base} width={size} height={size} loading="lazy" onError={() => setIdx(i => i + 1)}
         className="ticker-logo" style={{ width: size, height: size }} />
  )
}

// Lumen logo — a rising chart line ending in a glowing "lumen" spark.
// Uses theme variables so it adapts to light/dark + the chosen accent.
export function LumenMark({ size = 30 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" aria-hidden="true">
      <rect x="2" y="2" width="26" height="26" rx="8" fill="var(--ink)" />
      <polyline points="7,21 12,16 16,18 22,9" fill="none" stroke="var(--bg)"
                strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="22" cy="9" r="4.6" fill="none" stroke="var(--accent)" strokeWidth="1.4" opacity="0.5" />
      <circle cx="22" cy="9" r="2.4" fill="var(--accent)" />
    </svg>
  )
}

export function TopNav({ route, setRoute, lang, setLang, ccy, setCcy, t, session, signOut, displayName = '', setDisplayName,
                         portfolios = [], activePortfolio, onSwitchPortfolio, onCreatePortfolio, onRenamePortfolio, onDeletePortfolio,
                         alertCount = 0, onOpenAlerts }) {
  const th = lang === "th"
  const [showProfile, setShowProfile] = useState(false)
  const menuRef = useRef(null)
  // Portfolio switcher
  const [showPfMenu, setShowPfMenu] = useState(false)
  const [showNewPf, setShowNewPf] = useState(false)
  const [showManagePf, setShowManagePf] = useState(false)
  const pfMenuRef = useRef(null)

  useEffect(() => {
    if (!showProfile) return
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setShowProfile(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showProfile])

  useEffect(() => {
    if (!showPfMenu) return
    const handler = (e) => {
      if (pfMenuRef.current && !pfMenuRef.current.contains(e.target)) setShowPfMenu(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showPfMenu])

  const items = [
    { id: "dashboard", label: t.nav.dashboard },
    { id: "portfolio", label: t.nav.portfolio },
    { id: "analytics", label: t.nav.analytics },
    { id: "tools",     label: t.nav.tools },
    { id: "planning",  label: t.nav.planning },
    { id: "watchlist", label: t.nav.watchlist || "Watchlist" },
  ]
  const email    = session?.user?.email || ""
  const initials = email ? email.slice(0, 2).toUpperCase() : "ME"
  const name     = email ? email.split('@')[0] : (lang === "th" ? "ผู้ใช้งาน" : "User")

  return (
    <>
    <header className="topnav">
      <div className="topnav-inner">
        <button onClick={() => setRoute("dashboard")} style={{ display: "contents" }}>
          <Brand />
        </button>
        <nav className="nav-links" aria-label="Primary">
          {items.map(it => (
            <button
              key={it.id}
              className={"nav-link" + (route === it.id ? " active" : "")}
              onClick={() => setRoute(it.id)}
            >
              {it.label}
            </button>
          ))}
        </nav>
        <div className="nav-spacer" />
        <div className="nav-tools">
          {/* Portfolio switcher */}
          {portfolios.length > 0 && activePortfolio && (
            <div ref={pfMenuRef} style={{ position: "relative" }}>
              <button onClick={() => setShowPfMenu(s => !s)}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "6px 10px 6px 12px", borderRadius: 999,
                  border: "1px solid var(--line)", background: "var(--bg)",
                  color: "var(--ink)", cursor: "pointer", fontSize: 13, fontWeight: 500,
                  maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }} title={activePortfolio.name}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: "var(--accent)", flexShrink: 0 }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{activePortfolio.name}</span>
                <Icon name="down" size={11} />
              </button>
              {showPfMenu && (
                <div style={{
                  position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 50,
                  minWidth: 220, background: "var(--bg)", border: "1px solid var(--line)",
                  borderRadius: 12, boxShadow: "0 12px 32px rgba(0,0,0,0.12)", padding: 6,
                }}>
                  {portfolios.map(p => {
                    const on = p.id === activePortfolio.id
                    return (
                      <button key={p.id}
                        onClick={() => { onSwitchPortfolio?.(p); setShowPfMenu(false) }}
                        style={{
                          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                          width: "100%", padding: "8px 10px", borderRadius: 8, fontSize: 13,
                          border: "none", background: on ? "var(--accent-soft)" : "transparent",
                          color: on ? "var(--accent-ink)" : "var(--ink)", cursor: "pointer", textAlign: "left",
                        }}>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                        {on && <Icon name="check" size={13} />}
                      </button>
                    )
                  })}
                  <div style={{ height: 1, background: "var(--line)", margin: "6px 4px" }} />
                  <button onClick={() => { setShowPfMenu(false); setShowNewPf(true) }}
                    style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 10px", borderRadius: 8, fontSize: 13, border: "none", background: "transparent", color: "var(--ink)", cursor: "pointer", textAlign: "left" }}>
                    <Icon name="plus" size={13} /> {th ? "สร้างพอร์ตใหม่" : "New portfolio"}
                  </button>
                  <button onClick={() => { setShowPfMenu(false); setShowManagePf(true) }}
                    style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 10px", borderRadius: 8, fontSize: 13, border: "none", background: "transparent", color: "var(--ink-2)", cursor: "pointer", textAlign: "left" }}>
                    <Icon name="edit" size={13} /> {th ? "จัดการพอร์ต…" : "Manage portfolios…"}
                  </button>
                </div>
              )}
            </div>
          )}
          <div className="pill-toggle" role="group" aria-label="Currency">
            <button className={ccy === "THB" ? "on" : ""} onClick={() => setCcy("THB")}>฿ THB</button>
            <button className={ccy === "USD" ? "on" : ""} onClick={() => setCcy("USD")}>$ USD</button>
          </div>
          <div className="pill-toggle" role="group" aria-label="Language">
            <button className={lang === "th" ? "on" : ""} onClick={() => setLang("th")}>ไทย</button>
            <button className={lang === "en" ? "on" : ""} onClick={() => setLang("en")}>EN</button>
          </div>

          {/* Price Alert bell */}
          {session && onOpenAlerts && (
            <button onClick={onOpenAlerts}
              title={lang === "th" ? "การแจ้งเตือนราคา" : "Price Alerts"}
              style={{
                position: "relative", background: "none", border: "none", cursor: "pointer",
                color: alertCount > 0 ? "var(--accent-ink)" : "var(--ink-3)",
                padding: "6px 8px", borderRadius: 8, lineHeight: 0,
                display: "inline-flex", alignItems: "center",
              }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
              </svg>
              {alertCount > 0 && (
                <span style={{
                  position: "absolute", top: 3, right: 3,
                  minWidth: 14, height: 14, borderRadius: 99,
                  background: "var(--loss)", color: "#fff",
                  fontSize: 9, fontWeight: 800, lineHeight: "14px",
                  textAlign: "center", padding: "0 3px",
                  boxSizing: "border-box",
                }}>
                  {alertCount > 9 ? '9+' : alertCount}
                </span>
              )}
            </button>
          )}

          {/* Avatar + Profile dropdown */}
          <div ref={menuRef} style={{ position: "relative" }}>
            <button
              className="avatar"
              title={email}
              onClick={() => setShowProfile(v => !v)}
              style={{ cursor: "pointer" }}
            >
              {initials}
            </button>

            {showProfile && (
              <div style={{
                position: "absolute", top: "calc(100% + 10px)", right: 0,
                background: "var(--bg)", border: "1px solid var(--line)",
                borderRadius: 14, minWidth: 256,
                boxShadow: "0 8px 32px rgba(0,0,0,0.14)",
                zIndex: 300, overflow: "hidden",
                animation: "slideUp 0.15s ease",
              }}>
                {/* Profile header */}
                <div style={{ padding: "16px 18px 14px", borderBottom: "1px solid var(--line)", display: "flex", gap: 14, alignItems: "center" }}>
                  <div className="avatar" style={{ width: 44, height: 44, fontSize: 17, flexShrink: 0 }}>{initials}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
                    <div style={{ fontSize: 12, color: "var(--ink-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>{email}</div>
                  </div>
                </div>

                {/* Display name editor */}
                <div style={{ padding: "12px 18px 10px", borderBottom: "1px solid var(--line)" }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-3)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>
                    {lang === "th" ? "ชื่อแสดง" : "Display name"}
                  </div>
                  <input
                    value={displayName}
                    onChange={e => setDisplayName && setDisplayName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()}
                    placeholder={lang === "th" ? "ชื่อของคุณ" : "Your name"}
                    style={{
                      width: "100%", padding: "7px 10px", borderRadius: 8, fontSize: 13,
                      border: "1.5px solid var(--line)", background: "var(--bg-2)", color: "var(--ink)",
                      outline: "none", fontFamily: "inherit", boxSizing: "border-box",
                    }}
                  />
                </div>

                {/* Menu items */}
                <div style={{ padding: "6px 0" }}>
                  <MenuRow icon="currency" label={lang === "th" ? "สกุลเงิน" : "Currency"}>
                    <div className="pill-toggle" style={{ transform: "scale(0.9)", transformOrigin: "right" }}>
                      <button className={ccy === "THB" ? "on" : ""} onClick={() => setCcy("THB")}>฿ THB</button>
                      <button className={ccy === "USD" ? "on" : ""} onClick={() => setCcy("USD")}>$ USD</button>
                    </div>
                  </MenuRow>
                  <MenuRow icon="lang" label={lang === "th" ? "ภาษา" : "Language"}>
                    <div className="pill-toggle" style={{ transform: "scale(0.9)", transformOrigin: "right" }}>
                      <button className={lang === "th" ? "on" : ""} onClick={() => setLang("th")}>ไทย</button>
                      <button className={lang === "en" ? "on" : ""} onClick={() => setLang("en")}>EN</button>
                    </div>
                  </MenuRow>
                </div>

                {session && (
                  <div style={{ borderTop: "1px solid var(--line)", padding: "6px 0" }}>
                    <button
                      onClick={() => { setShowProfile(false); signOut() }}
                      style={{
                        width: "100%", textAlign: "left", padding: "11px 18px",
                        background: "none", border: "none", cursor: "pointer",
                        fontSize: 14, color: "oklch(0.45 0.12 25)",
                        display: "flex", alignItems: "center", gap: 10,
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = "oklch(0.97 0.02 25)"}
                      onMouseLeave={e => e.currentTarget.style.background = "none"}
                    >
                      <Icon name="logout" size={15} />
                      {lang === "th" ? "ออกจากระบบ" : "Sign out"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
    {/* Portfolio modals rendered as siblings of <header> so position:fixed
        anchors to the viewport, not to a header containing-block ancestor. */}
    {showNewPf && (
      <NewPortfolioModal th={th} onClose={() => setShowNewPf(false)}
        onCreate={async (name) => { await onCreatePortfolio?.(name); setShowNewPf(false) }} />
    )}
    {showManagePf && (
      <ManagePortfoliosModal th={th} portfolios={portfolios} activeId={activePortfolio?.id}
        onClose={() => setShowManagePf(false)}
        onRename={onRenamePortfolio} onDelete={onDeletePortfolio} />
    )}
    </>
  )
}

function NewPortfolioModal({ th, onClose, onCreate }) {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={e => e.target === e.currentTarget && !saving && onClose()}>
      <div style={{ background: "var(--bg)", borderRadius: 18, padding: 28, width: "100%", maxWidth: 420, boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{th ? "สร้างพอร์ตใหม่" : "New portfolio"}</h3>
        <p className="muted" style={{ margin: "4px 0 16px", fontSize: 12 }}>
          {th ? "พอร์ตใหม่จะเริ่มต้นว่าง — ไม่มีหุ้น/เงินสด/ธุรกรรม" : "Starts empty — no holdings, cash, or transactions"}
        </p>
        <input autoFocus value={name} onChange={e => setName(e.target.value)}
          placeholder={th ? "เช่น เกษียณ, เทรดสั้น, ลูก" : "e.g. Retirement, Speculation, Kids"}
          style={{ width: "100%", padding: "10px 12px", borderRadius: 8, fontSize: 14, border: "1.5px solid var(--line)", background: "var(--bg)", color: "var(--ink)", outline: "none", boxSizing: "border-box" }} />
        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          <button className="btn btn-outline" style={{ flex: 1 }} onClick={onClose} disabled={saving}>{th ? "ยกเลิก" : "Cancel"}</button>
          <button className="btn" style={{ flex: 1 }} disabled={saving || !name.trim()}
            onClick={async () => { setSaving(true); await onCreate(name.trim()); setSaving(false) }}>
            {saving ? (th ? "กำลังสร้าง…" : "Creating…") : (th ? "สร้าง" : "Create")}
          </button>
        </div>
      </div>
    </div>
  )
}

function ManagePortfoliosModal({ th, portfolios, activeId, onClose, onRename, onDelete }) {
  const [rows, setRows] = useState(() => portfolios.map(p => ({ id: p.id, name: p.name, original: p.name })))
  const [busy, setBusy] = useState(false)
  const handleDelete = async (id) => {
    if (portfolios.length <= 1) { alert(th ? "ต้องมีอย่างน้อย 1 พอร์ต" : "Must keep at least one portfolio"); return }
    const p = portfolios.find(x => x.id === id)
    const confirmText = th
      ? `ลบ "${p?.name}"? ข้อมูลในพอร์ตนี้ (หุ้น / ธุรกรรม / เงินสด / เป้าหมาย) จะถูกลบทั้งหมด — กู้คืนไม่ได้`
      : `Delete "${p?.name}"? Everything in this portfolio (holdings / transactions / cash / goals) will be removed — this can't be undone.`
    if (!window.confirm(confirmText)) return
    setBusy(true)
    await onDelete?.(id)
    setRows(rs => rs.filter(r => r.id !== id))
    setBusy(false)
  }
  const handleSave = async () => {
    setBusy(true)
    for (const r of rows) {
      const trimmed = r.name.trim()
      if (trimmed && trimmed !== r.original) await onRename?.(r.id, trimmed)
    }
    setBusy(false)
    onClose()
  }
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={e => e.target === e.currentTarget && !busy && onClose()}>
      <div style={{ background: "var(--bg)", borderRadius: 18, padding: 28, width: "100%", maxWidth: 480, maxHeight: "85vh", display: "flex", flexDirection: "column", gap: 14, boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{th ? "จัดการพอร์ต" : "Manage portfolios"}</h3>
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>{th ? "เปลี่ยนชื่อ หรือลบพอร์ต — ต้องเหลืออย่างน้อย 1 พอร์ตเสมอ" : "Rename or delete portfolios — at least one must remain."}</p>
        <div style={{ overflow: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
          {rows.map(r => (
            <div key={r.id} style={{ display: "grid", gridTemplateColumns: "1fr 90px 28px", gap: 10, alignItems: "center", padding: "8px 10px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--bg-2)" }}>
              <input value={r.name} onChange={e => setRows(rs => rs.map(x => x.id === r.id ? { ...x, name: e.target.value } : x))}
                style={{ width: "100%", padding: "6px 10px", fontSize: 13, border: "1px solid var(--line)", borderRadius: 8, background: "var(--bg)", color: "var(--ink)", outline: "none", boxSizing: "border-box" }} />
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                {r.id === activeId && <span className="chip" style={{ fontSize: 10 }}>{th ? "ใช้งานอยู่" : "Active"}</span>}
              </div>
              <button onClick={() => handleDelete(r.id)} disabled={busy || rows.length <= 1}
                style={{ background: "none", border: "none", cursor: rows.length <= 1 ? "not-allowed" : "pointer", color: "var(--loss)", padding: "4px 6px", borderRadius: 6, opacity: rows.length <= 1 ? 0.3 : 1, justifySelf: "end" }}
                title={th ? "ลบ" : "Delete"}>
                <Icon name="trash" size={14} />
              </button>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 10, paddingTop: 8, borderTop: "1px solid var(--line)" }}>
          <button className="btn btn-outline" style={{ flex: 1 }} onClick={onClose} disabled={busy}>{th ? "ปิด" : "Close"}</button>
          <button className="btn" style={{ flex: 1 }} onClick={handleSave} disabled={busy}>{busy ? (th ? "กำลังบันทึก…" : "Saving…") : (th ? "บันทึก" : "Save changes")}</button>
        </div>
      </div>
    </div>
  )
}

function MenuRow({ icon, label, children }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 18px", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: "var(--ink-2)" }}>
        <Icon name={icon} size={15} />
        {label}
      </div>
      {children}
    </div>
  )
}

export function BottomNav({ route, setRoute, lang }) {
  const items = [
    { id: "dashboard", labelTh: "หน้าหลัก", labelEn: "Home",      icon: "home"      },
    { id: "portfolio", labelTh: "พอร์ต",    labelEn: "Portfolio",  icon: "filter"    },
    { id: "analytics", labelTh: "วิเคราะห์", labelEn: "Analytics", icon: "spark"     },
    { id: "tools",     labelTh: "เครื่องมือ", labelEn: "Tools",    icon: "sort"      },
    { id: "planning",  labelTh: "วางแผน",    labelEn: "Plan",      icon: "leaf"      },
    { id: "watchlist", labelTh: "ติดตาม",    labelEn: "Watch",     icon: "eye"       },
  ]
  return (
    <nav className="bottom-nav" aria-label="Bottom navigation">
      {items.map(it => (
        <button
          key={it.id}
          className={"bottom-nav-item" + (route === it.id ? " active" : "")}
          onClick={() => setRoute(it.id)}
        >
          <Icon name={it.icon} size={22} />
          <span>{lang === "th" ? it.labelTh : it.labelEn}</span>
        </button>
      ))}
    </nav>
  )
}

export function PageHead({ kicker, title, sub, right }) {
  return (
    <header className="page-head">
      <div>
        {kicker ? <div className="label-up" style={{ marginBottom: 8 }}>{kicker}</div> : null}
        <h1>{title}</h1>
        {sub ? <div className="sub">{sub}</div> : null}
      </div>
      {right ? <div>{right}</div> : null}
    </header>
  )
}

export function Delta({ value, decimals = 2, suffix = "%", size = 13 }) {
  if (value == null || isNaN(value)) return null
  const up = value > 0, down = value < 0
  return (
    <span className={"delta " + (up ? "gain" : down ? "loss" : "muted")} style={{ fontSize: size }}>
      <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true">
        {up
          ? <path d="M5 1 L9 7 H1 Z" fill="currentColor" />
          : down
          ? <path d="M5 9 L1 3 H9 Z" fill="currentColor" />
          : <path d="M1 5 H9" stroke="currentColor" strokeWidth="2" />}
      </svg>
      {up ? "+" : ""}{value.toFixed(decimals)}{suffix}
    </span>
  )
}

export function Icon({ name, size = 18 }) {
  const props = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" }
  switch (name) {
    case "link":     return (<svg {...props}><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>)
    case "edit":     return (<svg {...props}><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4Z"/></svg>)
    case "upload":   return (<svg {...props}><path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M5 21h14"/></svg>)
    case "play":     return (<svg {...props}><polygon points="5 3 19 12 5 21"/></svg>)
    case "demo":     return (<svg {...props}><rect x="3" y="4" width="14" height="14" rx="2"/><rect x="7" y="8" width="14" height="14" rx="2"/></svg>)
    case "leaf":     return (<svg {...props}><path d="M5 19c5 0 14-1 14-14 0 0-7 0-11 4S5 19 5 19Z"/><path d="M5 19c0-4 3-9 7-11"/></svg>)
    case "home":     return (<svg {...props}><path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/></svg>)
    case "shield":   return (<svg {...props}><path d="M12 3 4 6v6c0 5 4 8 8 9 4-1 8-4 8-9V6Z"/><path d="m9 12 2 2 4-4"/></svg>)
    case "book":     return (<svg {...props}><path d="M4 4h10a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4Z"/><path d="M4 16a4 4 0 0 1 4-4h10"/></svg>)
    case "buy":      return (<svg {...props}><path d="M12 5v14"/><path d="m6 11 6-6 6 6"/></svg>)
    case "sell":     return (<svg {...props}><path d="M12 19V5"/><path d="m6 13 6 6 6-6"/></svg>)
    case "dividend": return (<svg {...props}><circle cx="12" cy="12" r="3"/><path d="M12 4v3"/><path d="M12 17v3"/><path d="M4 12h3"/><path d="M17 12h3"/></svg>)
    case "deposit":  return (<svg {...props}><path d="M21 12V7H3v12h11"/><path d="M3 11h18"/><path d="M17 18h4m-2-2v4"/></svg>)
    case "plus":     return (<svg {...props}><path d="M12 5v14M5 12h14"/></svg>)
    case "chevron":  return (<svg {...props}><polyline points="9 6 15 12 9 18"/></svg>)
    case "down":     return (<svg {...props}><polyline points="6 9 12 15 18 9"/></svg>)
    case "check":    return (<svg {...props}><polyline points="20 6 9 17 4 12"/></svg>)
    case "info":     return (<svg {...props}><circle cx="12" cy="12" r="9"/><path d="M12 8v.01M11 12h1v4h1"/></svg>)
    case "spark":    return (<svg {...props}><path d="M12 2v4M12 18v4M4 12H2M22 12h-2M5 5l3 3M16 16l3 3M5 19l3-3M16 8l3-3"/></svg>)
    case "search":   return (<svg {...props}><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>)
    case "filter":   return (<svg {...props}><path d="M3 5h18M6 12h12M10 19h4"/></svg>)
    case "sort":     return (<svg {...props}><path d="M3 6h13M3 12h9M3 18h5"/><path d="M17 11l3 3 3-3"/><path d="M20 14V4"/></svg>)
    case "logout":   return (<svg {...props}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>)
    case "currency": return (<svg {...props}><circle cx="12" cy="12" r="9"/><path d="M9 9h.01M15 9h.01M9 15c1 1 5 1 6 0"/><path d="M12 6v2m0 8v2"/></svg>)
    case "lang":     return (<svg {...props}><path d="M3 7V5h10"/><path d="M8 5v14"/><path d="M13 19h9M16 13h6"/><path d="M17.5 19c-.5-3 .5-5 2-6"/></svg>)
    case "user":     return (<svg {...props}><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>)
    case "eye":      return (<svg {...props}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>)
    case "eye-off":  return (<svg {...props}><path d="M3 3l18 18"/><path d="M10.6 6.1A10.9 10.9 0 0 1 12 6c6.5 0 10 7 10 7a14 14 0 0 1-3.4 4.1"/><path d="M6.1 7.1A14 14 0 0 0 2 12s3.5 7 10 7a10.9 10.9 0 0 0 4.5-1"/><path d="M9 9a4 4 0 0 0 6 6"/></svg>)
    case "refresh":  return (<svg {...props}><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>)
    case "chart":    return (<svg {...props}><line x1="3" y1="20" x2="21" y2="20"/><rect x="5" y="11" width="3" height="8"/><rect x="11" y="6" width="3" height="13"/><rect x="17" y="13" width="3" height="6"/></svg>)
    case "trash":    return (<svg {...props}><path d="M3 6h18"/><path d="M19 6l-1 14H6L5 6"/><path d="M8 6V4h8v2"/></svg>)
    case "calc":     return (<svg {...props}><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M9 7h6"/><circle cx="9" cy="12" r="0.8" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="0.8" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="0.8" fill="currentColor" stroke="none"/><circle cx="9" cy="17" r="0.8" fill="currentColor" stroke="none"/><circle cx="12" cy="17" r="0.8" fill="currentColor" stroke="none"/><circle cx="15" cy="17" r="0.8" fill="currentColor" stroke="none"/></svg>)
    default: return null
  }
}

// Shared allocation category icon — SVG-based so it renders identically on all platforms.
// Used by Dashboard and Portfolio Categories tab.
export function AllocCategoryIcon({ name, color, isCash, isEmergency }) {
  const s = { width: 22, height: 22, stroke: color, fill: "none", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" }
  if (isEmergency)
    return <svg viewBox="0 0 24 24" style={s}><path d="M12 3 4 6v6c0 5 4 8 8 9 4-1 8-4 8-9V6Z"/><path d="m9 12 2 2 4-4"/></svg>
  if (isCash)
    return <svg viewBox="0 0 24 24" style={s}><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 11h2M2 7l5-4h10l5 4"/></svg>
  if (name.includes("TH") || name.includes("ไทย"))
    return <span style={{ fontSize: 13, fontWeight: 800, color, letterSpacing: "-0.03em" }}>TH</span>
  if (name.includes("US") || name.includes("สหรัฐ"))
    return <span style={{ fontSize: 13, fontWeight: 800, color, letterSpacing: "-0.03em" }}>US</span>
  if (name === "Crypto")
    return <svg viewBox="0 0 24 24" style={s}><path d="M9 8h5a2 2 0 0 1 0 4H9m5 0h1a2 2 0 0 1 0 4H9m0-8v8m3-10v2m0 8v2M7 8h1m0 8H7"/></svg>
  if (name === "Bond" || name.includes("พันธบัตร"))
    return <svg viewBox="0 0 24 24" style={s}><path d="M4 4h10a4 4 0 0 1 4 4v10H8a4 4 0 0 1-4-4Z"/><path d="M4 14a4 4 0 0 1 4-4h10"/></svg>
  if (name === "Commodity" || name === "GoldTH" || name.includes("ทองคำ"))
    return <svg viewBox="0 0 24 24" style={s}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
  if (name === "MutualFund" || name.includes("กองทุน"))
    return <svg viewBox="0 0 24 24" style={s}><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/><path d="M7 7h10M7 11h7"/></svg>
  if (name === "ETF")
    return <svg viewBox="0 0 24 24" style={s}><line x1="3" y1="20" x2="21" y2="20"/><rect x="5" y="11" width="3" height="8"/><rect x="11" y="6" width="3" height="13"/><rect x="17" y="13" width="3" height="6"/></svg>
  return <svg viewBox="0 0 24 24" style={s}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
}
