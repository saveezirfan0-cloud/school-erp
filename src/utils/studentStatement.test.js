import { buildStatement, buildStatements, statementsHtml } from "./studentStatement";

const student = { id: "s1", name: "Ali <b>Khan</b>", studentId: "ZMI-1", grade: "Grade 5", parentName: "Mr Khan", parentPhone: "0300" };
const invoices = [
  { id: "i2", studentId: "s1", amount: 1000, status: "partial", month: "February", year: 2026, dueDate: "2026-02-10", concessionAmount: 100, lineItems: [{ description: "Tuition Fee", amount: 1000 }] },
  { id: "i1", studentId: "s1", amount: 1000, status: "paid", month: "January", year: 2026, dueDate: "2026-01-10" },
  { id: "o1", studentId: "other", amount: 999, status: "pending", month: "January", year: 2026 },
];
const payments = [
  { id: "p1", sourceId: "i1", type: "cash_in", amount: 1000, account: "Cash", date: "2026-01-12" },
  { id: "p2", sourceId: "i2", type: "cash_in", amount: 400, account: "Bank", date: "2026-02-20" },
  { id: "p3", sourceId: "i2", type: "cash_in", amount: 999, account: "Cash", date: "2026-02-21", reversed: true },
  { id: "p4", sourceId: "i2", type: "cash_out", amount: 999, account: "Cash", date: "2026-02-22", reversalOf: "p3" },
  { id: "p5", sourceId: "o1", type: "cash_in", amount: 5, account: "Cash", date: "2026-01-01" },
];

test("buildStatement orders invoices by period and applies the shared money rules", () => {
  const st = buildStatement({ student, invoices: invoices.filter(i => i.studentId === "s1"), payments, today: "2026-06-01" });
  expect(st.rows.map(r => r.id)).toEqual(["i1", "i2"]);
  expect(st.billed).toBe(2000);
  expect(st.received).toBe(1400); // the reversed pair is ignored
  expect(st.concession).toBe(100);
  expect(st.balance).toBe(500);
  expect(st.payments.map(p => p.id)).toEqual(["p1", "p2"]); // live receipts only, in date order
  expect(st.rows[1].statusLabel).toBe("Partial");
});

test("buildStatements groups invoices per student", () => {
  const sts = buildStatements({ students: [student, { id: "s9", name: "No Invoices" }], invoices, payments, today: "2026-06-01" });
  expect(sts[0].balance).toBe(500);
  expect(sts[1]).toMatchObject({ billed: 0, balance: 0, rows: [] });
});

test("statementsHtml escapes names, shows the balance and paginates per student", () => {
  const sts = buildStatements({ students: [student, { id: "s9", name: "Zed" }], invoices, payments, today: "2026-06-01" });
  const html = statementsHtml(sts);
  expect(html).toContain("Ali &lt;b&gt;Khan&lt;/b&gt;");
  expect(html).not.toContain("<b>Khan</b>");
  expect(html).toContain("Balance due: Rs. 500");
  expect(html).toContain("No balance due");
  expect(html.match(/<section class="page">/g)).toHaveLength(2);
  expect(html).toContain("No invoices.");
});
