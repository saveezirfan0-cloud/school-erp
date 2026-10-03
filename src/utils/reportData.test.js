import {
  parseDay, presetRange, customRange, previousRange, inRange, resolveGranularity, resolveRange,
  prepareData, computeFinancials, buildSeries, branchBreakdown, change, effectiveStatus,
  allocateByHead, computeCashFlow, computeBalanceSheet, filterFeeRows, summarizeFees, buildHighlights,
  yearAgoRange, comparisonRange, classDetail, teachersForGrade, buildSummaryText,
} from "./reportData";
import { summarizeInvoices, profitAndLoss } from "./reporting";

const TODAY = new Date(2026, 2, 15); // 15 Mar 2026
const d = (y, m, day) => new Date(y, m - 1, day);

const raw = {
  students: [
    { id: "s1", name: "Ali", studentId: "ZMI-1", grade: "Grade 5", branchId: "b1" },
    { id: "s2", name: "Sara", studentId: "ZMI-2", grade: "Grade 6", branchId: "" },
  ],
  invoices: [
    // paid in full in Jan, two line items
    { id: "i1", studentId: "s1", studentName: "Ali", branchId: "b1", amount: 1000, paidAmount: 1000, status: "paid", month: "January", year: 2026, paidDate: "2026-01-10", dueDate: "2026-01-05", paidAccount: "Cash",
      lineItems: [{ description: "Tuition Fee", amount: 800 }, { description: "Transport", amount: 200 }] },
    // Feb: partial 400 of 1000 with 100 concession, due long ago
    { id: "i2", studentId: "s1", studentName: "Ali", branchId: "b1", amount: 1000, paidAmount: 400, concessionAmount: 100, status: "partial", month: "February", year: 2026, paidDate: "2026-02-20", dueDate: "2026-02-10", paidAccount: "Bank" },
    // Main office (no branch), unpaid, due in the future
    { id: "i3", studentId: "s2", studentName: "Sara", branchId: "", amount: 500, paidAmount: 0, status: "pending", month: "March", year: 2026, dueDate: "2026-03-31" },
  ],
  expenses: [
    { id: "e1", category: "Utilities", amount: 300, date: "2026-01-15", branchId: "b1" },
    { id: "e2", category: "Utilities", amount: 200, date: "2026-02-15", branchId: "" },
    { id: "e3", category: "Repairs", amount: 100, date: "2026-02-20", branchId: "b1" },
  ],
  payslips: [
    { id: "p1", employeeName: "T", role: "Teacher", netPay: 600, month: "January", year: 2026, status: "paid", branchId: "b1" },
    { id: "p2", employeeName: "T", role: "Teacher", netPay: 600, month: "February", year: 2026, status: "pending", branchId: "b1" },
  ],
  accounts: [
    { id: "a1", code: "1000", name: "Cash", type: "Assets", subType: "Bank & Cash", balance: 5000 },
    { id: "a2", code: "1010", name: "Bank", type: "Assets", subType: "Bank & Cash", balance: 0 },
    { id: "a3", code: "2000", name: "Loan", type: "Liabilities", balance: 700 },
  ],
  payments: [
    { id: "x1", type: "cash_in", account: "Cash", amount: 1000, category: "Fee Collection", date: "2026-01-10", branchId: "b1" },
    { id: "x2", type: "cash_out", account: "Cash", amount: 300, category: "Utilities", date: "2026-01-15", branchId: "b1" },
    { id: "x3", type: "cash_in", account: "Bank", amount: 400, category: "Fee Collection", date: "2026-02-20", branchId: "b1" },
    // posted then reversed: both must drop out
    { id: "x4", type: "cash_in", account: "Cash", amount: 999, category: "Fee Collection", date: "2026-02-21", reversed: true },
    { id: "x5", type: "cash_out", account: "Cash", amount: 999, category: "Fee Collection (reversal)", date: "2026-02-22", reversalOf: "x4" },
  ],
};
const data = prepareData(raw);
const FEB = { from: d(2026, 2, 1), to: new Date(2026, 1, 28, 23, 59, 59, 999) };
const JAN_FEB = { from: d(2026, 1, 1), to: new Date(2026, 1, 28, 23, 59, 59, 999) };
const ALL = { from: null, to: null };

