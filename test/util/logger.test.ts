import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import { createLogger } from "../../src/util/logger.js";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("createLogger", () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  const tmpDirs: string[] = [];

  function makeTmpDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "logger-test-"));
    tmpDirs.push(dir);
    return dir;
  }

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(() => {
    for (const dir of tmpDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes all log levels to stderr", () => {
    const logger = createLogger({ minLevel: "debug" });

    logger.debug("debug msg");
    logger.info("info msg");
    logger.warn("warn msg");
    logger.error("error msg");

    expect(stderrSpy).toHaveBeenCalledTimes(4);

    const messages = stderrSpy.mock.calls.map((call) =>
      JSON.parse(call[0] as string)
    );
    expect(messages[0]).toMatchObject({ level: "debug", msg: "debug msg" });
    expect(messages[1]).toMatchObject({ level: "info", msg: "info msg" });
    expect(messages[2]).toMatchObject({ level: "warn", msg: "warn msg" });
    expect(messages[3]).toMatchObject({ level: "error", msg: "error msg" });
  });

  it("respects minLevel filtering", () => {
    const logger = createLogger({ minLevel: "warn" });

    logger.debug("skip");
    logger.info("skip");
    logger.warn("show");
    logger.error("show");

    expect(stderrSpy).toHaveBeenCalledTimes(2);
  });

  it("defaults to info level", () => {
    const logger = createLogger();

    logger.debug("skip");
    logger.info("show");

    expect(stderrSpy).toHaveBeenCalledTimes(1);
  });

  describe("logFilePath option", () => {
    it("writes log entries to file when logFilePath is specified", async () => {
      const tmpDir = makeTmpDir();
      const logFile = join(tmpDir, "run.log");

      const logger = createLogger({ minLevel: "debug", logFilePath: logFile });

      logger.info("hello file");
      logger.debug("debug file");
      await logger.flush();

      expect(existsSync(logFile)).toBe(true);
      const lines = readFileSync(logFile, "utf-8").trim().split("\n");
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0])).toMatchObject({ level: "info", msg: "hello file" });
      expect(JSON.parse(lines[1])).toMatchObject({ level: "debug", msg: "debug file" });
    });

    it("does not write to file when logFilePath is not specified", () => {
      const logger = createLogger({ minLevel: "info" });

      logger.info("no file");

      expect(stderrSpy).toHaveBeenCalledTimes(1);
    });

    it("applies minLevel filtering to file output", async () => {
      const tmpDir = makeTmpDir();
      const logFile = join(tmpDir, "run.log");

      const logger = createLogger({ minLevel: "warn", logFilePath: logFile });

      logger.debug("skip");
      logger.info("skip");
      logger.warn("show");
      logger.error("show");
      await logger.flush();

      const lines = readFileSync(logFile, "utf-8").trim().split("\n");
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0])).toMatchObject({ level: "warn", msg: "show" });
      expect(JSON.parse(lines[1])).toMatchObject({ level: "error", msg: "show" });
    });

    it("still writes to stderr when logFilePath is specified", async () => {
      const tmpDir = makeTmpDir();
      const logFile = join(tmpDir, "run.log");

      const logger = createLogger({ minLevel: "info", logFilePath: logFile });

      logger.info("both outputs");
      await logger.flush();

      expect(stderrSpy).toHaveBeenCalledTimes(1);
      const lines = readFileSync(logFile, "utf-8").trim().split("\n");
      expect(lines).toHaveLength(1);
    });

    it("does not crash when file write fails and emits a single stderr warning", async () => {
      stderrSpy.mockRestore();
      stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);

      const logFile = "/nonexistent-dir/impossible-path/run.log";
      const logger = createLogger({ minLevel: "info", logFilePath: logFile });

      // Should not throw
      expect(() => logger.info("should not crash")).not.toThrow();
      expect(() => logger.info("second log")).not.toThrow();

      // Wait for async error event to fire
      await new Promise((resolve) => setTimeout(resolve, 50));

      // stderr: 2 log lines + exactly 1 warning about file write failure
      const allCalls = stderrSpy.mock.calls.map((c) => c[0] as string);
      const warnings = allCalls.filter((s) => s.includes("Log file write failed"));
      expect(warnings).toHaveLength(1);
    });
  });

  describe("setLogFile", () => {
    it("enables file logging after logger creation", async () => {
      const tmpDir = makeTmpDir();
      const logFile = join(tmpDir, "run.log");

      const logger = createLogger({ minLevel: "info" });

      logger.info("before setLogFile - not in file");
      logger.setLogFile(logFile);
      logger.info("after setLogFile - in file");
      await logger.flush();

      const lines = readFileSync(logFile, "utf-8").trim().split("\n");
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0])).toMatchObject({ msg: "after setLogFile - in file" });
    });

    it("switches to a new log file", async () => {
      const tmpDir = makeTmpDir();
      const logFile1 = join(tmpDir, "run1.log");
      const logFile2 = join(tmpDir, "run2.log");

      const logger = createLogger({ minLevel: "info", logFilePath: logFile1 });

      logger.info("in file 1");
      await logger.flush();

      logger.setLogFile(logFile2);
      logger.info("in file 2");
      await logger.flush();

      const lines1 = readFileSync(logFile1, "utf-8").trim().split("\n");
      expect(lines1).toHaveLength(1);
      expect(JSON.parse(lines1[0])).toMatchObject({ msg: "in file 1" });

      const lines2 = readFileSync(logFile2, "utf-8").trim().split("\n");
      expect(lines2).toHaveLength(1);
      expect(JSON.parse(lines2[0])).toMatchObject({ msg: "in file 2" });
    });
  });
});
