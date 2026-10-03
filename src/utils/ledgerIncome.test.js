import { isLedgerIncome, isFeeHead } from "./ledgerIncome";

describe("isLedgerIncome", () => {
  const base = { type: "cash_in", category: "Welfare", amount: 100 };

  test("counts plain cash_in income such as imported workbook rows", () => {
    expect(isLedgerIncome(base)).toBe(true);
    expect(isLedgerIncome({ ...base, source: "import", category: "Baneen Fees" })).toBe(true);
  });

  test("skips cash out, reversals and transfers", () => {
    expect(isLedgerIncome({ ...base, type: "cash_out" })).toBe(false);
    expect(isLedgerIncome({ ...base, reversed: true })).toBe(false);
    expect(isLedgerIncome({ ...base, reversalOf: "abc" })).toBe(false);
    expect(isLedgerIncome({ ...base, category: "Bank Deposit" })).toBe(false);
  });

  test("skips receipts already counted through an invoice, expense or payslip", () => {
    ["invoice", "expense", "payslip"].forEach((source) => {
      expect(isLedgerIncome({ ...base, source })).toBe(false);
    });
  });
});

describe("isFeeHead", () => {
  test("recognises student fee heads", () => {
    ["Baneen Fees", "Banaat Fees", "School Fees", "Umer Colony Fees", "Admission Fees",
      "Banaat Admission Fees", "Tafseer Course Fees", "Tuition Fee"].forEach((h) => {
      expect(isFeeHead(h)).toBe(true);
    });
  });

  test("leaves welfare, donations, loans and misc as other income", () => {
    ["Welfare", "Donation", "Loan", "Suspense", "Miscellaneous", ""].forEach((h) => {
      expect(isFeeHead(h)).toBe(false);
    });
  });
});
