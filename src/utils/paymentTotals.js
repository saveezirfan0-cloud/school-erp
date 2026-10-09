// Totals for the Payments summary cards.
//
// Reversing a payment keeps the original row (flagged `reversed`) and adds an
// equal-and-opposite row (`reversalOf` set). Both stay in the ledger as the
// audit trail, but together they are money that never moved, so the cards
// count neither of them.
import { sumMoney, subMoney } from "./money";

export const isCountedPayment = (p) => !!p && !p.reversed && !p.reversalOf;

export function summarizePayments(rows = []) {
  const live = rows.filter(isCountedPayment);
  const totalIn = sumMoney(live.filter((p) => p.type === "cash_in").map((p) => p.amount));
  const totalOut = sumMoney(live.filter((p) => p.type === "cash_out").map((p) => p.amount));
  return { totalIn, totalOut, net: subMoney(totalIn, totalOut) };
}
