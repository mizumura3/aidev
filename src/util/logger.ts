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

export function createLogger(minLevel: LogLevel = "info"): Logger {
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
  }

  return {
    debug: (msg, extra) => log("debug", msg, extra),
    info: (msg, extra) => log("info", msg, extra),
    warn: (msg, extra) => log("warn", msg, extra),
    error: (msg, extra) => log("error", msg, extra),
  };
}