describe("dates and ranges", () => {
  test("parseDay reads YYYY-MM-DD as a local date", () => {
    const x = parseDay("2026-03-05");
    expect([x.getFullYear(), x.getMonth(), x.getDate()]).toEqual([2026, 2, 5]);
    expect(parseDay("")).toBeNull();
  });

  test("presets", () => {
    const m = presetRange("thisMonth", TODAY);
    expect(m.from).toEqual(d(2026, 3, 1));
    expect(m.to.getDate()).toBe(31);
    expect(presetRange("lastMonth", TODAY).to.getMonth()).toBe(1);
    expect(presetRange("thisQuarter", TODAY).from).toEqual(d(2026, 1, 1));
    // year to date is Jan 1 to today, not the whole calendar year
    const ytd = presetRange("ytd", TODAY);
    expect(ytd.from).toEqual(d(2026, 1, 1));
    expect([ytd.to.getMonth(), ytd.to.getDate()]).toEqual([2, 15]);
    expect(presetRange("lastQuarter", TODAY).from).toEqual(d(2025, 10, 1));
    // March is before July, so the FY started last July
    expect(presetRange("thisFY", TODAY).from).toEqual(d(2025, 7, 1));
    expect(presetRange("lastFY", TODAY).from).toEqual(d(2024, 7, 1));
    expect(presetRange("all", TODAY)).toEqual(ALL);
  });

  test("previousRange keeps whole months whole and shifts others by length", () => {
    const prevMar = previousRange(presetRange("thisMonth", TODAY));
    expect(prevMar.from).toEqual(d(2026, 2, 1));
    expect(prevMar.to.getDate()).toBe(28);
    const prevQ = previousRange(presetRange("thisQuarter", TODAY));
    expect(prevQ.from).toEqual(d(2025, 10, 1));
    expect(prevQ.to.getMonth()).toBe(11);
    const prev30 = previousRange(presetRange("last30", TODAY));
    expect(prev30.to.getDate()).toBe(13); // last 30 days start on 14 Feb
    expect(Math.round((prev30.to - prev30.from) / 864e5)).toBe(30);
    expect(previousRange(ALL)).toBeNull();
  });

  test("inRange and customRange", () => {
    const r = customRange("2026-01-10", "2026-01-20");
    expect(inRange(d(2026, 1, 20), r)).toBe(true);
    expect(inRange(d(2026, 1, 21), r)).toBe(false);
    expect(inRange(null, r)).toBe(false);
    expect(inRange(null, ALL)).toBe(true);
  });

  test("granularity: auto scales with the span, explicit choice is capped", () => {
    expect(resolveGranularity(presetRange("thisMonth", TODAY))).toBe("day");
    expect(resolveGranularity(presetRange("thisQuarter", TODAY))).toBe("week");
    expect(resolveGranularity(presetRange("thisYear", TODAY))).toBe("month");
    expect(resolveGranularity(presetRange("thisYear", TODAY), "quarter")).toBe("quarter");
    // daily over 6 years would be unreadable
    expect(resolveGranularity({ from: d(2020, 1, 1), to: d(2026, 1, 1) }, "day")).not.toBe("day");
  });

  test("resolveRange closes an open range using the data", () => {
    const r = resolveRange(ALL, [d(2025, 6, 1), d(2025, 7, 1)], TODAY);
    expect(r.from).toEqual(d(2025, 6, 1));
    expect(r.to >= TODAY).toBe(true);
  });
});

