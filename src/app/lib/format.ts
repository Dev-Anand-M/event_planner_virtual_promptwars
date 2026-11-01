export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}

export function timeOfDay(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

/** Which sidebar group a conversation belongs to, by its last activity. */
export function dayGroup(ts: number, now = Date.now()): 'Today' | 'Yesterday' | 'Previous 7 days' | 'Older' {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const today = start.getTime()
  if (ts >= today) return 'Today'
  if (ts >= today - 86_400_000) return 'Yesterday'
  if (ts >= today - 7 * 86_400_000) return 'Previous 7 days'
  return 'Older'
}

export const DAY_GROUPS = ['Today', 'Yesterday', 'Previous 7 days', 'Older'] as const

/** "in 3h" / "in 25m": when the daily limit resets. */
export function untilLabel(ts: number, now = Date.now()): string {
  const minutes = Math.max(1, Math.round((ts - now) / 60_000))
  if (minutes < 60) return `in ${minutes}m`
  const hours = Math.round(minutes / 60)
  return `in ${hours}h`
}

/** Amounts in the plan are unitless; the app displays them with a $ sign. */
export const money = (n: number): string => `$${Math.round(n).toLocaleString('en-US')}`

const DAY = 86_400_000
export const startOfDay = (now = Date.now()): number => Math.floor(now / DAY) * DAY

/** "Feb 14, 2026" for an ISO yyyy-mm-dd date. */
export function formatDate(iso: string): string {
  const ms = Date.parse(`${iso}T00:00:00Z`)
  return Number.isFinite(ms)
    ? new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    : iso
}

/** "in 41 days" / "today" / "3 days past", for an ISO date, UTC day math. */
export function countdown(iso: string, now = Date.now()): string {
  const ms = Date.parse(`${iso}T00:00:00Z`)
  if (!Number.isFinite(ms)) return 'unknown date'
  const days = Math.round((ms - startOfDay(now)) / DAY)
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days > 0) return `in ${days} days`
  return `${-days} day${days === -1 ? '' : 's'} past`
}
