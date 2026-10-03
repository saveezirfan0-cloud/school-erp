// Pure helper (no Supabase/Firebase imports) so it can be used from any util.
//
// Does this payment belong to this chart-of-accounts account? Matches by id
// when the payment has one (survives renames); older payments fall back to name.
export function paymentInAccount(payment, account) {
  return payment.accountId ? payment.accountId === account.id : payment.account === account.name;
}
