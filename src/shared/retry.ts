// Which HTTP failures are worth retrying: the one retry policy shared by the
// AD Network panel's lookups and the PD Inspector's config fetches.

/**
 * True for an HTTP status that says "try again later" rather than "no":
 * 408 (timeout), 429 (too many requests) or any 5xx. Any other status is a
 * definite answer, and repeating the request would only get it again.
 */
export function isTransientStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}
