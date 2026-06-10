import { useMemo, useState } from 'react'
import { useStore, getWorkbenchAccessState } from '../store'
import {
  GUEST_ENTER_RECHARGE_FLOW_LABEL,
  GUEST_RECHARGE_ACCOUNT_COPY,
  GUEST_RECHARGE_EXPLAINER_COPY,
  GUEST_RECHARGE_STATUS_COPY,
} from '../lib/accessCopy'

const THIRD_PARTY_RECHARGE_URL = 'https://catfk.com/'

const RECHARGE_PACKAGES = [
  {
    points: 30,
    priceLabel: '¥9.9',
    title: '入门包',
    meta: '轻量试用',
    hint: '适合偶尔使用，先跑通一次完整创作流程。',
  },
  {
    points: 100,
    priceLabel: '¥29.9',
    title: '标准包',
    meta: '默认推荐',
    hint: '适合日常生成，是当前版本的默认推荐。',
  },
  {
    points: 300,
    priceLabel: '¥79.9',
    title: '重度包',
    meta: '高频创作',
    hint: '适合高频生成、集中出图或短期密集迭代。',
  },
] as const

function formatAmount(amount: number | null | undefined) {
  const safe = typeof amount === 'number' && Number.isFinite(amount) ? amount : 0
  return Number.isInteger(safe) ? String(safe) : safe.toFixed(2)
}

