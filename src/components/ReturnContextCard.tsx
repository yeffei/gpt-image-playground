export interface ReturnContextCardContent {
  kicker: string
  title: string
  description: string
  action: string
}

interface ReturnContextCardProps {
  content: ReturnContextCardContent
  dismissLabel: string
  onDismiss: () => void
}

export default function ReturnContextCard({ content, dismissLabel, onDismiss }: ReturnContextCardProps) {
  return (
    <div className="prototype-return-card" role="status" aria-live="polite">
      <div className="prototype-return-card-copy">
        {content.kicker ? <span className="prototype-return-card-kicker">{content.kicker}</span> : null}
        <strong>{content.title}</strong>
        <p>{content.description}</p>
        {content.action ? <small>{content.action}</small> : null}
      </div>
      <button
        type="button"
        className="prototype-return-card-dismiss"
        onClick={onDismiss}
        aria-label={dismissLabel}
      >
        知道了
      </button>
    </div>
  )
}
