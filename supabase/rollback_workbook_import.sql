-- Rolls back the ledger import made from the Accounts workbook
-- (scripts/extract_workbook_ledger.py). Every imported row carries
-- extra.importBatch, so nothing else is touched.
--   xlsx-2026-10-03-hist : Jan-Jul 2026, tagged historical (hidden unless the History toggle is on)
--   xlsx-2026-10-03-cur  : Aug-Sep 2026 entries that are not student fees (student fees live in invoices)
-- Review the counts first, then run the deletes.

select extra->>'importBatch' batch, count(*) from payments
 where extra->>'importBatch' like 'xlsx-2026-10-03-%' group by 1;

delete from payments where extra->>'importBatch' like 'xlsx-2026-10-03-%';
delete from expenses where extra->>'importBatch' like 'xlsx-2026-10-03-%';
