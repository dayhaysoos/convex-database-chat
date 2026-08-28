import { describe, expect, it } from "vitest";
import {
  OpenRouterError,
  isAbortError,
  parseRetryAfterMs,
  statusToErrorCode,
} from "./errors.js";
import {
  DEFAULT_RETRY_OPTIONS,
  abortableSleep,
  backoffDelayMs,
} from "./retry.js";

describe("statusToErrorCode", () => {
  it("classifies auth failures as unauthorized", () => {
    expect(statusToErrorCode(401)).toBe("unauthorized");
    expect(statusToErrorCode(403)).toBe("unauthorized");
  });

  it("classifies 429 as rate_limited and 408 as timeout", () => {
    expect(statusToErrorCode(429)).toBe("rate_limited");
    expect(statusToErrorCode(408)).toBe("timeout");
  });

  it("classifies 5xx as provider_error and other 4xx as invalid_request", () => {
    expect(statusToErrorCode(500)).toBe("provider_error");
    expect(statusToErrorCode(503)).toBe("provider_error");
    expect(statusToErrorCode(400)).toBe("invalid_request");
    expect(statusToErrorCode(422)).toBe("invalid_request");
  });
});

describe("parseRetryAfterMs", () => {
  it("parses delta-seconds values", () => {
    expect(parseRetryAfterMs("30")).toBe(30_000);
    expect(parseRetryAfterMs("0")).toBe(0);
  });

  it("returns undefined for missing or non-numeric values", () => {
    expect(parseRetryAfterMs(null)).toBeUndefined();
    expect(parseRetryAfterMs(undefined)).toBeUndefined();
    expect(parseRetryAfterMs("Wed, 21 Oct 2026 07:28:00 GMT")).toBeUndefined();
    expect(parseRetryAfterMs("-5")).toBeUndefined();
  });
});

describe("OpenRouterError", () => {
  it("carries classification data and behaves as an Error", () => {
    const error = new OpenRouterError("boom", {
      code: "provider_error",
      status: 500,
      retryable: true,
      retryAfterMs: 1000,
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("boom");
    expect(error.code).toBe("provider_error");
    expect(error.status).toBe(500);
    expect(error.retryable).toBe(true);
    expect(error.retryAfterMs).toBe(1000);
  });
});

describe("isAbortError", () => {
  it("recognizes abort errors by name", () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    expect(isAbortError(abort)).toBe(true);
    expect(isAbortError(new Error("regular"))).toBe(false);
    expect(isAbortError("nope")).toBe(false);
  });
});

describe("backoffDelayMs", () => {
  const options = DEFAULT_RETRY_OPTIONS;

  it("uses the Retry-After value when provided, capped by maxDelayMs", () => {
    expect(backoffDelayMs(1, options, 60_000)).toBe(options.maxDelayMs);
    expect(backoffDelayMs(3, options, 250)).toBe(250);
  });

  it("applies full jitter within the exponential window", () => {
    for (let attempt = 1; attempt <= 5; attempt++) {
      const ceiling = Math.min(
        options.maxDelayMs,
        options.baseDelayMs * 2 ** (attempt - 1)
      );
      for (let i = 0; i < 20; i++) {
        const delay = backoffDelayMs(attempt, options);
        expect(delay).toBeGreaterThanOrEqual(0);
        expect(delay).toBeLessThanOrEqual(ceiling);
      }
    }
  });
});

describe("abortableSleep", () => {
  it("resolves early when the signal aborts mid-sleep", async () => {
    const controller = new AbortController();
    const started = Date.now();
    const sleeping = abortableSleep(500, controller.signal);
    setTimeout(() => controller.abort(), 10);
    await sleeping;
    expect(Date.now() - started).toBeLessThan(400);
  });

  it("resolves immediately for an already-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    const started = Date.now();
    await abortableSleep(500, controller.signal);
    expect(Date.now() - started).toBeLessThan(100);
  });

  it("resolves after the full delay without a signal", async () => {
    const started = Date.now();
    await abortableSleep(25);
    expect(Date.now() - started).toBeGreaterThanOrEqual(20);
  });
});
