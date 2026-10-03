import {
  ROW_CAP, isCapped, toYmd, todayLocal, presetRange, inRange, daysBetween,
  summarizeInvoices, profitAndLoss, monthlySeries, attributePayments, accountTotals,
  invoicesWithoutLedger, reversalIntegrity, transferBalance, trialBalance, balanceSheet,
  buildAging, bucketForDays, collectionRows, pivot, studentStatement, decodeRow,
} from "./reporting";

// The dataset from docs/audit/accounting-auditor.md (ACC-04):
// A paid in full, B 3000 + 2000 concession, C and E marked paid with no
// money recorded (QuickPayment / bulk receive), D partial 2500 of 6000.
const invoices = [
  { id: "A", amount: 5000, status: "paid", paidAmount: 5000, studentId: "s1", paidDate: "2026-10-01" },
  { id: "B", amount: 5000, status: "paid", paidAmount: 3000, concessionAmount: 2000, studentId: "s2", paidDate: "2026-10-02" },
  { id: "C", amount: 4000, status: "paid", studentId: "s2", paidDate: "2026-10-03" },
  { id: "D", amount: 6000, status: "partial", paidAmount: 2500, studentId: "s3", paidDate: "2026-10-04", dueDate: "2026-08-15" },
  { id: "E", amount: 3000, status: "paid", studentId: "s4", paidDate: "2026-10-05" },
];
const payments = [
  { id: "p1", type: "cash_in", account: "Cash", amount: 5000, source: "invoice", sourceId: "A", date: "2026-10-01" },
  { id: "p2", type: "cash_in", account: "Cash", amount: 3000, source: "invoice", sourceId: "B", date: "2026-10-02" },
  { id: "p3", type: "cash_in", account: "Cash", amount: 2500, source: "invoice", sourceId: "D", date: "2026-10-04" },
];
describe("ACC-04: one definition of collected / pending", () => {
  // The formulas the screens used before, kept here to show the drift.
  const legacyDashboardCollected = invoices.filter((i) => i.status === "paid").reduce((s, i) => s + i.amount, 0);
  const legacyDashboardPending = invoices.filter((i) => i.status === "pending").reduce((s, i) => s + i.amount, 0);

  it("reproduces the old 17,000 vs 10,500 disagreement", () => {
    expect(legacyDashboardCollected).toBe(17000);
    expect(legacyDashboardPending).toBe(0);
    const legacyReportsCollected = invoices.reduce((s, i) => s + (i.paidAmount || 0), 0);
    expect(legacyReportsCollected).toBe(10500);
  });

  it("collected is cash recorded (10,500), matching the bank ledger", () => {
    const s = summarizeInvoices(invoices, { today: "2026-10-10" });
    expect(s.collected).toBe(10500);
    const bank = payments.filter((p) => p.type === "cash_in").reduce((a, p) => a + p.amount, 0);
    expect(s.collected).toBe(bank);
  });

  it("splits the old 17,000 into cash, concession and unverified", () => {
    const s = summarizeInvoices(invoices, { today: "2026-10-10" });
    // Fully-paid invoices' face value = 17,000:
    //   5000 + 3000 cash, 2000 concession, 4000 + 3000 marked paid without money
    expect(s.concessions).toBe(2000);
    expect(s.unverified).toBe(7000);
    expect(5000 + 3000 + s.concessions + s.unverified).toBe(legacyDashboardCollected);
    expect(s.unverifiedCount).toBe(2);
  });

  it("pending counts partial invoices and is net of payments (3,500)", () => {
    const s = summarizeInvoices(invoices, { today: "2026-10-10" });
    expect(s.outstanding).toBe(3500);
    expect(s.overdue).toBe(3500); // D is past due
    expect(s.overdueCount).toBe(1);
  });

  it("collection rate is honest about unverified invoices", () => {
    const s = summarizeInvoices(invoices, { today: "2026-10-10" });
    // 10,500 collected of (23,000 billed - 2,000 concession) = 50%
    expect(s.collectionRate).toBe(50);
  });

  it("does not count trashed invoices", () => {
    const withTrashed = [...invoices, { id: "T", amount: 9999, status: "pending", deletedAt: "2026-10-01T00:00:00Z" }];
    expect(summarizeInvoices(withTrashed, { today: "2026-10-10" }).outstanding).toBe(3500);
  });

  it("uses matchesBranch so Main Office matches an empty branchId", () => {
    const inv = [
      { id: "1", amount: 100, status: "pending", branchId: "" },
      { id: "2", amount: 200, status: "pending", branchId: "b1" },
    ];
    expect(summarizeInvoices(inv, { branch: "main" }).outstanding).toBe(100);
    expect(summarizeInvoices(inv, { branch: "b1" }).outstanding).toBe(200);
    expect(summarizeInvoices(inv, { branch: "all" }).outstanding).toBe(300);
  });

  it("profit and loss: salaries only when paid, expenses by date", () => {
    const pl = profitAndLoss({
      invoices,
      expenses: [{ amount: 1000, date: "2026-10-02" }, { amount: 500, date: "2025-10-02" }],
      payslips: [
        { netPay: 2000, status: "paid", paidDate: "2026-10-05" },
        { netPay: 9000, status: "pending", date: "2026-10-05" },
      ],
    }, { range: { from: "2026-01-01", to: "2026-10-10" }, today: "2026-10-10" });
    expect(pl.expenses).toBe(1000);
    expect(pl.salaries).toBe(2000);
    expect(pl.net).toBe(10500 - 1000 - 2000);
  });
});

