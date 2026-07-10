import React from 'react'

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: React.ReactNode
  tone?: 'primary' | 'danger'
}

export function Checkbox({ checked, onChange, label, tone = 'primary', className, ...props }: CheckboxProps) {
  const toneClasses = tone === 'danger'
    ? 'border-red-300 bg-white checked:bg-red-500 checked:border-red-500 focus:ring-red-500/20 dark:border-red-400/50 dark:bg-white/10'
    : 'border-slate-300 bg-white checked:bg-[var(--platform-accent-fill,#785cff)] checked:border-[var(--platform-accent-fill,#785cff)] focus:ring-[rgba(123,97,255,0.18)] dark:border-white/25 dark:bg-white/10'

  return (
    <label className={`flex items-center gap-2.5 cursor-pointer group ${className || ''}`}>
      <div className="relative flex items-center justify-center">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className={`peer platform-checkbox h-5 w-5 cursor-pointer appearance-none rounded-md border-2 shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-offset-white dark:focus:ring-offset-gray-900 ${toneClasses}`}
          {...props}
        />
        <svg className="absolute h-3.5 w-3.5 pointer-events-none text-white opacity-0 transition-opacity peer-checked:opacity-100" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      {label && <span className="text-sm font-medium text-gray-700 transition-colors group-hover:text-gray-900 dark:text-gray-200 dark:group-hover:text-white">{label}</span>}
    </label>
  )
}