describe("shared invoice totals (one definition, utils/reporting.js)", () => {
  // DEFINITION CHANGE (audit ACC-04): this test used to expect that a paid
  // invoice with no recorded paidAmount counted as collected in full, less
  // concession (900 + 500). Collected is now cash recorded; those invoices
  // are reported as `unverified` and are neither collected nor pending.
  test("a paid invoice with no recorded paidAmount is NOT collected; it is unverified", () => {
    const legacy = prepareData({ invoices: [
      { id: "L1", studentId: "s1", status: "paid", amount: 1000, concessionAmount: 100, month: "March", year: 2026, paidDate: "2026-03-02" },
      { id: "L2", studentId: "s1", status: "paid", amount: 500, month: "March", year: 2026, paidDate: "2026-03-03" },
    ] });
    const f = computeFinancials(legacy, { range: ALL, branch: "all" });
    expect(f.collected).toBe(0);
    expect(f.pending).toBe(0);
    expect(f.unverified).toBe(900 + 500);
    expect(f.unverifiedCount).toBe(2);
    expect(legacy.invoices[0]._outstanding).toBe(0);
    expect(legacy.invoices[0]._unverified).toBe(900);
  });

  // The ACC-04 fixture from reporting.test.js / docs/audit/accounting-auditor.md.
  const acc04 = [
    { id: "A", amount: 5000, status: "paid", paidAmount: 5000, studentId: "s1", paidDate: "2026-10-01" },
    { id: "B", amount: 5000, status: "paid", paidAmount: 3000, concessionAmount: 2000, studentId: "s2", paidDate: "2026-10-02" },
    { id: "C", amount: 4000, status: "paid", studentId: "s2", paidDate: "2026-10-03" },
    { id: "D", amount: 6000, status: "partial", paidAmount: 2500, studentId: "s3", paidDate: "2026-10-04", dueDate: "2026-08-15" },
    { id: "E", amount: 3000, status: "paid", studentId: "s4", paidDate: "2026-10-05" },
  ];

  test("Reports and reporting.js agree on the ACC-04 fixture (10,500 / 3,500, not 17,000 / 0)", () => {
    const f = computeFinancials(prepareData({ invoices: acc04 }), { range: ALL, branch: "all" });
    const r = summarizeInvoices(acc04, { today: "2026-10-10" });
    expect(f.collected).toBe(10500);
    expect(f.pending).toBe(3500);
    expect(f.concessions).toBe(2000);
    expect(f.unverified).toBe(7000);
    expect(f).toMatchObject({ collected: r.collected, pending: r.outstanding, concessions: r.concessions, unverified: r.unverified });
    // Fee tab: same cohort numbers and the same rate as the Dashboard (50%)
    const s = summarizeFees(prepareData({ invoices: acc04 }).invoices, { range: ALL, today: new Date(2026, 9, 10) });
    expect(s.collected).toBe(10500);
    expect(s.outstanding).toBe(3500);
    expect(Math.round(s.rate * 100)).toBe(r.collectionRate);
  });

  test("a bounded range reports collected the same way reporting.js does", () => {
    const range = { from: d(2026, 10, 2), to: new Date(2026, 9, 4, 23, 59, 59, 999) };
    const f = computeFinancials(prepareData({ invoices: acc04 }), { range, branch: "all" });
    const r = summarizeInvoices(acc04, { today: "2026-10-10", range: { from: "2026-10-02", to: "2026-10-04" } });
    expect(f.collected).toBe(r.collected);
    expect(f.concessions).toBe(r.concessions);
    expect(f.unverified).toBe(r.unverified);
    expect(f.pending).toBe(r.outstanding); // a balance as of today, not cut by the period
  });

  test("payroll is cash basis like reporting.js: only paid payslips, by paid date", () => {
    const slips = [
      { id: "p1", netPay: 600, status: "paid", paidDate: "2026-02-03", month: "January", year: 2026 },
      { id: "p2", netPay: 900, status: "pending", month: "February", year: 2026 },
    ];
    const f = computeFinancials(prepareData({ payslips: slips }), { range: FEB, branch: "all" });
    const r = profitAndLoss({ payslips: slips }, { range: { from: "2026-02-01", to: "2026-02-28" } });
    expect(f.payroll).toBe(600);
    expect(f.payroll).toBe(r.salaries);
    expect(f.payrollUnpaid).toBe(900); // memo only, not an expense
    expect(f.totalExpenses).toBe(600);
  });
});

