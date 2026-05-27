import { useState, useEffect, useCallback } from 'react'
import { TopNav, BottomNav, Brand, Icon } from './components/Nav'
import { TweaksPanel, useTweaks, TweakSection, TweakRadio, TweakColor } from './components/TweaksPanel'
import { OnboardingPage } from './components/Onboarding'
import { DashboardPage } from './components/Dashboard'
import { PortfolioPage } from './components/Portfolio'
import { AnalyticsPage } from './components/Analytics'
import { ToolsPage } from './components/Tools'
import { PlanningPage } from './components/Planning'
import { LUMEN_I18N, setLiveFxRate } from './data'
import { supabase } from './lib/supabase'
import { getOrCreatePortfolio, getHoldingsSafe, getCashAccounts } from './lib/db'
import { fetchPrices, fetchFxRate } from './lib/prices'

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
  const [displayName, setDisplayNameRaw] = useState(() => {
    try { return localStorage.getItem('lumen_display_name') || '' } catch { return '' }
  })
  const setDisplayName = useCallback((name) => {
    setDisplayNameRaw(name)
    try { localStorage.setItem('lumen_display_name', name) } catch {}
  }, [])
  const lang = t.lang === "en" ? "en" : "th"
  const ccy  = t.ccy === "USD" ? "USD" : "THB"
  const i18n = LUMEN_I18N[lang]

  // Auth state: undefined = initializing, null = signed out, object = signed in
  const [session, setSession] = useState(undefined)
  const [portfolio, setPortfolio] = useState(null)
  const [liveHoldings, setLiveHoldings] = useState([])
  const [prices, setPrices] = useState({})
  const [cashAccounts, setCashAccounts] = useState([])
  const [loadingData, setLoadingData] = useState(false)
  const [dataError, setDataError] = useState(null)
  const [fxRate, setFxRate] = useState(36)    // live USD→THB rate

  // Fetch FX rate on mount, then refresh every hour
  useEffect(() => {
    fetchFxRate().then(r => { if (r) { setFxRate(r); setLiveFxRate(r) } })
    const id = setInterval(() => {
      fetchFxRate().then(r => { if (r) { setFxRate(r); setLiveFxRate(r) } })
    }, 60 * 60 * 1000)
    return () => clearInterval(id)
  }, [])

  const loadPortfolioData = useCallback(async (userId) => {
    setLoadingData(true)
    setDataError(null)
    try {
      const p = await getOrCreatePortfolio(userId, ccy)
      setPortfolio(p)
      const h = await getHoldingsSafe(p.id)
      setLiveHoldings(h)
      const [px, ca] = await Promise.allSettled([fetchPrices(h), getCashAccounts(p.id)])
      if (px.status === 'fulfilled') setPrices(px.value)
      else console.warn('[Lumen] price fetch failed:', px.reason?.message)
      if (ca.status === 'fulfilled') setCashAccounts(ca.value)
    } catch (err) {
      console.error('[Lumen] loadPortfolioData error:', err)
      setDataError(err.message)
      setPortfolio(null)
      setLiveHoldings([])
    } finally {
      setLoadingData(false)
    }
  }, [ccy])

  const refreshHoldings = useCallback(async () => {
    if (!portfolio) return
    try {
      const h = await getHoldingsSafe(portfolio.id)
      setLiveHoldings(h)
      const [px, ca] = await Promise.allSettled([fetchPrices(h), getCashAccounts(portfolio.id)])
      if (px.status === 'fulfilled') setPrices(px.value)
      if (ca.status === 'fulfilled') setCashAccounts(ca.value)
    } catch (err) {
      console.error('[Lumen] refreshHoldings error:', err)
    }
  }, [portfolio])

  const refreshCashAccounts = useCallback(async () => {
    if (!portfolio) return
    try {
      const ca = await getCashAccounts(portfolio.id)
      setCashAccounts(ca)
    } catch {}
  }, [portfolio])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (!session) { setPortfolio(null); setLiveHoldings([]) }
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (session?.user) {
      loadPortfolioData(session.user.id)
    }
  }, [session?.user?.id])

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

  const signOut = () => supabase.auth.signOut()

  if (session === undefined) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh" }}>
        <div style={{ opacity: 0.4, fontSize: 14 }}>Loading…</div>
      </div>
    )
  }

  const dataState = session ? "live" : t.data

  let page
  if (route === "onboarding") {
    page = (
      <OnboardingPage
        t={i18n} lang={lang} setRoute={setRoute}
        setDataState={(s) => setTweak("data", s)}
        session={session}
        signOut={signOut}
      />
    )
  } else if (route === "dashboard") {
    page = (
      <DashboardPage
        t={i18n} lang={lang} ccy={ccy} setRoute={setRoute}
        dataState={dataState}
        session={session}
        liveHoldings={liveHoldings}
        prices={prices}
        cashAccounts={cashAccounts}
        portfolio={portfolio}
        refreshCashAccounts={refreshCashAccounts}
        displayName={displayName}
        fxRate={fxRate}
      />
    )
  } else if (route === "portfolio") {
    page = (
      <PortfolioPage
        t={i18n} lang={lang} ccy={ccy} setRoute={setRoute}
        dataState={dataState}
        portfolio={portfolio}
        liveHoldings={liveHoldings}
        prices={prices}
        refreshHoldings={refreshHoldings}
        loadingData={loadingData}
        dataError={dataError}
        retryLoad={() => session?.user && loadPortfolioData(session.user.id)}
        fxRate={fxRate}
      />
    )
  } else if (route === "analytics") {
    page = <AnalyticsPage t={i18n} lang={lang} ccy={ccy} dataState={dataState} liveHoldings={liveHoldings} prices={prices} fxRate={fxRate} portfolio={portfolio} />
  } else if (route === "tools") {
    page = (
      <ToolsPage
        t={i18n} lang={lang} ccy={ccy} dataState={dataState}
        liveHoldings={liveHoldings}
        prices={prices}
        portfolio={portfolio}
        cashAccounts={cashAccounts}
        fxRate={fxRate}
      />
    )
  } else if (route === "planning") {
    page = (
      <PlanningPage
        t={i18n} lang={lang} ccy={ccy}
        session={session}
        liveHoldings={liveHoldings}
        prices={prices}
      />
    )
  }

  return (
    <div className="app">
      {route !== "onboarding" ? (
        <TopNav
          route={route} setRoute={setRoute}
          lang={lang} setLang={(v) => setTweak("lang", v)}
          ccy={ccy} setCcy={(v) => setTweak("ccy", v)}
          t={i18n}
          session={session}
          signOut={signOut}
          displayName={displayName}
          setDisplayName={setDisplayName}
        />
      ) : (
        <OnboardingNav
          lang={lang} setLang={(v) => setTweak("lang", v)}
          ccy={ccy} setCcy={(v) => setTweak("ccy", v)}
        />
      )}

      {page}

      {route !== "onboarding" && (
        <BottomNav route={route} setRoute={setRoute} lang={lang} />
      )}

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

        {!session && (
          <>
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
          </>
        )}

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
