// Pure helper (no Supabase/Firebase imports) so it can be used from any util.
//
// Does this payment belong to this chart-of-accounts account? Same rule as
// reporting.attributePayments (the id wins; the NAME is only a fallback for
// older rows that have no id, compared trimmed), so a single-account check and
// a whole-book attribution cannot disagree. Use attributePayments when you
// have the full account list: it also sends name-only rows to exactly one
// account when two accounts share a name and flags rows whose account is gone.
export function paymentInAccount(payment, account) {
  const id = payment.accountId || payment.account_id || "";
  if (id) return id === account.id;
  return String(payment.account || "").trim() === String(account.name || "").trim();
}
