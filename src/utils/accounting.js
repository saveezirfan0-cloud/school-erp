// src/utils/accounting.js
//
// The single place where "money moved" becomes a real ledger entry.
//
// In this app, Bank & Cash balances are derived entirely from the
// `payments` collection (see BankCash.jsx getAccountBalance): a
// payment with type "cash_in" adds to an account, "cash_out"
// subtracts. So any time money actually changes hands (a fee is
// collected, an expense is paid, a salary is paid) we record a
// payment row against the chosen account. That keeps the bank
// balances, the payments ledger, and the source document in sync.
//
// EVERY path that marks an invoice paid goes through
// collectInvoicePayment() / createInvoiceAndCollect() below (ACC-01):
// QuickPayment, Bulk Receive, Receive-now, Mark Paid (single and
// bulk), Excel import and concessions. They can therefore never
// disagree, and none of them can silently skip the ledger: when no
// postable account exists they either throw or (QuickPayment only)
// stamp the invoice `ledgerPosted: false` so the gap is visible.
//
// BACKWARD COMPATIBILITY (this code ships before any SQL is applied)
//  - Payments keep the account NAME in `account` (BankCash, Reports
//    and AccountDetail still read it) AND now also store the account
//    id as `accountId`. With the current schema `accountId` lands in
//    the payments.extra jsonb; if a real account_id column is added
//    later (and listed in firebase.js COLUMNS) it is used instead.
//  - Everything new on documents is an extra key that older readers
//    simply ignore: payments.accountId / repostOf, invoices.paidAccountId
//    / ledgerPosted / unpostedReason, expenses.paidAccountId /
//    ledgerPosted, payslips.paidAccountId.

import {
  db, addDoc, collection, serverTimestamp, doc, getDoc, deleteDoc, restoreDoc, updateDocs, deleteDocs, restoreDocs,
} from "../firebase";
import { supabase } from "../lib/supabaseClient";
import {
  toMinor, fromMinor, round2, todayLocal, isIsoDate, parsePositiveAmount, computeFeePayment,
} from "./money";
import {
  SALARY_ACCOUNT_NAME, findAccountByName, feeIncomeAccount, splitPaymentByHead,
} from "./autoJournals";

// ---------------------------------------------------------------
// Errors
// ---------------------------------------------------------------

export class AccountingError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AccountingError";
    this.code = code;
  }
}

export const ERR = {
  NO_ACCOUNTS: "NO_ACCOUNTS",
  NO_CASH_ACCOUNTS: "NO_CASH_ACCOUNTS",
  ACCOUNT_REQUIRED: "ACCOUNT_REQUIRED",
  ACCOUNT_NOT_FOUND: "ACCOUNT_NOT_FOUND",
  NOT_CASH_ACCOUNT: "NOT_CASH_ACCOUNT",
  BAD_AMOUNT: "BAD_AMOUNT",
  BAD_DATE: "BAD_DATE",
  BAD_TYPE: "BAD_TYPE",
  LEDGER_LOOKUP: "LEDGER_LOOKUP",
  ALREADY_PAID: "ALREADY_PAID",
  UNPOSTED_PENDING: "UNPOSTED_PENDING",
  NOT_FOUND: "NOT_FOUND",
  NOT_REVERSIBLE: "NOT_REVERSIBLE",
  UPDATE_FAILED: "UPDATE_FAILED",
};

// ---------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------

const normalise = (s) => String(s || "").toLowerCase().replace(/&/g, " and ").replace(/\s+/g, " ").trim();

// Only real Bank & Cash accounts can receive or pay money. Fixed
// Assets, Accounts Receivable and friends are also type "Assets" but
// must never hold fee cash (ACC-08).
export function isBankCashAccount(a) {
  const sub = normalise(a?.subType);
  return sub === "bank and cash" || sub === "cash and bank";
}

export function bankCashAccounts(accounts) {
  return Array.isArray(accounts) ? accounts.filter(isBankCashAccount) : [];
}

// Human-readable reason the user cannot post right now, or "" if they can.
// `status` is "loading" | "ready" | "error" (see useAccounts).
export function describeAccountsProblem(accounts, status = "ready") {
  if (status === "loading") return "";
  if (status === "error") {
    return "The account list could not be loaded, so payments cannot be posted to the books. Reload and try again.";
  }
  if (!Array.isArray(accounts) || accounts.length === 0) {
    return "No accounts are visible. Either none exist yet (add a Bank & Cash account in Chart of Accounts) or your role cannot read accounts.";
  }
  if (bankCashAccounts(accounts).length === 0) {
    return "There is no Bank & Cash account to post into. Add one in Chart of Accounts (sub-type Bank & Cash).";
  }
  return "";
}

export { paymentInAccount } from "./paymentAccount";

/**
 * Resolve the account a payment will post to, by id (preferred) or by
 * exact name (legacy callers). Throws AccountingError when the list is
 * empty/unreadable, the account does not exist, or it is not Bank & Cash.
 * @returns {{id:string, name:string}}
 */
