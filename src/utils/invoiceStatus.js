// Status an invoice should have once its total changes, given what has been
// received and conceded so far.
export function deriveInvoiceStatus(total, received, conceded = 0) {
  if (received + conceded + 0.001 >= total) return "paid";
  return received > 0 ? "partial" : "pending";
}
