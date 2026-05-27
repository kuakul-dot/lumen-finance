import { useState, useEffect } from 'react'
import { Icon } from './Nav'
import { supabase } from '../lib/supabase'

const REMEMBER_KEY = 'lumen_remember_email'

export function OnboardingPage({ t, lang, setRoute, setDataState, session, signOut }) {
  const [authMode, setAuthMode] = useState(null) // null | 'signin' | 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [remember, setRemember] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)

  const th = lang === "th"

  // Pre-fill email from localStorage if user previously checked "Remember me"
  useEffect(() => {
    try {
      const saved = localStorage.getItem(REMEMBER_KEY)
      if (saved) {
        setEmail(saved)
        setRemember(true)
      }
    } catch {}
  }, [])

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
        // Persist email if user checked "Remember me"
        try {
          if (remember) localStorage.setItem(REMEMBER_KEY, email)
          else localStorage.removeItem(REMEMBER_KEY)
        } catch {}
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
            <label htmlFor="auth-email" style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-2)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
              {th ? "อีเมล" : "Email"}
            </label>
            <input
              id="auth-email"
              type="email"
              name="email"
              required
              autoComplete="username"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="your@email.com"
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
            <label htmlFor="auth-password" style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-2)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
              {th ? "รหัสผ่าน" : "Password"}
            </label>
            <div style={{ position: "relative" }}>
              <input
                id="auth-password"
                type={showPassword ? "text" : "password"}
                name="password"
                required
                minLength={6}
                autoComplete={authMode === 'signup' ? "new-password" : "current-password"}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={th ? "อย่างน้อย 6 ตัวอักษร" : "At least 6 characters"}
                style={{
                  padding: "13px 44px 13px 16px", borderRadius: 10, fontSize: 15,
                  border: "1.5px solid var(--line)", background: "var(--bg)",
                  color: "var(--ink)", outline: "none", width: "100%", boxSizing: "border-box",
                }}
                onFocus={e => e.target.style.borderColor = "var(--accent)"}
                onBlur={e => e.target.style.borderColor = "var(--line)"}
              />
              <button
                type="button"
                onClick={() => setShowPassword(s => !s)}
                aria-label={showPassword ? (th ? "ซ่อนรหัสผ่าน" : "Hide password") : (th ? "แสดงรหัสผ่าน" : "Show password")}
                style={{
                  position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)",
                  background: "none", border: "none", cursor: "pointer",
                  padding: "8px 10px", color: "var(--ink-3)", display: "inline-flex",
                  alignItems: "center", justifyContent: "center", borderRadius: 6,
                }}
              >
                <Icon name={showPassword ? "eye-off" : "eye"} size={16} />
              </button>
            </div>
          </div>

          {/* Remember me + Forgot password row */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 2 }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, color: "var(--ink-2)", userSelect: "none" }}>
              <input
                type="checkbox"
                checked={remember}
                onChange={e => setRemember(e.target.checked)}
                style={{
                  width: 16, height: 16, cursor: "pointer",
                  accentColor: "var(--accent)",
                }}
              />
              {th ? "จำฉันไว้" : "Remember me"}
            </label>
            {authMode === 'signin' && (
              <button
                type="button"
                onClick={async () => {
                  if (!email) {
                    setError(th ? "กรอกอีเมลก่อนแล้วกด \"ลืมรหัสผ่าน?\"" : "Enter your email first, then click \"Forgot password?\"")
                    return
                  }
                  setLoading(true); setError(null); setSuccess(null)
                  try {
                    const { error } = await supabase.auth.resetPasswordForEmail(email, {
                      redirectTo: window.location.origin,
                    })
                    if (error) throw error
                    setSuccess(th ? "ส่งลิงก์รีเซ็ตรหัสผ่านไปที่อีเมลแล้ว" : "Password reset link sent to your email.")
                  } catch (err) { setError(err.message) }
                  finally { setLoading(false) }
                }}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  color: "var(--accent-ink)", fontSize: 13, fontWeight: 500, padding: 0,
                }}
              >
                {th ? "ลืมรหัสผ่าน?" : "Forgot password?"}
              </button>
            )}
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
