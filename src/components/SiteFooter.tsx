import './SiteFooter.css'

type SiteFooterProps = {
  currentView: 'workbench' | 'library' | 'promptLibrary' | 'plan' | 'recharge' | 'auth' | 'inspiration'
  isLoggedIn: boolean
}

function getCurrentViewLabel(view: SiteFooterProps['currentView']) {
  if (view === 'library') return '作品库'
  if (view === 'inspiration') return '灵感广场'
  if (view === 'promptLibrary') return '提示词库'
  if (view === 'plan' || view === 'recharge') return '计划与额度'
  if (view === 'auth') return '登录与注册'
  return '工作台'
}

export default function SiteFooter({ currentView, isLoggedIn }: SiteFooterProps) {
  const brandNote = isLoggedIn
    ? '面向图像生成、模板复用和个人结果沉淀的创作工作台。'
    : '可先试填图像需求、浏览官方模板，登录后再查看个人结果与额度。'
  const sectionSummary = isLoggedIn
    ? '工作台 · 灵感广场 · 提示词库 · 作品资产 · 计划与额度'
    : '工作台 · 灵感广场 · 提示词库 · 登录 / 注册'

  return (
    <footer className="site-footer-shell" aria-label="全站底部信息">
      <div className="site-footer-panel">
        <div className="site-footer-brand">
          <div className="site-footer-brand-mark" aria-hidden="true">
            <span />
          </div>
          <div className="site-footer-brand-copy">
            <span className="site-footer-kicker">SST Creative Workspace</span>
            <strong>SST 创作工作台</strong>
          </div>
          <p className="site-footer-brand-note">{brandNote}</p>
        </div>

        <div className="site-footer-main">
          <div className="site-footer-columns">
            <section className="site-footer-column" aria-label="产品状态">
              <h2>产品状态</h2>
              <ul>
                <li>当前页面：{getCurrentViewLabel(currentView)}</li>
                <li>{isLoggedIn ? '已登录，可继续生成并沉淀个人结果' : '访客态，可先试填工作台与浏览官方模板'}</li>
              </ul>
            </section>
          </div>

          <div className="site-footer-bottom">
            <span>{sectionSummary}</span>
          </div>
        </div>
      </div>
    </footer>
  )
}
