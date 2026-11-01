import { Cake, CalendarDays, CheckSquare, Heart, Lightbulb, ListChecks, Pencil, Trash2, Users } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import type { EventKind, MilestoneScope, PlanEvent } from '../../shared/types'
import { daysUntil } from '../../shared/planner'
import { cx } from '../lib/cx'
import { countdown, formatDate, money } from '../lib/format'
import { useDeleteEvent, useEditEvent, useEvent, useTogglePlan } from '../lib/api'
import { Badge, Button, ConfirmDialog, Menu, Spinner, useToast } from '../components/ui'
import { EventFormDialog } from '../components/EventFormDialog'
import { Chat } from './Chat'

const KIND_ICONS: Record<EventKind, typeof Heart> = { wedding: Heart, birthday: Cake, community: Users }
const KIND_LABELS: Record<EventKind, string> = { wedding: 'Wedding', birthday: 'Birthday', community: 'Community' }

const SCOPE_LABELS: Record<MilestoneScope, string> = { book: 'Book', send: 'Send', buy: 'Buy', confirm: 'Confirm', prep: 'Prep' }

export function EventView() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const page = useEvent(id)
  const remove = useDeleteEvent()
  const edit = useEditEvent()
  const toggle = useTogglePlan(id ?? '')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [editing, setEditing] = useState(false)
  // Plan and chat side by side on wide screens; a segmented switch below that.
  const [pane, setPane] = useState<'plan' | 'chat'>('plan')

  if (page.isLoading) {
    return (
      <div className="grid flex-1 place-items-center">
        <Spinner />
      </div>
    )
  }
  if (page.error || !page.data) {
    return (
      <div className="grid flex-1 place-items-center p-6 text-center">
        <div>
          <p className="text-[15px] font-medium">{page.error instanceof Error && page.error.message !== 'Request failed.' ? page.error.message : 'This event is not here any more.'}</p>
          <button type="button" onClick={() => navigate('/events')} className="mt-2 text-[13.5px] text-muted underline underline-offset-2 hover:text-fg">
            Back to your events
          </button>
        </div>
      </div>
    )
  }

  const event = page.data.event
  // The thread this event's chat has bound to itself this session; a reload
  // falls back to the id the server returned.
  const threadId = page.data.threadId

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EventHeader
        event={event}
        onEdit={() => setEditing(true)}
        onDelete={() => setConfirmDelete(true)}
        onRebuild={() =>
          edit.mutate(
            { id: event.id, kind: event.kind, title: event.title, date: event.date, city: event.city, guests: event.guests, budgetTotal: event.budgetTotal, details: event.details, rebuild: true },
            { onError: (error) => toast(error instanceof Error ? error.message : 'Could not recalculate', 'danger') },
          )
        }
      />
      <PaneSwitch pane={pane} onChange={setPane} />
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className={cx('min-h-0 flex-1 overflow-hidden md:max-w-[400px] md:flex-none', pane === 'chat' && 'hidden md:block')}>
          <PlanPanels event={event} onToggle={(t) => toggle.mutate(t, { onError: () => toast('Could not update the plan', 'danger') })} />
        </div>
        <div className={cx('flex min-h-0 flex-1 flex-col border-line md:flex-1 md:border-l', pane === 'plan' && 'hidden md:flex')}>
          <Chat eventId={event.id} conversationId={threadId ?? undefined} />
        </div>
      </div>

      <EventFormDialog event={event} open={editing} onClose={() => setEditing(false)} />
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete “${event.title}”?`}
        description="The plan and its chats are removed for good."
        loading={remove.isPending}
        onConfirm={() =>
          remove.mutate(event.id, {
            onSuccess: () => {
              setConfirmDelete(false)
              toast('Event deleted')
              navigate('/events')
            },
            onError: () => toast('Could not delete this event', 'danger'),
          })
        }
      />
    </div>
  )
}

function EventHeader({ event, onEdit, onDelete, onRebuild }: { event: PlanEvent; onEdit: () => void; onDelete: () => void; onRebuild: () => void }) {
  const Icon = KIND_ICONS[event.kind]
  const overdue = event.plan.timeline.filter((m) => !m.done && daysUntil(m.due) <= 0).length
  const nextDue = event.plan.timeline.find((m) => !m.done)
  return (
    <header className="shrink-0 border-b border-line bg-bg/80 px-4 py-3.5 backdrop-blur-sm md:px-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Link to="/events" className="text-[13px] text-faint hover:text-fg" aria-label="All events">
          Events
        </Link>
        <span aria-hidden className="text-faint">
          /
        </span>
        <span className="grid size-7 shrink-0 place-items-center rounded-[8px] bg-surface-2 text-fg">
          <Icon className="size-4" />
        </span>
        <h1 className="min-w-0 flex-1 truncate text-[17px] font-semibold tracking-[-0.01em]">{event.title}</h1>
        <div className="flex items-center gap-1.5">
          <Badge tone="neutral">{KIND_LABELS[event.kind]}</Badge>
          {event.plan.budget.stretched && <Badge tone="warning">Budget is tight</Badge>}
          {overdue > 0 && <Badge tone="danger">{overdue} overdue</Badge>}
        </div>
        <Menu
          trigger={
            <Button variant="ghost" size="icon" aria-label="Event options">
              <Pencil />
            </Button>
          }
          items={[
            { label: 'Edit details', icon: <Pencil />, onSelect: onEdit },
            { label: 'Recalculate plan', icon: <CheckSquare />, onSelect: onRebuild },
            { label: 'Delete event', icon: <Trash2 />, danger: true, onSelect: onDelete },
          ]}
        />
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-muted">
        <span className="inline-flex items-center gap-1.5">
          <CalendarDays className="size-3.5 text-faint" aria-hidden />
          {formatDate(event.date)} · {countdown(event.date)}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Users className="size-3.5 text-faint" aria-hidden />
          {event.guests.toLocaleString()} guests
        </span>
        <span className="inline-flex items-center gap-1.5">{money(event.budgetTotal)} budget</span>
        {event.city && <span>{event.city}</span>}
        {nextDue && <span>Next: {nextDue.label} ({formatDate(nextDue.due)})</span>}
      </div>
    </header>
  )
}

function PaneSwitch({ pane, onChange }: { pane: 'plan' | 'chat'; onChange: (pane: 'plan' | 'chat') => void }) {
  const options: { key: 'plan' | 'chat'; label: string; icon: typeof Heart }[] = [
    { key: 'plan', label: 'Plan', icon: ListChecks },
    { key: 'chat', label: 'Chat', icon: Cake },
  ]
  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-line px-3 py-1.5 md:hidden" role="tablist" aria-label="Event panes">
      {options.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={pane === key}
          onClick={() => onChange(key)}
          className={cx('inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-tile text-[13px] font-medium transition-colors', pane === key ? 'bg-surface text-fg shadow-card' : 'text-muted hover:bg-surface-2')}
        >
          <Icon className="size-3.5" aria-hidden />
          {label}
        </button>
      ))}
    </div>
  )
}

function PlanPanels({ event, onToggle }: { event: PlanEvent; onToggle: (t: { milestone?: number; vendor?: number; idea?: number }) => void }) {
  const plan = event.plan
  const bookedVendors = plan.vendors.filter((v) => v.booked).length
  const doneMilestones = plan.timeline.filter((m) => m.done).length
  return (
    <div className='scrollbar-thin h-full overflow-y-auto px-4 py-4 md:px-5'>
      <section aria-labelledby="budget-heading" className="rounded-card bg-surface p-4 shadow-card">
        <header className="flex items-baseline justify-between gap-2">
          <h2 id="budget-heading" className="text-[13.5px] font-semibold">
            Budget
          </h2>
          <p className="text-[12.5px] text-faint">
            {money(plan.budget.total)} total
            {plan.budget.stretched ? ' · stretched' : ''}
          </p>
        </header>
        <ul className="mt-3 space-y-2.5">
          {plan.budget.lines.map((line) => (
            <li key={line.category}>
              <div className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="truncate font-medium">{line.category}</span>
                <span className="tabular-nums text-muted">{money(line.amount)}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-[3px] bg-surface-2" aria-hidden>
                <div className="h-full rounded-[3px] bg-fg/85" style={{ width: `${Math.max(2, Math.round((line.amount / Math.max(1, plan.budget.total)) * 100))}%` }} />
              </div>
              {line.note && <p className="mt-0.5 text-[11.5px] text-faint">{line.note}</p>}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="timeline-heading" className="mt-3 rounded-card bg-surface p-4 shadow-card">
        <header className="flex items-baseline justify-between gap-2">
          <h2 id="timeline-heading" className="text-[13.5px] font-semibold">
            Timeline
          </h2>
          <p className="text-[12.5px] text-faint">
            {doneMilestones}/{plan.timeline.length} done
          </p>
        </header>
        <ol className="mt-3 space-y-1">
          {plan.timeline.map((milestone, index) => {
            const overdue = !milestone.done && daysUntil(milestone.due) <= 0
            return (
              <li key={`${milestone.label}-${index}`} className={cx('flex items-start gap-2.5 rounded-tile px-2 py-1.5 transition-colors hover:bg-surface-2')}>
                <input
                  type="checkbox"
                  checked={milestone.done}
                  onChange={() => onToggle({ milestone: index })}
                  aria-label={`Mark done: ${milestone.label}`}
                  className="mt-0.5 size-4 shrink-0 accent-fg"
                />
                <div className="min-w-0 flex-1">
                  <p className={cx('text-[13.5px] leading-snug', milestone.done && 'text-faint line-through')}>{milestone.label}</p>
                  <p className={cx('mt-0.5 text-[12px] tabular-nums', overdue ? 'text-danger' : 'text-faint')}>
                    {formatDate(milestone.due)} · {SCOPE_LABELS[milestone.scope]}
                  </p>
                </div>
              </li>
            )
          })}
        </ol>
      </section>

      <section aria-labelledby="vendors-heading" className="mt-3 rounded-card bg-surface p-4 shadow-card">
        <header className="flex items-baseline justify-between gap-2">
          <h2 id="vendors-heading" className="text-[13.5px] font-semibold">
            Vendors &amp; checklist
          </h2>
          <p className="text-[12.5px] text-faint">
            {bookedVendors}/{plan.vendors.length} booked
          </p>
        </header>
        <ul className="mt-3 space-y-1">
          {plan.vendors.map((vendor, index) => (
            <li key={`${vendor.label}-${index}`} className="flex items-start gap-2.5 rounded-tile px-2 py-1.5 transition-colors hover:bg-surface-2">
              <input type="checkbox" checked={vendor.booked} onChange={() => onToggle({ vendor: index })} aria-label={`Mark booked: ${vendor.label}`} className="mt-0.5 size-4 shrink-0 accent-fg" />
              <div className="min-w-0 flex-1">
                <p className={cx('text-[13.5px] leading-snug', vendor.booked && 'text-faint line-through')}>
                  {vendor.label}
                  {vendor.essential && (
                    <Badge tone="neutral" className="ml-2">
                      essential
                    </Badge>
                  )}
                </p>
                <p className="mt-0.5 text-[12px] text-faint">{vendor.category}</p>
                {vendor.note && <p className="text-[12px] text-faint">{vendor.note}</p>}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {plan.ideas.length > 0 && (
        <section aria-labelledby="ideas-heading" className="mt-3 rounded-card bg-surface p-4 shadow-card">
          <header className="flex items-baseline justify-between gap-2">
            <h2 id="ideas-heading" className="text-[13.5px] font-semibold">
              <Lightbulb className="mr-1 inline size-4 align-[-2px] text-faint" aria-hidden />
              Ideas saved
            </h2>
          </header>
          <ul className="mt-2 space-y-1">
            {plan.ideas.map((idea, index) => (
              <li key={`${idea}-${index}`} className="group flex items-start gap-2 rounded-tile px-2 py-1.5 text-[13.5px] leading-snug">
                <span className="min-w-0 flex-1">{idea}</span>
                <button type="button" onClick={() => onToggle({ idea: index })} aria-label={`Remove idea: ${idea}`} className="shrink-0 text-faint opacity-0 transition-opacity hover:text-danger focus-visible:opacity-100 group-hover:opacity-100">
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-3 px-1 text-center text-[11.5px] text-faint">
        Built by rules from your event's numbers. Change details or pick “Recalculate plan” in the header menu to refresh it.
      </p>
    </div>
  )
}
