import type { InspirationHomePostCard } from '../types'

export function InspirationOverlayCard(props: {
  item: InspirationHomePostCard
  onOpen: (postId: string) => void
  aspectClass?: string
  className?: string
}) {
  const aspectClass = props.aspectClass ?? 'aspect-[16/8.8]'
  const className = props.className ?? ''

  return (
    <button
      type="button"
      onClick={() => props.onOpen(props.item.id)}
      className={`group w-full overflow-hidden rounded-[20px] border border-white/70 bg-white/72 text-left shadow-[0_14px_32px_rgba(15,23,42,0.06)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_40px_rgba(15,23,42,0.1)] ${className}`.trim()}
    >
      <div className={`relative ${aspectClass} overflow-hidden bg-slate-100`}>
        <img
          src={props.item.imageUrl}
          alt={props.item.title ?? props.item.category}
          className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.02]"
        />
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/92 via-slate-950/56 via-42% to-transparent px-2.5 pb-2.5 pt-12 text-white sm:px-3 sm:pb-3">
          <div className="inline-flex max-w-[82%] items-center rounded-full bg-slate-950/72 px-2.5 py-1 shadow-[0_8px_20px_rgba(15,23,42,0.2)] backdrop-blur-md">
            <div className="line-clamp-1 text-[11.5px] font-medium leading-4 text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.35)]">
              {props.item.title ?? '灵感作品'}
            </div>
          </div>
        </div>
      </div>
    </button>
  )
}
