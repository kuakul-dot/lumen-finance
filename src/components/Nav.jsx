import { useState, useEffect, useRef } from 'react'

export function Brand() {
  return (
    <div className="brand">
      <LumenMark />
      <span>Lumen</span>
    </div>
  )
}

// Shared stock logo: custom logoUrl → ticker logo API → coloured initials.
// Thai symbols are queried with the .BK suffix (exchange-specific, so they
// don't collide with unrelated US tickers); on any miss it falls back to the
// initials.  Used across all pages.
export function TickerLogo({ ticker = "", logoUrl, region, cls, size = 34 }) {
  const [failed, setFailed] = useState(false)
  const base = String(ticker).replace(/\.BK$/i, "").toUpperCase()
  const symbolForLogo = region === "TH" ? `${base}.BK` : base
  const apiSrc = base ? `https://assets.parqet.com/logos/symbol/${encodeURIComponent(symbolForLogo)}?format=png&size=64` : null
  const src = logoUrl || apiSrc
  const initials = (base || "?").slice(0, 2)
  const bg = { Equity: "var(--bg-2)", ETF: "oklch(0.94 0.04 200)", Bond: "oklch(0.94 0.04 280)", Crypto: "oklch(0.94 0.05 65)", Commodity: "oklch(0.94 0.04 90)" }[cls] || "var(--bg-2)"
  const fg = { Equity: "var(--ink-2)", ETF: "var(--c1)", Bond: "var(--c4)", Crypto: "var(--c2)", Commodity: "var(--c7)" }[cls] || "var(--ink-2)"
  if (!src || failed) {
    return <div className="ticker-mark" style={{ width: size, height: size, background: bg, color: fg }}>{initials}</div>
  }
  return (
    <img src={src} alt={base} width={size} height={size} loading="lazy" onError={() => setFailed(true)}
         style={{ width: size, height: size, borderRadius: 8, objectFit: "contain", background: "#fff", border: "1px solid var(--line)" }} />
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

export function TopNav({ route, setRoute, lang, setLang, ccy, setCcy, t, session, signOut, displayName = '', setDisplayName }) {
  const [showProfile, setShowProfile] = useState(false)
  const menuRef = useRef(null)

  useEffect(() => {
    if (!showProfile) return
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setShowProfile(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showProfile])

  const items = [
    { id: "dashboard", label: t.nav.dashboard },
    { id: "portfolio", label: t.nav.portfolio },
    { id: "analytics", label: t.nav.analytics },
    { id: "tools",     label: t.nav.tools },
    { id: "planning",  label: t.nav.planning },
  ]
  const email    = session?.user?.email || ""
  const initials = email ? email.slice(0, 2).toUpperCase() : "ME"
  const name     = email ? email.split('@')[0] : (lang === "th" ? "ผู้ใช้งาน" : "User")

  return (
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
          <div className="pill-toggle" role="group" aria-label="Currency">
            <button className={ccy === "THB" ? "on" : ""} onClick={() => setCcy("THB")}>฿ THB</button>
            <button className={ccy === "USD" ? "on" : ""} onClick={() => setCcy("USD")}>$ USD</button>
          </div>
          <div className="pill-toggle" role="group" aria-label="Language">
            <button className={lang === "th" ? "on" : ""} onClick={() => setLang("th")}>ไทย</button>
            <button className={lang === "en" ? "on" : ""} onClick={() => setLang("en")}>EN</button>
          </div>

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
    { id: "dashboard", labelTh: "หน้าหลัก", labelEn: "Home",     icon: "home"   },
    { id: "portfolio", labelTh: "พอร์ต",    labelEn: "Portfolio", icon: "filter" },
    { id: "analytics", labelTh: "วิเคราะห์", labelEn: "Analytics", icon: "spark"  },
    { id: "tools",     labelTh: "เครื่องมือ", labelEn: "Tools",    icon: "sort"   },
    { id: "planning",  labelTh: "วางแผน",    labelEn: "Plan",      icon: "leaf"   },
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
    case "trash":    return (<svg {...props}><path d="M3 6h18"/><path d="M19 6l-1 14H6L5 6"/><path d="M8 6V4h8v2"/></svg>)
    default: return null
  }
}
