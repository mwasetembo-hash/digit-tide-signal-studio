import { describe, it, expect } from "vitest";
import { evaluateDigit, nextStake, detectSignal, DEFAULT_SETTINGS } from "@/lib/deriv-engine";

describe("deriv engine rules", () => {
  it("martingale multiplies stake by 2.1 after a loss", () => {
    expect(nextStake(1, 1, false, 1, 2.1, 5)).toBe(2.1);
  });
  it("stake resets after max consecutive losses", () => {
    expect(nextStake(1, 9.26, false, 5, 2.1, 5)).toBe(1);
  });
  it("stake resets after a win", () => {
    expect(nextStake(1, 4.41, true, 0, 2.1, 5)).toBe(1);
  });
  it("3 even digits in a row signals ODD", () => {
    expect(detectSignal([1, 2, 4, 6], DEFAULT_SETTINGS)?.type).toBe("DIGITODD");
  });
  it("over barrier is strict", () => {
    expect(evaluateDigit("DIGITOVER", 5, 5)).toBe(false);
  });
});

import { clampDigitBarrier } from "@/lib/deriv-engine";
import { hlBarrier, settleOrder } from "@/lib/scanner";
describe("barriers", () => {
  it("OVER barrier capped at 8", () => { expect(clampDigitBarrier("DIGITOVER", 9)).toBe(8); });
  it("UNDER barrier at least 1", () => { expect(clampDigitBarrier("DIGITUNDER", 0)).toBe(1); });
  it("Higher barrier is a negative non-zero offset", () => {
    const b = hlBarrier([100, 100, 100, 100], 2, "CALL", 5);
    expect(b).toBe("-0.01");
  });
  it("Higher wins only above entry+barrier", () => { expect(settleOrder("CALL", 100, 99.95, 5, "-0.1")).toBe(true); });
});