export default function RechargeAndResultView() {
  const account = useStore((s) => s.account)
  const billing = useStore((s) => s.billing)
  const setGalleryView = useStore((s) => s.setGalleryView)
  const setPendingRechargeAmount = useStore((s) => s.setPendingRechargeAmount)
  const setRechargeFlowStatus = useStore((s) => s.setRechargeFlowStatus)
  const redeemRechargeCode = useStore((s) => s.redeemRechargeCode)
  const openLoginDialog = useStore((s) => s.openLoginDialog)
  const [rechargeCode, setRechargeCode] = useState('')

  const amount = billing.pendingRechargeAmount ?? 30
  const amountLabel = formatAmount(amount)
  const activePackage = RECHARGE_PACKAGES.find((item) => item.points === amount) ?? RECHARGE_PACKAGES[0]
  const accessState = useMemo(() => getWorkbenchAccessState(account), [account])
  const isSuccess = billing.rechargeFlowStatus === 'success'
  const isRedeeming = billing.rechargeFlowStatus === 'processing'
  const currentBalanceLabel = accessState === 'guest' ? '登录后显示' : formatAmount(account.balance)
  const projectedBalanceAfterRechargeLabel = accessState === 'guest' ? '登录后显示' : formatAmount(account.balance + amount)
  const codeExample = `SP-${amount}-20260609-008-0001-ABCD1234`

  const resultCopy = useMemo(() => {
    if (accessState === 'guest') return GUEST_RECHARGE_EXPLAINER_COPY
    if (billing.rechargeFlowStatus === 'success') return `当前账号已到账 ${amountLabel} 点，可以回到工作台继续创作。`
    if (billing.rechargeFlowStatus === 'failed') return '在第三方小铺完成购买后，将余额码粘贴到这里兑换入账。'
    if (billing.rechargeFlowStatus === 'cancelled') return '你可以重新粘贴余额码，也可以稍后再处理。'
    return '在第三方小铺完成购买后，将余额码粘贴到这里兑换入账。'
  }, [accessState, amountLabel, billing.rechargeFlowStatus])

  const accessBanner = accessState === 'guest'
    ? {
        tone: 'guest',
        title: '需要先登录',
        copy: GUEST_RECHARGE_STATUS_COPY,
        action: `下一步：${GUEST_ENTER_RECHARGE_FLOW_LABEL}`,
      }
    : accessState === 'no_balance'
    ? {
        tone: 'no-balance',
        title: '可兑换余额码',
        copy: '当前账号余额不足，兑换成功后会直接更新到账户状态。',
        action: '下一步：购买余额码后回本站兑换',
      }
    : {
        tone: 'ready',
        title: '可继续补充点数',
        copy: '当前账号仍可生成，也可以提前兑换余额码，避免中途打断创作。',
        action: '下一步：按需要选择余额码面额',
      }

  const openRechargeShop = () => {
    window.open(THIRD_PARTY_RECHARGE_URL, '_blank', 'noopener,noreferrer')
  }

  const handleRedeemCode = () => {
    if (accessState === 'guest') {
      openLoginDialog()
      return
    }
    void redeemRechargeCode(rechargeCode)
  }

  return (
    <section id="plan-recharge-panel" className="recharge-view-shell is-embedded" aria-label="余额码充值与兑换">
      <div className="recharge-view-grid">
        <section className="recharge-card recharge-card-flow" aria-label="余额码兑换流程">
          <div className="recharge-step-list">
            <div className="recharge-step-panel">
              <div className="recharge-step-head">
                <span>1</span>
                <div>
                  <h2>选择面额</h2>
                  <p>{activePackage.title} · {activePackage.hint}</p>
                </div>
              </div>
              <div className="recharge-amount-grid">
                {RECHARGE_PACKAGES.map((item) => (
                  <button
                    key={item.points}
                    type="button"
                    className={`recharge-amount-chip ${amount === item.points ? 'is-active' : ''}`}
                    onClick={() => {
                      setPendingRechargeAmount(item.points)
                      if (billing.rechargeFlowStatus !== 'idle') setRechargeFlowStatus('idle')
                    }}
                  >
                    <strong>{item.points} 点</strong>
                    <span>{item.priceLabel}</span>
                    <small>{item.meta}</small>
                  </button>
                ))}
              </div>
            </div>

            <div className="recharge-step-panel recharge-step-panel-inline">
              <div className="recharge-step-head">
                <span>2</span>
                <div>
                  <h2>打开小铺购买</h2>
                  <p>第三方负责收款和发码，本站不处理支付。</p>
                </div>
              </div>
              <button type="button" className="recharge-link-button" onClick={openRechargeShop}>
                购买余额码
              </button>
            </div>

            <div className="recharge-step-panel recharge-code-panel">
              <div className="recharge-step-head">
                <span>3</span>
                <div>
                  <h2>粘贴余额码兑换</h2>
                  <p>兑换成功后，点数会加到当前账号。</p>
                </div>
              </div>
              <div className="recharge-code-row">
                <input
                  type="text"
                  value={rechargeCode}
                  placeholder={`例如：${codeExample}`}
                  autoComplete="off"
                  aria-label="余额码"
                  onChange={(event) => {
                    setRechargeCode(event.target.value)
                    if (billing.rechargeFlowStatus !== 'idle') setRechargeFlowStatus('idle')
                  }}
                  disabled={accessState === 'guest'}
                />
                <button type="button" className="recharge-primary-button" onClick={handleRedeemCode} disabled={isRedeeming}>
                  {accessState === 'guest' ? GUEST_ENTER_RECHARGE_FLOW_LABEL : isRedeeming ? '兑换中…' : '兑换入账'}
                </button>
              </div>
              <p className="recharge-code-hint">请粘贴完整兑换码，不是批次号。批次号类似 RCB-20260609-008，不能用于兑换。</p>
            </div>
          </div>
        </section>

        <aside className="recharge-side-stack" aria-label="账号摘要">
          <section className="recharge-card recharge-account-card">
            <div className="recharge-card-head">
              <span className="recharge-card-eyebrow">当前选择</span>
              <h2>{amountLabel} 点 · {activePackage.priceLabel}</h2>
            </div>
            <div className={`recharge-access-banner tone-${accessBanner.tone}`}>
              <strong>{accessBanner.title}</strong>
              <span>{accessBanner.copy}</span>
              <small>{accessBanner.action}</small>
            </div>
            <div className="recharge-success-summary">
              <div>
                <span>账号</span>
                <strong>{account.isLoggedIn ? account.displayName : GUEST_RECHARGE_ACCOUNT_COPY}</strong>
              </div>
              <div>
                <span>当前余额</span>
                <strong>{currentBalanceLabel} 点</strong>
              </div>
              <div>
                <span>{isSuccess ? '到账后余额' : '预计到账后'}</span>
                <strong>{projectedBalanceAfterRechargeLabel} 点</strong>
              </div>
            </div>
            <p className="recharge-card-copy">{resultCopy}</p>
            {isSuccess && accessState !== 'guest' ? (
              <div className="recharge-success-actions">
                <button type="button" className="recharge-primary-button" onClick={() => setGalleryView('workbench')}>
                  回到工作台继续创作
                </button>
                <button type="button" className="recharge-secondary-button" onClick={() => setGalleryView('plan')}>
                  查看计划与额度
                </button>
              </div>
            ) : null}
          </section>
        </aside>
      </div>
    </section>
  )
}
