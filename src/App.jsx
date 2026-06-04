import { useState, useEffect, useCallback, useRef } from 'react'
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
import { getOrCreatePortfolio, getPortfolios, addPortfolio, updatePortfolio, deletePortfolioCascade, getHoldingsSafe, getCashAccounts, deriveHoldings, recordSnapshot, exportData } from './lib/db'
import { fetchPrices, fetchFxRate } from './lib/prices'

const TWEAK_DEFAULTS = {
  accent:  "oklch(0.55 0.06 175)",
  density: "cozy",
  data:    "demo",
  type:    "editorial",
  lang:    "th",
  ccy:     "THB",
  theme:   "light",
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
// Dark-theme variants of the accent's soft background + ink text
const ACCENT_SOFT_DARK = (c) => {
  const m = c.match(/oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/)
  if (!m) return c
  return `oklch(0.32 ${(parseFloat(m[2]) * 0.6).toFixed(2)} ${m[3]})`
}
const ACCENT_INK_DARK = (c) => {
  const m = c.match(/oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/)
  if (!m) return c
  return `oklch(0.80 ${m[2]} ${m[3]})`
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
  const [portfolios, setPortfolios] = useState([])   // every portfolio this user owns
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

  // Load the holdings/prices/cash for whichever portfolio is active
  const loadActivePortfolioData = useCallback(async (p) => {
    if (!p) return
    const h = await getHoldingsSafe(p.id)
    setLiveHoldings(h)
    const [px, ca] = await Promise.allSettled([fetchPrices(h), getCashAccounts(p.id)])
    if (px.status === 'fulfilled') setPrices(px.value)
    else console.warn('[Lumen] price fetch failed:', px.reason?.message)
    if (ca.status === 'fulfilled') setCashAccounts(ca.value)
  }, [])

  const loadPortfolioData = useCallback(async (userId) => {
    setLoadingData(true)
    setDataError(null)
    try {
      let list = await getPortfolios(userId)
      if (list.length === 0) {
        // First-time user: seed a "Main" portfolio in their preferred currency
        const seed = await getOrCreatePortfolio(userId, ccy)
        list = [seed]
      }
      setPortfolios(list)
      const savedId = localStorage.getItem(`lumen.activePortfolio.${userId}`)
      const active = list.find(p => p.id === savedId) || list[0]
      setPortfolio(active)
      await loadActivePortfolioData(active)
    } catch (err) {
      console.error('[Lumen] loadPortfolioData error:', err)
      setDataError(err.message)
      setPortfolio(null)
      setPortfolios([])
      setLiveHoldings([])
    } finally {
      setLoadingData(false)
    }
  }, [ccy, loadActivePortfolioData])

  // ── Portfolio switching & management ────────────────────────────────────
  const switchPortfolio = useCallback(async (p) => {
    if (!p || p.id === portfolio?.id) return
    setPortfolio(p)
    setLiveHoldings([]); setPrices({}); setCashAccounts([])
    if (session?.user?.id) localStorage.setItem(`lumen.activePortfolio.${session.user.id}`, p.id)
    setLoadingData(true)
    try { await loadActivePortfolioData(p) }
    finally { setLoadingData(false) }
  }, [portfolio?.id, session?.user?.id, loadActivePortfolioData])

  const createPortfolio = useCallback(async (name) => {
    if (!session?.user?.id) return { error: 'not signed in' }
    const { data, error } = await addPortfolio(session.user.id, name, ccy)
    if (error || !data) return { error: error?.message || 'create failed' }
    setPortfolios(list => [...list, data])
    await switchPortfolio(data)
    return { data }
  }, [session?.user?.id, ccy, switchPortfolio])

  const renamePortfolio = useCallback(async (id, name) => {
    const trimmed = (name || '').trim()
    if (!trimmed) return { error: 'name required' }
    const { data, error } = await updatePortfolio(id, { name: trimmed })
    if (error || !data) return { error: error?.message || 'rename failed' }
    setPortfolios(list => list.map(p => (p.id === id ? data : p)))
    if (portfolio?.id === id) setPortfolio(data)
    return { data }
  }, [portfolio?.id])

  const removePortfolio = useCallback(async (id) => {
    if (portfolios.length <= 1) return { error: 'cannot delete the last portfolio' }
    const { error } = await deletePortfolioCascade(id)
    if (error) return { error: error.message }
    const remaining = portfolios.filter(p => p.id !== id)
    setPortfolios(remaining)
    if (portfolio?.id === id) await switchPortfolio(remaining[0])
    return {}
  }, [portfolios, portfolio?.id, switchPortfolio])

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

  // Record one portfolio-value snapshot per day (powers TWR / Sharpe / drawdown).
  // Idempotent per (portfolio, day); guarded so it writes once per session/day.
  const snapshotKeyRef = useRef('')
  useEffect(() => {
    if (!session || !portfolio?.id) return
    if (liveHoldings.length === 0 || Object.keys(prices).length === 0) return
    const today = new Date().toISOString().split('T')[0]
    const key = `${portfolio.id}:${today}`
    if (snapshotKeyRef.current === key) return

    const derived = deriveHoldings(liveHoldings, 'THB', prices, fxRate)
    const total_value = derived.reduce((s, r) => s + r.value, 0)
    const total_pl    = derived.reduce((s, r) => s + r.pl, 0)
    const total_cost  = total_value - total_pl
    if (total_value > 0) {
      snapshotKeyRef.current = key
      recordSnapshot(portfolio.id, { total_value, total_cost })
    }
  }, [session, portfolio?.id, liveHoldings, prices, fxRate])

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
    const dark = t.theme === "dark"
    root.setAttribute("data-theme", dark ? "dark" : "light")
    root.style.setProperty("--accent", t.accent)
    root.style.setProperty("--accent-soft", dark ? ACCENT_SOFT_DARK(t.accent) : ACCENT_SOFT(t.accent))
    root.style.setProperty("--accent-ink", dark ? ACCENT_INK_DARK(t.accent) : ACCENT_INK(t.accent))
    const d = DENSITY_MAP[t.density] || DENSITY_MAP.cozy
    root.style.setProperty("--pad-card", d.pad)
    root.style.setProperty("--gap", d.gap)
    root.style.setProperty("--radius", d.radius)
    if (t.type === "modern") {
      root.style.setProperty("--font-display", '"Geist", "IBM Plex Sans Thai", "Helvetica Neue", system-ui, sans-serif')
    } else {
      root.style.setProperty("--font-display", '"Instrument Serif", "Noto Serif Thai", Georgia, serif')
    }
  }, [t.accent, t.density, t.type, t.theme])

  const signOut = () => supabase.auth.signOut()

  const downloadBlob = (content, filename, type) => {
    const blob = new Blob([content], { type })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
    URL.revokeObjectURL(url)
  }
  const today = () => new Date().toISOString().split('T')[0]
  const handleExportJSON = async () => {
    if (!portfolio?.id) return
    const data = await exportData(portfolio.id, session?.user?.id)
    downloadBlob(JSON.stringify(data, null, 2), `lumen-backup-${today()}.json`, 'application/json')
  }
  const handleExportCSV = async () => {
    if (!portfolio?.id) return
    const data = await exportData(portfolio.id, session?.user?.id)
    const esc = s => `"${String(s ?? '').replace(/"/g, '""')}"`
    const header = ['Date', 'Type', 'Ticker', 'Shares', 'Price', 'Amount', 'Fee', 'Tax', 'Currency', 'Note']
    const rows = (data?.transactions || []).map(t => [
      (t.transacted_at || '').split('T')[0], t.type, t.ticker || '', t.shares ?? '', t.price ?? '',
      t.amount ?? '', t.fee ?? 0, t.tax ?? 0, t.currency || '', esc(t.note),
    ].join(','))
    downloadBlob('﻿' + [header.join(','), ...rows].join('\n'), `lumen-transactions-${today()}.csv`, 'text/csv;charset=utf-8;')
  }

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
        refreshHoldings={refreshHoldings}
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
        cashAccounts={cashAccounts}
        refreshCashAccounts={refreshCashAccounts}
        session={session}
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
        fxRate={fxRate}
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
          portfolios={portfolios}
          activePortfolio={portfolio}
          onSwitchPortfolio={switchPortfolio}
          onCreatePortfolio={createPortfolio}
          onRenamePortfolio={renamePortfolio}
          onDeletePortfolio={removePortfolio}
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
        <TweakSection label={lang === "th" ? "ธีม" : "Theme"} />
        <TweakRadio
          label={lang === "th" ? "โหมดสี" : "Appearance"}
          value={t.theme}
          options={[
            { value: "light", label: lang === "th" ? "สว่าง" : "Light" },
            { value: "dark",  label: lang === "th" ? "มืด" : "Dark" },
          ]}
          onChange={(v) => setTweak("theme", v)}
        />

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

        {session && portfolio && (
          <>
            <TweakSection label={lang === "th" ? "ข้อมูล (สำรอง)" : "Data (backup)"} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              <button onClick={handleExportJSON}
                style={{ padding: "8px 10px", fontSize: 11, fontWeight: 500, borderRadius: 8, cursor: "pointer", background: "var(--bg-2)", color: "var(--ink)", border: "1px solid var(--line)" }}>
                {lang === "th" ? "สำรอง JSON" : "Backup JSON"}
              </button>
              <button onClick={handleExportCSV}
                style={{ padding: "8px 10px", fontSize: 11, fontWeight: 500, borderRadius: 8, cursor: "pointer", background: "var(--bg-2)", color: "var(--ink)", border: "1px solid var(--line)" }}>
                {lang === "th" ? "ธุรกรรม CSV" : "Transactions CSV"}
              </button>
            </div>
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
        <Brand />
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
