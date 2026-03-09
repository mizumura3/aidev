import { appendFileSync } from "node:fs";

export type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  level: LogLevel;
  msg: string;
  [key: string]: unknown;
}

const levelOrder: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export interface Logger {
  debug(msg: string, extra?: Record<string, unknown>): void;
  info(msg: string, extra?: Record<string, unknown>): void;
  warn(msg: string, extra?: Record<string, unknown>): void;
  error(msg: string, extra?: Record<string, unknown>): void;
}

export interface CreateLoggerOptions {
  minLevel?: LogLevel;
  logFilePath?: string;
}

export function createLogger(opts: LogLevel | CreateLoggerOptions = "info"): Logger {
  const { minLevel = "info", logFilePath } = typeof opts === "string" ? { minLevel: opts } : opts;

  function log(level: LogLevel, msg: string, extra?: Record<string, unknown>) {
    if (levelOrder[level] < levelOrder[minLevel]) return;
    const entry: LogEntry = {
      level,
      msg,
      ts: new Date().toISOString(),
      ...extra,
    };
    const output = JSON.stringify(entry);
    process.stderr.write(output + "\n");
    if (logFilePath) {
      try {
        appendFileSync(logFilePath, output + "\n");
      } catch {
        // Logging should never crash the application
      }
    }
  }

  return {
    debug: (msg, extra) => log("debug", msg, extra),
    info: (msg, extra) => log("info", msg, extra),
    warn: (msg, extra) => log("warn", msg, extra),
    error: (msg, extra) => log("error", msg, extra),
  };
}
