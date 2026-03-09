import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createLogger } from "../../src/util/logger.js";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("createLogger", () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes all log levels to stderr", () => {
    const logger = createLogger("debug");

    logger.debug("debug msg");
    logger.info("info msg");
    logger.warn("warn msg");
    logger.error("error msg");

    expect(stderrSpy).toHaveBeenCalledTimes(4);
    expect(stdoutSpy).not.toHaveBeenCalled();

    const messages = stderrSpy.mock.calls.map((call) =>
      JSON.parse(call[0] as string)
    );
    expect(messages[0]).toMatchObject({ level: "debug", msg: "debug msg" });
    expect(messages[1]).toMatchObject({ level: "info", msg: "info msg" });
    expect(messages[2]).toMatchObject({ level: "warn", msg: "warn msg" });
    expect(messages[3]).toMatchObject({ level: "error", msg: "error msg" });
  });

  it("respects minLevel filtering", () => {
    const logger = createLogger("warn");

    logger.debug("skip");
    logger.info("skip");
    logger.warn("show");
    logger.error("show");

    expect(stderrSpy).toHaveBeenCalledTimes(2);
  });

  describe("logFilePath option", () => {
    it("writes log entries to file when logFilePath is specified", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "logger-test-"));
      const logFile = join(tmpDir, "run.log");

      const logger = createLogger({ minLevel: "debug", logFilePath: logFile });

      logger.info("hello file");
      logger.debug("debug file");

      expect(existsSync(logFile)).toBe(true);
      const lines = readFileSync(logFile, "utf-8").trim().split("\n");
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0])).toMatchObject({ level: "info", msg: "hello file" });
      expect(JSON.parse(lines[1])).toMatchObject({ level: "debug", msg: "debug file" });
    });

    it("does not write to file when logFilePath is not specified", () => {
      const logger = createLogger({ minLevel: "info" });

      logger.info("no file");

      // Only stderr should be called, no file created
      expect(stderrSpy).toHaveBeenCalledTimes(1);
    });

    it("applies minLevel filtering to file output", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "logger-test-"));
      const logFile = join(tmpDir, "run.log");

      const logger = createLogger({ minLevel: "warn", logFilePath: logFile });

      logger.debug("skip");
      logger.info("skip");
      logger.warn("show");
      logger.error("show");

      const lines = readFileSync(logFile, "utf-8").trim().split("\n");
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0])).toMatchObject({ level: "warn", msg: "show" });
      expect(JSON.parse(lines[1])).toMatchObject({ level: "error", msg: "show" });
    });

    it("still writes to stderr when logFilePath is specified", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "logger-test-"));
      const logFile = join(tmpDir, "run.log");

      const logger = createLogger({ minLevel: "info", logFilePath: logFile });

      logger.info("both outputs");

      expect(stderrSpy).toHaveBeenCalledTimes(1);
      const lines = readFileSync(logFile, "utf-8").trim().split("\n");
      expect(lines).toHaveLength(1);
    });

    it("does not crash when file write fails", () => {
      const logFile = "/nonexistent-dir/impossible-path/run.log";

      const logger = createLogger({ minLevel: "info", logFilePath: logFile });

      // Should not throw - logging failure is silently ignored
      expect(() => logger.info("should not crash")).not.toThrow();
      // stderr should still work
      expect(stderrSpy).toHaveBeenCalledTimes(1);
    });

    it("supports string argument for backward compatibility", () => {
      const logger = createLogger("debug");

      logger.debug("compat");

      expect(stderrSpy).toHaveBeenCalledTimes(1);
    });
  });
});
