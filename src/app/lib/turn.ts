// The reply currently being generated, held outside React so it survives the
// move from "/" to "/c/:id" when a first message creates its conversation.
// There is at most one turn at a time; the page for its conversation renders
// it under the saved messages and folds it into the query cache when done.

import { useSyncExternalStore } from 'react'
import type { QueryClient } from '@tanstack/react-query'

import type { ChatEvent, Conversation, Me, Message } from '../../shared/types'
import { ApiError, type ConversationPage } from './api'
import { streamChat, type ChatRequest } from './stream'

export type Turn = {
  /** Set once the server has told us which conversation this is. */
  conversationId: string | null
  /** The user message being answered (optimistic until `start` arrives). */
  userMessage: Message | null
  assistantMessageId: string | null
  text: string
  status: 'waiting' | 'streaming' | 'error'
  error: string | null
  model: string
  stop(): void
}

let turn: Turn | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((listener) => listener())
const set = (next: Turn | null) => {
  turn = next
  emit()
}
const update = (patch: Partial<Turn>) => turn && set({ ...turn, ...patch })

export function useTurn(): Turn | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => turn,
    () => turn,
  )
}

const localId = () => `local-${Math.random().toString(36).slice(2)}`

/**
 * Starts a turn. `onConversation` fires once when a new conversation's id is
 * known (so the page can navigate to it). Rejects only when the request was
 * refused before any reply began; stream errors end up on the turn itself.
 */
export async function startTurn(
  client: QueryClient,
  request: ChatRequest,
  options: { onConversation?: (conversation: Conversation) => void } = {},
): Promise<void> {
  if (turn) turn.stop()
  const controller = new AbortController()
  const optimisticUser: Message | null = request.regenerate
    ? null
    : { id: localId(), conversationId: request.conversationId ?? '', role: 'user', content: request.content ?? '', model: null, interrupted: false, createdAt: Date.now() }
  set({
    conversationId: request.conversationId ?? null,
    userMessage: optimisticUser,
    assistantMessageId: null,
    text: '',
    status: 'waiting',
    error: null,
    model: request.model ?? '',
    stop: () => controller.abort(),
  })

  const finish = (message: Message | null, usage?: Me['usage']) => {
    const current = turn
    if (!current?.conversationId) return set(null)
    const id = current.conversationId
    client.setQueryData<ConversationPage>(['conversation', id], (old) => {
      if (!old) return old
      let messages = old.messages
      if (request.regenerate) {
        const lastUser = [...messages].reverse().find((m) => m.role === 'user')
        if (lastUser) messages = messages.filter((m) => m.createdAt <= lastUser.createdAt)
      } else if (current.userMessage && !messages.some((m) => m.id === current.userMessage!.id)) {
        messages = [...messages, current.userMessage]
      }
      if (message) messages = [...messages, message]
      return { ...old, messages, conversation: { ...old.conversation, model: current.model || old.conversation.model, updatedAt: Date.now() } }
    })
    if (usage) client.setQueryData<Me>(['me'], (old) => old && { ...old, usage })
    void client.invalidateQueries({ queryKey: ['conversations'] })
    set(null)
  }

  const onEvent = (event: ChatEvent) => {
    if (!turn) return
    switch (event.type) {
      case 'start': {
        const isNew = !request.conversationId
        update({ conversationId: event.conversation.id, userMessage: event.userMessage, assistantMessageId: event.assistantMessageId, model: event.conversation.model })
        if (isNew) {
          client.setQueryData<ConversationPage>(['conversation', event.conversation.id], { conversation: event.conversation, messages: [event.userMessage] })
          client.setQueryData<{ items: Conversation[] }>(['conversations'], (old) => ({ items: [event.conversation, ...(old?.items ?? [])] }))
          options.onConversation?.(event.conversation)
        } else if (!request.regenerate) {
          client.setQueryData<ConversationPage>(['conversation', event.conversation.id], (old) => old && { ...old, messages: [...old.messages, event.userMessage] })
          update({ userMessage: null })
        }
        break
      }
      case 'delta':
        update({ text: turn.text + event.text, status: 'streaming' })
        break
      case 'done':
        finish(event.message, event.usage)
        break
      case 'error':
        update({ status: 'error', error: event.message })
        break
    }
  }

  try {
    await streamChat(request, { signal: controller.signal, onEvent })
    // The stream closed without `done` or `error`: treat whatever arrived as the reply.
    if (turn && turn.status !== 'error') {
      const current = turn
      finish(
        current.text && current.assistantMessageId && current.conversationId
          ? { id: current.assistantMessageId, conversationId: current.conversationId, role: 'assistant', content: current.text, model: current.model || null, interrupted: true, createdAt: Date.now() }
          : null,
      )
    }
  } catch (error) {
    if (controller.signal.aborted) {
      // Stopped by the user: keep the partial reply, marked as such.
      const current = turn
      finish(
        current?.text && current.assistantMessageId && current.conversationId
          ? { id: current.assistantMessageId, conversationId: current.conversationId, role: 'assistant', content: current.text, model: current.model || null, interrupted: true, createdAt: Date.now() }
          : null,
      )
      return
    }
    set(null)
    if (error instanceof ApiError) throw error
    throw new ApiError(0, 'Could not reach the server.')
  }
}

/** Removes the turn's error so the page is back to its saved messages. */
export function dismissTurn() {
  set(null)
}
