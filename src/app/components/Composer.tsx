import { ArrowUp, Square } from 'lucide-react'
import { useEffect, useRef, type KeyboardEvent } from 'react'

import { MAX_MESSAGE_CHARS } from '../../shared/config'
import { cx } from '../lib/cx'

export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  busy,
  disabled,
  placeholder,
  autoFocus,
}: {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  onStop: () => void
  /** A reply is being generated. */
  busy: boolean
  disabled?: boolean
  placeholder?: string
  autoFocus?: boolean
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`
  }, [value])
  useEffect(() => {
    if (autoFocus && !disabled) ref.current?.focus()
  }, [autoFocus, disabled])
  const canSend = !disabled && !busy && value.trim().length > 0 && value.length <= MAX_MESSAGE_CHARS
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      if (canSend) onSend()
    }
  }
  const over = value.length > MAX_MESSAGE_CHARS
  return (
    <div className={cx('rounded-[22px] bg-surface shadow-composer transition-[box-shadow] focus-within:shadow-[0_1px_2px_rgb(27_26_23/0.05),0_8px_32px_-12px_rgb(27_26_23/0.22),0_0_0_1px_rgb(27_26_23/0.14)]', disabled && 'opacity-70')}>
      <textarea
        ref={ref}
        rows={1}
        value={value}
        disabled={disabled}
        placeholder={placeholder ?? 'Message'}
        aria-label="Message"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        className="scrollbar-thin block w-full resize-none bg-transparent px-4 pb-1 pt-3.5 text-[15px] leading-[1.5] text-fg placeholder:text-faint focus:outline-none"
      />
      <div className="flex items-center justify-between px-2 pb-2">
        <span className={cx('pl-2 text-[12px] tabular-nums', over ? 'text-danger' : 'text-transparent')} aria-live="polite">
          {over ? `${value.length.toLocaleString()} / ${MAX_MESSAGE_CHARS.toLocaleString()}` : ''}
        </span>
        {busy ? (
          <button type="button" onClick={onStop} aria-label="Stop" className="grid size-8 place-items-center rounded-full bg-fg text-white transition-transform active:scale-95">
            <Square className="size-3.5 fill-current" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onSend}
            disabled={!canSend}
            aria-label="Send"
            className="grid size-8 place-items-center rounded-full bg-fg text-white transition-[opacity,transform] active:scale-95 disabled:opacity-25"
          >
            <ArrowUp className="size-4" />
          </button>
        )}
      </div>
    </div>
  )
}
