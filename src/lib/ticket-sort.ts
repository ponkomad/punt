import type { BacklogColumnId, SortConfig } from '@/stores/backlog-store'
import type { ColumnWithTickets, TicketWithRelations } from '@/types'

/**
 * A comparable key for one ticket field.
 * - `null` means "empty" and always sorts last, regardless of direction.
 * - Numbers sort before strings (used for estimates: parsed durations before free text).
 */
type SortKey = number | string | null

interface SortContext {
  /** columnId -> board position, for sorting by status in workflow order */
  statusRank: Map<string, number> | null
}

type KeyExtractor = (ticket: TicketWithRelations, ctx: SortContext) => SortKey

const PRIORITY_ORDER = ['critical', 'highest', 'high', 'medium', 'low', 'lowest']

// Jira-style conversion: 1w = 5d, 1d = 8h
const MINUTES_PER_UNIT: Record<string, number> = { m: 1, h: 60, d: 8 * 60, w: 5 * 8 * 60 }
const ESTIMATE_PATTERN = /^(\s*\d+(?:\.\d+)?\s*[wdhm]\s*)+$/
const ESTIMATE_PART = /(\d+(?:\.\d+)?)\s*([wdhm])/g

// Locale-aware, case/accent-insensitive, natural number ordering ("Task 2" < "Task 10", "Ё" next to "Е")
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/**
 * Parse a time estimate such as "30m", "2h", "1d 4h" or "1.5w" into minutes.
 * Returns null for empty or unrecognised values.
 */
export function parseEstimateMinutes(estimate: string | null | undefined): number | null {
  const value = estimate?.trim().toLowerCase()
  if (!value || !ESTIMATE_PATTERN.test(value)) return null
  let total = 0
  for (const [, amount, unit] of value.matchAll(ESTIMATE_PART)) {
    total += Number.parseFloat(amount) * MINUTES_PER_UNIT[unit]
  }
  return total
}

function timeOf(date: Date | string | null | undefined): number | null {
  if (!date) return null
  const time = (date instanceof Date ? date : new Date(date)).getTime()
  return Number.isNaN(time) ? null : time
}

function textOrNull(value: string | null | undefined): string | null {
  return value?.trim() ? value : null
}

function indexOrNull(list: readonly string[], value: string): number | null {
  const index = list.indexOf(value)
  return index === -1 ? null : index
}

const KEY_EXTRACTORS: Record<BacklogColumnId, KeyExtractor> = {
  key: (t) => t.number,
  title: (t) => t.title,
  type: (t) => t.type,
  status: (t, ctx) => (ctx.statusRank ? (ctx.statusRank.get(t.columnId) ?? null) : t.columnId),
  priority: (t) => indexOrNull(PRIORITY_ORDER, t.priority),
  resolution: (t) => textOrNull(t.resolution),
  assignee: (t) => textOrNull(t.assignee?.name),
  reporter: (t) => textOrNull(t.creator?.name),
  sprint: (t) => textOrNull(t.sprint?.name),
  storyPoints: (t) => t.storyPoints ?? null,
  estimate: (t) => parseEstimateMinutes(t.estimate) ?? textOrNull(t.estimate),
  startDate: (t) => timeOf(t.startDate),
  dueDate: (t) => timeOf(t.dueDate),
  created: (t) => timeOf(t.createdAt),
  updated: (t) => timeOf(t.updatedAt),
  parent: (t) => t.parentId ?? null,
  labels: (t) =>
    t.labels.length
      ? t.labels
          .map((l) => l.name)
          .sort(collator.compare)
          .join(',')
      : null,
  environment: (t) => textOrNull(t.environment),
  affectedVersion: (t) => textOrNull(t.affectedVersion),
  fixVersion: (t) => textOrNull(t.fixVersion),
  watchers: (t) => t.watchers?.length ?? 0,
}

/** Compare two non-null keys in ascending order. Numbers come before strings. */
function compareValues(a: number | string, b: number | string): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'string' && typeof b === 'string') return collator.compare(a, b)
  return typeof a === 'number' ? -1 : 1
}

function buildStatusRank(statusColumns?: ColumnWithTickets[]): Map<string, number> | null {
  if (!statusColumns) return null
  return new Map(statusColumns.map((c, index) => [c.id, c.order ?? index]))
}

/**
 * Comparator function for sorting tickets by a given column and direction.
 * Shared between backlog table and sprint section views.
 *
 * Empty values always sort last, mixed number/text keys keep numbers first,
 * and ties are broken by ticket number so the order is stable and predictable.
 */
export function createTicketComparator(
  sort: SortConfig,
  statusColumns?: ColumnWithTickets[],
): (a: TicketWithRelations, b: TicketWithRelations) => number {
  const extract = KEY_EXTRACTORS[sort.column]
  const ctx: SortContext = { statusRank: buildStatusRank(statusColumns) }
  const sign = sort.direction === 'asc' ? 1 : -1

  return (a, b) => {
    if (!extract) return 0
    const aKey = extract(a, ctx)
    const bKey = extract(b, ctx)

    if (aKey === null || bKey === null) {
      if (aKey !== bKey) return aKey === null ? 1 : -1
    } else if (typeof aKey !== typeof bKey) {
      return compareValues(aKey, bKey)
    } else {
      const result = compareValues(aKey, bKey)
      if (result !== 0) return result * sign
    }
    return a.number - b.number
  }
}

/**
 * Sort an array of tickets by the given sort config.
 * Returns a new sorted array (does not mutate the input).
 *
 * @param tickets - The tickets to sort
 * @param sort - Sort configuration (column + direction), or null to skip sorting
 * @param statusColumns - Status columns for resolving board order (used for 'status' sort)
 */
export function sortTickets(
  tickets: TicketWithRelations[],
  sort: SortConfig | null,
  statusColumns?: ColumnWithTickets[],
): TicketWithRelations[] {
  if (!sort) return tickets
  const sorted = [...tickets]
  sorted.sort(createTicketComparator(sort, statusColumns))
  return sorted
}
