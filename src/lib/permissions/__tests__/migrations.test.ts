/**
 * Data migration helpers for PUNT-7 (tickets.manage_assigned).
 * Existing roles that can only manage their own tickets get the new permission;
 * everything else (formats, unknown permission strings, other roles) is preserved.
 */

import { describe, expect, it } from 'vitest'
import { PERMISSIONS } from '../constants'
import { addAssignedPermission, migrateDefaultRoleSettings } from '../migrations'

const { TICKETS_CREATE, TICKETS_MANAGE_OWN, TICKETS_MANAGE_ANY, TICKETS_MANAGE_ASSIGNED } =
  PERMISSIONS

describe('addAssignedPermission', () => {
  it('adds manage_assigned to a role that manages only its own tickets', () => {
    expect(addAssignedPermission([TICKETS_CREATE, TICKETS_MANAGE_OWN])).toEqual([
      TICKETS_CREATE,
      TICKETS_MANAGE_OWN,
      TICKETS_MANAGE_ASSIGNED,
    ])
  })

  it('accepts the legacy JSON-string format', () => {
    expect(addAssignedPermission(JSON.stringify([TICKETS_MANAGE_OWN]))).toEqual([
      TICKETS_MANAGE_OWN,
      TICKETS_MANAGE_ASSIGNED,
    ])
  })

  it('returns null (no change) when the role already has it', () => {
    expect(addAssignedPermission([TICKETS_MANAGE_OWN, TICKETS_MANAGE_ASSIGNED])).toBeNull()
  })

  it('returns null for roles with manage_any (already covered)', () => {
    expect(addAssignedPermission([TICKETS_MANAGE_OWN, TICKETS_MANAGE_ANY])).toBeNull()
  })

  it('returns null for roles without manage_own (admin deliberately restricted them)', () => {
    expect(addAssignedPermission([TICKETS_CREATE])).toBeNull()
  })

  it('returns null for empty or malformed values', () => {
    expect(addAssignedPermission(null)).toBeNull()
    expect(addAssignedPermission('not json')).toBeNull()
    expect(addAssignedPermission({ foo: 1 })).toBeNull()
  })

  it('keeps unknown permission strings instead of dropping them', () => {
    expect(addAssignedPermission(['future.permission', TICKETS_MANAGE_OWN])).toEqual([
      'future.permission',
      TICKETS_MANAGE_OWN,
      TICKETS_MANAGE_ASSIGNED,
    ])
  })
})

describe('migrateDefaultRoleSettings', () => {
  it('updates the object format and leaves other fields untouched', () => {
    const stored = {
      Owner: { permissions: [TICKETS_MANAGE_ANY], color: '#f00' },
      Member: { permissions: [TICKETS_MANAGE_OWN], color: '#999', name: 'Developer' },
    }
    const result = migrateDefaultRoleSettings(stored)
    expect(result.changed).toBe(true)
    expect(result.value).toEqual({
      Owner: { permissions: [TICKETS_MANAGE_ANY], color: '#f00' },
      Member: {
        permissions: [TICKETS_MANAGE_OWN, TICKETS_MANAGE_ASSIGNED],
        color: '#999',
        name: 'Developer',
      },
    })
  })

  it('updates the old array format', () => {
    const result = migrateDefaultRoleSettings({ Member: [TICKETS_MANAGE_OWN] })
    expect(result).toEqual({
      changed: true,
      value: { Member: [TICKETS_MANAGE_OWN, TICKETS_MANAGE_ASSIGNED] },
    })
  })

  it('updates eligible custom role templates', () => {
    const stored = {
      _customRoles: [
        { id: 'r1', name: 'Contractor', permissions: [TICKETS_MANAGE_OWN] },
        { id: 'r2', name: 'Viewer', permissions: [] },
      ],
    }
    const result = migrateDefaultRoleSettings(stored)
    expect(result.changed).toBe(true)
    expect(result.value).toEqual({
      _customRoles: [
        {
          id: 'r1',
          name: 'Contractor',
          permissions: [TICKETS_MANAGE_OWN, TICKETS_MANAGE_ASSIGNED],
        },
        { id: 'r2', name: 'Viewer', permissions: [] },
      ],
    })
  })

  it('does not mutate the input', () => {
    const stored = { Member: { permissions: [TICKETS_MANAGE_OWN] } }
    migrateDefaultRoleSettings(stored)
    expect(stored.Member.permissions).toEqual([TICKETS_MANAGE_OWN])
  })

  it('reports no change when nothing needs migrating (idempotent)', () => {
    const once = migrateDefaultRoleSettings({ Member: [TICKETS_MANAGE_OWN] })
    expect(migrateDefaultRoleSettings(once.value)).toEqual({ changed: false, value: once.value })
  })

  it('handles empty and JSON-string settings', () => {
    expect(migrateDefaultRoleSettings(null)).toEqual({ changed: false, value: null })
    const asString = JSON.stringify({ Member: [TICKETS_MANAGE_OWN] })
    expect(migrateDefaultRoleSettings(asString)).toEqual({
      changed: true,
      value: { Member: [TICKETS_MANAGE_OWN, TICKETS_MANAGE_ASSIGNED] },
    })
  })
})
