import { useState, useEffect } from 'react'
import { TopNav, Brand, Icon } from './components/Nav'
import { TweaksPanel, useTweaks, TweakSection, TweakRadio, TweakColor } from './components/TweaksPanel'
import { OnboardingPage } from './components/Onboarding'
import { DashboardPage } from './components/Dashboard'
import { PortfolioPage } from './components/Portfolio'
import { AnalyticsPage } from './components/Analytics'
import { ToolsPage } from './components/Tools'
import { PlanningPage } from './components/Planning'
import { LUMEN_I18N } from './data'

const TWEAK_DEFAULTS = {
  accent:  "oklch(0.55 0.06 175)",
  density: "cozy",
  data:    "demo",
  type:    "editorial",
  lang:    "th",
  ccy:     "THB",
}

const ACCENT_SOFT = (c) => {
  const m = c.match(/oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/)
  if (!m) return c
  return `oklch(0.94 ${(parseFloat(m[2]) * 0.35).toFixed(2)} ${m[3]})`
}
const ACCENT_INK = (c) => {
  const m = c.match(/oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/)
  if (!m) return c
  return `oklch(0.36 ${m[2]} ${m[3]})`
}

const DENSITY_MAP = {
  compact: { pad: "16px", gap: "10px", radius: "10px" },
  cozy:    { pad: "24px", gap: "16px", radius: "14px" },
  airy:    { pad: "36px", gap: "24px", radius: "18px" },
}

export default function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS)
  const [route, setRoute] = useState("onboarding")
  const lang = t.lang === "en" ? "en" : "th"
  const ccy  = t.ccy === "USD" ? "USD" : "THB"
  const i18n = LUMEN_I18N[lang]

  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty("--accent", t.accent)
    root.style.setProperty("--accent-soft", ACCENT_SOFT(t.accent))
    root.style.setProperty("--accent-ink", ACCENT_INK(t.accent))
    const d = DENSITY_MAP[t.density] || DENSITY_MAP.cozy
    root.style.setProperty("--pad-card", d.pad)
    root.style.setProperty("--gap", d.gap)
    root.style.setProperty("--radius", d.radius)
    if (t.type === "modern") {
      root.style.setProperty("--font-display", '"Geist", "IBM Plex Sans Thai", "Helvetica Neue", system-ui, sans-serif')
    } else {
      root.style.setProperty("--font-display", '"Instrument Serif", "Noto Serif Thai", Georgia, serif')
    }
  }, [t.accent, t.density, t.type])

  let page
  if (route === "onboarding") {
    page = <OnboardingPage t={i18n} lang={lang} setRoute={setRoute} setDataState={(s) => setTweak("data", s)} />
  } else if (route === "dashboard") {
    page = <DashboardPage t={i18n} lang={lang} ccy={ccy} setRoute={setRoute} dataState={t.data} />
  } else if (route === "portfolio") {
    page = <PortfolioPage t={i18n} lang={lang} ccy={ccy} setRoute={setRoute} dataState={t.data} />
  } else if (route === "analytics") {
    page = <AnalyticsPage t={i18n} lang={lang} ccy={ccy} dataState={t.data} />
  } else if (route === "tools") {
    page = <ToolsPage t={i18n} lang={lang} ccy={ccy} dataState={t.data} />
  } else if (route === "planning") {
    page = <PlanningPage t={i18n} lang={lang} ccy={ccy} />
  }

  return (
    <div className="app">
      {route !== "onboarding" ? (
        <TopNav
          route={route} setRoute={setRoute}
          lang={lang} setLang={(v) => setTweak("lang", v)}
          ccy={ccy} setCcy={(v) => setTweak("ccy", v)}
          t={i18n}
        />
      ) : (
        <OnboardingNav lang={lang} setLang={(v) => setTweak("lang", v)} ccy={ccy} setCcy={(v) => setTweak("ccy", v)} />
      )}

      {page}

      <TweaksPanel title={i18n.tweaks.title}>
        <TweakSection label={i18n.tweaks.accent} />
        <TweakColor
          label={i18n.tweaks.accent}
          value={t.accent}
          options={[
            "oklch(0.55 0.06 175)",
            "oklch(0.5 0.10 270)",
            "oklch(0.65 0.10 75)",
            "oklch(0.62 0.11 25)",
          ]}
          onChange={(v) => setTweak("accent", v)}
        />

        <TweakSection label={i18n.tweaks.density} />
        <TweakRadio
          label={i18n.tweaks.density}
          value={t.density}
          options={[
            { value: "compact", label: i18n.tweaks.compact },
            { value: "cozy",    label: i18n.tweaks.cozy },
            { value: "airy",    label: i18n.tweaks.airy },
          ]}
          onChange={(v) => setTweak("density", v)}
        />

        <TweakRadio
          label={i18n.tweaks.type}
          value={t.type}
          options={[
            { value: "editorial", label: i18n.tweaks.classic },
            { value: "modern",    label: i18n.tweaks.modern },
          ]}
          onChange={(v) => setTweak("type", v)}
        />

        <TweakSection label={i18n.tweaks.data} />
        <TweakRadio
          label={i18n.tweaks.data}
          value={t.data}
          options={[
            { value: "demo",  label: i18n.tweaks.demo },
            { value: "empty", label: i18n.tweaks.empty },
          ]}
          onChange={(v) => setTweak("data", v)}
        />

        <TweakSection label={lang === "th" ? "ทางลัด" : "Quick jump"} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          {[
            ["onboarding", lang === "th" ? "เริ่มต้น"   : "Onboarding"],
            ["dashboard",  lang === "th" ? "หน้าหลัก"   : "Dashboard"],
            ["portfolio",  lang === "th" ? "พอร์ต"      : "Portfolio"],
            ["analytics",  lang === "th" ? "วิเคราะห์"  : "Analytics"],
            ["tools",      lang === "th" ? "เครื่องมือ" : "Tools"],
            ["planning",   lang === "th" ? "วางแผน"     : "Planning"],
          ].map(([id, lbl]) => (
            <button key={id} onClick={() => setRoute(id)}
                    style={{
                      padding: "8px 10px", fontSize: 11, fontWeight: 500,
                      borderRadius: 8, cursor: "pointer",
                      background: route === id ? "var(--ink)" : "var(--bg-2)",
                      color: route === id ? "var(--bg)" : "var(--ink)",
                      border: "1px solid var(--line)",
                    }}>
              {lbl}
            </button>
          ))}
        </div>
      </TweaksPanel>
    </div>
  )
}

function OnboardingNav({ lang, setLang, ccy, setCcy }) {
  return (
    <header className="topnav">
      <div className="topnav-inner">
        <div className="brand">
          <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
            <circle cx="15" cy="15" r="13" fill="var(--ink)" />
            <path d="M15 5 A10 10 0 0 1 15 25 L15 15 Z" fill="var(--bg)" />
            <circle cx="15" cy="15" r="2.2" fill="var(--ink)" />
          </svg>
          <span>Lumen</span>
        </div>
        <div className="nav-spacer" />
        <div className="nav-tools">
          <div className="pill-toggle">
            <button className={ccy === "THB" ? "on" : ""} onClick={() => setCcy("THB")}>฿ THB</button>
            <button className={ccy === "USD" ? "on" : ""} onClick={() => setCcy("USD")}>$ USD</button>
          </div>
          <div className="pill-toggle">
            <button className={lang === "th" ? "on" : ""} onClick={() => setLang("th")}>ไทย</button>
            <button className={lang === "en" ? "on" : ""} onClick={() => setLang("en")}>EN</button>
          </div>
        </div>
      </div>
    </header>
  )
}
