import { renderDocument, monthlyDocument, yearDocument } from "./reportPdf";

const statement = {
  year: 2026, month: 10, from: "2026-10-01", to: "2026-10-31", options: {},
  openingBalance: 0, totalIncome: 0, totalExpense: 0, closingBalance: 0,
  income: { groups: [], total: 0 }, expense: { groups: [], total: 0 }, cashAccounts: [],
};

describe("report preview", () => {
  it("pads the preview by the page margin on screen only", () => {
    const html = renderDocument(monthlyDocument(statement), { preview: true });
    expect(html).toContain("@media screen { body { padding: 12mm; } }");
    expect(html).toContain("@page { size: A4; margin: 12mm; }");
  });

  it("does not add the padding to the real print document", () => {
    expect(renderDocument(monthlyDocument(statement))).not.toContain("@media screen");
  });

  it("uses the tighter landscape margin for the year view", () => {
    const table = { opening: [], income: { rows: [], totals: [], total: 0 }, expense: { rows: [], totals: [], total: 0 }, net: [], netTotal: 0, closing: [] };
    expect(renderDocument(yearDocument(table, 2026), { preview: true })).toContain("padding: 10mm;");
  });
});
