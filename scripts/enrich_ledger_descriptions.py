#!/usr/bin/env python3
"""Give the ledger rows imported from the Accounts workbook real descriptions.

extract_workbook_ledger.py only has one figure per category per day, so imported
rows were described by their category alone ("Welfare"). The June-September cash
books list every transaction with its particulars ("Electricity Bill (School)").
This script matches each imported (date, side, category, amount) row to the cash
book entries of that day whose amounts add up to it and writes SQL that fills the
description in.

Usage:
    python3 scripts/enrich_ledger_descriptions.py Accounts.xlsx > enrich.sql
    (match report goes to stderr)

The old text is kept in extra.originalDescription so this is reversible:
    update payments set description = extra->>'originalDescription'
     where extra->>'descriptionSource' = 'cash book';      -- same for expenses
Rows whose day does not add up to the cash book are left untouched.
"""
import datetime
import itertools
import json
import os
import re
import subprocess
import sys

import openpyxl

HERE = os.path.dirname(os.path.abspath(__file__))
CASH_BOOKS = ["June-Cash Book", "July-Cash Book", "August-Cash Book", "September-Cash Book"]
# Words that say nothing about which category a particular belongs to.
STOP = {"fees", "fee", "bill", "bills", "exp", "expense", "expenses", "and", "the", "cash", "of"}
SYN = {
    "electricity": "utility", "gas": "utility", "utility": "utility", "utilities": "utility", "tanki": "utility",
    "stationary": "stationary", "stanationary": "stationary", "print": "printing", "printing": "printing",
    "repairing": "maintenance", "repair": "maintenance", "maintenance": "maintenance", "mantenance": "maintenance",
    "fixture": "fixture", "furniature": "fixture", "furniture": "fixture",
    "petrol": "fuel", "fuel": "fuel", "lunch": "lunch", "entertainment": "entertainment",
    "salary": "salary", "salaries": "salary", "staff": "salary", "advance": "advance", "adv": "advance",
    "baneen": "baneen", "banaat": "banaat", "bnat": "banaat", "school": "school", "umer": "umer", "colony": "umer",
    "gc": "banaat", "welfare": "welfare", "welfear": "welfare", "donation": "donation", "loan": "loan",
    "tafseer": "tafseer", "admission": "admission", "addmission": "admission", "gift": "gift", "gifts": "gift",
    "phone": "phone", "water": "water", "drinking": "water", "cleaning": "cleaning", "laundry": "cleaning",
    "laundary": "cleaning", "rent": "rent", "tution": "tuition", "tuition": "tuition",
}


def tokens(text):
    out = set()
    for w in re.findall(r"[a-z]+", text.lower()):
        if w in STOP:
            continue
        out.add(SYN.get(w, w))
    return out


def score(category, particulars):
    a, b = tokens(category), tokens(particulars)
    return len(a & b) * 2 - len(b - a) * 0.25


BRANCH_WORDS = {"baneen": "baneen", "baneeen": "baneen", "banaat": "banaat", "bnat": "banaat", "gc": "banaat",
                "school": "school", "umer": "umer"}
ORG_LEVEL = ("welfare", "donation", "loan", "suspense", "miscellaneous", "pt ", "gift", "debt")


def particulars_branches(text):
    return {BRANCH_WORDS[w] for w in re.findall(r"[a-z]+", text.lower()) if w in BRANCH_WORDS}


def category_branch(category):
    """Mirror extract_workbook_ledger.branch_of: the branch a category belongs to,
    or None for org-level heads such as Welfare / Donation / Loan."""
    found = particulars_branches(category)
    if found:
        return next(iter(found))
    c = category.lower()
    return None if any(c.startswith(w) for w in ORG_LEVEL) else "baneen"


def compatible(category, particulars):
    """A cash book line may never be matched across branches, a Loan row only takes
    loan / diary-fund lines, and Welfare / Donation rows never take plain fee lines
    (amounts alone can add up by coincidence)."""
    cb, pb = category_branch(category), particulars_branches(particulars)
    if cb is not None and pb and pb != {cb}:
        return False
    cat, part = category.lower(), particulars.lower()
    if cat.startswith("loan") and not re.search(r"loan|dairy|diary|debt", part):
        return False
    if cat.startswith(("welfare", "donation")) and "fee" in part and not re.search(r"welfare|donat|charity", part):
        return False
    return True


