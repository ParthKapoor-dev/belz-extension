// Error messages for people: logs, the options page, the panels' pills and toasts.

/** The message of `err`, or its text; '' when there is nothing to say. */
export function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return err ? String(err) : '';
}