describe("invoice helpers", () => {
  test("effectiveStatus derives overdue from the due date", () => {
    const inv = (o) => ({ amount: 100, paidAmount: 0, ...o });
    expect(effectiveStatus(inv({ status: "paid" }), TODAY)).toBe("paid");
    expect(effectiveStatus(inv({ status: "pending", dueDate: "2026-03-01" }), TODAY)).toBe("overdue");
    expect(effectiveStatus(inv({ status: "partial", paidAmount: 10, dueDate: "2026-03-01" }), TODAY)).toBe("overdue");
    expect(effectiveStatus(inv({ status: "partial", paidAmount: 10, dueDate: "2026-04-01" }), TODAY)).toBe("partial");
    expect(effectiveStatus(inv({ status: "pending" }), TODAY)).toBe("pending");
  });

  test("allocateByHead splits proportionally and falls back to Fees", () => {
    const parts = allocateByHead(raw.invoices[0], 500);
    expect(parts).toEqual([{ head: "Tuition Fee", amount: 400 }, { head: "Transport", amount: 100 }]);
    expect(allocateByHead({}, 50)).toEqual([{ head: "Fees", amount: 50 }]);
  });
});

describe("computeFinancials", () => {
  test("all time, all branches", () => {
    const f = computeFinancials(data, { range: ALL, branch: "all" });
    expect(f.billed).toBe(2500);
    expect(f.collected).toBe(1400);
    expect(f.concessions).toBe(100);
    expect(f.pending).toBe(500 + 500); // i2: 1000-400-100 = 500, i3: 500
    expect(f.opex).toBe(600);
    // DEFINITION CHANGE (audit ACC-05): payroll used to include the unpaid
    // February payslip (1200, net 1400 - 600 - 1200). It is now cash basis,
    // like fees: only paid payslips are an expense; unpaid is a memo.
    expect(f.payroll).toBe(600);
    expect(f.payrollUnpaid).toBe(600);
    expect(f.net).toBe(1400 - 600 - 600);
  });

  test("date range limits every line", () => {
    const f = computeFinancials(data, { range: FEB, branch: "all" });
    expect(f.billed).toBe(1000);
    expect(f.collected).toBe(400);
    expect(f.opex).toBe(300);
    expect(f.payroll).toBe(0); // Feb payslip is unpaid
    expect(f.payrollUnpaid).toBe(600);
    expect(f.byCategory.map(c => c.label)).toEqual(["Utilities", "Repairs"]);
  });

  test("branch filter, including the main office (no branchId)", () => {
    expect(computeFinancials(data, { range: ALL, branch: "b1" }).collected).toBe(1400);
    const main = computeFinancials(data, { range: ALL, branch: "main" });
    expect(main.billed).toBe(500);
    expect(main.opex).toBe(200);
  });

  test("income is split per fee type by collected amount", () => {
    const f = computeFinancials(data, { range: ALL, branch: "all" });
    const byLabel = Object.fromEntries(f.byHead.map(h => [h.label, h.amount]));
    expect(byLabel["Tuition Fee"]).toBe(800);
    expect(byLabel.Transport).toBe(200);
    expect(byLabel.Fees).toBe(400);
  });

  test("series puts amounts in the right bucket and covers empty periods", () => {
    const { granularity, buckets } = buildSeries(data, { range: { from: d(2026, 1, 1), to: d(2026, 3, 31) }, branch: "all", granularity: "month" });
    expect(granularity).toBe("month");
    expect(buckets.map(b => b.income)).toEqual([1000, 400, 0]);
    expect(buckets.map(b => b.expenses)).toEqual([300, 300, 0]);
    expect(buckets.map(b => b.payroll)).toEqual([600, 0, 0]); // unpaid Feb payslip is not cash out
    expect(buckets[1].net).toBe(400 - 300);
  });

  test("branch breakdown lists the main office plus each branch", () => {
    const rows = branchBreakdown(data, [{ id: "b1", name: "North" }], { range: ALL });
    expect(rows.map(r => r.name)).toEqual(["Main Office", "North"]);
    expect(rows[1].income).toBe(1400);
    expect(rows[0].students).toBe(1);
  });

  test("change handles a zero base", () => {
    expect(change(150, 100)).toEqual({ amount: 50, pct: 0.5 });
    expect(change(5, 0)).toEqual({ amount: 5, pct: null });
    expect(change(5, null)).toBeNull();
  });
});