def read_cash_books(path):
    wb = openpyxl.load_workbook(path, data_only=True)
    book = {}  # (date, side) -> [(particulars, amount)]
    for name in CASH_BOOKS:
        ws = wb[name]
        for r in range(5, min(ws.max_row, 400) + 1):
            for side, dc, pc, ac in (("i", 1, 2, 3), ("e", 4, 5, 6)):
                d, p, a = ws.cell(r, dc).value, ws.cell(r, pc).value, ws.cell(r, ac).value
                if isinstance(d, datetime.datetime) and isinstance(p, str) and isinstance(a, (int, float)) and a:
                    book.setdefault((d.date().isoformat(), side), []).append((p.strip(), a))
    return book


def assign(rows, entries):
    """Partition cash book entries among that day's ledger rows (sum == amount),
    maximising the keyword score. Returns {row index: [entry index]}."""
    best = {"score": None, "pick": {}}

    def dfs(i, free, pick, total):
        if i == len(rows):
            matched = len(pick)
            key = (matched, total)
            if best["score"] is None or key > best["score"]:
                best["score"], best["pick"] = key, dict(pick)
            return
        cat, amt = rows[i]
        found = False
        for size in range(1, min(len(free), 6) + 1):
            for combo in itertools.combinations(free, size):
                if (abs(sum(entries[j][1] for j in combo) - amt) < 0.01
                        and all(compatible(cat, entries[j][0]) for j in combo)):
                    found = True
                    pick[i] = list(combo)
                    s = sum(score(cat, entries[j][0]) for j in combo)
                    dfs(i + 1, [j for j in free if j not in combo], pick, total + s)
                    del pick[i]
        if not found or True:  # a row may also stay unmatched
            dfs(i + 1, free, pick, total)

    dfs(0, list(range(len(entries))), {}, 0.0)
    return best["pick"]


def sql_text(s):
    return "'" + s.replace("'", "''") + "'"


def main(path):
    ledger = json.loads(subprocess.check_output(
        [sys.executable, os.path.join(HERE, "extract_workbook_ledger.py"), path]))
    book = read_cash_books(path)
    by_day = {}
    for d, kind, cat, _branch, amt, _summary in ledger:
        if "2026-06-01" <= d <= "2026-09-30":
            by_day.setdefault((d, kind), []).append((cat, amt))

    out, total, matched = [], 0, 0
    for key, rows in sorted(by_day.items()):
        entries = book.get(key, [])
        pick = assign(rows, entries) if entries else {}
        for i, (cat, amt) in enumerate(rows):
            total += 1
            if i not in pick:
                print(f"UNMATCHED {key[0]} {key[1]} {cat} {amt}", file=sys.stderr)
                continue
            matched += 1
            text = "; ".join(entries[j][0] for j in sorted(pick[i]))[:240]
            out.append((key[0], key[1], cat, amt, text))
    print(f"matched {matched}/{total} ledger rows", file=sys.stderr)

    for table, kind in (("payments", None), ("expenses", None)):
        values = ",\n".join(
            f"({sql_text(d)},{sql_text(k)},{sql_text(c)},{a},{sql_text(t)})" for d, k, c, a, t in out
            if table == "payments" or k == "e")
        type_cond = ("and (p.type = case v.k when 'i' then 'cash_in' else 'cash_out' end)"
                     if table == "payments" else "")
        print(f"""update {table} p
   set description = v.t,
       extra = p.extra || jsonb_build_object('originalDescription', p.description, 'descriptionSource', 'cash book')
  from (values
{values}
) as v(d, k, c, a, t)
 where p.extra->>'importBatch' like 'xlsx-%'
   and p.extra->>'descriptionSource' is null
   and p.date = v.d and p.category = v.c and p.amount = v.a {type_cond};
""")


if __name__ == "__main__":
    main(sys.argv[1])
