/**
 * Permission data migrations.
 *
 * PUNT-7 added `tickets.manage_assigned`. New projects get it from ROLE_PRESETS,
 * but roles already stored in the database (Role.permissions and the admin's
 * SystemSettings.defaultRolePermissions) need it added once. These helpers are
 * pure so they can be unit-tested; prisma/migrate-assigned-permission.ts applies them.
 *
 * Rule: a role that can manage its own tickets (manage_own) but not every ticket
 * (manage_any) also gets manage_assigned. Roles that never had manage_own were
 * deliberately restricted by an admin and are left alone.
 */

import { PERMISSIONS } from './constants'

const OWN = PERMISSIONS.TICKETS_MANAGE_OWN
const ANY = PERMISSIONS.TICKETS_MANAGE_ANY
const ASSIGNED = PERMISSIONS.TICKETS_MANAGE_ASSIGNED

const CUSTOM_ROLES_KEY = '_customRoles'

/** Read a stored permission list (native JSON array or legacy JSON string), keeping unknown strings. */
function readPermissionList(value: unknown): string[] | null {
  let parsed = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    } catch {
      return null
    }
  }
  if (!Array.isArray(parsed)) return null
  return parsed.filter((p): p is string => typeof p === 'string')
}

/**
 * Return the permission list with manage_assigned added, or null if the role
 * should not change (already has it, has manage_any, lacks manage_own, or is malformed).
 */
export function addAssignedPermission(value: unknown): string[] | null {
  const permissions = readPermissionList(value)
  if (!permissions) return null
  if (!permissions.includes(OWN) || permissions.includes(ANY) || permissions.includes(ASSIGNED)) {
    return null
  }
  return [...permissions, ASSIGNED]
}

interface MigrationResult {
  changed: boolean
  value: unknown
}

/** Migrate one role entry: either a bare permission array or `{ permissions: [...], ... }`. */
function migrateRoleEntry(entry: unknown): MigrationResult {
  if (Array.isArray(entry)) {
    const updated = addAssignedPermission(entry)
    return updated ? { changed: true, value: updated } : { changed: false, value: entry }
  }
  if (entry && typeof entry === 'object' && 'permissions' in entry) {
    const updated = addAssignedPermission((entry as { permissions: unknown }).permissions)
    return updated
      ? { changed: true, value: { ...entry, permissions: updated } }
      : { changed: false, value: entry }
  }
  return { changed: false, value: entry }
}

function migrateCustomRoles(roles: unknown): MigrationResult {
  if (!Array.isArray(roles)) return { changed: false, value: roles }
  const results = roles.map(migrateRoleEntry)
  return {
    changed: results.some((r) => r.changed),
    value: results.map((r) => r.value),
  }
}

/**
 * Migrate SystemSettings.defaultRolePermissions (default role templates and
 * `_customRoles`). Returns a new object; the input is never mutated.
 */
export function migrateDefaultRoleSettings(value: unknown): MigrationResult {
  let parsed = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    } catch {
      return { changed: false, value }
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { changed: false, value }
  }

  let changed = false
  const next: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(parsed)) {
    const result = key === CUSTOM_ROLES_KEY ? migrateCustomRoles(entry) : migrateRoleEntry(entry)
    changed ||= result.changed
    next[key] = result.value
  }

  if (!changed) return { changed: false, value }
  return { changed: true, value: next }
}
