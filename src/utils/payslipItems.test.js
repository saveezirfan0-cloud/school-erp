import { computePayslip, itemsFromPayslip } from "./payslipItems";

describe("computePayslip", () => {
  it("totals earnings and deductions exactly", () => {
    const r = computePayslip("50000", [
      { type: "earning", label: "Transport", amount: "1500.10" },
      { type: "earning", label: "Bonus", amount: "0.20" },
      { type: "deduction", label: "Tax", amount: "2000" },
    ]);
    expect(r).toMatchObject({ ok: true, basicSalary: 50000, allowances: 1500.3, deductions: 2000, netPay: 49500.3 });
    expect(r.lineItems).toHaveLength(3);
  });

  it("works with no line items", () => {
    expect(computePayslip(30000, [])).toMatchObject({ ok: true, allowances: 0, deductions: 0, netPay: 30000 });
  });

  it("drops fully blank rows but rejects half-filled ones", () => {
    expect(computePayslip(100, [{ type: "earning", label: "", amount: "" }]).lineItems).toEqual([]);
    expect(computePayslip(100, [{ type: "earning", label: "", amount: "5" }]).ok).toBe(false);
    expect(computePayslip(100, [{ type: "earning", label: "Bonus", amount: "" }]).ok).toBe(false);
  });

  it("rejects negative amounts, zero basic and non-positive net", () => {
    expect(computePayslip(100, [{ type: "earning", label: "X", amount: "-1" }]).ok).toBe(false);
    expect(computePayslip(0, []).ok).toBe(false);
    expect(computePayslip("", []).ok).toBe(false);
    expect(computePayslip(100, [{ type: "deduction", label: "Fine", amount: "100" }]).ok).toBe(false);
  });
});

describe("itemsFromPayslip", () => {
  it("uses stored line items", () => {
    expect(itemsFromPayslip({ lineItems: [{ type: "deduction", label: "Tax", amount: 5 }] }))
      .toEqual([{ type: "deduction", label: "Tax", amount: 5 }]);
  });

  it("turns legacy flat totals into one line each", () => {
    expect(itemsFromPayslip({ allowances: 200, deductions: 50 })).toEqual([
      { type: "earning", label: "Allowances", amount: 200 },
      { type: "deduction", label: "Deductions", amount: 50 },
    ]);
    expect(itemsFromPayslip({ allowances: 0, deductions: 0 })).toEqual([]);
  });
});
