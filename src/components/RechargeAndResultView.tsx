import { useMemo, useState } from 'react'
import { useStore, getWorkbenchAccessState } from '../store'
import {
  GUEST_ENTER_RECHARGE_FLOW_LABEL,
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
  const activePackage = RECHARGE_PACKAGES.find((item) => item.points === amount) ?? RECHARGE_PACKAGES[0]
  const accessState = useMemo(() => getWorkbenchAccessState(account), [account])
  const isSuccess = billing.rechargeFlowStatus === 'success'
  const isRedeeming = billing.rechargeFlowStatus === 'processing'
  const codeExample = `SP-${amount}-20260609-008-0001-ABCD1234`

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
                  <p>{activePackage.title} · 购买后会获得对应点数的余额码</p>
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
                  <h2>购买余额码</h2>
                  <p>跳转到小铺付款，复制完整余额码后回到这里兑换</p>
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
                  <h2>兑换入账</h2>
                  <p>兑换成功后点数立即进入当前登录账号</p>
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
              {isSuccess && accessState !== 'guest' ? (
                <div className="recharge-success-actions recharge-success-actions-inline">
                  <button type="button" className="recharge-primary-button" onClick={() => setGalleryView('workbench')}>
                    回到工作台继续创作
                  </button>
                  <button type="button" className="recharge-secondary-button" onClick={() => setGalleryView('plan')}>
                    查看计划与额度
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </section>
      </div>
    </section>
  )
}
