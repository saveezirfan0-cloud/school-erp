#!/usr/bin/env python3
"""
Turn the JSON written by build_historical_import.py into small, self-verifying
SQL statements that can be run one after another (SQL editor, psql, or an MCP
execute_sql tool).

Each statement:
  * carries its rows as one pipe/newline separated text literal,
  * aborts if md5(text) differs from the expected checksum (so a copy/paste
    slip can never silently change data),
  * recomputes every id as md5('<kind>:<seq>')::uuid (links between rows are
    therefore resolved server-side, no uuids travel in the payload),
  * inserts rows *staged*: deleted_at = now() and extra.staged = true, so they
    stay hidden until activate_historical_import.sql is run,
  * uses "on conflict (id) do nothing", so re-running a statement is harmless.

Usage: python3 scripts/make_sql_chunks.py <out dir from the builder> [--max-bytes 24000]
Writes <out>/sql/NNN_<table>.sql, <out>/sql/manifest.json and expected.json.
"""
import argparse, hashlib, json, os, re

BANEEN = "3f9a8de1-664c-4686-a010-8f573ed76584"
BNAT = "9f38c9ca-d8a5-4736-aef3-ba0ec3c603a5"
SCHOOL = "1efac7a2-1409-42eb-af92-66367d8c1104"
BR_SQL = "case %s when 'N' then '" + BNAT + "' when 'S' then '" + SCHOOL + "' when 'B' then '" + BANEEN + "' end"
BR_LETTER = {BANEEN: "B", BNAT: "N", SCHOOL: "S", None: "", "": ""}


def clean(v):
    return re.sub(r"[\s|~;]+", " ", str(v if v is not None else "")).strip()


def ts_sql(col):
    return "(%s||'T12:00:00+00')::timestamptz" % col


def line(*vals):
    return "|".join(clean(v) for v in vals)


# ---- per table: row -> text line, and the INSERT ... SELECT that decodes it ----
def students(r):
    e = r["extra"]
    return line(r["_n"], r["name"], r["student_id"], r["grade"], r["monthly_fee"], ",".join(e["ledgers"]),
                e.get("firstInvoice"), e.get("lastInvoice"), r["created_at"][:10])


SQL_STUDENTS = """insert into public.students (id, name, student_id, grade, parent_name, parent_phone, email, branch_id, monthly_fee, address, dob, recurring_fee, extra, created_at, updated_at, deleted_at)
select md5('student:'||f[1])::uuid, f[2], nullif(f[3],''), nullif(f[4],''), null, null, null, '%s', f[5]::numeric, null, null, false,
  jsonb_strip_nulls(jsonb_build_object('historical',true,'source','manager.io','status','inactive','ledgers',to_jsonb(string_to_array(f[6],',')),'firstInvoice',nullif(f[7],''),'lastInvoice',nullif(f[8],''),'staged',true)),
  %s, %s, now()""" % (BANEEN, ts_sql("f[9]"), ts_sql("f[9]"))


def employees(r):
    e = r["extra"]
    return line(r["_n"], r["name"], BR_LETTER[r["branch_id"]], e.get("salary", 0), e.get("joinDate"), ",".join(e["ledgers"]),
                e.get("managerCode"), e.get("division"), 1 if r["_hist"] else 0, r["created_at"][:10])


SQL_EMPLOYEES = """insert into public.employees (id, name, branch_id, extra, created_at, updated_at, deleted_at)
select md5('employee:'||f[1])::uuid, f[2], %s,
  jsonb_strip_nulls(jsonb_build_object('role','','phone','','email','','salary',f[4]::numeric,'joinDate',f[5],'recurringPayslip',false,'source','manager.io','ledgers',to_jsonb(string_to_array(f[6],',')),'managerCode',nullif(f[7],''),'division',nullif(f[8],''),'staged',true))
    || case when f[9]='1' then '{"historical":true,"status":"inactive"}'::jsonb else '{}'::jsonb end,
  %s, %s, now()""" % (BR_SQL % "f[3]", ts_sql("f[10]"), ts_sql("f[10]"))


