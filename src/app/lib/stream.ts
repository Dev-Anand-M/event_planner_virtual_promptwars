import type { ChatEvent } from '../../shared/types'
import { readError } from './api'

export type ChatRequest = { conversationId?: string; content?: string; model?: string; regenerate?: boolean; eventId?: string }

/**
 * Sends one turn and reads the reply's server-sent events until the server
 * closes the stream. Resolves when the stream ends; rejects with ApiError when
 * the request itself is refused (limit reached, no key, bad input).
 */
export async function streamChat(body: ChatRequest, options: { signal: AbortSignal; onEvent: (event: ChatEvent) => void }): Promise<void> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify(body),
    signal: options.signal,
  })
  if (!response.ok) throw await readError(response)
  if (!response.body) return
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += value
      let end: number
      while ((end = buffer.indexOf('\n\n')) !== -1) {
        const lines = buffer.slice(0, end).split('\n')
        buffer = buffer.slice(end + 2)
        const data = lines
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n')
        if (data) options.onEvent(JSON.parse(data) as ChatEvent)
      }
    }
  } finally {
    reader.releaseLock()
  }
}
