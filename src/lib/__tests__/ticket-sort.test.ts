/**
 * Unit tests for ticket-sort.ts
 * Covers the shared backlog/sprint comparator: column-order status sorting,
 * duration-aware estimates, natural/locale-aware text, and nulls-last handling.
 */

import { describe, expect, it } from 'vitest'
import { createMockColumns, createMockTicket, createMockUser } from '@/__tests__/utils/mocks'
import type { SortConfig } from '@/stores/backlog-store'
import type { TicketWithRelations } from '@/types'
import { parseEstimateMinutes, sortTickets } from '../ticket-sort'

const asc = (column: SortConfig['column']): SortConfig => ({ column, direction: 'asc' })
const desc = (column: SortConfig['column']): SortConfig => ({ column, direction: 'desc' })

function tickets(values: Partial<TicketWithRelations>[]): TicketWithRelations[] {
  return values.map((v, i) => createMockTicket({ id: `t-${i}`, number: i + 1, ...v }))
}

describe('parseEstimateMinutes', () => {
  it('parses single units using 8h days and 5d weeks', () => {
    expect(parseEstimateMinutes('30m')).toBe(30)
    expect(parseEstimateMinutes('2h')).toBe(120)
    expect(parseEstimateMinutes('1d')).toBe(480)
    expect(parseEstimateMinutes('1w')).toBe(2400)
  })

  it('parses compound and fractional values', () => {
    expect(parseEstimateMinutes('1d 4h')).toBe(720)
    expect(parseEstimateMinutes('1.5h')).toBe(90)
    expect(parseEstimateMinutes(' 2H ')).toBe(120)
  })

  it('returns null for empty or unparseable values', () => {
    expect(parseEstimateMinutes(null)).toBeNull()
    expect(parseEstimateMinutes('')).toBeNull()
    expect(parseEstimateMinutes('soon')).toBeNull()
    expect(parseEstimateMinutes('2h maybe')).toBeNull()
  })
})