def invoices(r):
    e = r["extra"]
    items = ";".join("%s~%s" % (clean(i["description"]), i["amount"]) for i in e["lineItems"])
    return "|".join([clean(r["_n"]), clean(r["_stu"]), clean(r["date"]), clean(r["amount"]), clean(r["status"]), clean(r["paid_amount"]),
                     clean(r["paid_account"]), clean(r["paid_date"]), clean(e["ledger"]), clean(e.get("managerRef")), clean(e.get("notes")),
                     clean(e["studentName"]), items])


SQL_INVOICES = """insert into public.invoices (id, student_id, branch_id, amount, status, due_date, date, paid_amount, paid_account, paid_date, concession_amount, concession_note, extra, created_at, updated_at, deleted_at)
select md5('invoice:'||f[1])::uuid, case when left(f[2],1)='L' then substr(f[2],2) else md5('student:'||f[2])::uuid::text end, '%s',
  f[4]::numeric, f[5], null, f[3], f[6]::numeric, nullif(f[7],''), nullif(f[8],''), 0, null,
  jsonb_strip_nulls(jsonb_build_object('historical',true,'source','manager.io','ledger',f[9],'year',extract(year from f[3]::date)::int,'month',trim(to_char(f[3]::date,'Month')),'studentName',f[12],
    'lineItems',(select jsonb_agg(jsonb_build_object('description',split_part(x,'~',1),'amount',split_part(x,'~',2)::numeric)) from unnest(string_to_array(f[13],';')) x),
    'managerRef',nullif(f[10],''),'notes',nullif(f[11],''),'staged',true)),
  %s, %s, now()""" % (BANEEN, ts_sql("f[3]"), ts_sql("f[3]"))


def payslips(r):
    e = r["extra"]
    return line(r["_n"], r["_emp"], r["date"], r["amount"], r["status"], r["paid_account"], r["paid_date"], e["ledger"], e.get("managerRef"),
                r["_basic"], r["_other"], e.get("notes"), e["employeeName"], BR_LETTER[r["branch_id"]])


SQL_PAYSLIPS = """insert into public.payslips (id, employee_id, branch_id, amount, month, date, status, paid_account, paid_date, extra, created_at, updated_at, deleted_at)
select md5('payslip:'||f[1])::uuid, md5('employee:'||f[2])::uuid::text, %s, f[4]::numeric, trim(to_char(f[3]::date,'Month')), f[3], f[5], nullif(f[6],''), nullif(f[7],''),
  jsonb_strip_nulls(jsonb_build_object('historical',true,'source','manager.io','ledger',f[8],'employeeName',f[13],'role','','year',extract(year from f[3]::date)::int,
    'basicSalary',f[10]::numeric,'allowances',f[11]::numeric,'deductions',0,'netPay',f[4]::numeric,'notes',nullif(f[12],''),'managerRef',nullif(f[9],''),'staged',true)),
  %s, %s, now()""" % (BR_SQL % "f[14]", ts_sql("f[3]"), ts_sql("f[3]"))


def expenses(r):
    e = r["extra"]
    return line(r["_n"], r["description"], r["category"], r["amount"], r["date"], BR_LETTER[r["branch_id"]], r["paid_account"],
                e["ledger"], e.get("managerRef"), e.get("notes"))


SQL_EXPENSES = """insert into public.expenses (id, description, category, amount, date, branch_id, paid_account, extra, created_at, updated_at, deleted_at)
select md5('expense:'||f[1])::uuid, f[2], f[3], f[4]::numeric, f[5], %s, nullif(f[7],''),
  jsonb_strip_nulls(jsonb_build_object('historical',true,'source','manager.io','ledger',f[8],'notes',nullif(f[10],''),'managerRef',nullif(f[9],''),'staged',true)),
  %s, %s, now()""" % (BR_SQL % "f[6]", ts_sql("f[5]"), ts_sql("f[5]"))


def payments(r):
    e = r["extra"]
    return line(r["_n"], "i" if r["type"] == "cash_in" else "o", r["account"], r["category"], r["description"], r["amount"], r["date"],
                r["_tok"], BR_LETTER[r["branch_id"]], r["_src"], e["ledger"], e.get("managerRef"))


