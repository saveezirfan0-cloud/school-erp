#!/usr/bin/env python3
"""
Build the historical import for the school ERP from the Manager.io backups.

Reads the four ZMI ledgers and writes one JSON file per ERP table (rows use the
exact database column names) plus report.txt with counts and reconciliation
totals. Nothing is sent to the database here.

Every row is tagged extra.historical = true / extra.source = "manager.io" so the
app hides it unless the History toggle is on. Ids are deterministic (uuid5), so
re-running produces the same ids and the loader's "on conflict do nothing"
makes the import idempotent.

Usage:
  python3 scripts/build_historical_import.py <dir with .manager files> \
      --current-students current_students.txt --out out/

current_students.txt: one line per existing student, "id|name|...|...|DEL?".
Customers whose normalised name matches a live current student are linked to
that student's id and no student row is created (current students are never
modified).
"""
import argparse, collections, csv, datetime, difflib, hashlib, itertools, json, os, re, sys, uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from manager_extract import Ledger, norm_name  # noqa: E402

NS = uuid.UUID("5f0c1c1e-7d3a-4f60-9b1e-5a0a11a5e5d1")
BANEEN = "3f9a8de1-664c-4686-a010-8f573ed76584"
BNAT = "9f38c9ca-d8a5-4736-aef3-ba0ec3c603a5"
SCHOOL = "1efac7a2-1409-42eb-af92-66367d8c1104"

LEDGERS = [  # (tag, file, branch for rows that can't be attributed otherwise)
    ("main", "Zohra Majeed Islamic Institute.manager", None),
    ("banaat", "Zohra Majeed Islamic Institute (Banaat).manager", BNAT),
    ("y2324", "Zohra Majeed Islamic Institute (2023-2024).manager", None),
    ("y2425", "ZMI - Banat 24-25.manager", None),
]
LATEST = "y2425"
MONTHS = ["January", "February", "March", "April", "May", "June", "July",
          "August", "September", "October", "November", "December"]


def uid(kind, n):
    """Deterministic id = md5('<kind>:<n>')::uuid, recomputable in SQL."""
    return str(uuid.UUID(hashlib.md5(("%s:%s" % (kind, n)).encode()).hexdigest()))


def clean(v):
    """Make a value safe for the pipe/newline separated chunk format."""
    return re.sub(r"[|\r\n\t~;]+", " ", str(v if v is not None else "")).strip()


def month_name(iso):
    return MONTHS[int(iso[5:7]) - 1]


def ts(iso):
    return iso + "T12:00:00+00:00"


def is_placeholder(name):
    return bool(re.search(r"\bsales\b", name.lower()))


def acct_branch(account, ledger_branch):
    """Branch for a row not tied to a student: only where the evidence is direct."""
    a = (account or "").lower()
    if ledger_branch:
        return ledger_branch
    if a.startswith("school"):
        return SCHOOL
    if "banat" in a or "bnat" in a or a.startswith("b-153"):
        return BNAT
    return ""