export function resolvePostingAccount(accounts, { accountId, accountName } = {}) {
  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new AccountingError(ERR.NO_ACCOUNTS, describeAccountsProblem(accounts));
  }
  const postable = bankCashAccounts(accounts);
  if (postable.length === 0) {
    throw new AccountingError(ERR.NO_CASH_ACCOUNTS, describeAccountsProblem(accounts));
  }
  if (accountId) {
    const acct = accounts.find((a) => a.id === accountId);
    if (!acct) throw new AccountingError(ERR.ACCOUNT_NOT_FOUND, "The selected account no longer exists. Choose another account.");
    if (!isBankCashAccount(acct)) {
      throw new AccountingError(ERR.NOT_CASH_ACCOUNT, `"${acct.name}" is not a Bank & Cash account, so money cannot be posted into it.`);
    }
    return { id: acct.id, name: acct.name };
  }
  if (accountName) {
    const matches = postable.filter((a) => normalise(a.name) === normalise(accountName));
    if (matches.length === 1) return { id: matches[0].id, name: matches[0].name };
    throw new AccountingError(
      matches.length === 0 ? ERR.ACCOUNT_NOT_FOUND : ERR.ACCOUNT_REQUIRED,
      matches.length === 0 ? `No Bank & Cash account named "${accountName}".` : `More than one account is named "${accountName}". Choose it from the list.`
    );
  }
  throw new AccountingError(ERR.ACCOUNT_REQUIRED, "Select the Bank & Cash account first.");
}

// Chart of accounts (id, name, type), cached briefly because bulk flows record
// many payments in a row. Only used to pick the income/expense account for the
// informational journals below; the payment itself is linked by account id
// chosen by the caller, never looked up by name.
let acctCache = { at: 0, rows: [] };
async function loadAccounts() {
  if (Date.now() - acctCache.at < 60000 && acctCache.rows.length) return acctCache.rows;
  const { data, error } = await supabase.from("accounts").select("id,name,type").is("deleted_at", null);
  if (error) throw error;
  acctCache = { at: Date.now(), rows: data || [] };
  return acctCache.rows;
}

// Remembered choice of receiving account (per-browser convenience only;
// nothing depends on it, and it is never used unless the account is
// still a valid Bank & Cash account).
const LAST_ACCOUNT_KEY = "erp.lastCashAccountId";

export function rememberAccountChoice(accountId) {
  try { if (accountId) window.localStorage.setItem(LAST_ACCOUNT_KEY, accountId); } catch { /* storage unavailable */ }
}

export function pickDefaultAccountId(postable) {
  const list = Array.isArray(postable) ? postable : [];
  let remembered = "";
  try { remembered = window.localStorage.getItem(LAST_ACCOUNT_KEY) || ""; } catch { /* storage unavailable */ }
  if (remembered && list.some((a) => a.id === remembered)) return remembered;
  return list.length === 1 ? list[0].id : ""; // never an arbitrary pick among several
}

// ---------------------------------------------------------------
// Low-level ledger row
// ---------------------------------------------------------------

/**
 * Record a money movement against a bank/cash account. Prefer the
 * higher-level helpers below; this is the one place a payments row is
 * actually written.
 *
 * @param {object} p
 * @param {"cash_in"|"cash_out"} p.type
 * @param {string} p.account      account NAME (kept for existing readers)
 * @param {string} [p.accountId]  account id (stable across renames)
 * @param {number|string} p.amount  must be > 0; rounded to 2 dp
 * @param {string} p.category
 * @param {string} p.description
 * @param {string} [p.reference]
 * @param {string} [p.branchId]
 * @param {string} [p.date]       YYYY-MM-DD (local); defaults to today (local)
 * @param {string} [p.source]     "invoice" | "expense" | "payslip"
 * @param {string} [p.sourceId]
 * @param {object} [p.extra]      additional fields (e.g. repostOf, importBatchId)
 * @returns {Promise<{id:string}>}
 */
export async function recordPayment({
  type, account, accountId = "", amount, category, description,
  reference = "", branchId = "", date, source = "", sourceId = "", extra = {},
}) {
  if (type !== "cash_in" && type !== "cash_out") throw new AccountingError(ERR.BAD_TYPE, "Payment type must be cash in or cash out");
  if (!account) throw new AccountingError(ERR.ACCOUNT_REQUIRED, "No account selected");
  const amt = parsePositiveAmount(amount);
  if (!amt.ok) throw new AccountingError(ERR.BAD_AMOUNT, amt.error);
  const when = date || todayLocal();
  if (!isIsoDate(when)) throw new AccountingError(ERR.BAD_DATE, "Enter a valid date");

  const ref = await addDoc(collection(db, "payments"), {
    ...extra,
    type,
    account,
    ...(accountId ? { accountId } : {}),
    amount: amt.value,
    category: category || "",
    description: description || "",
    reference,
    branchId,
    date: when,
    source,        // lets us trace a payment back to its origin
    sourceId,
    reversed: false,
    reversalOf: null,
    createdAt: serverTimestamp(),
  });

  // Fee collections and salaries also get an informational double-entry journal.
  // The payment above is the ONE row the books count for the money (trialBalance
  // ignores the journal while the payment stands). The journal is best effort and
  // written only AFTER the payment succeeded: its failure (e.g. no accounting
  // permission) never fails or unposts the payment; the backfill script in
  // supabase/ can post anything that was missed.
  try {
    await postPaymentJournals({
      id: ref.id, type, account, accountId, amount: amt.value, description, branchId,
      date: when, source, sourceId,
    });
  } catch (err) {
    console.warn("Payment recorded, but its journal entry was not posted:", err);
  }
  return ref;
}

