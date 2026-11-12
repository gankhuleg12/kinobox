import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export const notFoundHandler: RequestHandler = (_req, _res, next) => next(AppError.notFound('Endpoint олдсонгүй'));

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let appErr: AppError;

  if (err instanceof AppError) {
    appErr = err;
  } else if (err instanceof ZodError) {
    appErr = new AppError(
      400,
      'VALIDATION_ERROR',
      err.issues[0]?.message ?? 'Мэдээлэл буруу байна',
      err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  } else if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    appErr = AppError.conflict('Энэ утга аль хэдийн бүртгэгдсэн байна');
  } else if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
    appErr = AppError.notFound();
  } else if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
    appErr = AppError.badRequest('Холбогдох бичлэг олдсонгүй');
  } else if (err?.type === 'entity.too.large') {
    appErr = new AppError(413, 'PAYLOAD_TOO_LARGE', 'Хүсэлтийн хэмжээ хэт их байна');
  } else if (err?.type === 'entity.parse.failed') {
    appErr = AppError.badRequest('JSON формат буруу байна');
  } else if (err?.name === 'MulterError') {
    appErr = AppError.badRequest(err.code === 'LIMIT_FILE_SIZE' ? 'Файлын хэмжээ хэт их байна' : 'Файл upload алдаа');
  } else {
    appErr = new AppError(500, 'INTERNAL_ERROR', 'Серверийн алдаа гарлаа');
  }

  if (appErr.status >= 500) {
    logger.error({ err, reqId: req.id, path: req.path }, 'Unhandled error');
  }

  if (res.headersSent) return;
  res.status(appErr.status).json({
    error: {
      code: appErr.code,
      message: appErr.message,
      ...(appErr.details !== undefined ? { details: appErr.details } : {}),
      requestId: req.id,
    },
  });
};
