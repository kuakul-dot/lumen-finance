import { useState, useEffect, useRef, useMemo } from 'react'

export function Brand() {
  return (
    <div className="brand">
      <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
        <circle cx="15" cy="15" r="13" fill="var(--ink)" />
        <path d="M15 5 A10 10 0 0 1 15 25 L15 15 Z" fill="var(--bg)" />
        <circle cx="15" cy="15" r="2.2" fill="var(--ink)" />
      </svg>
      <span>Lumen</span>
    </div>
  )
}

export function TopNav({ route, setRoute, lang, setLang, ccy, setCcy, t, session, signOut }) {
  const items = [
    { id: "dashboard", label: t.nav.dashboard },
    { id: "portfolio", label: t.nav.portfolio },
    { id: "analytics", label: t.nav.analytics },
    { id: "tools",     label: t.nav.tools },
    { id: "planning",  label: t.nav.planning },
  ]
  const initials = session?.user?.email
    ? session.user.email.slice(0, 2).toUpperCase()
    : "ME"
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
          <button
            className="avatar"
            title={session?.user?.email || ""}
            onClick={session ? signOut : undefined}
            style={{ cursor: session ? "pointer" : "default" }}
          >
            {initials}
          </button>
        </div>
      </div>
    </header>
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
    default: return null
  }
}
