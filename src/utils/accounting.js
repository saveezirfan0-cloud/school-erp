// src/utils/accounting.js
//
// The single place where "money moved" becomes a real ledger entry.
//
// In this app, Bank & Cash balances are derived entirely from the
// `payments` collection (see BankCash.jsx getAccountBalance): a
// payment with type "cash_in" adds to an account, "cash_out"
// subtracts. So any time money actually changes hands — a fee is
// collected, an expense is paid, a salary is paid — we record a
// payment row against the chosen account. That keeps the bank
// balances, the payments ledger, and the source document in sync.
//
// Using one helper for all of these guarantees they post consistently.

import { db, addDoc, collection, serverTimestamp } from "../firebase";
import { supabase } from "../lib/supabaseClient";

// Look up a chart-of-accounts id by account name, so callers that only know
// the name (fee collection, payslips...) still link payments by id. Cached
// briefly because bulk flows record many payments against one account.
const idCache = new Map(); // name -> { id, at }
async function findAccountId(name) {
  const hit = idCache.get(name);
  if (hit && Date.now() - hit.at < 60000) return hit.id;
  const { data } = await supabase
    .from("accounts").select("id").eq("name", name).is("deleted_at", null).limit(1);
  const id = data?.[0]?.id || "";
  idCache.set(name, { id, at: Date.now() });
  return id;
}

// Does this payment belong to this chart-of-accounts account? Matches by id
// when the payment has one (survives renames); older payments fall back to name.
export function paymentInAccount(payment, account) {
  return payment.accountId ? payment.accountId === account.id : payment.account === account.name;
}

/**
 * Record a money movement against a bank/cash account.
 *
 * @param {object} p
 * @param {"cash_in"|"cash_out"} p.type   money in or out of the account
 * @param {string} p.account              account NAME (matches accounts.name)
 * @param {string} [p.accountId]          chart-of-accounts id of that account (stable across renames)
 * @param {number} p.amount
 * @param {string} p.category             e.g. "Fee Collection", "Salary", "Expense"
 * @param {string} p.description
 * @param {string} [p.reference]          link back to source (e.g. invoice/payslip id)
 * @param {string} [p.branchId]
 * @param {string} [p.date]               ISO date; defaults to today
 * @param {string} [p.source]             source type: "invoice" | "expense" | "payslip"
 * @param {string} [p.sourceId]           source document id
 */
export async function recordPayment({
  type, account, accountId = "", amount, category, description,
  reference = "", branchId = "", date, source = "", sourceId = "",
}) {
  if (!account) throw new Error("No account selected");
  if (!amount || Number(amount) <= 0) throw new Error("Invalid amount");
  if (!accountId) accountId = await findAccountId(account);

  return addDoc(collection(db, "payments"), {
    type,
    account,
    accountId,     // stored in `extra`; lets us link back to the chart of accounts
    amount: Number(amount),
    category: category || "",
    description: description || "",
    reference,
    branchId,
    date: date || new Date().toISOString().slice(0, 10),
    source,        // lets us trace a payment back to its origin
    sourceId,
    reversed: false,
    reversalOf: null,
    createdAt: serverTimestamp(),
  });
}

// Bank & Cash accounts are the ones you can pay into / out of.
export function bankCashAccounts(accounts) {
  return accounts.filter(a => a.subType === "Bank & Cash" || a.type === "Assets");
}

// ---- Reversal & source linkage (for tracked, reversible edits) ----
//
// We never silently mutate a posted payment. To "undo" the money
// effect of a source document (invoice/payslip/expense), we post an
// equal-and-opposite reversing entry. The original and the reversal
// both remain in the ledger, preserving the audit trail. Net effect
// on the account balance is zero.

// Find all live (non-reversed, non-trashed) payments for a source doc.
export async function getSourcePayments(source, sourceId) {
  if (!sourceId) return [];
  const { data, error } = await supabase
    .from("payments")
    .select("*")
    .eq("source", source)
    .eq("source_id", sourceId)
    .is("deleted_at", null);
  if (error) throw error;
  // decode snake_case -> camelCase minimally for what callers use
  return (data || []).map(r => ({
    id: r.id, type: r.type, account: r.account, accountId: r.extra?.accountId || "",
    amount: Number(r.amount),
    reversed: r.reversed === true, reversalOf: r.reversal_of || null,
    category: r.category, description: r.description,
    branchId: r.branch_id, date: r.date,
  }));
}

// Sum of net money posted for a source (cash_in positive, cash_out
// negative), ignoring entries that have been reversed and the
// reversal entries themselves. Used for an invoice's "paid so far".
export async function getSourcePaidTotal(source, sourceId) {
  const rows = await getSourcePayments(source, sourceId);
  return rows
    .filter(r => !r.reversed && !r.reversalOf)
    .reduce((sum, r) => sum + (r.type === "cash_in" ? r.amount : -r.amount), 0);
}

// Post a reversing entry for an existing payment and mark the
// original as reversed. Leaves both in the ledger.
export async function reversePayment(payment) {
  // mark original reversed
  const { error: e1 } = await supabase
    .from("payments")
    .update({ reversed: true })
    .eq("id", payment.id);
  if (e1) throw e1;

  // post the opposite entry
  return addDoc(collection(db, "payments"), {
    type: payment.type === "cash_in" ? "cash_out" : "cash_in",
    account: payment.account,
    accountId: payment.accountId || "",
    amount: Number(payment.amount),
    category: (payment.category || "") + " (reversal)",
    description: "Reversal: " + (payment.description || ""),
    reference: payment.reversalOf || "",
    branchId: payment.branchId || "",
    date: new Date().toISOString().slice(0, 10),
    source: payment.source || "",
    sourceId: payment.sourceId || "",
    reversalOf: payment.id,
    createdAt: serverTimestamp(),
  });
}

// Reverse ALL live payments tied to a source (used when a paid
// invoice/payslip/expense is deleted, so the balance doesn't drift).
export async function reverseSourcePayments(source, sourceId) {
  const rows = await getSourcePayments(source, sourceId);
  const toReverse = rows.filter(r => !r.reversed && !r.reversalOf);
  for (const p of toReverse) {
    await reversePayment({ ...p, source, sourceId });
  }
  return toReverse.length;
}
