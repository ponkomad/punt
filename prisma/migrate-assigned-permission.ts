/**
 * Grant tickets.manage_assigned to existing roles that can manage their own
 * tickets but not every ticket. Run after deploying PUNT-7 with
 * `pnpm db:migrate-assigned-permission`.
 */

import type { InputJsonValue } from '../src/generated/prisma/runtime/library'
import { db } from '../src/lib/db'
import {
  addAssignedPermission,
  migrateDefaultRoleSettings,
} from '../src/lib/permissions/migrations'

async function migrateAssignedTicketPermission() {
  const roles = await db.role.findMany({ select: { id: true, permissions: true } })
  let updatedRoles = 0

  for (const role of roles) {
    const permissions = addAssignedPermission(role.permissions)
    if (!permissions) continue

    await db.role.update({
      where: { id: role.id },
      data: { permissions },
    })
    updatedRoles++
  }

  const settings = await db.systemSettings.findUnique({
    where: { id: 'system-settings' },
    select: { defaultRolePermissions: true },
  })
  const migratedSettings = migrateDefaultRoleSettings(settings?.defaultRolePermissions)

  if (settings && migratedSettings.changed) {
    await db.systemSettings.update({
      where: { id: 'system-settings' },
      data: { defaultRolePermissions: migratedSettings.value as InputJsonValue },
    })
  }

  console.info(
    `Added tickets.manage_assigned to ${updatedRoles} role(s)` +
      (migratedSettings.changed ? ' and updated system role defaults.' : '.'),
  )
}

migrateAssignedTicketPermission()
  .catch((error) => {
    console.error('Failed to migrate tickets.manage_assigned:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await db.$disconnect()
  })
