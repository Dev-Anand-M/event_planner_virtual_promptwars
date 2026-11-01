import { ArrowUpRight } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'

import { DAILY_MESSAGE_LIMIT, GROQ_API_KEYS_URL } from '../../shared/config'
import { Avatar, Badge, Button, ConfirmDialog, useToast } from '../components/ui'
import { useDeleteAllConversations, useMe } from '../lib/api'
import { untilLabel } from '../lib/format'

export function Settings() {
  const { data: me } = useMe()
  const toast = useToast()
  const navigate = useNavigate()
  const [confirm, setConfirm] = useState(false)
  const clear = useDeleteAllConversations()
  if (!me) return null
  const connections: { label: string; ok: boolean; detail: string; action?: React.ReactNode }[] = [
    {
      label: 'Groq API',
      ok: me.capabilities.ai,
      detail: me.capabilities.ai ? 'GROQ_API_KEY is set' : 'GROQ_API_KEY is not set',
      action: me.capabilities.ai ? undefined : (
        <a href={GROQ_API_KEYS_URL} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1 rounded-tile px-2.5 text-[13px] font-medium text-fg transition-colors hover:bg-surface-2">
          Get a key
          <ArrowUpRight className="size-3.5" />
        </a>
      ),
    },
    { label: 'Database', ok: me.capabilities.database, detail: 'D1 via the DB binding' },
    { label: 'Sign in with Freebuff', ok: me.capabilities.auth === 'freebuff', detail: me.capabilities.auth === 'freebuff' ? 'FREEBUFF_CLIENT_ID is set' : 'Using the local development user' },
  ]
  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[640px] px-5 py-8 md:px-6 md:py-10">
        <h1 className="text-[24px] font-semibold tracking-[-0.02em]">Settings</h1>

        <section className="mt-8">
          <h2 className="text-[13.5px] font-semibold">Account</h2>
          <div className="mt-3 flex items-center gap-4 rounded-card bg-surface p-4 shadow-card">
            <Avatar name={me.user.name ?? me.user.email ?? 'You'} src={me.user.picture} size={44} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-medium">{me.user.name ?? 'Signed in'}</p>
              {me.user.email && <p className="truncate text-[13px] text-muted">{me.user.email}</p>}
            </div>
            {me.capabilities.auth === 'freebuff' ? (
              <form method="post" action="/auth/freebuff/signout">
                <input type="hidden" name="returnTo" value="/" />
                <Button type="submit">Sign out</Button>
              </form>
            ) : (
              <Badge tone="warning">Development user</Badge>
            )}
          </div>
        </section>

        <section className="mt-8">
          <h2 className="text-[13.5px] font-semibold">Usage</h2>
          <div className="mt-3 rounded-card bg-surface p-4 shadow-card">
            <div className="flex items-baseline justify-between">
              <p className="text-[15px] font-medium">
                {me.usage.used} of {DAILY_MESSAGE_LIMIT} replies today
              </p>
              <p className="text-[12.5px] text-faint">Resets {untilLabel(me.usage.resetsAt)}</p>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-[3px] bg-surface-2">
              <div className="h-full rounded-[3px] bg-fg transition-[width] duration-500" style={{ width: `${Math.min(100, Math.round((me.usage.used / DAILY_MESSAGE_LIMIT) * 100))}%` }} />
            </div>
          </div>
        </section>

        <section className="mt-8">
          <h2 className="text-[13.5px] font-semibold">Connections</h2>
          <ul className="mt-3 divide-y divide-line rounded-card bg-surface shadow-card">
            {connections.map((item) => (
              <li key={item.label} className="flex min-h-13 items-center gap-3 px-4 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-medium">{item.label}</span>
                  <span className="block truncate text-[12px] text-faint">{item.detail}</span>
                </span>
                {item.action}
                <Badge tone={item.ok ? 'success' : 'neutral'}>{item.ok ? 'Connected' : 'Not set'}</Badge>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-8">
          <h2 className="text-[13.5px] font-semibold">Data</h2>
          <div className="mt-3 flex items-center justify-between gap-4 rounded-card bg-surface p-4 shadow-card">
            <div>
              <p className="text-[13.5px] font-medium">Delete all chats</p>
              <p className="text-[12.5px] text-faint">Removes every conversation and message.</p>
            </div>
            <Button variant="danger" onClick={() => setConfirm(true)}>
              Delete
            </Button>
          </div>
        </section>
      </div>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Delete all chats?"
        description="Every conversation is removed for good."
        confirmLabel="Delete everything"
        loading={clear.isPending}
        onConfirm={() =>
          clear.mutate(undefined, {
            onSuccess: () => {
              setConfirm(false)
              toast('All chats deleted')
              navigate('/')
            },
            onError: () => toast('Could not delete your chats', 'danger'),
          })
        }
      />
    </div>
  )
}
