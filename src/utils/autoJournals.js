// src/utils/autoJournals.js
//
// Pure rules for the journal entries the app posts automatically (no
// Supabase/Firebase imports, so reports and tests can use them).
//
//   expense paid          DR expense account       CR bank/cash account
//   salary paid           DR "Salaries" expense    CR bank/cash account
//   fee collected         DR bank/cash account     CR fee income account
//
// Entries are tagged with `source` + `sourceId` in the journal's extra jsonb:
//   source "expense"  sourceId = expense id
//   source "payment"  sourceId = payment id (fee collections and salaries)
// Reports that already count expenses / invoices / payslips directly must
// skip these sources or they would be counted twice.

export const AUTO_JOURNAL_SOURCES = ["expense", "payment"];
export const isAutoJournal = (j) => AUTO_JOURNAL_SOURCES.includes(j?.source);

// Expense account that paid salaries are booked to (matched by name).
export const SALARY_ACCOUNT_NAME = "Salaries";
// Income account used for a fee head that has no income account of its own
// (e.g. "Tuition Fee" invoices are booked to the generic "Fees" income).
export const FALLBACK_FEE_ACCOUNT_NAME = "Fees";

const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
// "Fees x2" / "Fees x3" are repeat counts of the same head.
const baseHead = (s) => norm(s).replace(/\s*x\d+$/, "");

// Find an account by (case/spacing-insensitive) name, optionally of one type.
export function findAccountByName(accounts, name, type) {
  const n = norm(name);
  return accounts.find((a) => (!type || a.type === type) && norm(a.name) === n) || null;
}

// Income account a fee line item is credited to, or null if there is none.
export function feeIncomeAccount(head, accounts) {
  const income = accounts.filter((a) => a.type === "Income");
  return findAccountByName(income, baseHead(head))
    || findAccountByName(income, FALLBACK_FEE_ACCOUNT_NAME);
}

// Split a payment across an invoice's line items in proportion to their
// amounts, rounding by cumulative share so the parts add up exactly to the
// payment. Invoices without usable line items are a single "Tuition Fee" part.
export function splitPaymentByHead(amount, lineItems) {
  const total = Number(amount) || 0;
  const items = (Array.isArray(lineItems) ? lineItems : [])
    .map((li) => ({
      head: String(li?.customDescription || li?.description || "").trim() || "Tuition Fee",
      weight: Number(li?.amount) || 0,
    }))
    .filter((li) => li.weight > 0);
  if (!items.length) return [{ head: "Tuition Fee", amount: total }];

  const weightSum = items.reduce((s, li) => s + li.weight, 0);
  let cumWeight = 0;
  let prev = 0;
  return items.map((li) => {
    cumWeight += li.weight;
    const cum = Math.round((total * cumWeight) / weightSum * 100) / 100;
    const part = Math.round((cum - prev) * 100) / 100;
    prev = cum;
    return { head: li.head, amount: part };
  }).filter((p) => p.amount > 0);
}
