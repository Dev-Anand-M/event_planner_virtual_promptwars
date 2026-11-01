import { Check, Copy, RefreshCw } from 'lucide-react'
import { useState } from 'react'

import { cx } from '../lib/cx'
import { Markdown } from './Markdown'
import { Mark } from './Shell'

export function UserMessage({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[78%] whitespace-pre-wrap break-words rounded-bubble rounded-br-[8px] bg-surface-2 px-4 py-2.5 text-[15px] leading-[1.55]">{content}</div>
    </div>
  )
}

export function AssistantMessage({
  content,
  streaming,
  interrupted,
  onRegenerate,
  error,
  onRetry,
}: {
  content: string
  /** Still receiving text: show the caret, hide the actions. */
  streaming?: boolean
  interrupted?: boolean
  onRegenerate?: () => void
  error?: string | null
  onRetry?: () => void
}) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable */
    }
  }
  const waiting = streaming && !content
  return (
    <div className="group flex gap-3.5">
      <Mark size={26} className="mt-0.5 rounded-[8px]" />
      <div className="min-w-0 flex-1 pt-0.5">
        {waiting ? (
          <span className="thinking inline-flex h-[24px] items-center gap-1" aria-label="Thinking">
            <span />
            <span />
            <span />
          </span>
        ) : (
          <Markdown className={cx('prose-chat', streaming && 'streaming')}>{content}</Markdown>
        )}
        {error && (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-danger">
            <span>{error}</span>
            {onRetry && (
              <button type="button" onClick={onRetry} className="font-medium underline underline-offset-2 hover:text-fg">
                Try again
              </button>
            )}
          </div>
        )}
        {!streaming && !error && (
          <div className="mt-1.5 flex h-7 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            {interrupted && <span className="mr-2 text-[12px] text-faint">Stopped</span>}
            <button type="button" onClick={copy} aria-label={copied ? 'Copied' : 'Copy'} className="grid size-7 place-items-center rounded-[8px] text-faint transition-colors hover:bg-surface-2 hover:text-fg [&_svg]:size-3.5">
              {copied ? <Check /> : <Copy />}
            </button>
            {onRegenerate && (
              <button type="button" onClick={onRegenerate} aria-label="Regenerate" className="grid size-7 place-items-center rounded-[8px] text-faint transition-colors hover:bg-surface-2 hover:text-fg [&_svg]:size-3.5">
                <RefreshCw />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}