describe("ACC-05: ranges, years and timezones", () => {
  it("year to date starts on 1 January of the current year", () => {
    expect(presetRange("ytd", new Date(2026, 9, 3))).toEqual({ from: "2026-01-01", to: "2026-10-03" });
    expect(presetRange("last_month", new Date(2026, 0, 15))).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(presetRange("all")).toEqual({ from: "", to: "" });
  });

  it("excludes prior years from a YTD range and never merges Oct 2025 with Oct 2026", () => {
    const inv = [
      { id: "x", amount: 4000, status: "paid", paidAmount: 4000, paidDate: "2025-10-10" },
      { id: "y", amount: 5000, status: "paid", paidAmount: 5000, paidDate: "2026-10-10" },
    ];
    const ytd = { from: "2026-01-01", to: "2026-12-31" };
    expect(summarizeInvoices(inv, { range: ytd }).collected).toBe(5000);
    const series = monthlySeries({ invoices: inv, expenses: [], payslips: [] }, {});
    const oct25 = series.find((m) => m.key === "2025-10");
    const oct26 = series.find((m) => m.key === "2026-10");
    expect(oct25.income).toBe(4000);
    expect(oct26.income).toBe(5000);
    expect(series).toHaveLength(13);
  });

  it("does not move undated records into the current month", () => {
    const inv = [{ id: "u", amount: 100, status: "paid", paidAmount: 100 }];
    const s = summarizeInvoices(inv, { range: { from: "2026-01-01", to: "2026-12-31" } });
    expect(s.collected).toBe(0);
    expect(s.undated).toBeGreaterThan(0);
    expect(summarizeInvoices(inv, {}).collected).toBe(100);
  });

  it("treats YYYY-MM-DD as a plain local date (no UTC shift) and ranges are inclusive", () => {
    expect(toYmd("2026-10-01")).toBe("2026-10-01");
    expect(toYmd("not a date")).toBe("");
    expect(toYmd("2026-02-30")).toBe("");
    expect(inRange("2026-10-01", { from: "2026-10-01", to: "2026-10-31" })).toBe(true);
    expect(inRange("2026-10-31", { from: "2026-10-01", to: "2026-10-31" })).toBe(true);
    expect(inRange("2026-11-01", { from: "2026-10-01", to: "2026-10-31" })).toBe(false);
  });

  it("todayLocal uses local components, not UTC", () => {
    expect(todayLocal(new Date(2026, 10, 1, 3, 30))).toBe("2026-11-01");
  });

  it("daysBetween is whole days", () => {
    expect(daysBetween("2026-10-01", "2026-10-31")).toBe(30);
    expect(daysBetween("2026-03-01", "2026-04-01")).toBe(31);
  });
});