// A manual (not document-linked) cash movement from the Payments page.
export async function postManualPayment({ accounts, accountId, type, amount, category, description, reference, branchId, date, extra }) {
  const acct = resolvePostingAccount(accounts, { accountId });
  return recordPayment({
    type, account: acct.name, accountId: acct.id, amount, category, description,
    reference: reference || "", branchId: branchId || "", date, extra,
  });
}

// ---------------------------------------------------------------
// Reading the ledger for one source document
// ---------------------------------------------------------------

// Find all live (non-trashed) payments for a source doc: originals,
// reversed originals and reversal rows.
export async function getSourcePayments(source, sourceId) {
  if (!sourceId) return [];
  const { data, error } = await supabase
    .from("payments")
    .select("*")
    .eq("source", source)
    .eq("source_id", sourceId)
    .is("deleted_at", null);
  if (error) throw error;
  return (data || []).map((r) => ({
    id: r.id, type: r.type, account: r.account, amount: Number(r.amount),
    accountId: r.account_id || r.extra?.accountId || "",
    reversed: r.reversed === true, reversalOf: r.reversal_of || null,
    repostOf: r.extra?.repostOf || null,
    category: r.category, description: r.description, reference: r.reference,
    branchId: r.branch_id, date: r.date, source: r.source, sourceId: r.source_id,
  }));
}

// Sum of net money posted for a source (cash_in positive, cash_out
// negative), ignoring entries that have been reversed and the
// reversal entries themselves. Used for an invoice's "paid so far".
export async function getSourcePaidTotal(source, sourceId) {
  const rows = await getSourcePayments(source, sourceId);
  return sumLive(rows);
}

// Exact (integer minor units) net of the rows that still count.
export function sumLive(rows) {
  let minor = 0;
  for (const r of rows || []) {
    if (r.reversed || r.reversalOf) continue;
    const m = toMinor(r.amount);
    if (!Number.isFinite(m)) continue;
    minor += r.type === "cash_in" ? m : -m;
  }
  return fromMinor(minor);
}

// Same read, but a failure is reported as a typed error: callers must
// not fall back to "assume nothing was paid" (that re-collects money).
async function readLedgerPaid(source, sourceId) {
  try {
    return await getSourcePaidTotal(source, sourceId);
  } catch (e) {
    throw new AccountingError(ERR.LEDGER_LOOKUP, "Could not read the payment ledger for this record, so nothing was posted. Check your connection and try again.");
  }
}

// ---------------------------------------------------------------
// Reversal (we never mutate a posted payment; ACC-02, ACC-14)
// ---------------------------------------------------------------

// Rows that exist only to cancel another row cannot themselves be reversed.
export const isReversalRow = (p) => !!(p && p.reversalOf);
// Rows created by an invoice / expense / payslip are changed only through that document.
export const isPostedBySource = (p) => !!(p && p.source);

// Post an equal-and-opposite entry for an existing payment and mark
// the original as reversed. Both rows stay in the ledger. Returns the
// reversal row id, or null when the payment was already reversed.
//
// Order matters: the original is CLAIMED first with a conditional
// update (so two concurrent reversals cannot both win), then the
// opposite row is inserted; if that insert fails the claim is undone.
export async function reversePayment(payment, { date } = {}) {
  if (!payment?.id) throw new AccountingError(ERR.NOT_FOUND, "Payment not found");
  if (payment.reversalOf) throw new AccountingError(ERR.NOT_REVERSIBLE, "A reversal entry cannot itself be reversed");
  const when = date || todayLocal();
  if (!isIsoDate(when)) throw new AccountingError(ERR.BAD_DATE, "Enter a valid date");

  const { data: claimed, error: e1 } = await supabase
    .from("payments")
    .update({ reversed: true })
    .eq("id", payment.id)
    .or("reversed.is.null,reversed.eq.false")
    .select("id");
  if (e1) throw e1;
  if (!claimed || claimed.length === 0) {
    // Either someone else already reversed it, or we may not update it.
    const { data: now, error: e2 } = await supabase.from("payments").select("reversed").eq("id", payment.id).maybeSingle();
    if (e2) throw e2;
    if (now && now.reversed === true) return null;
    throw new AccountingError(ERR.UPDATE_FAILED, "The payment could not be reversed (you may not have permission).");
  }

  try {
    const res = await addDoc(collection(db, "payments"), {
      type: payment.type === "cash_in" ? "cash_out" : "cash_in",
      account: payment.account,
      ...(payment.accountId ? { accountId: payment.accountId } : {}),
      amount: round2(payment.amount),
      category: (payment.category || "") + " (reversal)",
      description: "Reversal: " + (payment.description || ""),
      reference: payment.id,
      branchId: payment.branchId || "",
      date: when,
      source: payment.source || "",
      sourceId: payment.sourceId || "",
      reversed: false,
      reversalOf: payment.id,
      createdAt: serverTimestamp(),
    });
    // The payment's fee/salary journal goes with it. Only now that the reversal
    // is in the ledger (so a failed reversal never leaves a payment without its
    // journal) and best effort: the reversal itself has already happened.
    await deleteJournalsBySource("payment", payment.id)
      .catch((jerr) => console.warn("Could not remove journal entries for reversed payment:", jerr));
    return res.id;
  } catch (err) {
    try { await supabase.from("payments").update({ reversed: false }).eq("id", payment.id); } catch { /* best effort */ }
    throw err;
  }
}

