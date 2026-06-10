import { useEffect, useMemo, useState } from 'react'
import './PlanAndBillingView.css'
import { useStore } from '../store'
import { GUEST_RETURN_TO_WORKBENCH_LABEL } from '../lib/accessCopy'
import { getAccountLedger, getMyReferralInfo, type AccountLedgerRecord } from '../lib/authApi'
import RechargeAndResultView from './RechargeAndResultView'

type LedgerFilter = 'all' | 'income' | 'expense'
type LedgerRecordType = 'income' | 'expense' | 'neutral'

const LEDGER_PAGE_SIZE = 6
const PRICE_MATRIX = [
  { tier: '1K', copy: '轻量草图、社媒配图', low: 1, medium: 2, high: 3 },
  { tier: '2K', copy: '常规成片、详情预览', low: 2, medium: 3, high: 4 },
  { tier: '4K', copy: '高清海报、精修输出', low: 4, medium: 5, high: 6 },
] as const

function formatDateTime(timestamp: number | null) {
  if (!timestamp) return '刚刚还没有充值记录'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp))
}

function formatAmount(value: number | null | undefined) {
  const safe = typeof value === 'number' && Number.isFinite(value) ? value : 0
  return Number.isInteger(safe) ? String(safe) : safe.toFixed(2)
}

function getQualityLabel(quality: 'auto' | 'low' | 'medium' | 'high') {
  if (quality === 'high') return '高质量'
  if (quality === 'medium') return '中质量'
  if (quality === 'low') return '低质量'
  return '自动质量'
}

function getLedgerTitle(record: AccountLedgerRecord) {
  if (record.type === 'signup_bonus') return '新用户启动礼包'
  if (record.type === 'referral_reward') return '邀请奖励'
  if (record.type === 'referral_signup_bonus') return '邀请注册奖励'
  if (record.type === 'referral_reward_reversal') return '邀请奖励冲正'
  if (record.type === 'recharge_code_redeem') return '余额码兑换'
  if (record.type === 'generation_charge') return '创作扣费'
  if (record.type === 'admin_adjustment') return '余额调整'
  return record.amount >= 0 ? '余额入账' : '余额扣减'
}

function getLedgerMeta(record: AccountLedgerRecord) {
  if (record.note) return record.note
  if (record.type === 'signup_bonus') return '注册后自动发放'
  if (record.type === 'referral_reward') return '邀请新用户注册'
  if (record.type === 'referral_signup_bonus') return '通过邀请注册'
  if (record.type === 'generation_charge') return '生成成功后扣点'
  if (record.relatedId) return `关联 ${record.relatedId}`
  return '账号余额变化'
}

function mapAccountLedgerRecord(record: AccountLedgerRecord) {
  const amount = Number.isFinite(record.amount) ? record.amount : 0
  const createdAt = Date.parse(record.createdAt)
  const recordType: LedgerRecordType = amount > 0 ? 'income' : amount < 0 ? 'expense' : 'neutral'
  return {
    id: record.id,
    createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
    type: recordType,
    status: '成功',
    statusTone: 'success',
    title: getLedgerTitle(record),
    meta: getLedgerMeta(record),
    amount,
    amountLabel: amount > 0 ? `+${formatAmount(amount)}` : amount < 0 ? `-${formatAmount(Math.abs(amount))}` : '0',
    balanceAfter: record.balanceAfter,
  }
}

