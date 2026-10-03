import { coerceColumn } from "./columns";

test("blank numeric columns become null", () => {
  expect(coerceColumn("students", "monthly_fee", "")).toBeNull();
  expect(coerceColumn("invoices", "amount", undefined)).toBeNull();
});

test("real values and non-numeric columns are left alone", () => {
  expect(coerceColumn("students", "monthly_fee", "2500")).toBe("2500");
  expect(coerceColumn("students", "monthly_fee", 0)).toBe(0);
  expect(coerceColumn("students", "name", "")).toBe("");
  expect(coerceColumn("unknown_table", "amount", "")).toBe("");
});