// Reverse ALL live payments tied to a source (used when a paid
// invoice/payslip/expense is deleted, so the balance doesn't drift).
// Safe to call twice: rows already reversed are skipped.
export async function reverseSourcePayments(source, sourceId) {
  const rows = await getSourcePayments(source, sourceId);
  const toReverse = rows.filter((r) => !r.reversalOf && !r.reversed && !rows.some((x) => x.reversalOf === r.id));
  let n = 0;
  for (const p of toReverse) {
    const id = await reversePayment({ ...p, source, sourceId });
    if (id) n++;
  }
  return n;
}

// ---------------------------------------------------------------
// Restore from Trash re-posts what the delete reversed (ACC-03, CODE-10)
// ---------------------------------------------------------------

const SOURCE_FOR_COLLECTION = { invoices: "invoice", expenses: "expense", payslips: "payslip" };

export function ledgerSourceFor(collectionName) {
  return SOURCE_FOR_COLLECTION[collectionName] || "";
}

// For each original payment that the delete reversed, post a fresh
// entry (tagged repostOf) so the restored document's money is back in
// the books. Idempotent: originals already re-posted are skipped.
// Returns how many entries were re-posted or un-flagged.
export async function repostReversedPayments(source, sourceId) {
  const rows = await getSourcePayments(source, sourceId);
  const reversedOriginals = rows.filter((r) => r.reversed && !r.reversalOf);
  let n = 0;
  for (const orig of reversedOriginals) {
    if (rows.some((x) => x.repostOf === orig.id)) continue;
    const hasReversalRow = rows.some((x) => x.reversalOf === orig.id);
    if (!hasReversalRow) {
      // Legacy half-finished reversal (flag set, offsetting row never
      // written): the cash is still in the books, so just clear the flag.
      const { error } = await supabase.from("payments").update({ reversed: false }).eq("id", orig.id);
      if (error) throw error;
      n++;
      continue;
    }
    await recordPayment({
      type: orig.type,
      account: orig.account,
      accountId: orig.accountId,
      amount: orig.amount,
      category: orig.category || "",
      description: "Re-posted after restore: " + (orig.description || ""),
      reference: orig.id,
      branchId: orig.branchId || "",
      date: todayLocal(),
      source, sourceId,
      extra: { repostOf: orig.id },
    });
    n++;
  }
  return n;
}

/**
 * Restore a trashed document. Invoices, expenses and payslips first
 * get their reversed ledger entries re-posted so status and ledger
 * agree again; if the restore itself then fails, the re-posts are
 * reversed again.
 */
export async function restoreWithLedger(collectionName, id) {
  const source = ledgerSourceFor(collectionName);
  if (!source) {
    if (collectionName === "payments") {
      const { partners } = await restorePaymentWithPair(id);
      return { reposted: 0, partners };
    }
    await restoreDoc(doc(db, collectionName, id));
    return { reposted: 0 };
  }
  const before = await getSourcePayments(source, id);
  const reposted = await repostReversedPayments(source, id);
  try {
    await restoreDoc(doc(db, collectionName, id));
  } catch (err) {
    if (reposted > 0) {
      try {
        const after = await getSourcePayments(source, id);
        const fresh = after.filter((r) => r.repostOf && !before.some((b) => b.id === r.id) && !r.reversed);
        for (const r of fresh) await reversePayment({ ...r, source, sourceId: id });
      } catch { /* leave for manual follow-up; the original error is more useful */ }
    }
    throw err;
  }
  return { reposted };
}

// ---------------------------------------------------------------
// Delete / restore of reversed pairs (Payments "Delete", Trash "Restore")
// ---------------------------------------------------------------
// A reversed payment and its reversal entry cancel each other out, so they
// only mean something together. Deleting one side alone would move the
// account balance by the side that stays, and the 0011 guard refuses to
// un-flag an original once its reversal is gone. Delete therefore always
// takes the whole pair to Trash, whichever side was picked, and Restore
// brings the pair back. A live (un-reversed, non-reversal) row has no
// partner and goes alone; with 0011 applied the database refuses that and
// asks for a reversal instead.

// Ids of the rows linked to `rows` by a reversal (the reversal of each
// original, the original of each reversal), limited to the side of Trash
// asked for: live partners for Delete, trashed ones for Restore. The given
// rows themselves are never included.
async function reversalPartners(rows, { trashed }) {
  const picked = (rows || []).filter((r) => r && r.id);
  if (picked.length === 0) return [];
  const ids = picked.map((r) => r.id);
  const originals = [...new Set(picked.map((r) => r.reversalOf).filter(Boolean))];
  const q = (col, vals) => supabase.from("payments").select("id, deleted_at").in(col, vals);
  const [rev, orig] = await Promise.all([q("reversal_of", ids), originals.length ? q("id", originals) : { data: [] }]);
  if (rev.error) throw rev.error;
  if (orig.error) throw orig.error;
  const mine = new Set(ids);
  const out = new Set();
  for (const r of [...(rev.data || []), ...(orig.data || [])]) {
    if (!mine.has(r.id) && (r.deleted_at != null) === trashed) out.add(r.id);
  }
  return [...out];
}