export default function PlanAndBillingView() {
  const account = useStore((s) => s.account)
  const authSessionToken = useStore((s) => s.authSessionToken)
  const billing = useStore((s) => s.billing)
  const setGalleryView = useStore((s) => s.setGalleryView)
  const setAccountState = useStore((s) => s.setAccountState)
  const showToast = useStore((s) => s.showToast)
  const [ledgerFilter, setLedgerFilter] = useState<LedgerFilter>('all')
  const [ledgerPage, setLedgerPage] = useState(1)
  const [accountLedger, setAccountLedger] = useState<AccountLedgerRecord[] | null>(null)
  const [accountLedgerError, setAccountLedgerError] = useState<string | null>(null)
  const [accountLedgerLoading, setAccountLedgerLoading] = useState(false)

  useEffect(() => {
    const token = authSessionToken?.trim()
    if (!account.isLoggedIn || !token) {
      setAccountLedger(null)
      setAccountLedgerError(null)
      setAccountLedgerLoading(false)
      return
    }

    let cancelled = false
    setAccountLedger(null)
    setAccountLedgerError(null)
    setAccountLedgerLoading(true)
    getAccountLedger(token, 100)
      .then((records) => {
        if (cancelled) return
        setAccountLedger(records)
        setAccountLedgerError(null)
      })
      .catch((error) => {
        if (cancelled) return
        setAccountLedger(null)
        setAccountLedgerError(error instanceof Error ? error.message : '余额流水加载失败')
      })
      .finally(() => {
        if (!cancelled) setAccountLedgerLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [account.isLoggedIn, account.userId, authSessionToken])

  useEffect(() => {
    const token = authSessionToken?.trim()
    if (!account.isLoggedIn || account.inviteCode?.trim() || !token) return

    let cancelled = false
    getMyReferralInfo(token)
      .then((payload) => {
        if (!cancelled) setAccountState({ inviteCode: payload.referral.inviteCode })
      })
      .catch(() => {
        if (!cancelled) showToast('邀请信息加载失败，请稍后刷新账号状态', 'info')
      })

    return () => {
      cancelled = true
    }
  }, [account.inviteCode, account.isLoggedIn, authSessionToken, setAccountState, showToast])

  const inviteCode = account.inviteCode?.trim() ?? ''
  const hasBackendSession = Boolean(account.isLoggedIn && authSessionToken?.trim())
  const canUseLocalBilling = !hasBackendSession
  const accountScopeLabel = useMemo(() => {
    if (!account.isLoggedIn) return '未登录'
    const email = account.email?.trim()
    const userId = account.userId?.trim()
    const suffix = userId ? userId.slice(-6) : ''
    if (email) return `${email}${suffix ? ` · ${suffix}` : ''}`
    return suffix ? `${account.displayName} · ${suffix}` : account.displayName
  }, [account.displayName, account.email, account.isLoggedIn, account.userId])
  const inviteLink = useMemo(() => {
    if (!inviteCode || typeof window === 'undefined') return ''
    const url = new URL('/register', window.location.origin)
    url.searchParams.set('inviteCode', inviteCode)
    return url.toString()
  }, [inviteCode])
  const latestRechargeRecords = canUseLocalBilling
    ? billing.rechargeHistory.filter((record) => record.status === 'success').slice(0, 2)
    : []
  const latestSuccessfulRecharge = latestRechargeRecords[0] ?? null
  const localLedgerRecords = useMemo(() => [
    ...billing.rechargeHistory
      .map((record) => ({
        id: record.id,
        createdAt: record.createdAt,
        type: (record.status === 'success' ? 'income' : 'neutral') as LedgerRecordType,
        status: record.status === 'success' ? '成功' : record.status === 'failed' ? '失败' : '已取消',
        statusTone: record.status === 'success' ? 'success' : record.status === 'failed' ? 'failed' : 'cancelled',
        title: record.status === 'success' ? '余额码兑换' : record.status === 'failed' ? '兑换失败' : '兑换取消',
        meta: record.code ? `余额码 ${record.code}` : '余额码',
        amount: record.status === 'success' ? record.amount : 0,
        amountLabel: record.status === 'success' ? `+${formatAmount(record.amount)}` : '0',
        balanceAfter: record.balanceAfter ?? account.balance,
      })),
    ...billing.usageHistory.map((record) => ({
      id: record.id,
      createdAt: record.createdAt,
      type: 'expense' as const,
      status: '成功',
      statusTone: 'success',
      title: '创作扣费',
      meta: `${record.sourceMode === 'agent' ? '对话创作' : '工作台创作'} · ${getQualityLabel(record.quality)} · ${record.outputCount} 张`,
      amount: -record.amount,
      amountLabel: `-${formatAmount(record.amount)}`,
      balanceAfter: record.balanceAfter,
    })),
  ].sort((a, b) => b.createdAt - a.createdAt), [account.balance, billing.rechargeHistory, billing.usageHistory])
  const balanceLedgerRecords = useMemo(() => {
    if (accountLedger) {
      return accountLedger.map(mapAccountLedgerRecord).sort((a, b) => b.createdAt - a.createdAt)
    }
    return canUseLocalBilling ? localLedgerRecords : []
  }, [accountLedger, canUseLocalBilling, localLedgerRecords])

  const filteredLedgerRecords = useMemo(() => balanceLedgerRecords.filter((record) => {
    if (ledgerFilter === 'all') return true
    return record.type === ledgerFilter
  }), [balanceLedgerRecords, ledgerFilter])
  const ledgerPageCount = Math.max(1, Math.ceil(filteredLedgerRecords.length / LEDGER_PAGE_SIZE))
  const safeLedgerPage = Math.min(ledgerPage, ledgerPageCount)
  const pagedLedgerRecords = useMemo(
    () => filteredLedgerRecords.slice(
      (safeLedgerPage - 1) * LEDGER_PAGE_SIZE,
      safeLedgerPage * LEDGER_PAGE_SIZE,
    ),
    [filteredLedgerRecords, safeLedgerPage],
  )
  const { totalIncome, totalExpense } = useMemo(() => {
    let income = 0
    let expense = 0
    for (const record of balanceLedgerRecords) {
      if (record.amount > 0) {
        income += record.amount
      } else if (record.amount < 0) {
        expense += Math.abs(record.amount)
      }
    }
    return { totalIncome: income, totalExpense: expense }
  }, [balanceLedgerRecords])

  const updateLedgerFilter = (nextFilter: LedgerFilter) => {
    setLedgerFilter(nextFilter)
    setLedgerPage(1)
  }

  const copyInviteValue = async (value: string, label: string) => {
    if (!value) {
      showToast('当前账号暂未生成邀请码', 'error')
      return
    }
    try {
      const { copyTextToClipboard } = await import('../lib/clipboard')
      await copyTextToClipboard(value)
      showToast(`${label}已复制`, 'success')
    } catch (error) {
      console.error(error)
      const { getClipboardFailureMessage } = await import('../lib/clipboard')
      showToast(getClipboardFailureMessage(`${label}复制失败`, error), 'error')
    }
  }

  return (
    <section className="plan-view-shell" aria-label="计划与额度">
      <div className="plan-view-hero">
        <div className="plan-view-copy">
          <h1 className="plan-view-title">计划与额度</h1>
          <p className="plan-view-subtitle">
            {account.isLoggedIn ? `当前账号：${accountScopeLabel}。邀请链接、余额和流水都按这个账号显示。` : '登录后查看账号余额、邀请链接和点数流水。'}
          </p>
        </div>
        <div className="plan-view-hero-actions">
          {account.isLoggedIn ? (
            <button
              type="button"
              className="plan-view-primary"
              onClick={() => copyInviteValue(inviteLink, '邀请链接')}
              disabled={!inviteLink}
            >
              {inviteLink ? '复制邀请链接' : '邀请码加载中'}
            </button>
          ) : null}
          <button type="button" className="plan-view-secondary" onClick={() => setGalleryView('workbench')}>
            {account.isLoggedIn ? '返回工作台' : GUEST_RETURN_TO_WORKBENCH_LABEL}
          </button>
        </div>
      </div>

      <div className="plan-view-grid">
        <RechargeAndResultView />

        <section className="plan-card">
          <div className="plan-card-head">
            <h2>扣费规则</h2>
          </div>
          <div className="plan-rule-layout">
            <div className="plan-rule-strip">
              <span>最近充值：{latestSuccessfulRecharge ? formatDateTime(latestSuccessfulRecharge.createdAt) : '暂无'}</span>
              <strong>生成成功后按成片数量扣点</strong>
              <small>失败、取消、超时或被拦截不扣点；部分成功时，只按成功生成的图片张数扣点。</small>
            </div>
            <div className="plan-price-table" aria-label="扣费价格表">
              <div className="plan-price-row is-head">
                <span>规格</span>
                <span>低/自动</span>
                <span>中质量</span>
                <span>高质量</span>
              </div>
              {PRICE_MATRIX.map((row) => (
                <div key={row.tier} className="plan-price-row">
                  <span>
                    <strong>{row.tier}</strong>
                    <small>{row.copy}</small>
                  </span>
                  <b>{row.low} 点/张</b>
                  <b>{row.medium} 点/张</b>
                  <b>{row.high} 点/张</b>
                </div>
              ))}
            </div>
            <div className="plan-estimate-ticket" aria-label="扣费小票示例">
              <span>生成前预估</span>
              <strong>2K · 中质量 · 2 张 = 6 点</strong>
              <small>实际扣费以成功返回的图片数量为准，扣费后会自动写入余额流水。</small>
            </div>
          </div>
        </section>

        <div className="plan-side-stack">
          {account.isLoggedIn ? (
            <section id="invite-registration" className="plan-card plan-invite-card" aria-label="邀请链接">
              <div className="plan-card-head plan-invite-head">
                <div>
                  <h2>邀请链接</h2>
                  <p>复制下面的链接发给对方，对方打开后会进入带邀请码的注册页。</p>
                </div>
              </div>
              {inviteCode ? (
                <div className="plan-invite-fields">
                  <div className="plan-invite-field">
                    <span>邀请码</span>
                    <strong>{inviteCode}</strong>
                  </div>
                  <div className="plan-invite-field">
                    <span>邀请链接</span>
                    <strong>{inviteLink}</strong>
                  </div>
                </div>
              ) : (
                <div className="plan-empty-note">
                  <strong>暂无邀请码</strong>
                  <p>请刷新登录状态，或稍后重新进入本页。</p>
                </div>
              )}
              <div className="plan-invite-actions">
                <button type="button" onClick={() => copyInviteValue(inviteCode, '邀请码')} disabled={!inviteCode}>
                  复制邀请码
                </button>
                <button type="button" onClick={() => copyInviteValue(inviteLink, '邀请链接')} disabled={!inviteLink}>
                  复制邀请链接
                </button>
              </div>
            </section>
          ) : null}

          <section className="plan-card">
            <div className="plan-card-head plan-ledger-head">
              <div>
                <h2>余额流水</h2>
                <p>这里是账号点数流水，包含启动赠额、邀请奖励、余额码入账、扣费和余额变化，不等同于充值订单。</p>
              </div>
              <div className="plan-ledger-summary" aria-label="流水汇总">
                <span>入账 <strong>+{formatAmount(totalIncome)}</strong></span>
                <span>支出 <strong>-{formatAmount(totalExpense)}</strong></span>
              </div>
            </div>
            {account.isLoggedIn ? (
              <div className="plan-ledger-note">
                <strong>余额以当前登录账号为准：{accountScopeLabel}</strong>
                <span>如果看到“新用户启动礼包”或邀请奖励，表示后台曾写入点数流水；即使后来扣到 0，也会保留这条历史记录。</span>
              </div>
            ) : null}
            <div className="plan-ledger-toolbar" aria-label="流水筛选">
              {([
                ['all', '全部'],
                ['income', '入账'],
                ['expense', '支出'],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={ledgerFilter === value ? 'is-active' : ''}
                  onClick={() => updateLedgerFilter(value)}
                >
                  {label}
                </button>
              ))}
              <span>{accountLedgerLoading ? '加载中' : `共 ${filteredLedgerRecords.length} 条`}</span>
            </div>
            {accountLedgerLoading ? (
              <div className="plan-empty-note">
                <strong>正在加载余额流水</strong>
                <p>正在读取当前登录账号的入账、扣费和余额变化。</p>
              </div>
            ) : pagedLedgerRecords.length > 0 ? (
              <div className="plan-history-shell">
                {accountLedgerError ? (
                  <div className="plan-empty-note">
                    <strong>余额流水加载失败</strong>
                    <p>{accountLedgerError}</p>
                  </div>
                ) : null}
                <div className="plan-history-list">
                  {pagedLedgerRecords.map((record) => (
                    <article key={record.id} className={`plan-history-item is-${record.type}`}>
                      <div className={`plan-history-type is-${record.type}`}>{record.type === 'income' ? '+' : record.type === 'expense' ? '-' : '·'}</div>
                      <div className="plan-history-main">
                        <span className="plan-history-date">{formatDateTime(record.createdAt)}</span>
                        <strong className="plan-history-title">{record.title}</strong>
                        <small className="plan-history-meta">{record.meta}</small>
                      </div>
                      <div className="plan-history-metric">
                        <span>变动</span>
                        <strong className={record.type === 'income' ? 'is-income' : record.type === 'expense' ? 'is-expense' : 'is-neutral'}>{record.amountLabel}</strong>
                      </div>
                      <div className="plan-history-metric">
                        <span>余额</span>
                        <strong>{formatAmount(record.balanceAfter)}</strong>
                      </div>
                      <div className="plan-history-metric plan-history-status-cell">
                        <span>状态</span>
                        <strong className={`plan-history-status is-${record.statusTone}`}>{record.status}</strong>
                      </div>
                    </article>
                  ))}
                </div>
                <div className="plan-ledger-pagination" aria-label="流水分页">
                  <button type="button" onClick={() => setLedgerPage((page) => Math.max(1, page - 1))} disabled={safeLedgerPage <= 1}>
                    上一页
                  </button>
                  <span>{safeLedgerPage} / {ledgerPageCount}</span>
                  <button type="button" onClick={() => setLedgerPage((page) => Math.min(ledgerPageCount, page + 1))} disabled={safeLedgerPage >= ledgerPageCount}>
                    下一页
                  </button>
                </div>
              </div>
            ) : (
              <div className="plan-empty-note">
                <strong>暂无余额流水</strong>
                <p>
                  {accountLedgerError
                    ? accountLedgerError
                    : account.isLoggedIn
                    ? '完成余额码兑换或出图扣费后会显示在这里。'
                    : '登录后，余额变化会显示在这里。'}
                </p>
              </div>
            )}
          </section>
        </div>
      </div>
    </section>
  )
}