describe("DB-5 / ACC-21: row cap", () => {
  it("flags exactly the platform cap", () => {
    expect(ROW_CAP).toBe(1000);
    expect(isCapped(1000)).toBe(true);
    expect(isCapped(999)).toBe(false);
    expect(isCapped(1001)).toBe(false);
  });
});

describe("ACC-07: accounts by id, name as fallback", () => {
  it("renaming an account does not orphan payments that carry its id", () => {
    const accs = [{ id: "a1", code: "1", name: "Meezan Bank Ltd", balance: 100 }];
    const pays = [{ id: "p", type: "cash_in", account: "Meezan Bank", accountId: "a1", amount: 50 }];
    const { byAccount, unmatched } = attributePayments(accs, pays);
    expect(unmatched).toHaveLength(0);
    expect(accountTotals(accs[0], byAccount.get("a1")).balance).toBe(150);
  });

  it("falls back to the name for rows without an id, and reports unknown names", () => {
    const accs = [{ id: "a1", code: "1", name: "Cash", balance: 0 }];
    const pays = [
      { id: "p1", type: "cash_in", account: "Cash", amount: 10 },
      { id: "p2", type: "cash_in", account: "Old Name", amount: 99 },
    ];
    const r = attributePayments(accs, pays);
    expect(r.byAccount.get("a1")).toHaveLength(1);
    expect(r.unmatched.map((p) => p.id)).toEqual(["p2"]);
  });

  it("duplicate account names do not double count", () => {
    const accs = [
      { id: "a1", code: "1", name: "Cash", balance: 0 },
      { id: "a2", code: "2", name: "Cash", balance: 0 },
    ];
    const pays = [{ id: "p1", type: "cash_in", account: "Cash", amount: 10 }];
    const r = attributePayments(accs, pays);
    const total = accs.reduce((s, a) => s + accountTotals(a, r.byAccount.get(a.id)).balance, 0);
    expect(total).toBe(10);
    expect(r.duplicateNames).toEqual(["Cash"]);
  });
});

