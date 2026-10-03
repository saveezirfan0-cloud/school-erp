import { escapeHtml, receiptPrefix, buildReceiptNumber, buildReceiptHtml, receiptFromPayment } from "./invoiceGenerator";

describe("escapeHtml", () => {
  test("escapes every HTML-significant character", () => {
    expect(escapeHtml(`<i>"a" & 'b' \`c\`</i>`)).toBe("&lt;i&gt;&quot;a&quot; &amp; &#39;b&#39; &#96;c&#96;&lt;/i&gt;");
  });
  test("null, undefined and numbers are safe", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
    expect(escapeHtml(5000)).toBe("5000");
  });
});

describe("receipt numbers", () => {
  test("prefix comes from the branch name, MAIN by default", () => {
    expect(receiptPrefix("")).toBe("MAIN");
    expect(receiptPrefix(undefined)).toBe("MAIN");
    expect(receiptPrefix("Lahore Campus")).toBe("LAHO");
    expect(receiptPrefix("A1")).toBe("A1");
    expect(receiptPrefix("<i>")).toBe("I");
    expect(receiptPrefix("---")).toBe("MAIN");
  });
  test("is deterministic: branch prefix, payment date, payment id", () => {
    const a = buildReceiptNumber({ branchName: "Main Office", date: "2026-10-03", id: "3f9a1c7b-aaaa-bbbb-cccc-1234567890ab" });
    expect(a).toBe("MAIN-20261003-3F9A1C7B");
    expect(buildReceiptNumber({ branchName: "Main Office", date: "2026-10-03", id: "3f9a1c7b-aaaa-bbbb-cccc-1234567890ab" })).toBe(a);
  });
  test("different payments never share a number", () => {
    const x = buildReceiptNumber({ date: "2026-10-03", id: "11111111-0000" });
    const y = buildReceiptNumber({ date: "2026-10-03", id: "22222222-0000" });
    expect(x).not.toBe(y);
  });
  test("only safe characters can appear in a number", () => {
    expect(buildReceiptNumber({ branchName: "x<y>", date: "2026-01-02", id: "ab\"cd-ef&gh" })).toMatch(/^[A-Z0-9]+-\d{8}-[A-Z0-9]+$/);
  });
  test("rejects a bad date or missing id", () => {
    expect(() => buildReceiptNumber({ date: "03/10/2026", id: "abcdef12" })).toThrow();
    expect(() => buildReceiptNumber({ date: "2026-10-03", id: "" })).toThrow();
    expect(() => buildReceiptNumber({ date: "2026-10-03", id: "a-b" })).toThrow();
  });
});

describe("buildReceiptHtml", () => {
  const base = {
    receiptNo: "MAIN-20261003-3F9A1C7B", date: "2026-10-03", studentName: "Ali Khan", amount: 5000,
    period: "October 2026", account: "Cash in Hand", institute: "Test School",
  };
  test("renders the key facts", () => {
    const html = buildReceiptHtml({ ...base, studentId: "STU-1", invoiceTotal: 8000, paidToDate: 5000, balance: 3000, printedOn: "2026-10-04" });
    expect(html.startsWith("<!doctype html>")).toBe(true);
    for (const text of ["MAIN-20261003-3F9A1C7B", "Ali Khan", "Rs. 5,000", "October 2026", "Cash in Hand", "Rs. 8,000", "Rs. 3,000", "Test School", "STU-1"]) {
      expect(html).toContain(text);
    }
  });
  test("every dynamic field is escaped", () => {
    const evil = `<i>x</i>"'&`;
    const html = buildReceiptHtml({
      ...base, receiptNo: evil, studentName: evil, studentId: evil, branchName: evil,
      period: evil, description: evil, account: evil, institute: evil, printedOn: evil,
      invoiceTotal: 1, paidToDate: 1, balance: 0,
    });
    expect(html).not.toContain("<i>");
    expect(html).not.toContain("</i>");
    expect(html).toContain("&lt;i&gt;x&lt;/i&gt;&quot;&#39;&amp;");
  });
  test("non-numeric amounts cannot inject markup either", () => {
    const html = buildReceiptHtml({ ...base, amount: "<b>1</b>" });
    expect(html).not.toContain("<b>1</b>");
  });
  test("carries a CSP that allows no scripts and contains no script tag", () => {
    const html = buildReceiptHtml(base);
    expect(html).toMatch(/Content-Security-Policy[^>]*default-src 'none'/);
    expect(html.toLowerCase()).not.toContain("<script");
  });
  test("invoice block is omitted when the invoice could not be read", () => {
    const html = buildReceiptHtml(base);
    expect(html).not.toContain("Invoice total");
  });
});

describe("receiptFromPayment", () => {
  const payment = { id: "abcdef1234", date: "2026-10-03", amount: 3000, account: "Cash in Hand", branchId: "b1", description: "Fee — Ali Khan (October)" };
  test("uses the invoice when available", () => {
    const r = receiptFromPayment({
      payment, branches: [{ id: "b1", name: "Lahore Campus" }],
      invoice: { studentName: "Ali Khan", month: "October", year: 2026, amount: 5000, paidAmount: 3000, concessionAmount: 500 },
      printedOn: "2026-10-04",
    });
    expect(r).toMatchObject({
      receiptNo: "LAHO-20261003-ABCDEF12", studentName: "Ali Khan", period: "October 2026",
      invoiceTotal: 5000, paidToDate: 3000, balance: 1500, branchName: "Lahore Campus",
    });
  });
  test("falls back to the payment description when the invoice is unreadable", () => {
    const r = receiptFromPayment({ payment, branches: [] });
    expect(r.studentName).toBe("Ali Khan");
    expect(r.receiptNo).toMatch(/^MAIN-20261003-/);
    expect(r.invoiceTotal).toBeUndefined();
  });
  test("balance never goes negative and uses exact arithmetic", () => {
    const r = receiptFromPayment({ payment, invoice: { amount: 300.3, paidAmount: 100.1, concessionAmount: 200.2 } });
    expect(r.balance).toBe(0);
  });
});
