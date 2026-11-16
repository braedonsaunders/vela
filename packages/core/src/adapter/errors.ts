import type * as V from '../../wire/v0/types';

/** A server's refusal in the v0 error shape, whichever protocol the server speaks. */
export class VelaError extends Error {
  constructor(
    readonly detail: V.ProtocolError,
    readonly status: number,
    readonly retryAfter: string | null = null,
  ) {
    super(detail.message);
  }
}

/** The refusal for an operation this server's adapter does not offer. */
export function notOffered(operation: string): VelaError {
  const detail: V.ProtocolError = {
    class: 'request',
    code: 'unsupported',
    message: `${operation} is not offered by this server`,
    retry: { allowed: false },
  };
  return new VelaError(detail, 400);
}
