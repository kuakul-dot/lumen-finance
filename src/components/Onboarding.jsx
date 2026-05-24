import { useState } from 'react'
import { Icon } from './Nav'

export function OnboardingPage({ t, lang, setRoute, setDataState }) {
  const [hover, setHover] = useState(null)

  const pick = (mode) => {
    if (mode === "demo") {
      setDataState("demo")
      setRoute("dashboard")
    } else {
      setDataState("empty")
      setRoute("dashboard")
    }
  }

  const options = [
    {
      id: "enter",
      icon: "edit",
      title: t.onboarding.enter,
      sub: t.onboarding.enterSub,
      chips: [],
      best: true,
    },
    {
      id: "upload",
      icon: "upload",
      title: t.onboarding.upload,
      sub: t.onboarding.uploadSub,
      chips: ["CSV", "PDF", "Binance API"],
    },
  ]

  return (
    <div className="shell-narrow fade-in">
      <header style={{ textAlign: "center", marginBottom: 56, marginTop: 32 }}>
        <div className="label-up" style={{ marginBottom: 16 }}>{t.onboarding.kicker} · {t.onboarding.step} 01 / 03</div>
        <h1 style={{
          fontFamily: "var(--font-display)", fontSize: 64, lineHeight: 1.02,
          letterSpacing: "-0.03em", fontWeight: 400, margin: 0,
          maxWidth: 720, marginInline: "auto",
        }}>
          {t.onboarding.title}
        </h1>
        <p style={{ color: "var(--ink-3)", marginTop: 18, fontSize: 16, maxWidth: 520, marginInline: "auto" }}>
          {t.onboarding.subtitle}
        </p>
      </header>

      <div className="grid grid-2" style={{ gap: 20 }}>
        {options.map(o => (
          <button
            key={o.id}
            className="option-card"
            onMouseEnter={() => setHover(o.id)}
            onMouseLeave={() => setHover(null)}
            onClick={() => pick(o.id)}
          >
            <div style={{ display: "flex", alignItems: "flex-start", gap: 24 }}>
              <div className="o-icon">
                <Icon name={o.icon} size={22} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h3 className="display" style={{ fontSize: 24, margin: "0 0 8px", display: "block" }}>
                  {o.title}
                  {o.best ? <span className="chip chip-soft" style={{ marginLeft: 10, verticalAlign: "middle", fontSize: 11 }}>{lang === "th" ? "แนะนำ" : "Recommended"}</span> : null}
                </h3>
                <p style={{ color: "var(--ink-3)", margin: "0 0 14px", fontSize: 14, lineHeight: 1.5, maxWidth: 560 }}>
                  {o.sub}
                </p>
                {o.chips.length > 0 && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {o.chips.map(c => <span key={c} className="chip">{c}</span>)}
                  </div>
                )}
              </div>
              <div style={{ alignSelf: "center", color: "var(--ink-3)" }}>
                <Icon name="chevron" size={18} />
              </div>
            </div>
          </button>
        ))}
      </div>

      <div style={{ marginTop: 40, textAlign: "center" }}>
        <div className="label-up" style={{ marginBottom: 16 }}>
          {lang === "th" ? "หรือ" : "Or"}
        </div>
        <button
          onClick={() => pick("demo")}
          style={{
            display: "inline-flex", alignItems: "center", gap: 14,
            background: "var(--ink)", color: "var(--bg)",
            padding: "16px 28px", borderRadius: 999,
            fontSize: 15, fontWeight: 500,
            transition: "transform 0.06s, background 0.15s",
          }}
          onMouseDown={e => e.currentTarget.style.transform = "translateY(1px)"}
          onMouseUp={e => e.currentTarget.style.transform = ""}
        >
          <Icon name="play" size={18} />
          {t.onboarding.demo}
          <span style={{
            background: "rgba(255,255,255,0.18)", color: "var(--bg)",
            fontSize: 11, padding: "2px 8px", borderRadius: 999, marginLeft: 4,
            whiteSpace: "nowrap",
          }}>
            {lang === "th" ? "ไม่ต้องเชื่อม" : "no setup"}
          </span>
        </button>
        <div style={{ marginTop: 18 }}>
          <a href="#" style={{ color: "var(--ink-3)", fontSize: 13, borderBottom: "1px solid var(--line-2)" }}>
            {t.onboarding.guide}
          </a>
        </div>
      </div>

      <div style={{
        marginTop: 80, padding: "24px 0", borderTop: "1px solid var(--line)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 16, color: "var(--ink-3)", fontSize: 12,
      }}>
        <span>{lang === "th" ? "เข้ารหัสฝั่งลูกค้า · อ่านอย่างเดียว · ไม่เก็บคีย์ส่วนตัว" : "Client-side encryption · Read-only · We never store private keys"}</span>
        <span style={{ display: "flex", gap: 18, fontVariant: "small-caps", letterSpacing: "0.05em" }}>
          <span>SOC 2</span>
          <span>ISO 27001</span>
          <span>PDPA</span>
          <span>GDPR</span>
        </span>
      </div>
    </div>
  )
}
