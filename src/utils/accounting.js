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

import {
  SALARY_ACCOUNT_NAME, findAccountByName, feeIncomeAccount, splitPaymentByHead,
} from "./autoJournals";

export { paymentInAccount } from "./paymentAccount";

// Chart of accounts (id, name, type), cached briefly because bulk flows record
// many payments in a row. Used to link payments by id and to pick journal accounts.
let acctCache = { at: 0, rows: [] };
async function loadAccounts() {
  if (Date.now() - acctCache.at < 60000 && acctCache.rows.length) return acctCache.rows;
  const { data } = await supabase.from("accounts").select("id,name,type").is("deleted_at", null);
  acctCache = { at: Date.now(), rows: data || [] };
  return acctCache.rows;
}
async function findAccountId(name) {
  return findAccountByName(await loadAccounts(), name)?.id || "";
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

  const ref = await addDoc(collection(db, "payments"), {
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

  // Fee collections and salaries are also booked as journal entries. A failure
  // here (e.g. no accounting permission) must not undo the payment itself; the
  // backfill script in supabase/ can post anything that was missed.
  try {
    await postPaymentJournals({
      id: ref.id, type, account, amount: Number(amount), description, branchId,
      date: date || new Date().toISOString().slice(0, 10), source, sourceId,
    });
  } catch (err) {
    console.warn("Payment recorded, but its journal entry was not posted:", err);
  }
  return ref;
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

  // Its fee/salary journal entries go with it (the reversing payment below is
  // not journaled). Best-effort: the reversal itself must still happen.
  await deleteJournalsBySource("payment", payment.id)
    .catch((err) => console.warn("Could not remove journal entries for reversed payment:", err));

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

// ---- Double-entry journals for expenses ----
//
// A paid expense is also booked as a journal entry: debit the expense account
// from the chart, credit the bank/cash account it was paid from. The entry is
// tagged source "expense" + sourceId (stored in the journal's `extra` jsonb) so
// it can be traced, retargeted and removed with its expense. Reports that read
// expenses directly (monthlyStatement) skip these entries to avoid counting an
// expense twice. Unpaid expenses post nothing: the books are cash-basis, with
// no accounts-payable account to credit.

export async function postExpenseJournal({
  expenseId, expenseAccount, payAccount, amount, date, description, branchId = "",
}) {
  if (!expenseId || !expenseAccount?.name || !payAccount?.name) return null;
  if (!amount || Number(amount) <= 0) return null;
  return addDoc(collection(db, "journals"), {
    date: date || new Date().toISOString().slice(0, 10),
    reference: "EXP-" + String(expenseId).slice(0, 8),
    description: description || "Expense",
    debitAccount: expenseAccount.name,
    creditAccount: payAccount.name,
    amount: Number(amount),
    notes: "Auto-posted from Expenses",
    branchId,
    source: "expense",
    sourceId: expenseId,
    createdAt: serverTimestamp(),
  });
}

// Move auto-posted journals to Trash. `source` is "expense" (ids are expense
// ids) or "payment" (ids are payment ids).
export async function deleteJournalsBySource(source, ids) {
  ids = [].concat(ids).filter(Boolean);
  if (!ids.length) return;
  const { error } = await supabase
    .from("journals")
    .update({ deleted_at: new Date().toISOString() })
    .eq("extra->>source", source)
    .in("extra->>sourceId", ids)
    .is("deleted_at", null);
  if (error) throw error;
}
export const deleteExpenseJournals = (expenseIds) => deleteJournalsBySource("expense", expenseIds);

// Keep existing expense journals in step with a bulk edit of their expenses:
// `accountName` re-points the debit side, `date` moves the entry.
export async function syncExpenseJournals(expenseIds, { accountName, date } = {}) {
  const ids = [].concat(expenseIds).filter(Boolean);
  const patch = {};
  if (accountName) patch.debit_account = accountName;
  if (date) patch.date = date;
  if (!ids.length || !Object.keys(patch).length) return;
  const { error } = await supabase
    .from("journals")
    .update(patch)
    .eq("extra->>source", "expense")
    .in("extra->>sourceId", ids)
    .is("deleted_at", null);
  if (error) throw error;
}

// ---- Journals for fee collections and salaries ----
//
//   fee collected   DR bank/cash account   CR fee income account (one entry per
//                   invoice head, the payment split pro rata across them)
//   salary paid     DR "Salaries" expense  CR bank/cash account
//
// Keyed by the payment (source "payment", sourceId = payment id), so reversing
// or deleting the payment takes its journals with it. Nothing is posted when the
// chart has no matching account; we never guess an account.
export async function postPaymentJournals(p) {
  if (!p?.id || !p.amount) return;
  const accounts = await loadAccounts();
  const base = {
    date: p.date,
    reference: (p.source === "payslip" ? "SAL-" : "FEE-") + String(p.id).slice(0, 8),
    description: p.description || "",
    notes: "Auto-posted from " + (p.source === "payslip" ? "Payslips" : "Fees"),
    branchId: p.branchId || "",
    source: "payment",
    sourceId: p.id,
    createdAt: serverTimestamp(),
  };

  if (p.source === "payslip" && p.type === "cash_out") {
    const salary = findAccountByName(accounts, SALARY_ACCOUNT_NAME, "Expenses");
    if (!salary) return;
    await addDoc(collection(db, "journals"), {
      ...base, debitAccount: salary.name, creditAccount: p.account, amount: p.amount,
    });
    return;
  }

  if (p.source === "invoice" && p.type === "cash_in") {
    const { data: inv } = await supabase.from("invoices").select("extra").eq("id", p.sourceId).maybeSingle();
    for (const part of splitPaymentByHead(p.amount, inv?.extra?.lineItems)) {
      const income = feeIncomeAccount(part.head, accounts);
      if (!income) continue;
      await addDoc(collection(db, "journals"), {
        ...base, debitAccount: p.account, creditAccount: income.name, amount: part.amount,
      });
    }
  }
}
