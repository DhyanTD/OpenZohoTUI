import { randomUUID } from 'node:crypto'
import type { ActiveTimer, PendingLog } from './schemas.js'

const durationPattern = /^(?:(\d+)h)?(?:(\d+)m)?$/i
const decimalHoursPattern = /^(\d+\.\d+)h$/i

export function parseDuration(value: string): number {
  if (/^\d+$/.test(value)) return Number(value)
  if (/^\d{1,3}:\d{2}$/.test(value)) {
    const [hours, minutes] = value.split(':').map(Number) as [number, number]
    if (minutes > 59) throw new Error(`Invalid duration: ${value}`)
    return hours * 60 + minutes
  }
  const decimalHours = decimalHoursPattern.exec(value)
  if (decimalHours) {
    const minutes = Number(decimalHours[1]) * 60
    if (Number.isInteger(minutes)) return minutes
    throw new Error(`Invalid duration: ${value}; decimal hours must resolve to whole minutes`)
  }
  const match = durationPattern.exec(value)
  if (!match || (!match[1] && !match[2])) throw new Error(`Invalid duration: ${value}`)
  return Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0)
}

export function elapsedMinutes(startedAt: string, endedAt = new Date()): number {
  return Math.max(1, Math.round((endedAt.getTime() - new Date(startedAt).getTime()) / 60_000))
}

export function stopTimer(timer: ActiveTimer, endedAt = new Date(), overrideMinutes?: number, timezone = 'UTC'): PendingLog {
  const minutes = overrideMinutes ?? elapsedMinutes(timer.startedAt, endedAt)
  if (!Number.isInteger(minutes) || minutes <= 0) throw new Error('Duration must be a positive whole number of minutes')
  const parts = new Intl.DateTimeFormat('en', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: timezone,
  }).formatToParts(endedAt)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value
  const timezoneDate = `${part('year')}-${part('month')}-${part('day')}`
  return {
    id: randomUUID(),
    taskRef: timer.taskRef,
    projectId: timer.projectId,
    date: timezoneDate,
    minutes,
    notes: timer.notes ?? '',
    billing: timer.billing,
    state: 'pending',
    createdAt: new Date().toISOString(),
  }
}
