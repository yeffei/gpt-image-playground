import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import './AuthView.css'
import { useStore } from '../store'
import {
  AuthApiError,
  accountFromAuthPayload,
  getPublicAuthSettings,
  loginWithPassword,
  registerWithEmailCode,
  resetPasswordWithEmailCode,
  sendAuthVerificationCode,
} from '../lib/authApi'

type SubmitState = 'idle' | 'submitting' | 'success' | 'failed'
type CodePurpose = 'register' | 'password_reset'

function getModeTitle(mode: 'login' | 'register' | 'recover') {
  if (mode === 'register') return '注册账号'
  if (mode === 'recover') return '找回密码'
  return '登录账号'
}

function getModeSubtitle(mode: 'login' | 'register' | 'recover') {
  if (mode === 'register') return '使用邮箱验证码创建账号，之后同步额度、作品和模板。'
  if (mode === 'recover') return '通过邮箱验证码重置密码，完成后自动回到当前入口。'
  return '使用邮箱和密码登录，继续刚才的创作流程。'
}

function getPrimaryActionLabel(mode: 'login' | 'register' | 'recover') {
  if (mode === 'register') return '注册并进入'
  if (mode === 'recover') return '重置并登录'
  return '登录'
}

function isLikelyEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function getRedirectTitle(view: 'workbench' | 'plan' | 'library' | 'promptLibrary') {
  if (view === 'plan') return '计划与额度'
  if (view === 'library') return '作品库'
  if (view === 'promptLibrary') return '提示词库'
  return '工作台'
}

function getErrorMessage(error: unknown) {
  if (error instanceof AuthApiError || error instanceof Error) return error.message
  return '账号请求失败，请稍后重试'
}

