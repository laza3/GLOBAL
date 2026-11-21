import { dbErrorCode } from '@hmp/db';
import { ERRORS, isErrorCode, type ErrorCode } from '@hmp/shared';

/** Erreur métier : un code stable, jamais un message technique. */
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly details?: unknown,
  ) {
    super(code);
    this.name = 'AppError';
  }
  get status(): number {
    return ERRORS[this.code].status;
  }
  get userMessage(): string {
    return ERRORS[this.code].message;
  }
}

/** Traduit une erreur PostgreSQL connue en AppError ; null si elle est technique (→ 500, jamais exposée). */
export function fromDbError(error: unknown): AppError | null {
  const code = dbErrorCode(error);
  if (code && isErrorCode(code)) return new AppError(code);
  return null;
}