describe("computeCashFlow", () => {
  test("opening balance, reversals dropped, per-account closing", () => {
    const cf = computeCashFlow(data, { range: JAN_FEB, branch: "all" });
    expect(cf.opening).toBe(5000);
    expect(cf.inflow).toBe(1400);
    expect(cf.outflow).toBe(300);
    expect(cf.closing).toBe(6100);
    expect(cf.perAccount.find(a => a.name === "Cash").closing).toBe(5700);
    expect(cf.inByCategory[0].label).toBe("Fee Collection");
  });

  test("a later range carries earlier postings into the opening balance", () => {
    const cf = computeCashFlow(data, { range: FEB, branch: "all" });
    expect(cf.opening).toBe(5000 + 1000 - 300);
    expect(cf.inflow).toBe(400);
    expect(cf.buckets[cf.buckets.length - 1].balance).toBe(cf.closing);
  });

  test("account filter, and account opening balances are skipped for one branch", () => {
    expect(computeCashFlow(data, { range: JAN_FEB, account: "a2" }).inflow).toBe(400);
    const b1 = computeCashFlow(data, { range: JAN_FEB, branch: "b1" });
    expect(b1.opening).toBe(0);
    expect(b1.openingExcluded).toBe(true);
  });
});

describe("computeBalanceSheet", () => {
  test("asset accounts are live balances as at a date; liabilities are stored", () => {
    const jan31 = new Date(2026, 0, 31, 23, 59, 59);
    const bs = computeBalanceSheet(data, { asAt: jan31 });
    expect(bs.assets.rows.find(r => r.name === "Cash").balance).toBe(5000 + 1000 - 300);
    expect(bs.assets.rows.find(r => r.name === "Bank").balance).toBe(0);
    expect(bs.liabilitiesEquity.total).toBe(700);
    expect(computeBalanceSheet(data, { asAt: null }).assets.total).toBe(5000 + 700 + 400);
  });
});

describe("summarizeFees", () => {
  const rows = filterFeeRows(data.invoices, { branch: "all", today: TODAY });

  test("cohort totals, rate and status mix", () => {
    const s = summarizeFees(rows, { range: ALL, today: TODAY });
    expect(s.billed).toBe(2500);
    expect(s.collected).toBe(1400);
    expect(s.outstanding).toBe(1000);
    expect(s.overdue).toBe(500); // i2 only; i3 is not due yet
    expect(s.rate).toBeCloseTo(1400 / 2400);
    expect(s.statusCounts).toEqual({ paid: 1, partial: 0, pending: 1, overdue: 1 });
  });

  test("aging buckets and defaulters", () => {
    const s = summarizeFees(rows, { range: ALL, today: TODAY });
    expect(s.aging.find(a => a.label === "Not yet due").amount).toBe(500);
    expect(s.aging.find(a => a.label === "31–60 days").amount).toBe(500);
    expect(s.defaulters.map(x => x.student)).toEqual(["Ali", "Sara"]);
    expect(s.defaulters[0].outstanding).toBe(500);
  });

  test("received-in-period uses the paid date, not the billing period", () => {
    const s = summarizeFees(rows, { range: { from: d(2026, 2, 1), to: new Date(2026, 1, 28, 23, 59) }, today: TODAY });
    expect(s.receivedInPeriod).toBe(400);
    expect(s.billed).toBe(1000);
  });

  test("grade, status, account and search filters", () => {
    expect(filterFeeRows(data.invoices, { grade: "Grade 6", today: TODAY }).map(i => i.id)).toEqual(["i3"]);
    expect(filterFeeRows(data.invoices, { status: "overdue", today: TODAY }).map(i => i.id)).toEqual(["i2"]);
    expect(filterFeeRows(data.invoices, { account: "Cash", today: TODAY }).map(i => i.id)).toEqual(["i1"]);
    expect(filterFeeRows(data.invoices, { search: "zmi-2", today: TODAY }).map(i => i.id)).toEqual(["i3"]);
    expect(filterFeeRows(data.invoices, { branch: "main", today: TODAY }).map(i => i.id)).toEqual(["i3"]);
  });

  test("by grade", () => {
    const s = summarizeFees(rows, { range: ALL, today: TODAY });
    expect(s.byGrade[0]).toMatchObject({ grade: "Grade 5", billed: 2000, collected: 1400, outstanding: 500, students: 1 });
  });
});