export default function AuthView() {
  const authViewMode = useStore((s) => s.authViewMode)
  const authRedirectView = useStore((s) => s.authRedirectView)
  const setAuthViewMode = useStore((s) => s.setAuthViewMode)
  const setGalleryView = useStore((s) => s.setGalleryView)
  const completeAuthSession = useStore((s) => s.completeAuthSession)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [code, setCode] = useState('')
  const [submitState, setSubmitState] = useState<SubmitState>('idle')
  const [statusMessage, setStatusMessage] = useState('')
  const [codeSending, setCodeSending] = useState(false)
  const [cooldownUntil, setCooldownUntil] = useState(0)
  const [now, setNow] = useState(Date.now())
  const [registrationEnabled, setRegistrationEnabled] = useState(true)
  const redirectTimerRef = useRef<number | null>(null)
  const inviteUrlAppliedRef = useRef(false)

  const redirectTitle = useMemo(() => getRedirectTitle(authRedirectView), [authRedirectView])
  const normalizedEmail = email.trim().toLowerCase()
  const emailReady = isLikelyEmail(normalizedEmail)
  const isSubmitting = submitState === 'submitting' || submitState === 'success'
  const codePurpose: CodePurpose = authViewMode === 'recover' ? 'password_reset' : 'register'
  const cooldownSeconds = Math.max(0, Math.ceil((cooldownUntil - now) / 1000))
  const canSendCode = authViewMode !== 'login'
    && (authViewMode !== 'register' || registrationEnabled)
    && emailReady
    && !codeSending
    && cooldownSeconds <= 0

  useEffect(() => {
    if (inviteUrlAppliedRef.current) return
    if (typeof window === 'undefined') return
    const urlInviteCode = new URLSearchParams(window.location.search).get('inviteCode')?.trim()
    const pathname = window.location.pathname.replace(/\/+$/, '') || '/'
    if (!urlInviteCode && pathname !== '/register') return

    inviteUrlAppliedRef.current = true
    if (urlInviteCode) setInviteCode(urlInviteCode)
    if (authViewMode !== 'register') setAuthViewMode('register')
  }, [authViewMode, setAuthViewMode])

  useEffect(() => {
    let cancelled = false
    getPublicAuthSettings()
      .then((settings) => {
        if (cancelled) return
        setRegistrationEnabled(settings.registrationEnabled)
        if (!settings.registrationEnabled && authViewMode === 'register') {
          setSubmitState('failed')
          setStatusMessage('注册暂未开放，请直接登录已有账号。')
        }
      })
      .catch(() => {
        if (!cancelled) setRegistrationEnabled(true)
      })
    return () => {
      cancelled = true
    }
  }, [authViewMode])

  useEffect(() => {
    if (cooldownUntil <= Date.now()) return
    const timer = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(timer)
  }, [cooldownUntil])

  useEffect(() => () => {
    if (redirectTimerRef.current != null) {
      window.clearTimeout(redirectTimerRef.current)
    }
  }, [])

  const clearRedirectTimer = () => {
    if (redirectTimerRef.current != null) {
      window.clearTimeout(redirectTimerRef.current)
      redirectTimerRef.current = null
    }
  }

  const resetAuthFeedback = () => {
    clearRedirectTimer()
    setSubmitState('idle')
    setStatusMessage('')
    setCode('')
    setPassword('')
    setInviteCode('')
  }

  const handleSendCode = async () => {
    clearRedirectTimer()
    setSubmitState('idle')
    setStatusMessage('')
    if (!emailReady) {
      setSubmitState('failed')
      setStatusMessage('请先输入有效邮箱。')
      return
    }
    if (authViewMode === 'register' && !registrationEnabled) {
      setSubmitState('failed')
      setStatusMessage('注册暂未开放，请直接登录已有账号。')
      return
    }
    setCodeSending(true)
    try {
      const result = await sendAuthVerificationCode(normalizedEmail, codePurpose)
      setCooldownUntil(Date.now() + 60_000)
      setNow(Date.now())
      if (result.devCode) setCode(result.devCode)
      setStatusMessage(result.devCode
        ? `本地开发验证码：${result.devCode}`
        : '验证码已发送，请查收邮箱。')
    } catch (error) {
      setStatusMessage(getErrorMessage(error))
      setSubmitState('failed')
    } finally {
      setCodeSending(false)
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    clearRedirectTimer()
    setSubmitState('submitting')
    setStatusMessage('')
    if (authViewMode === 'register' && !registrationEnabled) {
      setSubmitState('failed')
      setStatusMessage('注册暂未开放，请直接登录已有账号。')
      return
    }
    try {
      const payload = authViewMode === 'login'
        ? await loginWithPassword({ email: normalizedEmail, password })
        : authViewMode === 'register'
        ? await registerWithEmailCode({
            email: normalizedEmail,
            password,
            code,
            displayName: displayName.trim() || undefined,
            inviteCode: inviteCode.trim() || undefined,
          })
        : await resetPasswordWithEmailCode({ email: normalizedEmail, password, code })
      setSubmitState('success')
      setStatusMessage(`验证成功，正在返回${redirectTitle}。`)
      redirectTimerRef.current = window.setTimeout(() => {
        completeAuthSession({
          token: payload.session.token,
          account: accountFromAuthPayload(payload),
        })
        redirectTimerRef.current = null
      }, 360)
    } catch (error) {
      setStatusMessage(getErrorMessage(error))
      setSubmitState('failed')
    }
  }

  const statusCopy = statusMessage || (authViewMode === 'login'
    ? '登录后会自动回到原入口，并可继续提交生成。'
    : '验证码会发送到你的邮箱，10 分钟内有效。')
  const statusTitle = submitState === 'failed'
    ? '提交失败'
    : submitState === 'submitting'
    ? '正在处理'
    : statusMessage.includes('验证码')
    ? '验证码已发送'
    : '提交成功'

  return (
    <section className="auth-view-shell" aria-label="登录与注册">
      <aside className="auth-guest-brief" aria-label="访客入口说明">
        <p className="auth-guest-kicker">账号边界</p>
        <h2>试填不打断，生成与保存需要登录。</h2>
        <p>
          当前入口会保留你刚才的提示词和参数。登录后可以继续提交生成，并把额度、作品和模板同步到账号里。
        </p>
        <div className="auth-guest-paths" aria-label="访客可用入口">
          <span>试填内容会保留</span>
          <span>官方模板可浏览</span>
          <span>登录后同步资产</span>
        </div>
      </aside>
      <section className="auth-card">
        <div className="auth-panel auth-panel-form">
          <div className="auth-panel-head">
            <div className="auth-title-block">
              <div className="auth-context-mark" aria-hidden="true">
                <span />
              </div>
              <div>
                <p className="auth-form-eyebrow">{authViewMode === 'login' ? '账号入口' : authViewMode === 'register' ? '创建账号' : '找回访问'}</p>
                <h1 className="auth-view-title">{getModeTitle(authViewMode)}</h1>
                <p className="auth-view-subtitle">{getModeSubtitle(authViewMode)}返回{redirectTitle}时会保留当前入口。</p>
              </div>
            </div>
            <div className="auth-mode-switch" role="tablist" aria-label="登录与注册切换">
              {[
                { key: 'login', label: '登录' },
                { key: 'register', label: registrationEnabled ? '注册' : '注册暂停' },
                { key: 'recover', label: '找回' },
              ].map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={`auth-mode-chip ${authViewMode === item.key ? 'is-active' : ''}`}
                  onClick={() => {
                    resetAuthFeedback()
                    setAuthViewMode(item.key as 'login' | 'register' | 'recover')
                  }}
                  disabled={isSubmitting}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <form className="auth-form" onSubmit={handleSubmit}>
            <div className="auth-field-list" aria-label="账号字段">
              <label className="auth-field">
                <span>邮箱</span>
                <input
                  value={email}
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={isSubmitting}
                  required
                />
              </label>

              {authViewMode === 'register' ? (
                <div className="auth-register-grid">
                  <label className="auth-field">
                    <span>昵称</span>
                    <input
                      value={displayName}
                      type="text"
                      autoComplete="nickname"
                      placeholder="新创作者"
                      onChange={(event) => setDisplayName(event.target.value)}
                      disabled={isSubmitting}
                    />
                  </label>
                  <label className="auth-field">
                    <span>邀请码</span>
                    <input
                      value={inviteCode}
                      type="text"
                      autoComplete="off"
                      placeholder="留空则普通注册"
                      onChange={(event) => setInviteCode(event.target.value.trim())}
                      disabled={isSubmitting}
                    />
                  </label>
                </div>
              ) : null}

              {authViewMode !== 'login' ? (
                <div className="auth-code-row">
                  <label className="auth-field">
                    <span>验证码</span>
                    <input
                      value={code}
                      inputMode="numeric"
                      pattern="[0-9]{6}"
                      placeholder="6 位数字"
                      onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                      disabled={isSubmitting}
                      required
                    />
                  </label>
                  <button
                    type="button"
                    className="auth-secondary-button auth-code-button"
                    onClick={handleSendCode}
                    disabled={!canSendCode || isSubmitting}
                  >
                    {codeSending ? '发送中...' : cooldownSeconds > 0 ? `${cooldownSeconds}s` : '发送验证码'}
                  </button>
                </div>
              ) : null}

              <label className="auth-field">
                <span>{authViewMode === 'recover' ? '新密码' : '密码'}</span>
                <input
                  value={password}
                  type="password"
                  autoComplete={authViewMode === 'login' ? 'current-password' : 'new-password'}
                  placeholder="至少 8 位"
                  minLength={8}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={isSubmitting}
                  required
                />
              </label>
            </div>

            {submitState !== 'idle' || statusMessage ? (
              <div className={`auth-status-banner ${submitState === 'failed' ? 'is-failed' : 'is-success'}`}>
                <strong>{statusTitle}</strong>
                <p>{statusCopy}</p>
              </div>
            ) : null}

            <div className="auth-form-actions">
              <button
                type="submit"
                className="auth-primary-button"
                disabled={isSubmitting}
              >
                {submitState === 'submitting' || submitState === 'success' ? `正在返回${redirectTitle}...` : getPrimaryActionLabel(authViewMode)}
              </button>
              <button
                type="button"
                className="auth-secondary-button"
                disabled={isSubmitting}
                onClick={() => {
                  resetAuthFeedback()
                  setGalleryView(authRedirectView)
                }}
              >
                先回{redirectTitle}
              </button>
            </div>

            <div className="auth-context-list" aria-label="账号权益">
              <span>额度同步</span>
              <span>作品沉淀</span>
              <span>模板复用</span>
            </div>
          </form>
        </div>
      </section>
    </section>
  )
}
