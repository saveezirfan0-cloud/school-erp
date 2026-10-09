import { summarizePayments, isCountedPayment } from "./paymentTotals";

const rows = [
  { id: "a", type: "cash_in", amount: 1000 },
  { id: "b", type: "cash_out", amount: 300 },
  // 500 received, then reversed: the original and its offsetting row
  { id: "c", type: "cash_in", amount: 500, reversed: true },
  { id: "d", type: "cash_out", amount: 500, reversalOf: "c" },
];

describe("summarizePayments", () => {
  it("ignores reversed originals and reversal rows", () => {
    expect(summarizePayments(rows)).toEqual({ totalIn: 1000, totalOut: 300, net: 700 });
  });

  it("keeps the net unchanged by reversal pairs", () => {
    const withoutPair = rows.filter((p) => p.id === "a" || p.id === "b");
    expect(summarizePayments(rows).net).toBe(summarizePayments(withoutPair).net);
  });

  it("adds money exactly", () => {
    expect(summarizePayments([
      { type: "cash_in", amount: 0.1 }, { type: "cash_in", amount: 0.2 }, { type: "cash_out", amount: 0.1 },
    ])).toEqual({ totalIn: 0.3, totalOut: 0.1, net: 0.2 });
  });

  it("handles empty input", () => {
    expect(summarizePayments([])).toEqual({ totalIn: 0, totalOut: 0, net: 0 });
    expect(summarizePayments()).toEqual({ totalIn: 0, totalOut: 0, net: 0 });
  });

  it("isCountedPayment", () => {
    expect(isCountedPayment({ type: "cash_in" })).toBe(true);
    expect(isCountedPayment({ reversed: true })).toBe(false);
    expect(isCountedPayment({ reversalOf: "x" })).toBe(false);
    expect(isCountedPayment(null)).toBe(false);
  });
});