// Move payments to Trash together with the live rows on the other side of
// their reversal link. Returns how many rows went and how many of them were
// partners pulled in beyond the rows picked.
export async function deletePaymentsWithPairs(rows) {
  const picked = (rows || []).filter((r) => r && r.id);
  if (picked.length === 0) return { deleted: 0, partners: 0 };
  const partners = await reversalPartners(picked, { trashed: false });
  const ids = [...new Set([...picked.map((r) => r.id), ...partners])];
  const deleted = await deleteDocs("payments", ids);
  return { deleted, partners: partners.length };
}

// Restore a trashed payment together with the trashed rows on the other side
// of its reversal link, so a reversed pair never comes back one-sided.
export async function restorePaymentWithPair(id) {
  const { data: row, error } = await supabase.from("payments").select("id, reversal_of, deleted_at").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!row) throw new AccountingError(ERR.NOT_FOUND, "Payment not found");
  const partners = await reversalPartners([{ id: row.id, reversalOf: row.reversal_of || null }], { trashed: true });
  const ids = [...new Set([row.id, ...partners])];
  const restored = await restoreDocs("payments", ids);
  if (!restored) throw new AccountingError(ERR.UPDATE_FAILED, "The payment could not be restored (it may not be in Trash, or you may not have permission).");
  return { restored, partners: partners.length };
}

// ---------------------------------------------------------------
// Document patches (merge into `extra`, never overwrite it)
// ---------------------------------------------------------------

// updateDoc() would REPLACE the whole `extra` jsonb with only the new
// extra keys, wiping studentName, lineItems and friends. updateDocs()
// merges, so every patch that may include an extra-only field uses it.
export async function patchDoc(collectionName, id, patch) {
  const n = await updateDocs(collectionName, [id], patch);
  if (!n) throw new AccountingError(ERR.UPDATE_FAILED, "The record could not be updated (it may have been deleted, or you may not have permission).");
}

// ---------------------------------------------------------------
// Fee collection: THE path that marks an invoice paid / partial
// ---------------------------------------------------------------

export const needsPosting = (invoice) => invoice?.ledgerPosted === false;

// Same wording the Fees page has always written, so existing ledgers read consistently.
const feeDescription = (inv) => `Fee — ${inv.studentName || "student"} (${inv.month || ""})`;

/**
 * Collect money (and/or grant a concession) against an existing invoice.
 *
 *  - reads what the ledger already holds for the invoice (a failed read
 *    blocks the payment instead of assuming 0),
 *  - validates amount, balance and overpayment in integer minor units,
 *  - requires a Bank & Cash account (by id) when cash is received,
 *  - posts the cash_in row and updates the invoice together,
 *  - undoes the cash_in if the invoice update fails.
 *
 * With `allowUnposted` and NO usable account list, the invoice is still
 * marked paid but stamped ledgerPosted:false (visible "Unposted" badge in
 * Fees, with a Post action for roles that can see accounts). An explicit
 * but invalid account choice is always an error.
 */
