// src/utils/ledgerIncome.js
//
// Income that lives in the `payments` ledger rather than in invoices: fee
// collections imported from the accounts workbook (Jan–Jul 2026), welfare,
// donations, loans received and so on. The Dashboard and the monthly
// statement both read income through here so they always agree.
import { INCOME_RULES } from "../config/statementHeads";

// Payments that are transfers between our own accounts, not income.
export const TRANSFER_CATEGORIES = ["Bank Deposit", "Bank Withdrawal"];

// A cash_in payment that is income in its own right: not reversed, not the
// receipt side of an invoice / expense / payslip (those are already counted
// through the invoice, expense or payslip itself) and not an account transfer.
export function isLedgerIncome(p) {
  if (!p || p.type !== "cash_in" || p.reversed === true || p.reversalOf) return false;
  if (p.source === "invoice" || p.source === "expense" || p.source === "payslip") return false;
  return !TRANSFER_CATEGORIES.includes(p.category);
}

// True when an income head is student fee income (Baneen Fees, Admission
// Fees, Tafseer Course Fees...) as opposed to welfare, donations or loans.
export function isFeeHead(name) {
  const rule = INCOME_RULES.find((r) => r.match.test(String(name || "")));
  return rule?.group === "fees";
}
