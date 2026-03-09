/** Max length for stderr content in error logs to avoid leaking excessive data. */
const MAX_STDERR_LENGTH = 1000;

export interface ErrorDetails {
  error: string;
  stack?: string;
  stderr?: string;
  exitCode?: number;
  command?: string;
}

/**
 * Extract structured error details from an unknown error value.
 * Handles standard Error objects and ExecaError-like objects (duck-typed).
 */
export function formatErrorDetails(err: unknown): ErrorDetails {
  if (!(err instanceof Error)) {
    return { error: String(err) };
  }

  const details: ErrorDetails = {
    error: err.message,
    stack: err.stack,
  };

  // Duck-type ExecaError: check for stderr, exitCode, command properties
  const execaLike = err as unknown as Record<string, unknown>;

  if (typeof execaLike.stderr === "string") {
    details.stderr =
      execaLike.stderr.length > MAX_STDERR_LENGTH
        ? execaLike.stderr.slice(0, MAX_STDERR_LENGTH) + "...(truncated)"
        : execaLike.stderr;
  }

  if (typeof execaLike.exitCode === "number") {
    details.exitCode = execaLike.exitCode;
  }

  if (typeof execaLike.command === "string") {
    details.command = execaLike.command;
  }

  return details;
}