test("highlights mention growth, top expense and overdue fees", () => {
  const cur = computeFinancials(data, { range: FEB, branch: "all" });
  const prev = computeFinancials(data, { range: { from: d(2026, 1, 1), to: new Date(2026, 0, 31, 23, 59) }, branch: "all" });
  const fees = summarizeFees(filterFeeRows(data.invoices, { today: TODAY }), { range: ALL, today: TODAY });
  const text = buildHighlights({ cur, prev, fees, branches: [] }).map(h => h.text).join("\n");
  expect(text).toMatch(/Income is down 60%/);
  expect(text).toMatch(/Biggest operating expense: Utilities/);
  expect(text).toMatch(/overdue/);
});

describe("account matching by id (survives renames)", () => {
  const renamed = prepareData({
    accounts: [{ id: "a1", code: "1000", name: "Petty cash (renamed)", type: "Assets", subType: "Bank & Cash", balance: 100 }],
    payments: [
      { id: "n1", type: "cash_in", account: "Cash", accountId: "a1", amount: 50, date: "2026-01-05" },   // posted under the old name
      { id: "n2", type: "cash_in", account: "Petty cash (renamed)", amount: 25, date: "2026-01-06" },     // legacy row, name only
      { id: "n3", type: "cash_in", account: "Gone", accountId: "zzz", amount: 10, date: "2026-01-07" },   // account no longer exists
    ],
  });
  test("cash flow groups by account id and keeps unlinked postings visible", () => {
    const cf = computeCashFlow(renamed, { range: JAN_FEB });
    const main = cf.perAccount.find(a => a.key === "a1");
    expect(main.name).toBe("Petty cash (renamed)");
    expect(main.inflow).toBe(75);
    expect(main.closing).toBe(175);
    expect(cf.perAccount.find(a => a.name === "Gone").inflow).toBe(10);
    expect(cf.accountOptions.map(o => o.label)).toEqual(["Gone", "Petty cash (renamed)"]);
    expect(computeCashFlow(renamed, { range: JAN_FEB, account: "a1" }).inflow).toBe(75);
  });
  test("balance sheet uses the same matching", () => {
    expect(computeBalanceSheet(renamed, { asAt: null }).assets.rows[0].balance).toBe(175);
  });
});

describe("accrual basis", () => {
  test("income is billed less concessions by invoice month, regardless of payment", () => {
    const f = computeFinancials(data, { range: ALL, branch: "all", basis: "accrual" });
    expect(f.income).toBe(2500 - 100);
    expect(f.concessions).toBe(100);
    expect(f.collected).toBe(1400); // cash still reported for reference
    // DEFINITION CHANGE vs main (audited, ACC-05): payroll is cash basis on BOTH
    // bases (only paid payslips, 600). Main's test expected the unpaid February
    // payslip (1200 total) to be accrued here; it is the `payrollUnpaid` memo instead.
    expect(f.payroll).toBe(600);
    expect(f.payrollUnpaid).toBe(600);
    expect(f.net).toBe(2400 - 600 - 600);
  });
  test("period limits follow the billing month, not the paid date", () => {
    const f = computeFinancials(data, { range: FEB, branch: "all", basis: "accrual" });
    expect(f.income).toBe(1000 - 100);
    expect(f.byHead.reduce((s, h) => s + h.amount, 0)).toBe(900);
  });
  test("series income and branch rows follow the basis", () => {
    const { buckets } = buildSeries(data, { range: { from: d(2026, 1, 1), to: d(2026, 3, 31) }, branch: "all", granularity: "month", basis: "accrual" });
    expect(buckets.map(b => b.income)).toEqual([1000, 900, 500]);
    const rows = branchBreakdown(data, [{ id: "b1", name: "North" }], { range: ALL, basis: "accrual" });
    expect(rows[1].income).toBe(1900);
    expect(rows[1].collectionRate).toBeCloseTo(1400 / 1900);
  });
});

