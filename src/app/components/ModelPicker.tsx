import { AnimatePresence, motion } from 'motion/react'
import { Check, ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { MODELS } from '../../shared/config'
import { useModels } from '../lib/api'
import { cx } from '../lib/cx'

/** A quiet pill naming the model; opens a list with each model's one-liner. */
export function ModelPicker({ value, onChange, disabled }: { value: string; onChange: (id: string) => void; disabled?: boolean }) {
  const { data } = useModels()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const models = data?.items ?? MODELS.map((m) => ({ ...m, available: true }))
  const current = models.find((m) => m.id === value) ?? models[0]
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-8 items-center gap-1.5 rounded-tile px-2.5 text-[13px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-50"
      >
        {current?.name ?? value}
        <ChevronDown className="size-3.5 text-faint" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.ul
            role="listbox"
            aria-label="Model"
            initial={{ opacity: 0, y: 4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={{ duration: 0.14 }}
            className="absolute left-0 top-full z-40 mt-1 w-[280px] rounded-[14px] bg-surface p-1 shadow-pop"
          >
            {models.map((model) => (
              <li key={model.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={model.id === value}
                  disabled={!model.available}
                  onClick={() => {
                    onChange(model.id)
                    setOpen(false)
                  }}
                  className={cx('flex w-full items-start gap-3 rounded-tile px-2.5 py-2 text-left transition-colors hover:bg-surface-2 disabled:opacity-40 disabled:hover:bg-transparent')}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] font-medium">{model.name}</span>
                    <span className="block text-[12px] text-faint">{model.available ? model.description : 'Not available right now'}</span>
                  </span>
                  {model.id === value && <Check className="mt-0.5 size-4 shrink-0 text-fg" />}
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  )
}
