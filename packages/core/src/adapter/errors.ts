import type * as V from '../wire';

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

/** The server no longer knows a row's id or its cursor (404, or 409 cursor_expired): it re-minted
 * the row, as Ether does for Home's rows when the feed recomputes after playback. */
export function supersededRow(error: unknown): boolean {
  return error instanceof VelaError && (error.status === 404 || error.status === 409);
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
