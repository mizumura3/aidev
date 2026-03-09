import { createWriteStream, type WriteStream } from "node:fs";

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
  setLogFile(path: string): void;
  flush(): Promise<void>;
}

export interface CreateLoggerOptions {
  minLevel?: LogLevel;
  logFilePath?: string;
}

export function createLogger(opts: CreateLoggerOptions = {}): Logger {
  const { minLevel = "info", logFilePath } = opts;

  let stream: WriteStream | null = null;
  let fileErrorWarned = false;

  function openStream(path: string): void {
    if (stream) {
      stream.end();
    }
    fileErrorWarned = false;
    stream = createWriteStream(path, { flags: "a" });
    stream.on("error", (err) => {
      if (!fileErrorWarned) {
        fileErrorWarned = true;
        process.stderr.write(
          JSON.stringify({ level: "warn", msg: "Log file write failed", error: String(err), ts: new Date().toISOString() }) + "\n"
        );
      }
    });
  }

  if (logFilePath) {
    openStream(logFilePath);
  }

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
    if (stream) {
      stream.write(output + "\n");
    }
  }

  return {
    debug: (msg, extra) => log("debug", msg, extra),
    info: (msg, extra) => log("info", msg, extra),
    warn: (msg, extra) => log("warn", msg, extra),
    error: (msg, extra) => log("error", msg, extra),
    setLogFile(path: string) {
      openStream(path);
    },
    flush(): Promise<void> {
      return new Promise((resolve, reject) => {
        if (stream && !stream.destroyed) {
          stream.write("", (err) => {
            if (err) reject(err);
            else resolve();
          });
        } else {
          resolve();
        }
      });
    },
  };
}