describe("ACC-06: books checks", () => {
  it("flags invoices marked paid with no matching ledger entry", () => {
    const flagged = invoicesWithoutLedger(invoices, payments);
    expect(flagged.map((f) => f.id).sort()).toEqual(["C", "E"]);
    expect(flagged.find((f) => f.id === "C")).toMatchObject({ claimed: 4000, posted: 0, kind: "no_ledger" });
  });

  it("flags a paid invoice whose ledger entry was reversed", () => {
    const pays = [
      { id: "p1", type: "cash_in", amount: 5000, source: "invoice", sourceId: "A", reversed: true },
      { id: "p2", type: "cash_out", amount: 5000, source: "invoice", sourceId: "A", reversalOf: "p1" },
    ];
    const flagged = invoicesWithoutLedger([invoices[0]], pays);
    expect(flagged).toHaveLength(1);
  });

  it("reports a short ledger for a paid invoice", () => {
    const f = invoicesWithoutLedger(
      [{ id: "Z", amount: 5000, status: "paid", paidAmount: 3000 }],
      [{ id: "p", type: "cash_in", amount: 3000, source: "invoice", sourceId: "Z" }],
    );
    expect(f[0]).toMatchObject({ kind: "short", diff: 2000 });
  });

  it("detects broken reversal pairs and one-legged transfers", () => {
    expect(reversalIntegrity([{ id: "p1", reversed: true }])).toHaveLength(1);
    expect(reversalIntegrity([
      { id: "p1", reversed: true },
      { id: "p2", reversalOf: "p1" },
    ])).toHaveLength(0);
    expect(transferBalance([
      { type: "cash_out", amount: 500, category: "Bank Transfer" },
    ]).diff).toBe(-500);
  });

  it("trial balance: opening balances and journals must balance", () => {
    const accs = [
      { id: "a", code: "1", name: "Cash", type: "Assets", balance: 1000 },
      { id: "e", code: "3", name: "Capital", type: "Equity", balance: 1000 },
      { id: "i", code: "4", name: "Fees", type: "Income", balance: 0 },
    ];
    const journals = [{ id: "j", amount: 200, debitAccount: "Cash", creditAccount: "Fees" }];
    const tb = trialBalance({ accounts: accs, journals, payments: [] });
    expect(tb.openingDiff).toBe(0);
    expect(tb.balanced).toBe(true);
    const bs = balanceSheet({ accounts: accs, journals, payments: [] });
    expect(bs.assets.total).toBe(1200);
    expect(bs.rightTotal).toBe(1200);
    expect(bs.difference).toBe(0);
  });

  it("balance sheet shows the imbalance instead of hiding it, and bad journals", () => {
    const accs = [{ id: "a", code: "1", name: "Cash", type: "Assets", balance: 1000 }];
    const journals = [{ id: "j", amount: 50, debitAccount: "Cash", creditAccount: "Gone" }];
    const bs = balanceSheet({ accounts: accs, journals, payments: [] });
    expect(bs.difference).toBe(1000);
    expect(bs.tb.journalProblems).toHaveLength(1);
    expect(bs.tb.balanced).toBe(false);
  });

  it("an older auto-posted expense journal is not counted on top of its cash_out payment", () => {
    const accs = [
      { id: "a", code: "1", name: "Cash", type: "Assets", balance: 1000 },
      { id: "x", code: "5", name: "Rent", type: "Expenses", balance: 0 },
      { id: "e", code: "3", name: "Capital", type: "Equity", balance: 1000 },
    ];
    const pay = { id: "p", type: "cash_out", account: "Cash", accountId: "a", amount: 300, source: "expense", sourceId: "ex1" };
    const jr = { id: "j", amount: 300, debitAccount: "Rent", creditAccount: "Cash", source: "expense", sourceId: "ex1" };
    const tb = trialBalance({ accounts: accs, journals: [jr], payments: [pay] });
    expect(tb.rows.find((r) => r.account.id === "a").net).toBe(700); // paid once, not twice
    expect(tb.postedJournals).toBe(0);
    // once the payment is reversed (expense deleted) nothing stands in for it
    const rev = [{ ...pay, reversed: true }, { ...pay, id: "p2", type: "cash_in", reversalOf: "p" }];
    expect(trialBalance({ accounts: accs, journals: [jr], payments: rev }).postedJournals).toBe(1);
  });

  it("cash movements flow into assets and into the derived equity line", () => {
    const accs = [{ id: "a", code: "1", name: "Cash", type: "Assets", balance: 0 }];
    const bs = balanceSheet({ accounts: accs, journals: [], payments });
    expect(bs.assets.total).toBe(10500);
    expect(bs.unbookedCash).toBe(10500);
    expect(bs.difference).toBe(0);
  });
});

describe("FEAT-001: aging", () => {
  it("buckets days past due", () => {
    expect(bucketForDays(-1)).toBe("current");
    expect(bucketForDays(0)).toBe("d0_30");
    expect(bucketForDays(30)).toBe("d0_30");
    expect(bucketForDays(31)).toBe("d31_60");
    expect(bucketForDays(60)).toBe("d31_60");
    expect(bucketForDays(61)).toBe("d61_90");
    expect(bucketForDays(90)).toBe("d61_90");
    expect(bucketForDays(91)).toBe("d90plus");
  });

  it("builds one row per student, ignoring paid invoices, using balance not face value", () => {
    const inv = [
      { id: "1", studentId: "s1", studentName: "Ali", amount: 5000, paidAmount: 2000, status: "partial", dueDate: "2026-09-01" },
      { id: "2", studentId: "s1", studentName: "Ali", amount: 1000, status: "pending", dueDate: "2026-05-01" },
      { id: "3", studentId: "s2", studentName: "Sara", amount: 700, status: "paid", paidAmount: 700, dueDate: "2026-01-01" },
      { id: "4", studentId: "s3", studentName: "Omar", amount: 800, status: "pending", dueDate: "2026-12-01" },
    ];
    const students = [{ id: "s1", name: "Ali", parentPhone: "0300", grade: "5" }];
    const a = buildAging(inv, students, { today: "2026-10-03" });
    expect(a.rows.map((r) => r.name)).toEqual(["Ali", "Omar"]);
    const ali = a.rows[0];
    expect(ali.buckets.d31_60).toBe(3000); // 2026-09-01 is 32 days ago
    expect(ali.buckets.d90plus).toBe(1000);
    expect(ali.total).toBe(4000);
    expect(ali.phone).toBe("0300");
    expect(a.rows[1].buckets.current).toBe(800);
    expect(a.total).toBe(4800);
  });
});

