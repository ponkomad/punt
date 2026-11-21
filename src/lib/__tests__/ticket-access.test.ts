/**
 * Ticket access rules (PUNT-7): creators, assignees and "manage any" holders.
 * Covers resolveTicketAccess (pure), requireTicketAccess / requireTicketsAccess
 * (async, permission lookup) and the backward-compatible requireTicketPermission.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS, type Permission } from '../permissions'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
vi.mock('@/lib/db', () => ({
  db: { user: { findUnique: vi.fn() }, projectMember: { findUnique: vi.fn() } },
}))
vi.mock('@/lib/permissions/check', () => ({
  hasPermission: vi.fn(),
  hasAnyPermission: vi.fn(),
  hasAllPermissions: vi.fn(),
  isMember: vi.fn(),
  getEffectivePermissions: vi.fn(),
  getRolePermissions: vi.fn(),
  canManageMember: vi.fn(),
  canAssignRole: vi.fn(),
}))

import { getEffectivePermissions } from '@/lib/permissions/check'
import {
  requireTicketAccess,
  requireTicketPermission,
  requireTicketsAccess,
  resolveTicketAccess,
} from '../auth-helpers'

const mockGetEffectivePermissions = vi.mocked(getEffectivePermissions)

const ME = 'user-me'
const OTHER = 'user-other'
const PROJECT = 'project-1'
const FORBIDDEN = 'Forbidden: Missing permission to modify this resource'

const {
  TICKETS_MANAGE_OWN: OWN,
  TICKETS_MANAGE_ANY: ANY,
  TICKETS_MANAGE_ASSIGNED: ASSIGNED,
} = PERMISSIONS

function givenPermissions(permissions: Permission[], isSystemAdmin = false) {
  mockGetEffectivePermissions.mockResolvedValue({
    permissions: new Set(permissions),
    // biome-ignore lint/suspicious/noExplicitAny: mock typing
    membership: {} as any,
    isSystemAdmin,
  })
}

const assignedToMe = { creatorId: OTHER, assigneeId: ME }
const createdByMe = { creatorId: ME, assigneeId: OTHER }
const someoneElses = { creatorId: OTHER, assigneeId: OTHER }

describe('resolveTicketAccess', () => {
  const resolve = (perms: Permission[], ticket: typeof assignedToMe, action: 'edit' | 'delete') =>
    resolveTicketAccess(new Set(perms), false, ME, ticket, action)

  it('grants "assigned" edit access to the assignee with manage_assigned', () => {
    expect(resolve([ASSIGNED], assignedToMe, 'edit')).toBe('assigned')
  })

  it('does not let manage_assigned delete a ticket', () => {
    expect(resolve([ASSIGNED], assignedToMe, 'delete')).toBeNull()
  })

  it('does not grant assignee access without manage_assigned', () => {
    expect(resolve([OWN], assignedToMe, 'edit')).toBeNull()
  })

  it('does not grant manage_assigned on tickets assigned to someone else', () => {
    expect(resolve([ASSIGNED], someoneElses, 'edit')).toBeNull()
  })

  it('prefers "own" over "assigned" when the user is both creator and assignee', () => {
    expect(resolve([OWN, ASSIGNED], { creatorId: ME, assigneeId: ME }, 'edit')).toBe('own')
  })

  it('keeps creator access via manage_own for edit and delete', () => {
    expect(resolve([OWN], createdByMe, 'edit')).toBe('own')
    expect(resolve([OWN], createdByMe, 'delete')).toBe('own')
  })

  it('grants "any" for manage_any and for system admins', () => {
    expect(resolve([ANY], someoneElses, 'delete')).toBe('any')
    expect(resolveTicketAccess(new Set(), true, ME, someoneElses, 'delete')).toBe('any')
  })

  it('treats unassigned / creator-less tickets as not owned', () => {
    expect(resolve([OWN, ASSIGNED], { creatorId: null, assigneeId: null }, 'edit')).toBeNull()
  })
})

describe('requireTicketAccess', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the access mode for an assignee', async () => {
    givenPermissions([ASSIGNED])
    await expect(requireTicketAccess(ME, PROJECT, assignedToMe, 'edit')).resolves.toBe('assigned')
  })

  it('throws Forbidden when the user cannot edit', async () => {
    givenPermissions([OWN])
    await expect(requireTicketAccess(ME, PROJECT, assignedToMe, 'edit')).rejects.toThrow(FORBIDDEN)
  })
})

describe('requireTicketsAccess (batch)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('allows a batch where every ticket is created by or assigned to the user', async () => {
    givenPermissions([OWN, ASSIGNED])
    await expect(
      requireTicketsAccess(ME, PROJECT, [assignedToMe, createdByMe], 'edit'),
    ).resolves.toBeUndefined()
    expect(mockGetEffectivePermissions).toHaveBeenCalledTimes(1)
  })

  it('rejects the whole batch if any ticket is not editable', async () => {
    givenPermissions([OWN, ASSIGNED])
    await expect(
      requireTicketsAccess(ME, PROJECT, [assignedToMe, someoneElses], 'edit'),
    ).rejects.toThrow(FORBIDDEN)
  })

  it('allows any batch with manage_any', async () => {
    givenPermissions([ANY])
    await expect(
      requireTicketsAccess(ME, PROJECT, [someoneElses, someoneElses], 'edit'),
    ).resolves.toBeUndefined()
  })
})

describe('requireTicketPermission (backward compatible)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('accepts the assignee as an optional fifth argument', async () => {
    givenPermissions([ASSIGNED])
    await expect(requireTicketPermission(ME, PROJECT, OTHER, 'edit', ME)).resolves.toBe(true)
  })

  it('still denies an assignee when the assignee is not passed', async () => {
    givenPermissions([ASSIGNED])
    await expect(requireTicketPermission(ME, PROJECT, OTHER, 'edit')).rejects.toThrow(FORBIDDEN)
  })
})
