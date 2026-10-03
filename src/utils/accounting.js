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
  db, addDoc, collection, serverTimestamp, doc, getDoc, deleteDoc, restoreDoc, updateDocs,
} from "../firebase";
import { supabase } from "../lib/supabaseClient";
import {
  toMinor, fromMinor, round2, todayLocal, isIsoDate, parsePositiveAmount, computeFeePayment,
} from "./money";

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

  return addDoc(collection(db, "payments"), {
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
    return { id: ref.id, posted: true, paid: true };
  } catch (err) {
    try { await patchDoc("expenses", ref.id, { ledgerPosted: false, unpostedReason: String(err?.message || "posting failed").slice(0, 200) }); } catch { /* flag best effort */ }
    return { id: ref.id, posted: false, paid: true, error: err };
  }
}
