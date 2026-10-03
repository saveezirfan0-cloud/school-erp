import { escapeHtml, neutralizeCell, buildCSV, buildPrintHtml, exportToPDF, exportToCSV, exportToExcel, printHTML } from "../exportUtils";

describe("escapeHtml", () => {
  test("escapes the five dangerous characters (and backtick)", () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&\``)).toBe(
      "&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&#96;"
    );
  });
  test("null and undefined become empty; other types are stringified", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
    expect(escapeHtml(0)).toBe("0");
    expect(escapeHtml(false)).toBe("false");
  });
  test("does not double-escape ampersands inside already escaped output", () => {
    expect(escapeHtml("&amp;")).toBe("&amp;amp;");
  });
});

describe("CSV formula neutralisation (SEC-15)", () => {
  test.each(["=1+1", "+1+1", "-1+1", "@SUM(A1)", "\tcmd", "\rcmd"])(
    "prefixes %j with an apostrophe",
    (cell) => {
      expect(neutralizeCell(cell)).toBe(`'${cell}`);
    }
  );

  test("leaves ordinary text alone", () => {
    expect(neutralizeCell("Ali Khan")).toBe("Ali Khan");
    expect(neutralizeCell("a=b")).toBe("a=b");
    expect(neutralizeCell("")).toBe("");
  });

  test("real numbers stay numeric, including negatives", () => {
    expect(neutralizeCell(-500)).toBe("-500");
    expect(neutralizeCell(12.5)).toBe("12.5");
    expect(neutralizeCell(0)).toBe("0");
    expect(neutralizeCell(NaN)).toBe("");
  });

  test("numeric-looking text is not turned into text", () => {
    expect(neutralizeCell("-500")).toBe("-500");
    expect(neutralizeCell("+923001234567")).toBe("+923001234567");
    expect(neutralizeCell("1e3")).toBe("1e3");
  });

  test("null/undefined are empty, booleans and dates are rendered", () => {
    expect(neutralizeCell(null)).toBe("");
    expect(neutralizeCell(undefined)).toBe("");
    expect(neutralizeCell(true)).toBe("TRUE");
    expect(neutralizeCell(new Date("2026-03-31T00:00:00Z"))).toBe("2026-03-31T00:00:00.000Z");
  });
});

describe("buildCSV", () => {
  const csv = buildCSV(["Name", "=Amount"], [
    ["Ali, \"Jr\"", -500],
    ["=1+2", "line1\nline2"],
    [null, 12.5],
  ]);

  test("starts with a UTF-8 BOM and quotes text cells and headers", () => {
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0]).toBe(`"Name","'=Amount"`);
    expect(lines[1]).toBe(`"Ali, ""Jr""",-500`);
  });

  test("neutralises formulas in text cells, keeps numbers bare, handles embedded newlines and nulls", () => {
    expect(csv).toContain(`"'=1+2","line1\nline2"`);
    expect(csv).toContain(`"",12.5`);
  });
});

describe("print HTML (SEC-02 / CODE-16)", () => {
  const payload = "<img src=probe>";
  const html = buildPrintHtml(`T ${payload}`, [payload, "H2"], [[payload, "<script>probe</script>", null, 5]], "1 Jan");

  test("no dynamic value can introduce a tag", () => {
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;img src=probe&gt;");
    expect(html).toContain("&lt;script&gt;probe&lt;/script&gt;");
  });

  test("renders null as empty and numbers as text", () => {
    expect(html).toContain("<td></td><td>5</td>");
  });

  test("the print document forbids script execution", () => {
    expect(html).toContain("default-src 'none'");
  });
});

describe("printHTML / non-Latin PDF fallback", () => {
  afterEach(() => { delete window.open; jest.useRealTimers(); });

  test("printHTML returns false and does not throw when the popup is blocked", () => {
    window.open = jest.fn(() => null);
    expect(printHTML("T", "<p>x</p>")).toBe(false);
  });

  test("exportToPDF falls back to an escaped print document for text jsPDF cannot draw", async () => {
    jest.useFakeTimers();
    const w = { document: { write: jest.fn(), close: jest.fn() }, print: jest.fn(), focus: jest.fn() };
    window.open = jest.fn(() => w);
    await exportToPDF("<b>T</b>", ["a"], [["<i>x</i> \u0627\u0631\u062f\u0648"]]);
    const written = w.document.write.mock.calls[0][0];
    expect(written).toContain("&lt;i&gt;x&lt;/i&gt;");
    expect(written).not.toContain("<i>");
    expect(written).not.toContain("<script");
    jest.advanceTimersByTime(500);
    expect(w.print).toHaveBeenCalled();
  });
});

describe("exportToExcel (exceljs)", () => {
  test("writes an .xlsx with numeric cells numeric and text cells neutralised", async () => {
    const ExcelJS = require("exceljs");
    let blob;
    URL.createObjectURL = jest.fn((b) => { blob = b; return "blob:x"; });
    URL.revokeObjectURL = jest.fn();
    const click = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await exportToExcel("book", ["Name", "Amount"], [["=1+2", 1500.5], ["Ali", -20]], "Fees: 2026/27 [x]");
    expect(click).toHaveBeenCalled();
    click.mockRestore();
    expect(blob.type).toContain("spreadsheetml");
    const buf = await new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.readAsArrayBuffer(blob);
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.worksheets[0];
    expect(ws.name).toBe("Fees  2026 27  x");
    expect(ws.getCell("A2").value).toBe("'=1+2");
    expect(ws.getCell("B2").value).toBe(1500.5);
    expect(ws.getCell("B3").value).toBe(-20);
  });
});

describe("exportToCSV", () => {
  test("creates a download link with a sanitised file name", () => {
    URL.createObjectURL = jest.fn(() => "blob:x");
    URL.revokeObjectURL = jest.fn();
    const click = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    exportToCSV("students/../2026", ["a"], [["1"]]);
    expect(click).toHaveBeenCalled();
    const blob = URL.createObjectURL.mock.calls[0][0];
    expect(blob.type).toContain("text/csv");
    click.mockRestore();
  });
});
