// Payslip line items: named earnings (added to basic) and deductions.
//
// A payslip keeps its flat totals (basicSalary, allowances, deductions,
// netPay, amount) because reports, exports and the ledger read those. The
// optional `lineItems` array is the breakdown behind allowances/deductions:
//   [{ type: "earning" | "deduction", label: "Transport", amount: 1500 }]
// Totals are always derived from the items, so the two can never disagree.
import { toMinor, fromMinor } from "./money";

export const ITEM_TYPES = { earning: "earning", deduction: "deduction" };

const blank = (v) => v === "" || v === null || v === undefined;

// Seed the editor from a stored payslip. Older payslips only have the flat
// allowances/deductions totals, so those become one line each.
export function itemsFromPayslip(p) {
  if (Array.isArray(p?.lineItems) && p.lineItems.length) {
    return p.lineItems.map((i) => ({ type: i.type === "deduction" ? "deduction" : "earning", label: i.label || "", amount: i.amount ?? "" }));
  }
  const items = [];
  if (Number(p?.allowances) > 0) items.push({ type: "earning", label: "Allowances", amount: p.allowances });
  if (Number(p?.deductions) > 0) items.push({ type: "deduction", label: "Deductions", amount: p.deductions });
  return items;
}

// Validate and total a payslip. Returns { ok:false, error } or
// { ok:true, basicSalary, allowances, deductions, netPay, lineItems }.
// Blank rows (no label and no amount) are dropped; a row with only one of the
// two is an error, as is any negative or non-numeric amount.
export function computePayslip(basic, items = []) {
  const b = toMinor(basic);
  if (!Number.isFinite(b) || b <= 0) return { ok: false, error: "Basic salary must be above zero" };

  let earn = 0, ded = 0;
  const lineItems = [];
  for (const it of items) {
    const label = String(it.label || "").trim();
    if (!label && blank(it.amount)) continue;
    if (!label) return { ok: false, error: "Every line item needs a name" };
    const a = blank(it.amount) ? NaN : toMinor(it.amount);
    if (!Number.isFinite(a) || a < 0) return { ok: false, error: `"${label}": enter an amount of zero or more` };
    if (it.type === "deduction") ded += a; else earn += a;
    lineItems.push({ type: it.type === "deduction" ? "deduction" : "earning", label, amount: fromMinor(a) });
  }
  const net = b + earn - ded;
  if (net <= 0) return { ok: false, error: "Net pay must be above zero" };
  return {
    ok: true,
    basicSalary: fromMinor(b),
    allowances: fromMinor(earn),
    deductions: fromMinor(ded),
    netPay: fromMinor(net),
    lineItems,
  };
}
