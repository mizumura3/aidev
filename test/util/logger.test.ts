import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createLogger } from "../../src/util/logger.js";

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
});
