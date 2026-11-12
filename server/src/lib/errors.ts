export type ErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'INVALID_CREDENTIALS'
  | 'TOKEN_EXPIRED'
  | 'SESSION_REVOKED'
  | 'ACCOUNT_LOCKED'
  | 'ACCOUNT_BANNED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'EMAIL_TAKEN'
  | 'ALREADY_ENTITLED'
  | 'NOT_ENTITLED'
  | 'VIDEO_NOT_READY'
  | 'RATE_LIMITED'
  | 'PAYLOAD_TOO_LARGE'
  | 'SERVICE_NOT_CONFIGURED'
  | 'PAYMENT_PROVIDER_ERROR'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }

  static badRequest(message = 'Буруу хүсэлт', details?: unknown) {
    return new AppError(400, 'BAD_REQUEST', message, details);
  }
  static unauthorized(message = 'Нэвтрэх шаардлагатай', code: ErrorCode = 'UNAUTHORIZED') {
    return new AppError(401, code, message);
  }
  static forbidden(message = 'Хандах эрхгүй', code: ErrorCode = 'FORBIDDEN') {
    return new AppError(403, code, message);
  }
  static notFound(message = 'Олдсонгүй') {
    return new AppError(404, 'NOT_FOUND', message);
  }
  static conflict(message: string, code: ErrorCode = 'CONFLICT') {
    return new AppError(409, code, message);
  }
  static notConfigured(service: string) {
    return new AppError(503, 'SERVICE_NOT_CONFIGURED', `${service} тохиргоо хийгдээгүй байна`);
  }
}
