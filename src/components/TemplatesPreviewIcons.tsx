import { FavoriteIcon, PhotoIcon, PlusIcon, CopyIcon, WrenchIcon, ChevronRightIcon } from './icons'

export { FavoriteIcon, PhotoIcon, PlusIcon, CopyIcon, WrenchIcon, ChevronRightIcon }

export function SearchIconLike(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.3-4.3m1.8-5.2a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  )
}

