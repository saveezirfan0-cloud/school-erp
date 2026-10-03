import {
  normalizeHeader, cleanText, parseCsv, matrixToTable, buildMapping, applyMapping, parseDateCell,
  parseMonthYear, parseInvoiceStatus, parseDirection, validateImport, missingRequired, describeTotals,
  checkUploadMeta, zipUncompressedSize, IMPORT_TYPES, MAX_ROWS, MAX_FILE_BYTES,
} from "./importParsing";

const mapRows = (type, headers, rowsOfArrays) => {
  const table = matrixToTable([headers, ...rowsOfArrays]);
  const m = buildMapping(table.headers, IMPORT_TYPES[type].columnMap);
  return { mapping: m, mapped: applyMapping(table.rows, m.fieldToHeader) };
};

describe("normalizeHeader", () => {
  test("is case, spacing, BOM and punctuation insensitive", () => {
    expect(normalizeHeader("﻿  Student_ID ")).toBe("student id");
    expect(normalizeHeader("Dr/Cr")).toBe("dr cr");
    expect(normalizeHeader("Monthly   Fee")).toBe("monthly fee");
    expect(normalizeHeader("Amount (Rs.)")).toBe("amount rs");
    expect(normalizeHeader(null)).toBe("");
  });
});

describe("buildMapping: exact matches, no substring guessing (CODE-28)", () => {
  test('a "Paid" column does not become the student id', () => {
    const { fieldToHeader } = buildMapping(["Name", "Paid", "Valid", "Provider ID"], IMPORT_TYPES.students.columnMap);
    expect(fieldToHeader.name).toBe("Name");
    expect(fieldToHeader.studentId).toBeUndefined();
  });
  test('"Customer Name" is a listed alias, but "Contact Phone" is not mistaken for the name or the phone', () => {
    const { fieldToHeader } = buildMapping(["Customer Name", "Contact Phone"], IMPORT_TYPES.students.columnMap);
    expect(fieldToHeader.name).toBe("Customer Name");
    expect(fieldToHeader.parentPhone).toBeUndefined();
  });
  test("one source column is used for at most one field", () => {
    const { fieldToHeader } = buildMapping(["Description", "Amount", "Date", "Account"], IMPORT_TYPES.payments.columnMap);
    expect(fieldToHeader.description).toBe("Description");
    expect(fieldToHeader.account).toBe("Account");
    expect(Object.values(fieldToHeader).filter((h) => h === "Account")).toHaveLength(1);
    expect(fieldToHeader.category).toBeUndefined();
  });
  test("monthly fee never reads the Balance column", () => {
    const { fieldToHeader } = buildMapping(["Name", "Monthly Fee", "Balance"], IMPORT_TYPES.students.columnMap);
    expect(fieldToHeader.monthlyFee).toBe("Monthly Fee");
    const { fieldToHeader: only } = buildMapping(["Name", "Balance"], IMPORT_TYPES.students.columnMap);
    expect(only.monthlyFee).toBeUndefined();
  });
  test("case and spacing variants map; unmapped fields are reported", () => {
    const r = buildMapping(["  STUDENT NAME", "amount", "MONTH"], IMPORT_TYPES.invoices.columnMap);
    expect(r.fieldToHeader).toMatchObject({ studentName: "  STUDENT NAME", amount: "amount", month: "MONTH" });
    expect(r.unmappedFields).toContain("status");
  });
  test("missingRequired names what is absent", () => {
    expect(missingRequired("invoices", { amount: "A", month: "M" })).toEqual([expect.stringMatching(/one of/)]);
    expect(missingRequired("invoices", { amount: "A", month: "M", studentName: "S" })).toEqual([]);
    expect(missingRequired("payments", { date: "D", account: "A" })).toEqual([expect.stringMatching(/amount/)]);
    expect(missingRequired("payments", { date: "D", account: "A", credit: "C" })).toEqual([]);
  });
});