describe('sortTickets', () => {
  it('returns the input unchanged when sort is null', () => {
    const input = tickets([{ title: 'b' }, { title: 'a' }])
    expect(sortTickets(input, null)).toBe(input)
  })

  it('does not mutate the input array', () => {
    const input = tickets([{ title: 'b' }, { title: 'a' }])
    const before = input.map((t) => t.id)
    sortTickets(input, asc('title'))
    expect(input.map((t) => t.id)).toEqual(before)
  })

  describe('status', () => {
    const columns = createMockColumns() // To Do(0), In Progress(1), Review(2), Done(3)
    const input = tickets([
      { columnId: 'col-4' },
      { columnId: 'col-1' },
      { columnId: 'col-3' },
      { columnId: 'col-2' },
    ])

    it('sorts by board column order, not alphabetically', () => {
      const result = sortTickets(input, asc('status'), columns)
      expect(result.map((t) => t.columnId)).toEqual(['col-1', 'col-2', 'col-3', 'col-4'])
    })

    it('reverses column order when descending', () => {
      const result = sortTickets(input, desc('status'), columns)
      expect(result.map((t) => t.columnId)).toEqual(['col-4', 'col-3', 'col-2', 'col-1'])
    })

    it('uses the column order field even when the columns array is unordered', () => {
      const shuffled = [...columns].reverse()
      const result = sortTickets(input, asc('status'), shuffled)
      expect(result.map((t) => t.columnId)).toEqual(['col-1', 'col-2', 'col-3', 'col-4'])
    })
  })

  describe('estimate', () => {
    const input = tickets(['2h', '10h', '1d', '30m', null, '3d'].map((estimate) => ({ estimate })))

    it('sorts by duration ascending with empty estimates last', () => {
      const result = sortTickets(input, asc('estimate'))
      expect(result.map((t) => t.estimate)).toEqual(['30m', '2h', '1d', '10h', '3d', null])
    })

    it('sorts by duration descending with empty estimates still last', () => {
      const result = sortTickets(input, desc('estimate'))
      expect(result.map((t) => t.estimate)).toEqual(['3d', '10h', '1d', '2h', '30m', null])
    })

    it('places unparseable estimates after parsed ones but before empty', () => {
      const mixed = tickets([{ estimate: 'soon' }, { estimate: null }, { estimate: '1h' }])
      expect(sortTickets(mixed, asc('estimate')).map((t) => t.estimate)).toEqual([
        '1h',
        'soon',
        null,
      ])
    })
  })

  describe('title', () => {
    it('uses natural number ordering', () => {
      const input = tickets([{ title: 'Task 10' }, { title: 'Task 2' }, { title: 'Task 1' }])
      expect(sortTickets(input, asc('title')).map((t) => t.title)).toEqual([
        'Task 1',
        'Task 2',
        'Task 10',
      ])
    })

    it('places Cyrillic Ё next to Е instead of after Я', () => {
      const input = tickets([{ title: 'Яблоко' }, { title: 'Ёлка' }, { title: 'Арбуз' }])
      expect(sortTickets(input, asc('title')).map((t) => t.title)).toEqual([
        'Арбуз',
        'Ёлка',
        'Яблоко',
      ])
    })

    it('groups accented letters with their base letter', () => {
      const input = tickets([{ title: 'zebra' }, { title: 'éclair' }, { title: 'apple' }])
      expect(sortTickets(input, asc('title')).map((t) => t.title)).toEqual([
        'apple',
        'éclair',
        'zebra',
      ])
    })
  })

  describe('empty values are always last', () => {
    it('story points: asc and desc', () => {
      const input = tickets([3, null, 0, 8].map((storyPoints) => ({ storyPoints })))
      expect(sortTickets(input, asc('storyPoints')).map((t) => t.storyPoints)).toEqual([
        0,
        3,
        8,
        null,
      ])
      expect(sortTickets(input, desc('storyPoints')).map((t) => t.storyPoints)).toEqual([
        8,
        3,
        0,
        null,
      ])
    })

    it('due date: desc keeps tickets without a date at the end', () => {
      const input = tickets([
        { dueDate: new Date('2026-12-01') },
        { dueDate: null },
        { dueDate: new Date('2026-11-01') },
      ])
      expect(
        sortTickets(input, desc('dueDate')).map((t) => t.dueDate?.toISOString() ?? null),
      ).toEqual(['2026-12-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z', null])
    })

    it('assignee: unassigned last even when a name sorts after "zzz"', () => {
      const input = tickets([
        { assignee: createMockUser({ name: 'Zzzyx' }) },
        { assignee: null },
        { assignee: createMockUser({ name: 'Ann' }) },
      ])
      expect(sortTickets(input, asc('assignee')).map((t) => t.assignee?.name ?? null)).toEqual([
        'Ann',
        'Zzzyx',
        null,
      ])
      expect(sortTickets(input, desc('assignee')).map((t) => t.assignee?.name ?? null)).toEqual([
        'Zzzyx',
        'Ann',
        null,
      ])
    })

    it('fix version: empty last in both directions', () => {
      const input = tickets([{ fixVersion: null }, { fixVersion: '1.2' }, { fixVersion: '1.10' }])
      expect(sortTickets(input, asc('fixVersion')).map((t) => t.fixVersion)).toEqual([
        '1.2',
        '1.10',
        null,
      ])
      expect(sortTickets(input, desc('fixVersion')).map((t) => t.fixVersion)).toEqual([
        '1.10',
        '1.2',
        null,
      ])
    })
  })

  it('resolution: sorts resolved tickets by resolution with unresolved last', () => {
    const input = tickets([
      { resolution: null },
      { resolution: "Won't Fix" },
      { resolution: 'Done' },
    ])
    expect(sortTickets(input, asc('resolution')).map((t) => t.resolution)).toEqual([
      'Done',
      "Won't Fix",
      null,
    ])
  })

  it('labels: compares sorted label names regardless of insertion order', () => {
    const lbl = (name: string) => ({ id: name, name, color: '#000' })
    const input = tickets([
      { title: 'zb', labels: [lbl('zeta'), lbl('beta')] },
      { title: 'c', labels: [lbl('charlie')] },
    ])
    // "beta,zeta" < "charlie"
    expect(sortTickets(input, asc('labels')).map((t) => t.title)).toEqual(['zb', 'c'])
  })

  it('breaks ties by ticket number so equal values have a stable, predictable order', () => {
    const input = tickets([
      { number: 3, priority: 'high' },
      { number: 1, priority: 'high' },
      { number: 2, priority: 'high' },
    ])
    expect(sortTickets(input, desc('priority')).map((t) => t.number)).toEqual([1, 2, 3])
  })
})