def base_extra(ledger, key, **kw):
    e = dict(historical=True, source="manager.io", ledger=ledger)
    if key:
        e["managerKey"] = key
    e.update({k: v for k, v in kw.items() if v not in (None, "")})
    return e


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dir")
    ap.add_argument("--current-students", required=True)
    ap.add_argument("--chart", default=os.path.join(os.path.dirname(__file__), "..", "data", "manager_chart_of_accounts.csv"))
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)

    chart_type = {r["name"].lower(): r["type"] for r in csv.DictReader(open(a.chart, encoding="utf-8"))}

    # ---- current students (never modified) --------------------------------
    cur = collections.defaultdict(list)
    for ln in open(a.current_students, encoding="utf-8"):
        p = ln.rstrip("\n").split("|")
        if len(p) >= 5 and p[4] != "DEL":
            cur[norm_name(p[1])].append(dict(id=p[0], grade=p[2]))

    base = os.path.dirname(next(
        os.path.join(r, LEDGERS[0][1]) for r, _, fs in os.walk(a.dir) if LEDGERS[0][1] in fs))
    L = {tag: Ledger(os.path.join(base, f)) for tag, f, _ in LEDGERS}
    lb = {tag: b for tag, _, b in LEDGERS}
    report = []

    def rep(s=""):
        report.append(s)
        print(s)

    # ---- students ----------------------------------------------------------
    cust = {}  # (tag,key) -> customer dict
    for tag in L:
        for k, c in L[tag].customers().items():
            cust[(tag, k)] = dict(c, tag=tag)
    invoices = {tag: L[tag].invoices() for tag in L}
    receipts = {tag: L[tag].receipts() for tag in L}
    payments = {tag: L[tag].payments() for tag in L}
    transfers = {tag: L[tag].transfers() for tag in L}
    payslips = {tag: L[tag].payslips() for tag in L}

    # Customers are keyed by normalised name. Manager has typos and an "xx-"
    # prefix on some names, so first merge spellings that share a student code
    # AND are at least 80% similar (genuinely different people sharing a code
    # stay separate). alias: any normalised spelling -> canonical spelling.
    def base_norm(name):
        return re.sub(r"^xx[-\s]+", "", norm_name(name))

    order = {t: i for i, (t, _, _) in enumerate(LEDGERS)}
    alias, by_code = {}, collections.defaultdict(set)
    for (tag, k), c in sorted(cust.items(), key=lambda x: order[x[0][0]]):
        n0 = base_norm(c["name"])
        alias[n0] = n0
        code = re.sub(r"\D", "", c["code"] or "").lstrip("0")
        if n0 and code and not is_placeholder(c["name"]):
            by_code[code].add(n0)

    def find(x):
        while alias[x] != x:
            alias[x] = alias[alias[x]]
            x = alias[x]
        return x

    for code, names in by_code.items():
        names = sorted(names)
        for i, a1 in enumerate(names):
            for b1 in names[i + 1:]:
                if difflib.SequenceMatcher(None, a1, b1).ratio() >= 0.8:
                    alias[find(b1)] = find(a1)

    def canon(name):
        return find(base_norm(name)) if base_norm(name) in alias else base_norm(name)

    students = {}   # canonical norm -> aggregate
    merged_from = collections.defaultdict(set)
    for (tag, k), c in sorted(cust.items(), key=lambda x: order[x[0][0]]):
        n = canon(c["name"])
        if not n or is_placeholder(c["name"]):
            continue
        merged_from[n].add(base_norm(c["name"]))
        s = students.setdefault(n, dict(norm=n, name=c["name"], code="", grade="", fee=0, ledgers=[],
                                        first=None, last=None))
        s["name"] = re.sub(r"^xx[-\s]+", "", c["name"].strip(), flags=re.I)   # latest spelling wins
        s["code"] = c["code"] or s["code"]
        s["grade"] = c["division"] or s["grade"]
        if tag not in s["ledgers"]:
            s["ledgers"].append(tag)
    # fee + grade + active span from invoices
    for tag in L:
        for iv in sorted(invoices[tag].values(), key=lambda i: i["date"]):
            c = cust.get((tag, iv["customer"]))
            if not c:
                continue
            s = students.get(canon(c["name"]))
            if not s:
                continue
            fee = [l for l in iv["lines"] if "admission" not in l["item"].lower()]
            if fee:
                s["fee"] = fee[0]["price"]
            div = next((l["division"] for l in iv["lines"] if l["division"]), "")
            s["grade"] = div or s["grade"]
            s["first"] = min(s["first"] or iv["date"], iv["date"])
            s["last"] = max(s["last"] or iv["date"], iv["date"])

    student_id_of = {}   # norm -> ERP id
    student_tok = {}     # norm -> "<seq>" for new students, "L<uuid>" for linked current students
    student_rows, linked = [], 0
    new_seq = itertools.count(1)
    for n in sorted(students):
        s = students[n]
        matches = [m for sp in sorted(merged_from[n] | {n}) for m in cur.get(sp, [])]
        if matches:
            sid = next((m["id"] for m in matches if m["grade"].lower().replace("-", " ") == s["grade"].lower()), matches[0]["id"])
            student_id_of[n] = sid
            student_tok[n] = "L" + sid
            linked += 1
            s["linked"] = True
            continue
        seq = next(new_seq)
        sid = uid("student", seq)
        student_id_of[n] = sid
        student_tok[n] = str(seq)
        d = s["first"] or "2022-11-13"
        student_rows.append(dict(
            _n=seq, id=sid, name=s["name"], student_id=s["code"] or None, grade=s["grade"] or None,
            parent_name=None, parent_phone=None, email=None, branch_id=BANEEN,
            monthly_fee=s["fee"], address=None, dob=None, recurring_fee=False,
            extra=dict(historical=True, source="manager.io", status="inactive",
                       ledgers=s["ledgers"], firstInvoice=s["first"], lastInvoice=s["last"]),
            created_at=ts(d), updated_at=ts(d)))
    rep("STUDENTS: %d distinct historical students; %d linked to existing current students (not modified); %d new rows"
        % (len(students), linked, len(student_rows)))

    def student_of(tag, ckey):
        c = cust.get((tag, ckey))
        if not c:
            return None
        n = canon(c["name"])
        return (n, students[n]["name"]) if n in student_id_of else None

    # ---- employees ----------------------------------------------------------
    emp = {}   # norm -> agg
    emp_key = {}  # (tag,key) -> norm
    for tag in L:
        for k, e in sorted(L[tag].employees().items()):
            n = norm_name(e["name"])
            if not n:
                continue
            emp_key[(tag, k)] = n
            x = emp.setdefault(n, dict(norm=n, name=e["name"], code="", division="", ledgers=[], salary=0, first=None))
            x["name"] = e["name"]
            x["code"] = e["code"] or x["code"]
            x["division"] = e["division"] or x["division"]
            if tag not in x["ledgers"]:
                x["ledgers"].append(tag)
        for emp_k, amt in L[tag].payslip_templates().items():
            n = emp_key.get((tag, emp_k))
            if n:
                emp[n]["salary"] = amt
    SALARY_ITEMS = ("monthly salary", "school salary", "gc salary")

    # payslips (deduplicated across ledgers on employee + month + total)
    slip_rows_src = []
    seen_slip = set()
    for tag in L:
        for k, p in sorted(payslips[tag].items(), key=lambda x: x[1]["date"]):
            n = emp_key.get((tag, p["employee"]))
            if not n:
                continue
            sig = (n, p["date"][:7], sum(l["amount"] for l in p["lines"]))
            if sig in seen_slip:
                continue
            seen_slip.add(sig)
            slip_rows_src.append(dict(tag=tag, key=k, norm=n, **{kk: p[kk] for kk in ("date", "ref", "lines")}))
            e = emp[n]
            base_pay = sum(l["amount"] for l in p["lines"] if l["item"].lower() in SALARY_ITEMS)
            if base_pay:
                e["salary"] = base_pay
            e["first"] = min(e["first"] or p["date"], p["date"])
    emp_seq = {n: i for i, n in enumerate(sorted(emp), 1)}
    emp_id = {n: uid("employee", emp_seq[n]) for n in emp}

    def emp_branch(x):
        nm = x["name"].lower()
        if "banat" in nm or "banaat" in nm or "bnat" in nm:
            return BNAT
        if "school" in nm:
            return SCHOOL
        return BANEEN

    emp_rows = []
    for n, x in sorted(emp.items(), key=lambda kv: emp_seq[kv[0]]):
        latest = LATEST in x["ledgers"]
        extra = dict(source="manager.io", ledgers=x["ledgers"], managerCode=x["code"] or None, division=x["division"] or None,
                     **({} if latest else dict(historical=True, status="inactive")))
        extra = {k: v for k, v in extra.items() if v is not None}
        d = x["first"] or "2022-11-13"
        emp_rows.append(dict(_n=emp_seq[n], _hist=not latest, id=emp_id[n], name=x["name"], branch_id=emp_branch(x), extra=dict(
            role="", phone="", email="", salary=x["salary"], joinDate=x["first"] or "", recurringPayslip=False, **extra),
            created_at=ts(d), updated_at=ts(d)))
    rep("EMPLOYEES: %d (%d seen in latest ledger => visible; %d older only => historical)"
        % (len(emp_rows), sum(1 for x in emp.values() if LATEST in x["ledgers"]), sum(1 for x in emp.values() if LATEST not in x["ledgers"])))

    # ---- invoices ------------------------------------------------------------
    alloc = collections.defaultdict(list)   # (tag, invoice key) -> [(date, amount, bank)]
    over_alloc = 0
    for tag in L:
        for r in receipts[tag].values():
            for l in r["lines"]:
                if l["invoice"]:
                    alloc[(tag, l["invoice"])].append((r["date"], l["amount"], r["bank"]))
    inv_rows, inv_uuid, skipped_inv = [], {}, 0
    inv_seq = itertools.count(1)
    for tag in L:
        for k, iv in sorted(invoices[tag].items(), key=lambda x: x[1]["date"]):
            so = student_of(tag, iv["customer"])
            if not so:
                skipped_inv += 1
                continue
            n, sname = so
            inum = next(inv_seq)
            iid = uid("invoice", inum)
            inv_uuid[(tag, k)] = (inum, sname, iv)
            paid_list = sorted(alloc.get((tag, k), []))
            paid = sum(x[1] for x in paid_list)
            if paid > iv["amount"]:
                over_alloc += 1
            paid_amt = min(paid, iv["amount"])
            status = "paid" if paid_amt >= iv["amount"] else ("partial" if paid_amt > 0 else "pending")
            inv_rows.append(dict(
                _n=inum, _stu=student_tok[n], id=iid, student_id=student_id_of[n], branch_id=BANEEN, amount=iv["amount"], status=status,
                due_date=None, date=iv["date"], paid_amount=paid_amt,
                paid_account=paid_list[-1][2] if paid_list else None,
                paid_date=paid_list[-1][0] if status != "pending" and paid_list else None,
                concession_amount=0, concession_note=None,
                extra=base_extra(tag, k, year=int(iv["date"][:4]), month=month_name(iv["date"]), studentName=sname,
                                 lineItems=[dict(description=l["item"] + (" x%d" % l["qty"] if l["qty"] != 1 and l["price"] != 1 else ""), amount=l["amount"]) for l in iv["lines"]],
                                 managerRef=iv["ref"], notes=iv["note"]),
                created_at=ts(iv["date"]), updated_at=ts(iv["date"])))
    st = collections.Counter(r["status"] for r in inv_rows)
    for tag in L:
        for k, iv in invoices[tag].items():
            if (tag, k) not in inv_uuid:
                rep("  skipped invoice %s %s amount %d customer=%s" % (tag, iv["date"], iv["amount"], cust.get((tag, iv["customer"]), {}).get("name")))
    rep("INVOICES: %d (%s); skipped %d with no student; %d receipts over-allocate an invoice (capped)"
        % (len(inv_rows), dict(st), skipped_inv, over_alloc))
    rep("  billed %d, collected %d, outstanding %d" % (
        sum(r["amount"] for r in inv_rows), sum(r["paid_amount"] for r in inv_rows),
        sum(r["amount"] - r["paid_amount"] for r in inv_rows)))

    # ---- payslips + salary payments (FIFO allocation) ------------------------
    emp_pay = collections.defaultdict(list)   # norm -> payment lines with employee
    for tag in L:
        for k, p in payments[tag].items():
            for i, l in enumerate(p["lines"]):
                if l["employee"]:
                    n = emp_key.get((tag, l["employee"]))
                    if n:
                        emp_pay[n].append(dict(tag=tag, key=k, idx=i, date=p["date"], bank=p["bank"], amount=l["amount"],
                                               desc=l["desc"] or p["note"], ref=p["ref"]))
    slip_out, slip_id = [], {}
    slip_seq = itertools.count(1)
    pay_alloc = collections.defaultdict(list)    # (tag,key,idx) -> [(slip_id, amount, label)]
    pay_left = {}
    for n in emp:
        slips = sorted([s for s in slip_rows_src if s["norm"] == n], key=lambda s: s["date"])
        pays = sorted(emp_pay.get(n, []), key=lambda x: (x["date"], x["key"], x["idx"]))
        need = [[s, sum(l["amount"] for l in s["lines"]), 0, None, None] for s in slips]  # slip, due, got, paid_date, bank
        qi = 0
        for pm in pays:
            rem = pm["amount"]
            while rem > 0 and qi < len(need):
                s, due, got, _, _ = need[qi]
                take = min(rem, due - got)
                if take > 0:
                    need[qi][2] += take
                    pay_alloc[(pm["tag"], pm["key"], pm["idx"])].append((s["tag"] + ":" + s["key"], take))
                    if need[qi][2] >= due:
                        need[qi][3], need[qi][4] = pm["date"], pm["bank"]
                    rem -= take
                if need[qi][2] >= due:
                    qi += 1
            pay_left[(pm["tag"], pm["key"], pm["idx"])] = rem
        for s, due, got, pdate, bank in need:
            snum = next(slip_seq)
            sid = uid("payslip", snum)
            slip_id[s["tag"] + ":" + s["key"]] = (snum, s, n)
            lines = s["lines"]
            basic = sum(l["amount"] for l in lines if l["item"].lower() in SALARY_ITEMS)
            other = due - basic
            notes = "; ".join("%s %d%s" % (l["item"], l["amount"], " (%s)" % l["desc"] if l["desc"] else "") for l in lines)
            slip_out.append(dict(
                _n=snum, _emp=emp_seq[n], _basic=basic or due, _other=other if basic else 0,
                id=sid, employee_id=emp_id[n], branch_id=emp_branch(emp[n]), amount=due, month=month_name(s["date"]), date=s["date"],
                status="paid" if got >= due else "pending",
                paid_account=bank if got >= due else None, paid_date=pdate if got >= due else None,
                extra=base_extra(s["tag"], s["key"], employeeName=emp[n]["name"], role="", year=int(s["date"][:4]),
                                 basicSalary=basic or due, allowances=other if basic else 0, deductions=0, netPay=due,
                                 notes=notes, managerRef=s["ref"]),
                created_at=ts(s["date"]), updated_at=ts(s["date"])))
    stc = collections.Counter(r["status"] for r in slip_out)
    rep("PAYSLIPS: %d (%s) total %d; %d duplicate payslips across ledgers dropped" % (
        len(slip_out), dict(stc), sum(r["amount"] for r in slip_out),
        sum(len(payslips[t]) for t in L) - len(slip_out)))

    # ---- payments (cash book) + expenses --------------------------------------
    pay_rows, exp_rows = [], []
    pay_seq, exp_seq, tr_seq = itertools.count(1), itertools.count(1), itertools.count(1)
    KIND = {"I": "invoice", "E": "expense", "S": "payslip", "T": "transfer"}

    def add_pay(typ, account, amount, category, desc, date, tok, branch, source, tag, **extra):
        """tok: for sourced rows "<I|E|S|T><seq>" (links to the source document), else the Manager reference text."""
        n = next(pay_seq)
        if source:
            sid = uid(KIND[tok[0]], tok[1:])
            ref, source_id = sid, sid
        else:
            ref, source_id = (tok or None), None
        pay_rows.append(dict(
            _n=n, _src=source or "", _tok=tok or "",
            id=uid("payment", n), type=typ, account=account, description=desc, category=category, amount=amount,
            date=date, reference=ref, branch_id=branch or None, source=source or None, source_id=source_id,
            reversed=False, reversal_of=None, extra=base_extra(tag, None, **extra), created_at=ts(date), updated_at=ts(date)))

    for tag in L:
        lbr = lb[tag]
        for k, r in sorted(receipts[tag].items(), key=lambda x: x[1]["date"]):
            for i, l in enumerate(r["lines"]):
                if l["invoice"] and (tag, l["invoice"]) in inv_uuid:
                    inum, sname, iv = inv_uuid[(tag, l["invoice"])]
                    add_pay("cash_in", r["bank"], l["amount"], "Fee Collection",
                            "Fee — %s (%s)" % (sname, month_name(iv["date"])), r["date"], "I%d" % inum, BANEEN, "invoice", tag,
                            managerRef=r["ref"])
                    continue
                so = student_of(tag, l["customer"]) if l["customer"] else None
                if l["account"]:
                    add_pay("cash_in", r["bank"], l["amount"], l["account"], l["desc"] or l["account"], r["date"], r["ref"],
                            acct_branch(l["account"], lbr), None, tag, managerRef=r["ref"])
                elif so:
                    add_pay("cash_in", r["bank"], l["amount"], "Fee Collection", "Fee — %s%s" % (so[1], " (%s)" % l["desc"] if l["desc"] else ""),
                            r["date"], r["ref"], BANEEN, None, tag, managerRef=r["ref"])
                else:
                    cn = cust.get((tag, l["customer"]), {}).get("name") if l["customer"] else None
                    add_pay("cash_in", r["bank"], l["amount"], "Fee Collection" if cn else "Other Income",
                            l["desc"] or cn or "Receipt", r["date"], r["ref"], lbr or "", None, tag, managerRef=r["ref"])
        for k, p in sorted(payments[tag].items(), key=lambda x: x[1]["date"]):
            for i, l in enumerate(p["lines"]):
                if l["employee"]:
                    n = emp_key.get((tag, l["employee"]))
                    if not n:
                        add_pay("cash_out", p["bank"], l["amount"], "Salary", l["desc"] or "Salary", p["date"], p["ref"], lbr, None, tag)
                        continue
                    adv = "advance" in (l["desc"] + " " + p["note"]).lower()
                    cat = "Salary Advance" if adv else "Salary"
                    for sref, amt in pay_alloc.get((tag, k, i), []):
                        snum, s, _n = slip_id[sref]
                        add_pay("cash_out", p["bank"], amt, cat, "Salary — %s (%s %s)" % (emp[n]["name"], month_name(s["date"]), s["date"][:4]),
                                p["date"], "S%d" % snum, emp_branch(emp[n]), "payslip", tag, managerRef=p["ref"])
                    left = pay_left.get((tag, k, i), l["amount"])
                    if left > 0:
                        add_pay("cash_out", p["bank"], left, cat, "%s — %s%s" % (cat, emp[n]["name"], " (%s)" % l["desc"] if l["desc"] else ""),
                                p["date"], p["ref"], emp_branch(emp[n]), None, tag, managerRef=p["ref"])
                    continue
                acct = l["account"]
                if acct and chart_type.get(acct.lower()) == "Expenses":
                    enum = next(exp_seq)
                    br = acct_branch(acct, lbr)
                    exp_rows.append(dict(
                        _n=enum, id=uid("expense", enum), description=l["desc"] or acct, category=acct, amount=l["amount"], date=p["date"],
                        branch_id=br or None, paid_account=p["bank"],
                        extra=base_extra(tag, None, notes=p["note"], managerRef=p["ref"]),
                        created_at=ts(p["date"]), updated_at=ts(p["date"])))
                    add_pay("cash_out", p["bank"], l["amount"], acct, l["desc"] or acct, p["date"], "E%d" % enum, br, "expense", tag,
                            managerRef=p["ref"])
                else:
                    add_pay("cash_out", p["bank"], l["amount"], acct or "Other", l["desc"] or acct or "Payment", p["date"], p["ref"],
                            acct_branch(acct, lbr), None, tag, managerRef=p["ref"])
        for k, t in sorted(transfers[tag].items(), key=lambda x: x[1]["date"]):
            tn = next(tr_seq)
            add_pay("cash_out", t["src"], t["amount"], "Bank Transfer", "Transfer to %s" % t["dst"], t["date"], "T%d" % tn, lbr, "transfer", tag)
            add_pay("cash_in", t["dst"], t["amount"], "Bank Transfer", "Transfer from %s" % t["src"], t["date"], "T%d" % tn, lbr, "transfer", tag)

    # ---- reconciliation against Manager's own totals ---------------------------
    man_in = sum(l["amount"] for t in L for r in receipts[t].values() for l in r["lines"])
    man_out = sum(l["amount"] for t in L for p in payments[t].values() for l in p["lines"])
    mine_in = sum(r["amount"] for r in pay_rows if r["type"] == "cash_in" and r["category"] != "Bank Transfer")
    mine_out = sum(r["amount"] for r in pay_rows if r["type"] == "cash_out" and r["category"] != "Bank Transfer")
    rep("PAYMENTS: %d rows (%d in, %d out)" % (len(pay_rows), sum(1 for r in pay_rows if r["type"] == "cash_in"), sum(1 for r in pay_rows if r["type"] == "cash_out")))
    rep("  money in  : Manager %d vs import %d  %s" % (man_in, mine_in, "OK" if man_in == mine_in else "MISMATCH"))
    rep("  money out : Manager %d vs import %d  %s" % (man_out, mine_out, "OK" if man_out == mine_out else "MISMATCH"))
    rep("EXPENSES: %d rows, total %d" % (len(exp_rows), sum(r["amount"] for r in exp_rows)))
    by_bank = collections.defaultdict(int)
    for r in pay_rows:
        by_bank[r["account"]] += r["amount"] if r["type"] == "cash_in" else -r["amount"]
    rep("  net by account: %s" % dict(by_bank))
    inv_ids = {x["id"] for x in inv_rows}
    unlinked_inv = [r for r in pay_rows if r["source"] == "invoice" and r["source_id"] not in inv_ids]
    rep("  fee payments pointing at a missing invoice: %d" % len(unlinked_inv))

    out = dict(students=student_rows, employees=emp_rows, invoices=inv_rows, payslips=slip_out, expenses=exp_rows, payments=pay_rows)
    for t, rows in out.items():
        with open(os.path.join(a.out, t + ".json"), "w", encoding="utf-8") as fh:
            json.dump(rows, fh, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(a.out, "report.txt"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(report) + "\n")


if __name__ == "__main__":
    main()