SQL_PAYMENTS = """insert into public.payments (id, type, account, description, category, amount, date, reference, branch_id, source, source_id, reversed, reversal_of, extra, created_at, updated_at, deleted_at)
select md5('payment:'||f[1])::uuid, case f[2] when 'i' then 'cash_in' else 'cash_out' end, f[3], f[5], f[4], f[6]::numeric, f[7],
  coalesce(sid, nullif(f[8],'')), %s, nullif(f[10],''), sid, false, null,
  jsonb_strip_nulls(jsonb_build_object('historical',true,'source','manager.io','ledger',f[11],'managerRef',nullif(f[12],''),'staged',true)),
  %s, %s, now()
from (select f, case when f[10]<>'' then md5((case left(f[8],1) when 'I' then 'invoice' when 'E' then 'expense' when 'S' then 'payslip' else 'transfer' end)||':'||substr(f[8],2))::uuid::text end sid
      from (select string_to_array(l,'|') f from regexp_split_to_table(d, E'\\n') l where l <> '') a) s""" % (BR_SQL % "f[9]", ts_sql("f[7]"), ts_sql("f[7]"))

TABLES = [("students", students, SQL_STUDENTS), ("employees", employees, SQL_EMPLOYEES), ("invoices", invoices, SQL_INVOICES),
          ("payslips", payslips, SQL_PAYSLIPS), ("expenses", expenses, SQL_EXPENSES), ("payments", payments, SQL_PAYMENTS)]


def statement(sql_insert, payload):
    if "from (select f," in sql_insert:      # payments already wraps its own subquery
        body = sql_insert
    else:
        body = sql_insert + "\nfrom (select string_to_array(l,'|') f from regexp_split_to_table(d, E'\\n') l where l <> '') s"
    assert "$dat$" not in payload
    return ("do $zmi$\ndeclare d text := $dat$%s$dat$;\nbegin\n"
            "  if md5(d) <> '%s' then raise exception 'checksum mismatch %%', md5(d); end if;\n"
            "  %s\n  on conflict (id) do nothing;\nend $zmi$;\n") % (payload, hashlib.md5(payload.encode()).hexdigest(), body.replace("\n", "\n  "))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dir")
    ap.add_argument("--max-bytes", type=int, default=24000)
    a = ap.parse_args()
    out = os.path.join(a.dir, "sql")
    os.makedirs(out, exist_ok=True)
    for f in os.listdir(out):
        os.remove(os.path.join(out, f))
    manifest, expected, nfile = [], {}, 0
    for table, fmt, sql in TABLES:
        rows = json.load(open(os.path.join(a.dir, table + ".json"), encoding="utf-8"))
        kind = {"students": "student", "employees": "employee", "invoices": "invoice", "payslips": "payslip", "expenses": "expense", "payments": "payment"}[table]
        for r in rows:   # the SQL recomputes ids from the sequence number: make sure they agree
            assert r["id"] == str(__import__("uuid").UUID(hashlib.md5(("%s:%s" % (kind, r["_n"])).encode()).hexdigest())), (table, r["_n"])
        lines = [fmt(r) for r in rows]
        expected[table] = dict(count=len(rows), amount=sum(r.get("amount") or 0 for r in rows))
        chunk, size = [], 0
        def flush():
            nonlocal chunk, size, nfile
            if not chunk:
                return
            nfile += 1
            payload = "\n".join(chunk)
            fn = "%03d_%s.sql" % (nfile, table)
            open(os.path.join(out, fn), "w", encoding="utf-8").write(statement(sql, payload))
            manifest.append(dict(file=fn, table=table, rows=len(chunk), bytes=len(payload.encode()), md5=hashlib.md5(payload.encode()).hexdigest()))
            chunk, size = [], 0
        for ln in lines:
            if size + len(ln.encode()) + 1 > a.max_bytes:
                flush()
            chunk.append(ln); size += len(ln.encode()) + 1
        flush()
    json.dump(manifest, open(os.path.join(out, "manifest.json"), "w"), indent=1)
    json.dump(expected, open(os.path.join(a.dir, "expected.json"), "w"), indent=1)
    print("%d statements, %d bytes of payload" % (len(manifest), sum(m["bytes"] for m in manifest)))
    for t in expected:
        print("  %-10s %s" % (t, expected[t]))


if __name__ == "__main__":
    main()