export async function collectInvoicePayment({
  invoice, accounts, accountId, amount, date, concession = false, concessionNote = "", allowUnposted = false,
  collectRemaining = false, // bulk "Mark Paid": collect whatever balance the ledger says is left
}) {
  if (!invoice?.id) throw new AccountingError(ERR.NOT_FOUND, "Invoice not found");
  if (needsPosting(invoice)) {
    throw new AccountingError(ERR.UNPOSTED_PENDING, "This invoice has a receipt that was never posted to the books. Post it to an account first.");
  }
  const when = date || todayLocal();
  if (!isIsoDate(when)) throw new AccountingError(ERR.BAD_DATE, "Enter a valid payment date");

  const already = await readLedgerPaid("invoice", invoice.id);
  let cashInput = amount === undefined || amount === null || amount === "" ? 0 : amount;
  if (collectRemaining) {
    const rem = toMinor(invoice.amount) - toMinor(already) - toMinor(invoice.concessionAmount || 0);
    if (!(rem > 0)) throw new AccountingError(ERR.BAD_AMOUNT, "This invoice has no balance left to collect");
    cashInput = fromMinor(rem);
  }
  const calc = computeFeePayment({
    total: invoice.amount,
    alreadyPaid: already,
    amount: cashInput,
    existingConcession: invoice.concessionAmount || 0,
    concession,
  });
  if (!calc.ok) throw new AccountingError(ERR.BAD_AMOUNT, calc.error);

  let acct = null;
  let posted = true;
  if (calc.cash > 0) {
    try {
      acct = resolvePostingAccount(accounts, { accountId });
    } catch (e) {
      const unavailable = e.code === ERR.NO_ACCOUNTS || e.code === ERR.NO_CASH_ACCOUNTS;
      if (allowUnposted && unavailable && !accountId) posted = false;
      else throw e;
    }
  }

  let paymentId = "";
  if (calc.cash > 0 && posted) {
    const res = await recordPayment({
      type: "cash_in", account: acct.name, accountId: acct.id, amount: calc.cash,
      category: "Fee Collection",
      description: feeDescription(invoice),
      reference: invoice.id, branchId: invoice.branchId || "", date: when,
      source: "invoice", sourceId: invoice.id,
    });
    paymentId = res.id;
  }

  const patch = {
    status: calc.status,
    paidAmount: calc.newPaid,
    paidDate: when,
    concessionAmount: calc.concessionTotal,
    concessionNote: concession ? (concessionNote || "Concession") : (invoice.concessionNote || ""),
  };
  if (acct) { patch.paidAccount = acct.name; patch.paidAccountId = acct.id; }
  if (calc.cash > 0) {
    patch.ledgerPosted = posted;
    patch.unpostedReason = posted ? "" : "No Bank & Cash account was available when this payment was received. It has not been posted to the books.";
  }

  try {
    await patchDoc("invoices", invoice.id, patch);
  } catch (err) {
    if (paymentId) {
      try {
        await reversePayment({
          id: paymentId, type: "cash_in", account: acct.name, accountId: acct.id, amount: calc.cash,
          category: "Fee Collection", description: feeDescription(invoice),
          branchId: invoice.branchId || "", source: "invoice", sourceId: invoice.id,
        });
      } catch { /* surfaced below */ }
    }
    throw new AccountingError(ERR.UPDATE_FAILED, "The payment could not be saved against the invoice and was not kept. " + (err?.message || ""));
  }

  return {
    status: calc.status, paidAmount: calc.newPaid, cash: calc.cash,
    concessionAdded: calc.concessionAdded, balance: calc.balance,
    posted: calc.cash > 0 ? posted : true, paymentId, accountName: acct?.name || "",
  };
}

/**
 * Create an invoice and receive its full payment in one go (Receive-now,
 * QuickPayment, Bulk Receive "Paid", Excel import of paid rows).
 * Account and amount are validated BEFORE anything is written; if the
 * collection fails after the invoice exists, the new invoice is moved
 * back to Trash so a retry cannot create a duplicate.
 */
export async function createInvoiceAndCollect({ invoiceData, accounts, accountId, date, allowUnposted = false, concessionNote = "", receivedAmount }) {
  const amt = parsePositiveAmount(invoiceData?.amount, "Invoice amount");
  if (!amt.ok) throw new AccountingError(ERR.BAD_AMOUNT, amt.error);
  // Normally the whole invoice is received; imports of part-paid invoices pass less.
  let received = amt;
  if (receivedAmount !== undefined && receivedAmount !== null) {
    received = parsePositiveAmount(receivedAmount, "Amount received");
    if (!received.ok) throw new AccountingError(ERR.BAD_AMOUNT, received.error);
    if (received.minor > amt.minor) throw new AccountingError(ERR.BAD_AMOUNT, "Amount received cannot exceed the invoice amount");
  }
  const when = date || todayLocal();
  if (!isIsoDate(when)) throw new AccountingError(ERR.BAD_DATE, "Enter a valid payment date");

  // fail fast, before any write
  try {
    resolvePostingAccount(accounts, { accountId });
  } catch (e) {
    const unavailable = e.code === ERR.NO_ACCOUNTS || e.code === ERR.NO_CASH_ACCOUNTS;
    if (!(allowUnposted && unavailable && !accountId)) throw e;
  }

  const base = {
    ...invoiceData,
    amount: amt.value,
    status: "pending",
    paidAmount: 0,
    paidDate: null,
    createdAt: serverTimestamp(),
  };
  const ref = await addDoc(collection(db, "invoices"), base);
  const invoice = { ...base, id: ref.id, concessionAmount: 0 };
  try {
    const result = await collectInvoicePayment({
      invoice, accounts, accountId, amount: received.value, date: when, allowUnposted, concessionNote,
    });
    return { id: ref.id, ...result };
  } catch (err) {
    try { await deleteDoc(doc(db, "invoices", ref.id)); } catch { /* best effort */ }
    throw err;
  }
}

/**
 * Post a receipt that was saved earlier as "paid but unposted"
 * (ledgerPosted:false) into a chosen Bank & Cash account.
 */
export async function postUnpostedInvoice({ invoice, accounts, accountId, date }) {
  if (!needsPosting(invoice)) throw new AccountingError(ERR.NOT_REVERSIBLE, "This invoice is already posted to the books.");
  const acct = resolvePostingAccount(accounts, { accountId });
  const ledgerPaid = await readLedgerPaid("invoice", invoice.id);
  const cashM = toMinor(invoice.paidAmount) - toMinor(ledgerPaid);
  const when = date || (isIsoDate(invoice.paidDate) ? invoice.paidDate : todayLocal());
  let paymentId = "";
  if (cashM > 0) {
    const res = await recordPayment({
      type: "cash_in", account: acct.name, accountId: acct.id, amount: fromMinor(cashM),
      category: "Fee Collection", description: feeDescription(invoice),
      reference: invoice.id, branchId: invoice.branchId || "", date: when,
      source: "invoice", sourceId: invoice.id,
    });
    paymentId = res.id;
  }
  try {
    await patchDoc("invoices", invoice.id, {
      ledgerPosted: true, unpostedReason: "", paidAccount: acct.name, paidAccountId: acct.id,
    });
  } catch (err) {
    if (paymentId) {
      try {
        await reversePayment({ id: paymentId, type: "cash_in", account: acct.name, accountId: acct.id, amount: fromMinor(cashM), source: "invoice", sourceId: invoice.id });
      } catch { /* surfaced below */ }
    }
    throw err;
  }
  return { paymentId, cash: fromMinor(Math.max(0, cashM)) };
}

