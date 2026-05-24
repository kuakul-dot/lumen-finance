import { useState } from 'react'
import { Icon } from './Nav'
import { supabase } from '../lib/supabase'

export function OnboardingPage({ t, lang, setRoute, setDataState, session, signOut }) {
  const [authMode, setAuthMode] = useState(null) // null | 'signin' | 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)

  const th = lang === "th"

  const handleAuth = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccess(null)
    try {
      if (authMode === 'signup') {
        const { error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        setSuccess(th ? 'ตรวจสอบอีเมลเพื่อยืนยันบัญชี แล้วกลับมาเข้าสู่ระบบ' : 'Check your email to confirm your account, then sign in.')
        setAuthMode('signin')
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        setRoute('dashboard')
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // Already signed in
  if (session) {
    return (
      <div className="shell-narrow fade-in">
        <header style={{ textAlign: "center", marginBottom: 48, marginTop: 32 }}>
          <div className="label-up" style={{ marginBottom: 16 }}>
            {th ? "เข้าสู่ระบบแล้ว" : "Signed in"}
          </div>
          <h1 style={{
            fontFamily: "var(--font-display)", fontSize: 52, lineHeight: 1.05,
            letterSpacing: "-0.03em", fontWeight: 400, margin: 0,
          }}>
            {th ? "ยินดีต้อนรับกลับ" : "Welcome back"}
          </h1>
          <p style={{ color: "var(--ink-3)", marginTop: 14, fontSize: 15 }}>
            {session.user.email}
          </p>
        </header>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 400, margin: "0 auto" }}>
          <button
            className="btn"
            style={{ padding: "16px 28px", fontSize: 16, borderRadius: 999, justifyContent: "center" }}
            onClick={() => setRoute('dashboard')}
          >
            <Icon name="play" size={16} />
            {th ? "ไปที่หน้าหลัก" : "Go to Dashboard"}
          </button>
          <button
            className="btn btn-outline"
            style={{ padding: "12px 28px", fontSize: 14, borderRadius: 999, justifyContent: "center" }}
            onClick={() => setRoute('portfolio')}
          >
            <Icon name="edit" size={14} />
            {th ? "จัดการพอร์ต" : "Manage Portfolio"}
          </button>
          <button
            onClick={signOut}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: "var(--ink-3)", fontSize: 13, marginTop: 8, padding: "8px 0",
            }}
          >
            {th ? "ออกจากระบบ" : "Sign out"}
          </button>
        </div>
      </div>
    )
  }

  // Auth form
  if (authMode) {
    return (
      <div className="shell-narrow fade-in">
        <header style={{ textAlign: "center", marginBottom: 40, marginTop: 32 }}>
          <div className="label-up" style={{ marginBottom: 16 }}>
            {authMode === 'signup'
              ? (th ? "สมัครสมาชิก" : "Create account")
              : (th ? "เข้าสู่ระบบ" : "Sign in")}
          </div>
          <h1 style={{
            fontFamily: "var(--font-display)", fontSize: 52, lineHeight: 1.05,
            letterSpacing: "-0.03em", fontWeight: 400, margin: 0,
          }}>
            {authMode === 'signup'
              ? (th ? "สร้างบัญชีใหม่" : "Get started")
              : (th ? "ยินดีต้อนรับกลับ" : "Welcome back")}
          </h1>
        </header>

        <form onSubmit={handleAuth} style={{ maxWidth: 420, margin: "0 auto", display: "flex", flexDirection: "column", gap: 14 }}>
          {success && (
            <div style={{
              padding: "12px 16px", borderRadius: 10,
              background: "oklch(0.94 0.05 160)", color: "oklch(0.35 0.08 160)",
              fontSize: 14,
            }}>
              {success}
            </div>
          )}
          {error && (
            <div style={{
              padding: "12px 16px", borderRadius: 10,
              background: "oklch(0.96 0.05 25)", color: "oklch(0.40 0.12 25)",
              fontSize: 14,
            }}>
              {error}
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-2)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
              {th ? "อีเมล" : "Email"}
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder={th ? "your@email.com" : "your@email.com"}
              style={{
                padding: "13px 16px", borderRadius: 10, fontSize: 15,
                border: "1.5px solid var(--line)", background: "var(--bg)",
                color: "var(--ink)", outline: "none", width: "100%", boxSizing: "border-box",
              }}
              onFocus={e => e.target.style.borderColor = "var(--accent)"}
              onBlur={e => e.target.style.borderColor = "var(--line)"}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-2)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
              {th ? "รหัสผ่าน" : "Password"}
            </label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder={th ? "อย่างน้อย 6 ตัวอักษร" : "At least 6 characters"}
              style={{
                padding: "13px 16px", borderRadius: 10, fontSize: 15,
                border: "1.5px solid var(--line)", background: "var(--bg)",
                color: "var(--ink)", outline: "none", width: "100%", boxSizing: "border-box",
              }}
              onFocus={e => e.target.style.borderColor = "var(--accent)"}
              onBlur={e => e.target.style.borderColor = "var(--line)"}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn"
            style={{
              marginTop: 4, padding: "15px 28px", borderRadius: 999,
              fontSize: 15, fontWeight: 500, justifyContent: "center",
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading
              ? (th ? "กำลังดำเนินการ…" : "Please wait…")
              : authMode === 'signup'
                ? (th ? "สมัครสมาชิก" : "Create account")
                : (th ? "เข้าสู่ระบบ" : "Sign in")}
          </button>

          <div style={{ textAlign: "center", marginTop: 8 }}>
            {authMode === 'signup' ? (
              <span style={{ fontSize: 13, color: "var(--ink-3)" }}>
                {th ? "มีบัญชีแล้ว? " : "Already have an account? "}
                <button type="button" onClick={() => { setAuthMode('signin'); setError(null); setSuccess(null) }}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--accent-ink)", fontWeight: 600, fontSize: 13, padding: 0 }}>
                  {th ? "เข้าสู่ระบบ" : "Sign in"}
                </button>
              </span>
            ) : (
              <span style={{ fontSize: 13, color: "var(--ink-3)" }}>
                {th ? "ยังไม่มีบัญชี? " : "No account? "}
                <button type="button" onClick={() => { setAuthMode('signup'); setError(null); setSuccess(null) }}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--accent-ink)", fontWeight: 600, fontSize: 13, padding: 0 }}>
                  {th ? "สมัครสมาชิก" : "Create one"}
                </button>
              </span>
            )}
          </div>

          <button type="button" onClick={() => { setAuthMode(null); setError(null); setSuccess(null) }}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: "var(--ink-3)", fontSize: 13, marginTop: 4, padding: "8px 0",
            }}>
            ← {th ? "กลับ" : "Back"}
          </button>
        </form>
      </div>
    )
  }

  // Main onboarding screen
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

      {/* Sign in / Sign up card */}
      <div style={{ marginBottom: 20 }}>
        <button
          className="option-card"
          onClick={() => setAuthMode('signin')}
          style={{ width: "100%", textAlign: "left" }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", gap: 24 }}>
            <div className="o-icon">
              <Icon name="leaf" size={22} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h3 className="display" style={{ fontSize: 24, margin: "0 0 8px", display: "block" }}>
                {th ? "เข้าสู่ระบบ / สมัครสมาชิก" : "Sign in / Create account"}
                <span className="chip chip-soft" style={{ marginLeft: 10, verticalAlign: "middle", fontSize: 11 }}>
                  {th ? "แนะนำ" : "Recommended"}
                </span>
              </h3>
              <p style={{ color: "var(--ink-3)", margin: 0, fontSize: 14, lineHeight: 1.5 }}>
                {th
                  ? "บันทึกพอร์ตของคุณบน cloud เข้าถึงได้ทุกที่ ปลอดภัยด้วย RLS"
                  : "Save your portfolio to the cloud, access anywhere, secured with Row-Level Security."}
              </p>
            </div>
            <div style={{ alignSelf: "center", color: "var(--ink-3)" }}>
              <Icon name="chevron" size={18} />
            </div>
          </div>
        </button>
      </div>

      {/* Demo button */}
      <div style={{ textAlign: "center", marginTop: 32 }}>
        <div className="label-up" style={{ marginBottom: 16 }}>
          {th ? "หรือ" : "Or"}
        </div>
        <button
          onClick={() => { setDataState("demo"); setRoute("dashboard") }}
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
            {th ? "ไม่ต้องเชื่อม" : "no setup"}
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
        <span>{th ? "เข้ารหัสฝั่งลูกค้า · อ่านอย่างเดียว · ไม่เก็บคีย์ส่วนตัว" : "Client-side encryption · Read-only · We never store private keys"}</span>
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
