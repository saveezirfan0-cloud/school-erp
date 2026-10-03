# Importing the Manager.io history

Loads the old Manager.io books (`.manager` backups) into the ERP without touching current-year data.

## How the app keeps history separate

Every imported row carries `extra.historical = true` (employees seen in the latest ledger are the one
exception: they are normal rows). The Firestore shim (`src/firebase.js`) hides historical rows from every
list read unless the **History** toggle in the navbar is on, so Dashboard, Reports, Bank & Cash balances and
pending-fee totals are unchanged by default.

## Pipeline

```
python3 scripts/build_historical_import.py <dir with .manager files> --current-students current_students.txt --out out/
python3 scripts/make_sql_chunks.py out/
# run out/sql/NNN_*.sql in order (SQL editor / psql / MCP execute_sql)
# verify counts and sums against out/expected.json
# then run scripts/activate_historical_import.sql
```

* `current_students.txt` is one line per existing student: `id|name|grade|fee|DEL?`. Customers whose
  normalised name matches a live current student are linked to it (their invoices point at the existing
  student id) and no student row is created - current students are never modified.
* The builder reconciles money in/out with the totals in the Manager books and prints the result.
* Each SQL statement carries the md5 of its payload and aborts on a mismatch, recomputes ids as
  `md5('<kind>:<seq>')::uuid`, and inserts rows *staged* (`deleted_at` set, `extra.staged = true`) so they are
  invisible to every version of the app until `activate_historical_import.sql` is run. Re-running a
  statement is harmless (`on conflict (id) do nothing`).
* To undo everything: `delete from <table> where extra->>'source' = 'manager.io'` for students, employees,
  invoices, payslips, expenses and payments.

## Mapping notes

* Fee invoices come from Manager sales invoices; paid / partial / pending is derived from receipt lines that
  reference the invoice. Receipts also become `payments` rows (`cash_in`, linked by `source = invoice`).
* Payments to expense accounts become an `expenses` row plus a linked `payments` row (as the app does).
  Payments to employees are allocated first-in-first-out to payslips (`source = payslip`).
* Transfers between cash accounts become a `cash_out` / `cash_in` pair (`Bank Transfer`).
* Opening balances are not imported.
* Branch is set only where the evidence is direct (student-linked rows -> Baneen, the Banaat ledger -> Bnat);
  everything else is left unassigned.
