import { motion } from 'motion/react'
import { CalendarDays, MoreHorizontal, Plus, Trash2, Users } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'

import type { EventKind, PlanEvent } from '../../shared/types'
import { planProgress } from '../../shared/planner'
import { EventFormDialog } from '../components/EventFormDialog'
import { Button, ConfirmDialog, Menu, useToast } from '../components/ui'
import { useDeleteEvent, useEvents } from '../lib/api'
import { countdown, formatDate, money } from '../lib/format'

const KIND_ICONS: Record<EventKind, string> = { wedding: '💍', birthday: '🎂', community: '👥' }

export function Events() {
  const { data, isLoading } = useEvents()
  const [creating, setCreating] = useState(false)
  const items = data?.items ?? []
  // Soonest first, and held events (past dates) last.
  const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date))

  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[900px] px-5 py-8 md:px-6 md:py-10">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[24px] font-semibold tracking-[-0.02em]">Your events</h1>
            <p className="mt-1 text-[13.5px] text-muted">Each event gets a ruled plan and an assistant that knows its numbers.</p>
          </div>
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus aria-hidden /> New event
          </Button>
        </header>

        {isLoading ? (
          <p className="mt-12 text-center text-[13.5px] text-faint">Loading…</p>
        ) : sorted.length === 0 ? (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-10 rounded-card border border-dashed border-line-strong bg-surface p-10 text-center" data-testid="events-empty">
            <p className="text-[15px] font-medium">Nothing planned yet</p>
            <p className="mx-auto mt-1.5 max-w-sm text-[13.5px] text-muted">Create a wedding, a birthday, or a community event and Gather builds the budget, timeline, and vendor checklist to start from.</p>
            <Button variant="primary" className="mt-5" onClick={() => setCreating(true)}>
              <Plus aria-hidden /> Create your first event
            </Button>
          </motion.div>
        ) : (
          <ul className="mt-7 grid gap-3 sm:grid-cols-2">
            {sorted.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </ul>
        )}
      </div>
      <EventFormDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  )
}

function EventCard({ event }: { event: PlanEvent }) {
  const toast = useToast()
  const navigate = useNavigate()
  const remove = useDeleteEvent()
  const [confirm, setConfirm] = useState(false)
  const progress = planProgress(event.plan)
  return (
    <li className="group relative">
      <Link
        to={`/e/${event.id}`}
        className="block rounded-card bg-surface p-4 shadow-card transition-[box-shadow,border-color] hover:shadow-pop"
      >
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-surface-2 text-[17px]" aria-hidden>
            {KIND_ICONS[event.kind]}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-medium">{event.title}</p>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12.5px] text-muted">
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays className="size-3.5 text-faint" aria-hidden />
                {formatDate(event.date)} · {countdown(event.date)}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Users className="size-3.5 text-faint" aria-hidden />
                {event.guests.toLocaleString()}
              </span>
              <span>{money(event.budgetTotal)} budget</span>
              <span>
                {progress.milestones.done}/{progress.milestones.total} milestones
              </span>
            </p>
          </div>
        </div>
      </Link>
      <span className="absolute right-2 top-2 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <Menu
          trigger={
            <Button variant="ghost" size="icon-sm" aria-label={`Options for ${event.title}`}>
              <MoreHorizontal />
            </Button>
          }
          items={[{ label: 'Delete', icon: <Trash2 />, danger: true, onSelect: () => setConfirm(true) }]}
        />
      </span>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title={`Delete “${event.title}”?`}
        description="The plan and its chats are removed for good."
        loading={remove.isPending}
        onConfirm={() =>
          remove.mutate(event.id, {
            onSuccess: () => {
              setConfirm(false)
              toast('Event deleted')
              navigate('/events')
            },
            onError: () => toast('Could not delete this event', 'danger'),
          })
        }
      />
    </li>
  )
}
