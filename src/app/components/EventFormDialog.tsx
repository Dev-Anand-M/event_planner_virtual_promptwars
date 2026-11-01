// One form for creating and editing an event; changing kind, date, guests or
// budget makes the server rebuild the plan, so the form says so up front.

import { useState } from 'react'
import { useNavigate } from 'react-router'

import type { EventKind, PlanEvent } from '../../shared/types'
import { useCreateEvent, useEditEvent } from '../lib/api'
import { cx } from '../lib/cx'
import { Button, Dialog, Input, useToast } from './ui'

const KIND_LABELS: Record<EventKind, string> = { wedding: 'Wedding', birthday: 'Birthday', community: 'Community' }
const KIND_OPTIONS: EventKind[] = ['wedding', 'birthday', 'community']
// Small emoji marks: keep the picker language-neutral and dependency-light.
const KIND_ICONS: Record<EventKind, string> = { wedding: '💍', birthday: '🎂', community: '👥' }

const todayISO = () => new Date().toISOString().slice(0, 10)

export function EventFormDialog({ event, open, onClose }: { event?: PlanEvent; open: boolean; onClose: () => void }) {
  const editing = Boolean(event)
  const toast = useToast()
  const navigate = useNavigate()
  const create = useCreateEvent()
  const edit = useEditEvent()
  const busy = create.isPending || edit.isPending
  const [form, setForm] = useState(() => ({
    kind: event?.kind ?? ('wedding' as EventKind),
    title: event?.title ?? '',
    date: event?.date ?? '',
    city: event?.city ?? '',
    guests: event ? String(event.guests) : '25',
    budgetTotal: event ? String(event.budgetTotal) : '',
    details: event?.details ?? '',
  }))
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }))

  const submit = () => {
    const errors: string[] = []
    if (!form.title.trim()) errors.push('name the event')
    if (!form.date || form.date < todayISO()) errors.push('pick a valid future date')
    const guests = Number(form.guests)
    if (!Number.isFinite(guests) || guests < 1) errors.push('set at least one guest')
    const budget = Number(form.budgetTotal)
    if (!Number.isFinite(budget) || budget < 100) errors.push('set a budget of at least $100')
    if (errors.length) return toast(`Fix the form: ${errors.join(', ')}.`, 'danger')

    const payload = { kind: form.kind, title: form.title, date: form.date, city: form.city, guests, budgetTotal: budget, details: form.details }
    if (editing && event) {
      edit.mutate(
        { id: event.id, ...payload },
        {
          onSuccess: () => {
            onClose()
            toast('Event updated — plan recalculated')
          },
          onError: (error) => toast(error instanceof Error ? error.message : 'Could not update the event', 'danger'),
        },
      )
    } else {
      create.mutate(payload, {
        onSuccess: ({ event: created }) => {
          onClose()
          if (created?.id) navigate(`/e/${created.id}`)
        },
        onError: (error) => toast(error instanceof Error ? error.message : 'Could not create the event', 'danger'),
      })
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? 'Edit event' : 'New event'}
      description={editing ? 'Changing kind, date, guests or budget recalculates the plan.' : 'The plan is built from these numbers. You can refine everything after.'}
      width={480}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={submit}>
            {editing ? 'Save' : 'Create plan'}
          </Button>
        </>
      }
    >
      <form
        className="space-y-3.5"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <div>
          <p className="mb-1.5 text-[12.5px] font-medium text-muted" id="kind-label">
            Type
          </p>
          <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-labelledby="kind-label">
            {KIND_OPTIONS.map((kind) => {
              const selected = form.kind === kind
              return (
                <label key={kind} className={cx('flex cursor-pointer flex-col items-center gap-1 rounded-tile border px-2 py-2.5 text-center text-[12.5px] font-medium transition-colors', selected ? 'border-fg/60 bg-surface-2' : 'border-line hover:border-line-strong')}>
                  <input type="radio" name="kind" value={kind} checked={selected} onChange={() => set('kind')(kind)} className="sr-only" />
                  <span className="text-[16px]" aria-hidden>
                    {KIND_ICONS[kind]}
                  </span>
                  {KIND_LABELS[kind]}
                </label>
              )
            })}
          </div>
        </div>
        <Input value={form.title} onChange={(e) => set('title')(e.target.value)} aria-label="Event name" maxLength={120} placeholder="Event name — “Riya turns 30”" required />
        <div className="grid grid-cols-2 gap-3">
          <Input type="date" min={todayISO()} value={form.date} onChange={(e) => set('date')(e.target.value)} aria-label="Event date" required />
          <Input value={form.city} onChange={(e) => set('city')(e.target.value)} aria-label="City" maxLength={80} placeholder="City" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex items-center gap-2 rounded-control border border-line-strong bg-surface px-3">
            <span className="text-[12.5px] text-faint">Guests</span>
            <input type="number" min={1} max={10000} value={form.guests} onChange={(e) => set('guests')(e.target.value)} aria-label="Guests" className="h-9 w-full bg-transparent text-[13.5px] text-fg focus:outline-none" />
          </label>
          <label className="flex items-center gap-2 rounded-control border border-line-strong bg-surface px-3">
            <span className="text-[12.5px] text-faint">Budget</span>
            <input type="number" min={100} max={10000000} value={form.budgetTotal} onChange={(e) => set('budgetTotal')(e.target.value)} aria-label="Budget total" className="h-9 w-full bg-transparent text-[13.5px] text-fg focus:outline-none" />
          </label>
        </div>
        <textarea
          value={form.details}
          onChange={(e) => set('details')(e.target.value)}
          aria-label="Notes for the assistant"
          maxLength={1200}
          rows={3}
          placeholder="Vibe, dietary needs, traditions the assistant should respect…"
          className="scrollbar-thin w-full resize-none rounded-control border border-line-strong bg-surface px-3 py-2 text-[13.5px] leading-relaxed text-fg placeholder:text-faint focus:border-fg/40 focus:outline-none focus:ring-[3px] focus:ring-fg/8"
        />
      </form>
    </Dialog>
  )
}