describe("FEAT-002: collections", () => {
  const accs = [
    { id: "c", code: "1", name: "Cash", type: "Assets" },
    { id: "b", code: "2", name: "Bank", type: "Assets" },
  ];
  const inv = [{ id: "i1", branchId: "north" }, { id: "i2", branchId: "" }];
  const pays = [
    { id: "1", type: "cash_in", source: "invoice", sourceId: "i1", account: "Cash", amount: 100, date: "2026-09-10", branchId: "" },
    { id: "2", type: "cash_in", source: "invoice", sourceId: "i2", account: "Bank", amount: 50, date: "2026-10-10" },
    // reversed pair must vanish
    { id: "3", type: "cash_in", source: "invoice", sourceId: "i2", account: "Bank", amount: 70, date: "2026-10-11", reversed: true },
    { id: "4", type: "cash_out", source: "invoice", sourceId: "i2", account: "Bank", amount: 70, date: "2026-10-12", reversalOf: "3" },
    // not a fee receipt
    { id: "5", type: "cash_in", source: "", account: "Cash", amount: 999, date: "2026-10-10" },
  ];

  it("groups net fee receipts by branch, month and account", () => {
    const { rows } = collectionRows({ payments: pays, invoices: inv, accounts: accs }, {});
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === "1").branchKey).toBe("north"); // from the invoice
    const p = pivot(rows, "month", "accountName");
    expect(p.rowKeys).toEqual(["2026-09", "2026-10"]);
    expect(p.cell("2026-09", "Cash")).toBe(100);
    expect(p.cell("2026-10", "Bank")).toBe(50);
    expect(p.grand).toBe(150);
  });

  it("respects branch and range", () => {
    const north = collectionRows({ payments: pays, invoices: inv, accounts: accs }, { branch: "north" });
    expect(north.rows.map((r) => r.id)).toEqual(["1"]);
    const oct = collectionRows({ payments: pays, invoices: inv, accounts: accs }, { range: { from: "2026-10-01", to: "2026-10-31" } });
    expect(oct.rows.map((r) => r.id)).toEqual(["2"]);
    const main = collectionRows({ payments: pays, invoices: inv, accounts: accs }, { branch: "main" });
    expect(main.rows.map((r) => r.id)).toEqual(["2"]);
  });
});

describe("Student ledger uses the same definitions", () => {
  it("shows cash, concession and the marked-paid-without-money gap for the audit student", () => {
    // student s2 has invoices B (3000 + 2000 concession) and C (marked paid, no money)
    const s2 = invoices.filter((i) => i.studentId === "s2");
    const st = studentStatement(s2, payments);
    expect(st.billed).toBe(9000);
    expect(st.received).toBe(3000);
    expect(st.concessions).toBe(2000);
    expect(st.unverified).toBe(4000);
    expect(st.outstanding).toBe(0);
    expect(st.ledgerGap).toBe(0);
  });

  it("does not double count reversals (restored invoice case)", () => {
    const inv = [{ id: "R", amount: 5000, status: "paid", paidAmount: 5000 }];
    const pays = [
      { id: "1", type: "cash_in", source: "invoice", sourceId: "R", amount: 5000, reversed: true },
      { id: "2", type: "cash_out", source: "invoice", sourceId: "R", amount: 5000, reversalOf: "1" },
    ];
    const st = studentStatement(inv, pays);
    expect(st.postedToLedger).toBe(0);
    expect(st.ledgerGap).toBe(5000);
  });
});

describe("decodeRow", () => {
  it("camel-cases columns and merges extra", () => {
    expect(decodeRow({ student_id: "x", extra: { month: "Oct" } })).toEqual({ studentId: "x", month: "Oct" });
  });
});
