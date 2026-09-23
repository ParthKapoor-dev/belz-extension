// Error messages for people (logs, the options page, the panels' pills and
// toasts), and which HTTP failures are worth retrying.

/** The message of `err`, or its text; '' when there is nothing to say. */
export function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return err ? String(err) : '';
}

/**
 * True for an HTTP status that says "try again later" rather than "no":
 * 408 (timeout), 429 (too many requests) or any 5xx. Any other status is a
 * definite answer, and repeating the request would only get it again.
 */
export function isTransientStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}
