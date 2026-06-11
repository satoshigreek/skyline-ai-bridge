import { describe, expect, it } from "vitest";
import { applySlippage, fromSmallestUnits, toSmallestUnits } from "../src/lib/units";

describe("unit conversions", () => {
  it("converts USDC (6 decimals) exactly", () => {
    expect(toSmallestUnits("250", 6)).toBe(250_000_000n);
    expect(toSmallestUnits("0.000001", 6)).toBe(1n);
    expect(fromSmallestUnits(250_000_000n, 6)).toBe("250");
  });

  it("converts 18-decimal amounts exactly", () => {
    expect(toSmallestUnits("0.1", 18)).toBe(100_000_000_000_000_000n);
    expect(fromSmallestUnits(1_500_000_000_000_000_000n, 18)).toBe("1.5");
  });

  it("handles NEAR's 24 decimals without precision loss", () => {
    expect(toSmallestUnits("2.5", 24)).toBe(2_500_000_000_000_000_000_000_000n);
    expect(fromSmallestUnits(2_500_000_000_000_000_000_000_000n, 24)).toBe("2.5");
  });

  it("truncates excess precision instead of rounding up", () => {
    // 7 decimal places into a 6-decimal token -> truncate, never inflate.
    expect(toSmallestUnits("1.2345678", 6)).toBe(1_234_567n);
  });

  it("rejects non-decimal strings", () => {
    expect(() => toSmallestUnits("1e5", 6)).toThrow();
    expect(() => toSmallestUnits("-5", 6)).toThrow();
    expect(() => toSmallestUnits("abc", 6)).toThrow();
  });

  it("applies slippage floor in basis points", () => {
    expect(applySlippage(10_000n, 100)).toBe(9_900n); // 1%
    expect(applySlippage(10_000n, 50)).toBe(9_950n); // 0.5%
  });

  it("USDC 6 decimals vs 18 are never interchangeable", () => {
    const usdc = toSmallestUnits("250", 6);
    const erc18 = toSmallestUnits("250", 18);
    expect(usdc).not.toBe(erc18);
    expect(erc18 / usdc).toBe(10n ** 12n);
  });
});