describe("csv and tables", () => {
  test("quotes, embedded commas / newlines, BOM, semicolons", () => {
    expect(parseCsv('﻿Name,Note\n"Khan, A","say ""hi""\nthere"\n')).toEqual([["Name", "Note"], ["Khan, A", 'say "hi"\nthere']]);
    expect(parseCsv("a;b\n1;2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([["a", "b"], ["1", "2"]]);
  });
  test("blank rows dropped, row numbers kept, duplicate headers suffixed", () => {
    const t = matrixToTable([["A", "A"], ["1", "2"], ["", ""], ["3", "4"]]);
    expect(t.headers).toEqual(["A", "A (2)"]);
    expect(t.rows.map((r) => r.rowNumber)).toEqual([2, 4]);
  });
  test("row limit is enforced", () => {
    const big = [["A"], ...Array.from({ length: MAX_ROWS + 1 }, (_, i) => [String(i)])];
    expect(() => matrixToTable(big)).toThrow(/Too many rows/);
  });
});

describe("value parsers", () => {
  test("dates", () => {
    expect(parseDateCell("2026-03-01")).toBe("2026-03-01");
    expect(parseDateCell("2026/3/1")).toBe("2026-03-01");
    expect(parseDateCell("01/03/2026")).toBe("2026-03-01");
    expect(parseDateCell(new Date(Date.UTC(2026, 2, 1)))).toBe("2026-03-01");
    expect(parseDateCell(46082)).toBe("2026-03-01"); // Excel serial
    expect(parseDateCell("2026-02-30")).toBeNull();
    expect(parseDateCell("soon")).toBeNull();
    expect(parseDateCell(12)).toBeNull();
    expect(parseDateCell("")).toBeNull();
  });
  test("month and year", () => {
    expect(parseMonthYear("March 2026")).toEqual({ month: "March", year: 2026 });
    expect(parseMonthYear("Mar-2026 fee")).toEqual({ month: "March", year: 2026 });
    expect(parseMonthYear("2026-03")).toEqual({ month: "March", year: 2026 });
    expect(parseMonthYear("03/2026")).toEqual({ month: "March", year: 2026 });
    expect(parseMonthYear(new Date(Date.UTC(2026, 9, 1)))).toEqual({ month: "October", year: 2026 });
    expect(parseMonthYear("tuition")).toEqual({ month: null, year: null });
    expect(parseMonthYear("Marketing")).toEqual({ month: null, year: null });
  });
  test('"Unpaid" is never read as paid (ACC-10)', () => {
    for (const t of ["Unpaid", "Not paid", "NOT  PAID", "Pending", "Outstanding", "Overdue"]) {
      expect(parseInvoiceStatus(t)).toMatchObject({ ok: true, status: "pending" });
    }
    for (const t of ["Paid", "paid in full", "Settled"]) expect(parseInvoiceStatus(t)).toMatchObject({ ok: true, status: "paid" });
    for (const t of ["Partially paid", "Partial"]) expect(parseInvoiceStatus(t)).toMatchObject({ ok: true, status: "partial" });
    expect(parseInvoiceStatus("")).toMatchObject({ ok: true, status: "pending", explicit: false });
    expect(parseInvoiceStatus("whatever").ok).toBe(false);
    expect(parseInvoiceStatus("Unpaid balance forwarded").ok).toBe(false);
  });
  test("direction honours Dr/Cr and whole words only", () => {
    expect(parseDirection("Dr")).toBe("cash_out");
    expect(parseDirection("DEBIT")).toBe("cash_out");
    expect(parseDirection("Withdrawal")).toBe("cash_out");
    expect(parseDirection("Cr")).toBe("cash_in");
    expect(parseDirection("Credit")).toBe("cash_in");
    expect(parseDirection("Deposit")).toBe("cash_in");
    expect(parseDirection("Outstanding")).toBeNull();
    expect(parseDirection("Without")).toBeNull();
    expect(parseDirection("")).toBeNull();
  });
  test("cleanText defuses formulas, strips control characters, caps length", () => {
    expect(cleanText("=1+1")).toBe("'=1+1");
    expect(cleanText("@name")).toBe("'@name");
    expect(cleanText("-abc")).toBe("'-abc");
    expect(cleanText("-5")).toBe("-5");
    expect(cleanText("a\u0000b\nc")).toBe("a b c");
    expect(cleanText("x".repeat(600)).length).toBe(500);
    expect(cleanText(null)).toBe("");
  });
});

describe("invoices import (ACC-10, CODE-31)", () => {
  const students = [
    { id: "s1", name: "Ahmad Khan", studentId: "STU-1", parentPhone: "0300", branchId: "b1" },
    { id: "s2", name: "Sara Ali", studentId: "STU-2" },
    { id: "s3", name: "Twin", studentId: "T-1" },
    { id: "s4", name: "Twin", studentId: "T-2" },
  ];
  const run = (headers, rows, existing = []) => {
    const { mapped } = mapRows("invoices", headers, rows);
    return validateImport("invoices", mapped, { students, existing });
  };

  test("Unpaid stays pending, resolves the student id, parses month and money", () => {
    const { rows } = run(["Student", "Amount", "Month", "Status"], [["Ahmad Khan", "Rs. 5,000", "March 2026", "Unpaid"]]);
    expect(rows[0].status).toBe("ok");
    expect(rows[0].record).toMatchObject({ studentId: "s1", amount: 5000, month: "March", year: 2026, status: "pending", paidAmount: 0, branchId: "b1" });
  });
  test("a Paid row needs a paid date and becomes a cash row", () => {
    const bad = run(["Student", "Amount", "Month", "Status"], [["Ahmad Khan", "5000", "March 2026", "Paid"]]);
    expect(bad.rows[0].status).toBe("error");
    expect(bad.rows[0].message).toMatch(/Paid Date/);
    const good = run(["Student", "Amount", "Month", "Status", "Paid Date"], [["Ahmad Khan", "5000", "March 2026", "Paid", "2026-03-05"]]);
    expect(good.rows[0].record).toMatchObject({ status: "paid", paidAmount: 5000, paidDate: "2026-03-05" });
    expect(good.summary.totals).toMatchObject({ amount: 5000, cashRows: 1, cashAmount: 5000 });
  });
  test("partial rows need a paid amount below the invoice amount", () => {
    const h = ["Student", "Amount", "Month", "Status", "Paid Amount", "Paid Date"];
    expect(run(h, [["Ahmad Khan", "5000", "March 2026", "Partial", "", "2026-03-05"]]).rows[0].status).toBe("error");
    expect(run(h, [["Ahmad Khan", "5000", "March 2026", "Partial", "5000", "2026-03-05"]]).rows[0].status).toBe("error");
    expect(run(h, [["Ahmad Khan", "5000", "March 2026", "Partial", "2000", "2026-03-05"]]).rows[0].record).toMatchObject({ status: "partial", paidAmount: 2000 });
  });
  test("unknown statuses, unknown students and ambiguous names are errors, never guesses", () => {
    const r = run(["Student", "Amount", "Month", "Status"], [
      ["Ahmad Khan", "5000", "March 2026", "Maybe"],
      ["Nobody", "5000", "March 2026", "Unpaid"],
      ["Twin", "5000", "March 2026", "Unpaid"],
    ]).rows;
    expect(r.map((x) => x.status)).toEqual(["error", "error", "error"]);
    expect(r[0].message).toMatch(/Unrecognised status/);
    expect(r[1].message).toMatch(/No student named/);
    expect(r[2].message).toMatch(/Student ID column/);
  });
  test("Student ID column disambiguates", () => {
    const r = run(["Student", "Student ID", "Amount", "Month"], [["Twin", "T-2", "100", "May 2026"]]).rows[0];
    expect(r.record.studentId).toBe("s4");
  });
  test("bad amounts and months are errors", () => {
    const r = run(["Student", "Amount", "Month"], [
      ["Ahmad Khan", "abc", "March 2026"],
      ["Ahmad Khan", "0", "March 2026"],
      ["Ahmad Khan", "-100", "March 2026"],
      ["Ahmad Khan", "100", "tuition"],
      ["Ahmad Khan", "100", "March"],
    ]).rows;
    expect(r.every((x) => x.status === "error")).toBe(true);
    expect(r[4].message).toMatch(/Year is missing/);
  });
  test("duplicates against existing invoices and within the file are flagged, not written", () => {
    const { rows, summary } = run(["Student", "Amount", "Month"], [
      ["Ahmad Khan", "100", "March 2026"],
      ["Ahmad Khan", "100", "March 2026"],
      ["Sara Ali", "100", "March 2026"],
      ["Sara Ali", "100", "April 2026"],
    ], [{ studentId: "s2", month: "March", year: 2026 }]);
    expect(rows.map((r) => r.status)).toEqual(["ok", "duplicate", "duplicate", "ok"]);
    expect(rows[1].message).toMatch(/row 2/);
    expect(summary).toMatchObject({ total: 4, ready: 2, duplicates: 2, errors: 0 });
  });
  test("describeTotals", () => {
    expect(describeTotals("invoices", { amount: 1200.5, cashRows: 1, cashAmount: 500 })).toMatch(/1,200.5.*1 row already received/);
  });
});

describe("payments import: Dr/Cr and Credit columns (ACC-10)", () => {
  const cashAccounts = [{ id: "a1", name: "Cash in Hand" }, { id: "a2", name: "Meezan Bank" }];
  const run = (headers, rows, existing = []) => {
    const { mapped } = mapRows("payments", headers, rows);
    return validateImport("payments", mapped, { cashAccounts, existing });
  };

  test("separate Debit and Credit columns: debit is money out, credit is money in", () => {
    const { rows, summary } = run(["Date", "Account", "Description", "Debit", "Credit"], [
      ["2026-03-01", "Cash in Hand", "Rent", "20,000", ""],
      ["2026-03-02", "Cash in Hand", "Fee receipts", "", "50000"],
    ]);
    expect(rows[0].record).toMatchObject({ type: "cash_out", amount: 20000, accountId: "a1" });
    expect(rows[1].record).toMatchObject({ type: "cash_in", amount: 50000 });
    expect(summary.totals).toEqual({ moneyIn: 50000, moneyOut: 20000 });
  });
  test("Dr / Cr / Withdrawal / Deposit in a Type column", () => {
    const { rows } = run(["Date", "Account", "Type", "Amount"], [
      ["2026-03-01", "Meezan Bank", "Dr", "100"],
      ["2026-03-01", "Meezan Bank", "Cr", "200"],
      ["2026-03-01", "Meezan Bank", "Withdrawal", "300"],
      ["2026-03-01", "Meezan Bank", "Deposit", "400"],
      ["2026-03-01", "Meezan Bank", "Outstanding", "500"],
    ]);
    expect(rows.map((r) => r.record?.type)).toEqual(["cash_out", "cash_in", "cash_out", "cash_in", undefined]);
    expect(rows[4].status).toBe("error");
  });
  test("signed amounts without a Type: negative is money out, with a warning", () => {
    const { rows } = run(["Date", "Account", "Amount"], [["2026-03-01", "Cash in Hand", "(1,200)"], ["2026-03-01", "Cash in Hand", "300"]]);
    expect(rows[0].record).toMatchObject({ type: "cash_out", amount: 1200 });
    expect(rows[1].record).toMatchObject({ type: "cash_in", amount: 300 });
    expect(rows[0].message).toMatch(/No Type column/);
  });
  test("both debit and credit, neither, a negative amount with a type, an unknown or non-cash account all fail", () => {
    const { rows } = run(["Date", "Account", "Debit", "Credit"], [
      ["2026-03-01", "Cash in Hand", "10", "10"],
      ["2026-03-01", "Cash in Hand", "", ""],
      ["2026-03-01", "Furniture", "10", ""],
      ["31 March", "Cash in Hand", "10", ""],
    ]);
    expect(rows.map((r) => r.status)).toEqual(["error", "error", "error", "error"]);
    expect(rows[2].message).toMatch(/No Bank & Cash account named/);
    const neg = run(["Date", "Account", "Type", "Amount"], [["2026-03-01", "Cash in Hand", "Credit", "-5"]]).rows[0];
    expect(neg.status).toBe("error");
  });
  test("re-importing the same file is detected as duplicates", () => {
    const first = run(["Date", "Account", "Description", "Debit"], [["2026-03-01", "Cash in Hand", "Rent", "20000"]]);
    const existing = [{ date: "2026-03-01", account: "Cash in Hand", type: "cash_out", amount: 20000, reference: "", description: "Rent" }];
    expect(first.rows[0].status).toBe("ok");
    const again = run(["Date", "Account", "Description", "Debit"], [["2026-03-01", "Cash in Hand", "Rent", "20000"]], existing);
    expect(again.rows[0].status).toBe("duplicate");
    expect(describeTotals("payments", again.summary.totals)).toMatch(/Money in/);
  });
  test("reversal rows are not treated as existing entries", () => {
    expect(IMPORT_TYPES.payments.existingKeys({ reversalOf: "x", date: "2026-03-01", account: "A", type: "cash_in", amount: 1 })).toEqual([]);
  });
});

describe("other templates", () => {
  test("students: monthly fee from Monthly Fee only, duplicates by id or name+phone", () => {
    const { mapped } = mapRows("students", ["Name", "Code", "Monthly Fee", "Balance", "Phone"], [
      ["Ahmad", "S-1", "3000", "18000", "0300"],
      ["Ahmad", "S-9", "3000", "0", "0300"],
      ["Zed", "S-1", "", "", ""],
      ["Bilal", "S-3", "Rs 2,500", "", ""],
      ["Carl", "S-4", "abc", "", ""],
    ]);
    const { rows } = validateImport("students", mapped, { existing: [] });
    expect(rows[0].record.monthlyFee).toBe(3000);
    expect(rows[1].status).toBe("duplicate"); // same name + phone
    expect(rows[2].status).toBe("duplicate"); // same student id
    expect(rows[3].record.monthlyFee).toBe(2500);
    expect(rows[4].status).toBe("error");
  });
  test("expenses require positive amounts and real dates", () => {
    const { mapped } = mapRows("expenses", ["Description", "Amount", "Date"], [
      ["Rent", "15000", "2026-03-01"], ["Bad", "-1", "2026-03-01"], ["NoDate", "5", ""], ["Rent", "15000", "2026-03-01"],
    ]);
    const { rows, summary } = validateImport("expenses", mapped);
    expect(rows.map((r) => r.status)).toEqual(["ok", "error", "error", "duplicate"]);
    expect(summary.totals.amount).toBe(15000);
  });
  test("accounts: type and sub-type are validated, never copied from each other", () => {
    const { mapped } = mapRows("accounts", ["Code", "Name", "Type", "Sub Type", "Opening Balance"], [
      ["1001", "Cash in Hand", "asset", "Bank and Cash", "50,000"],
      ["1002", "Mystery", "Stuff", "", ""],
      ["1003", "Bad Sub", "Assets", "Banana", ""],
      ["1001", "Dup Code", "Assets", "", ""],
    ]);
    const { rows } = validateImport("accounts", mapped, { existing: [] });
    expect(rows[0].record).toMatchObject({ type: "Assets", subType: "Bank & Cash", balance: 50000 });
    expect(rows[1].status).toBe("error");
    expect(rows[2].status).toBe("error");
    expect(rows[3].status).toBe("duplicate");
  });
  test("employees: salary parsed, duplicates by email", () => {
    const { mapped } = mapRows("employees", ["Name", "Email", "Salary"], [["Sara", "s@x.com", "25,000"], ["Sarah", "S@X.com", "1"]]);
    const { rows } = validateImport("employees", mapped);
    expect(rows[0].record.salary).toBe(25000);
    expect(rows[1].status).toBe("duplicate");
  });
  test("unknown type throws", () => {
    expect(() => validateImport("nope", [])).toThrow();
  });
});

describe("upload safety (SEC-13)", () => {
  test("extension, size, emptiness and magic bytes", () => {
    expect(checkUploadMeta({ name: "a.xls", size: 10, head: [0x50, 0x4b] })).toMatch(/Only .xlsx and .csv/);
    expect(checkUploadMeta({ name: "a.xlsm", size: 10, head: [0x50, 0x4b] })).toMatch(/Only .xlsx and .csv/);
    expect(checkUploadMeta({ name: "a.xlsx", size: MAX_FILE_BYTES + 1, head: [0x50, 0x4b] })).toMatch(/too large/);
    expect(checkUploadMeta({ name: "a.csv", size: 0 })).toMatch(/empty/);
    expect(checkUploadMeta({ name: "a.xlsx", size: 10, head: [1, 2] })).toMatch(/real .xlsx/);
    expect(checkUploadMeta({ name: "a.xlsx", size: 10, head: [0x50, 0x4b] })).toBe("");
    expect(checkUploadMeta({ name: "A.CSV", size: 10 })).toBe("");
  });

  // Build a zip central directory by hand (entries only declare sizes).
  const zipWith = (sizes) => {
    const parts = [];
    const cd = [];
    let len = 0;
    const u16 = (n) => [n & 255, (n >> 8) & 255];
    const u32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
    sizes.forEach((sz, i) => {
      const name = `f${i}`;
      const rec = [...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(1), ...u32(sz), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(0), ...Array.from(name).map((c) => c.charCodeAt(0))];
      cd.push(...rec);
    });
    parts.push(...cd);
    len = cd.length;
    const eocd = [...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(sizes.length), ...u16(sizes.length), ...u32(len), ...u32(0), ...u16(0)];
    return new Uint8Array([...parts, ...eocd]);
  };
  test("reads the declared uncompressed size from the central directory", () => {
    expect(zipUncompressedSize(zipWith([100, 250]))).toBe(350);
    expect(zipUncompressedSize(zipWith([4000000000, 4000000000]))).toBe(8000000000);
  });
  test("not a zip -> null", () => {
    expect(zipUncompressedSize(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]))).toBeNull();
    expect(zipUncompressedSize(new Uint8Array(5))).toBeNull();
  });
});