// ---------------------------------------------------------------
// Salaries: idempotent payslip payment (ACC-09, CODE-14)
// ---------------------------------------------------------------

/**
 * Pay one payslip. Re-reads the payslip and the ledger first, so a
 * double click, a second tab, or a stale list cannot pay it twice:
 *  - payslip already paid            -> ALREADY_PAID error
 *  - cash_out already posted for it  -> no second posting; it is just
 *                                       marked paid (heals a failed update)
 */
export async function payPayslip({ payslip, accounts, accountId, date }) {
  if (!payslip?.id) throw new AccountingError(ERR.NOT_FOUND, "Payslip not found");
  const acct = resolvePostingAccount(accounts, { accountId });
  const when = date || todayLocal();
  if (!isIsoDate(when)) throw new AccountingError(ERR.BAD_DATE, "Enter a valid payment date");

  let fresh;
  try {
    const snap = await getDoc(doc(db, "payslips", payslip.id));
    if (!snap.exists()) throw new AccountingError(ERR.NOT_FOUND, "This payslip no longer exists.");
    fresh = { id: payslip.id, ...snap.data() };
  } catch (e) {
    if (e instanceof AccountingError) throw e;
    throw new AccountingError(ERR.LEDGER_LOOKUP, "Could not re-check the payslip before paying, so nothing was posted. Try again.");
  }
  if (fresh.status === "paid") throw new AccountingError(ERR.ALREADY_PAID, `${fresh.employeeName || "This payslip"} (${fresh.month} ${fresh.year}) is already paid.`);

  const amt = parsePositiveAmount(fresh.netPay, "Net pay");
  if (!amt.ok) throw new AccountingError(ERR.BAD_AMOUNT, amt.error);

  let existing;
  try { existing = await getSourcePayments("payslip", fresh.id); }
  catch { throw new AccountingError(ERR.LEDGER_LOOKUP, "Could not read the payment ledger, so nothing was posted. Try again."); }
  const alreadyPosted = existing.some((r) => !r.reversalOf && !r.reversed && r.type === "cash_out");

  let paymentId = "";
  if (!alreadyPosted) {
    const res = await recordPayment({
      type: "cash_out", account: acct.name, accountId: acct.id, amount: amt.value,
      category: "Salary",
      description: `Salary — ${fresh.employeeName || "employee"} (${fresh.month} ${fresh.year})`,
      reference: fresh.id, branchId: fresh.branchId || "", date: when,
      source: "payslip", sourceId: fresh.id,
    });
    paymentId = res.id;
  }
  try {
    await patchDoc("payslips", fresh.id, { status: "paid", paidDate: when, paidAccount: acct.name, paidAccountId: acct.id });
  } catch (err) {
    throw new AccountingError(ERR.UPDATE_FAILED, "The salary was posted but the payslip could not be marked paid. Retrying is safe: it will not pay twice. " + (err?.message || ""));
  }
  return { paymentId, healed: alreadyPosted, amount: amt.value };
}

// ---------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------

/**
 * Create an expense and, if an account is given, post the cash_out.
 * Account and amount are validated before anything is written. If the
 * posting fails after the expense exists, the expense is flagged
 * ledgerPosted:false and { posted:false, error } is returned so the
 * caller can show it (never a plain success toast).
 *
 * This is the ONLY place a paid expense is posted. Field names on the
 * expense (all land in `extra`): `accountId` = the chart-of-accounts
 * EXPENSE account the category was picked from (set by the caller),
 * `paidAccountId` / `paidAccount` = the Bank & Cash account paid from
 * (id / name, set here). The cash_out payment carries the Bank & Cash
 * `accountId`. A paid expense with a category account also gets an
 * informational double-entry journal (postExpenseJournal, best effort); the
 * cash_out payment stays the one source of truth for money (see below).
 */
