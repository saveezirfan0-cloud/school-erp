/**
 * @jest-environment node
 */
// Real-file check: a workbook written by exceljs is accepted by the
// pre-flight checks, and the zip central-directory reader sees sane sizes.
import { zipUncompressedSize, checkUploadMeta, matrixToTable, buildMapping, IMPORT_TYPES } from "./importParsing";

const ExcelJS = require("exceljs");

test("a real .xlsx passes the zip pre-flight and reads back through exceljs", async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.addRow(["Date", "Account", "Debit", "Credit"]);
  ws.addRow([new Date(Date.UTC(2026, 2, 1)), "Cash in Hand", 20000, null]);
  ws.addRow([new Date(Date.UTC(2026, 2, 2)), "Cash in Hand", null, "50,000"]);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());

  expect(checkUploadMeta({ name: "t.xlsx", size: buf.length, head: buf.subarray(0, 4) })).toBe("");
  const unz = zipUncompressedSize(buf);
  expect(unz).toBeGreaterThan(100);
  expect(unz).toBeLessThan(1e6);

  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(buf);
  const sheet = wb2.worksheets[0];
  const matrix = [];
  sheet.eachRow({ includeEmpty: true }, (row) => {
    const line = [];
    for (let c = 1; c <= row.cellCount; c++) line.push(row.getCell(c).value);
    matrix.push(line);
  });
  const t = matrixToTable(matrix, 1);
  expect(t.headers).toEqual(["Date", "Account", "Debit", "Credit"]);
  expect(t.rows).toHaveLength(2);
  expect(t.rows[0].cells.Debit).toBe(20000);
  expect(t.rows[0].cells.Date instanceof Date).toBe(true);
  expect(buildMapping(t.headers, IMPORT_TYPES.payments.columnMap).fieldToHeader).toMatchObject({ debit: "Debit", credit: "Credit", account: "Account", date: "Date" });
});
