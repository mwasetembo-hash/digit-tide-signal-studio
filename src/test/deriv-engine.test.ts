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
