import type { Request } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';

export interface AuditEntry {
  actorId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string | number;
  meta?: Prisma.InputJsonValue;
  req?: Request;
}

/** Audit log бичих нь үндсэн үйлдлийг хэзээ ч унагахгүй (fire-and-forget) */
export function audit(entry: AuditEntry) {
  const { req } = entry;
  prisma.auditLog
    .create({
      data: {
        actorId: entry.actorId ?? req?.auth?.userId ?? null,
        action: entry.action,
        entityType: entry.entityType ?? null,
        entityId: entry.entityId !== undefined ? String(entry.entityId) : null,
        ip: req?.ip?.slice(0, 45) ?? null,
        userAgent: req?.get('user-agent')?.slice(0, 300) ?? null,
        meta: entry.meta ?? undefined,
      },
    })
    .catch((err) => logger.error({ err, action: entry.action }, 'audit log write failed'));
}