export async function createExpenseAndPost({ expense, accounts, accountId }) {
  const amt = parsePositiveAmount(expense?.amount, "Amount");
  if (!amt.ok) throw new AccountingError(ERR.BAD_AMOUNT, amt.error);
  const when = expense.date || todayLocal();
  if (!isIsoDate(when)) throw new AccountingError(ERR.BAD_DATE, "Enter a valid date");
  const acct = accountId ? resolvePostingAccount(accounts, { accountId }) : null;

  const data = {
    ...expense,
    amount: amt.value,
    date: when,
    paidAccount: acct ? acct.name : "",
    ...(acct ? { paidAccountId: acct.id } : {}),
    createdAt: serverTimestamp(),
  };
  const ref = await addDoc(collection(db, "expenses"), data);
  if (!acct) return { id: ref.id, posted: false, paid: false };

  try {
    await recordPayment({
      type: "cash_out", account: acct.name, accountId: acct.id, amount: amt.value,
      category: expense.category || "Expense",
      description: expense.description || "Expense",
      reference: ref.id, branchId: expense.branchId || "", date: when,
      source: "expense", sourceId: ref.id,
    });
    // Informational double-entry record (debit the category's expense account,
    // credit the account paid from). Best effort: it never fails the expense,
    // and reporting/trialBalance ignore it while the cash_out payment stands.
    let journalPosted = false;
    const expenseAccount = expense.accountId ? (accounts || []).find((a) => a.id === expense.accountId) : null;
    if (expenseAccount) {
      try {
        await postExpenseJournal({
          expenseId: ref.id, expenseAccount, payAccount: acct, amount: amt.value, date: when,
          description: expense.description, branchId: expense.branchId || "",
        });
        journalPosted = true;
      } catch (jerr) {
        console.error("Expense journal not posted:", jerr);
      }
    }
    return { id: ref.id, posted: true, paid: true, journalPosted };
  } catch (err) {
    try { await patchDoc("expenses", ref.id, { ledgerPosted: false, unpostedReason: String(err?.message || "posting failed").slice(0, 200) }); } catch { /* flag best effort */ }
    return { id: ref.id, posted: false, paid: true, error: err };
  }
}

// ---- Double-entry journals for expenses ----
//
// A paid expense is ALSO recorded as a journal (debit the expense account from
// the chart, credit the Bank & Cash account paid from), tagged source "expense"
// + sourceId so it can be traced, retargeted and removed with its expense, and
// shown as a read-only "Auto" row on the Journals page. It is informational:
// the cash_out payment written by createExpenseAndPost is the ONE row the
// books count for money. trialBalance (reporting.js) and the monthly statement
// skip an expense journal while its payment stands, so nothing is counted twice.
export async function postExpenseJournal({
  expenseId, expenseAccount, payAccount, amount, date, description, branchId = "",
}) {
  if (!expenseId || !expenseAccount?.name || !payAccount?.name) return null;
  if (!amount || Number(amount) <= 0) return null;
  return addDoc(collection(db, "journals"), {
    date: date || todayLocal(),
    reference: "EXP-" + String(expenseId).slice(0, 8),
    description: description || "Expense",
    debitAccount: expenseAccount.name,
    creditAccount: payAccount.name,
    ...(expenseAccount.id ? { debitAccountId: expenseAccount.id } : {}),
    ...(payAccount.id ? { creditAccountId: payAccount.id } : {}),
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

// Keep existing legacy expense journals in step with a bulk edit of their
// expenses: `accountName` re-points the debit side, `date` moves the entry.
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
// INFORMATIONAL, like the expense journal above: the cash_in / cash_out payment
// is the ONE row the books count for the money, and trialBalance ignores one of
// these journals while its payment stands (reporting.js). They are keyed by the
// payment (source "payment", sourceId = payment id), so reversing the payment
// takes its journals to Trash (reversePayment) and a restore that re-posts the
// payment journals it again. Nothing is posted when the chart has no matching
// account; we never guess an account. Called by recordPayment only after the
// payment row is saved, and never allowed to fail it.
export async function postPaymentJournals(p) {
  if (!p?.id || !(Number(p.amount) > 0)) return;
  const isSalary = p.source === "payslip" && p.type === "cash_out";
  const isFee = p.source === "invoice" && p.type === "cash_in";
  if (!isSalary && !isFee) return;

  const accounts = await loadAccounts();
  const bank = (p.accountId && accounts.find((a) => a.id === p.accountId)) || findAccountByName(accounts, p.account);
  if (!bank) return;
  const base = {
    date: p.date,
    reference: (isSalary ? "SAL-" : "FEE-") + String(p.id).slice(0, 8),
    description: p.description || "",
    notes: "Auto-posted from " + (isSalary ? "Payslips" : "Fees"),
    branchId: p.branchId || "",
    source: "payment",
    sourceId: p.id,
  };
  // Debit/credit are linked by id (stable across renames) and by name (legacy readers).
  const entry = (debit, credit, amount) => addDoc(collection(db, "journals"), {
    ...base,
    debitAccount: debit.name, creditAccount: credit.name,
    ...(debit.id ? { debitAccountId: debit.id } : {}),
    ...(credit.id ? { creditAccountId: credit.id } : {}),
    amount,
    createdAt: serverTimestamp(),
  });

  try {
    if (isSalary) {
      const salary = findAccountByName(accounts, SALARY_ACCOUNT_NAME, "Expenses");
      if (salary) await entry(salary, bank, p.amount);
      return;
    }
    const { data: inv } = await supabase.from("invoices").select("extra").eq("id", p.sourceId).maybeSingle();
    for (const part of splitPaymentByHead(p.amount, inv?.extra?.lineItems)) {
      const income = feeIncomeAccount(part.head, accounts);
      if (income) await entry(bank, income, part.amount);
    }
  } catch (err) {
    // Do not leave half of a split behind.
    await deleteJournalsBySource("payment", p.id).catch(() => {});
    throw err;
  }
}