describe("comparison ranges", () => {
  test("same period last year, aligned to month ends", () => {
    const y = yearAgoRange({ from: d(2025, 2, 1), to: new Date(2025, 1, 28, 23, 59, 59, 999) });
    expect(y.from).toEqual(d(2024, 2, 1));
    expect(y.to.getDate()).toBe(29); // Feb 2024 has 29 days
    const mid = yearAgoRange({ from: d(2026, 3, 10), to: new Date(2026, 3, 20, 23, 59, 59, 999) });
    expect([mid.from.getFullYear(), mid.from.getMonth(), mid.from.getDate()]).toEqual([2025, 2, 10]);
    expect(yearAgoRange(ALL)).toBeNull();
  });
  test("comparisonRange picks by mode", () => {
    const r = presetRange("thisYear", TODAY);
    expect(comparisonRange(r, "none")).toBeNull();
    expect(comparisonRange(r, "yoy").from).toEqual(d(2025, 1, 1));
    expect(comparisonRange(r, "prev").from).toEqual(d(2025, 1, 1)); // whole year steps back a year
    const q = presetRange("thisQuarter", TODAY);
    expect(comparisonRange(q, "prev").from).toEqual(d(2025, 10, 1));
    expect(comparisonRange(q, "yoy").from).toEqual(d(2025, 1, 1));
  });
  test("highlights name the comparison", () => {
    const cur = computeFinancials(data, { range: FEB, branch: "all" });
    const prev = computeFinancials(data, { range: { from: d(2026, 1, 1), to: new Date(2026, 0, 31, 23, 59) }, branch: "all" });
    const text = buildHighlights({ cur, prev, fees: null, branches: [], vs: "the same period last year" }).map(h => h.text).join("\n");
    expect(text).toMatch(/on the same period last year/);
  });
});

describe("class view", () => {
  const rows = filterFeeRows(data.invoices, { branch: "all", today: TODAY });
  test("classDetail lists every student in the class, worst balance first", () => {
    const g5 = classDetail(rows, "Grade 5", { range: ALL, today: TODAY });
    expect(g5).toHaveLength(1);
    expect(g5[0]).toMatchObject({ student: "Ali", studentId: "s1", billed: 2000, collected: 1400, outstanding: 500, status: "overdue" });
    const g6 = classDetail(rows, "Grade 6", { range: ALL, today: TODAY });
    expect(g6[0]).toMatchObject({ student: "Sara", status: "pending", unpaid: 1 });
    expect(classDetail(rows, "Grade 9", { range: ALL, today: TODAY })).toEqual([]);
  });
  test("classDetail respects the billing period", () => {
    expect(classDetail(rows, "Grade 5", { range: FEB, today: TODAY })[0].billed).toBe(1000);
  });
  test("a settled class is marked paid", () => {
    const paid = filterFeeRows(data.invoices, { grade: "Grade 5", status: "paid", today: TODAY });
    expect(classDetail(paid, "Grade 5", { range: ALL, today: TODAY })[0].status).toBe("paid");
  });
  test("teachersForGrade reads Subjects, grouping subjects per teacher", () => {
    const subjects = [
      { name: "Maths", grade: "Grade 5", teacher: "Mr Khan", branchId: "b1" },
      { name: "Science", grade: "Grade 5", teacher: "Mr Khan", branchId: "b1" },
      { name: "Urdu", grade: "Grade 5", teacher: " Ms  Noor ", branchId: "" },
      { name: "Art", grade: "", teacher: "Everyone" },
      { name: "Maths", grade: "Grade 6", teacher: "Ms Ali" },
      { name: "PT", grade: "Grade 5", teacher: "" },
    ];
    expect(teachersForGrade(subjects, "Grade 5")).toEqual([
      { teacher: "Mr Khan", subjects: ["Maths", "Science"] },
      { teacher: "Ms Noor", subjects: ["Urdu"] },
    ]);
    expect(teachersForGrade(subjects, "Grade 5", "b1").map(t => t.teacher)).toEqual(["Mr Khan"]);
  });
});

test("buildSummaryText lays out title, scope, lines and highlights", () => {
  const t = buildSummaryText({ title: "P&L report", scope: "All · 2026", lines: [["Income", "Rs. 5"]], highlights: [{ text: "Up 5%." }] });
  expect(t).toBe("P&L report\nAll · 2026\n\nIncome: Rs. 5\n\nHighlights:\n- Up 5%.\n\nGenerated from ZMI School ERP");
});
