#!/usr/bin/env python3
"""
Extract the chart of accounts from Manager.io ".manager" backup files and
emit (a) a CSV with provenance and (b) an idempotent SQL seed for
public.accounts.

A .manager file is a SQLite database: table Objects(Key, ContentType, Content)
where Content is a protobuf blob. Chart-of-accounts objects carry the account
name in field 1 and a reference to their group in field 3 (a .NET GUID split
into two fixed64 values). Create dates come from the Changes table.

Usage:
  python3 scripts/extract_manager_chart_of_accounts.py <dir-with-.manager-files> \
      [--csv data/manager_chart_of_accounts.csv] \
      [--sql supabase/seed_chart_of_accounts.sql]
"""
import argparse, csv, datetime, glob, os, sqlite3, uuid

# Ledgers to read, oldest first. Order decides which ledger is credited as the
# first source of an account. Umer Colony Branch.manager is skipped: it is an
# unused 32-object stub holding only Manager's default template accounts.
LEDGERS = [
    "Zohra Majeed Islamic Institute.manager",               # original book, from 2022-11-13
    "Zohra Majeed Islamic Institute (Banaat).manager",      # girls' branch, from 2023-03-16
    "Zohra Majeed Islamic Institute (2023-2024).manager",   # next financial year
    "ZMI - Banat 24-25.manager",
]

# Manager object type GUIDs that hold chart-of-accounts entries.
ACCOUNT_TYPES = {
    "26b9e4a5-ce10-4f30-94c7-23a1ca4428f9",  # income / expense account
    "6ef13e42-ad89-4d42-9480-546e0c04a411",  # balance sheet account
    "c03d1921-7a45-4eda-8742-a2d9082dcf4f",  # balance sheet account (variant)
    "1408c33b-6284-4f50-9e31-48cbea21f3cf",  # cash / bank account
    "f361339b-932a-4436-b56e-a337c1587c72",  # capital / equity account
    "74dfd025-d68e-4a99-9c78-5d43e17c0e09",  # retained earnings
}
INCOME_GROUP = "95713fac-30d3-42e4-b536-dd7bc4f7a80e"
EXPENSE_GROUP = "fd003045-876e-439e-b923-1904453f5c30"
ASSET_GROUP = "4c05c221-ca57-4c7c-be62-115669302ed4"      # Manager built-in "Current assets"
LIABILITY_GROUP = "ed5a19f6-12c5-45cc-b4b7-4e79f7ef50bc"  # Manager built-in liabilities
UNKNOWN_GROUP = "9275ff4c-4cff-41d0-b7b5-f31c783f03d8"    # only "Welfare" uses it; not named in any file


def varint(b, i):
    r = s = 0
    while True:
        x = b[i]; i += 1
        r |= (x & 0x7F) << s; s += 7
        if not x & 0x80:
            return r, i


def decode(b, depth=0):
    """Minimal schema-less protobuf decoder -> list of (field, value)."""
    i, out = 0, []
    try:
        while i < len(b):
            k, i = varint(b, i)
            f, w = k >> 3, k & 7
            if w == 0:
                v, i = varint(b, i)
            elif w == 1:
                v = b[i:i + 8]; i += 8
            elif w == 5:
                v = b[i:i + 4]; i += 4
            elif w == 2:
                n, i = varint(b, i)
                v = b[i:i + n]; i += n
                try:
                    t = v.decode("utf8")
                    if not (t and t.isprintable()):
                        raise ValueError
                    v = t
                except ValueError:
                    sub = decode(v, depth + 1) if depth < 3 else None
                    v = sub or v
            else:
                return None
            out.append((f, v))
    except IndexError:
        return None
    return out


def group_ref(field3):
    if isinstance(field3, list):
        d = dict(field3)
        a, b = d.get(1), d.get(2)
        if isinstance(a, bytes) and isinstance(b, bytes) and len(a) == len(b) == 8:
            return str(uuid.UUID(bytes_le=a + b))
    return None


def ticks_to_date(t):
    return (datetime.datetime(1, 1, 1) + datetime.timedelta(microseconds=t // 10)).strftime("%Y-%m-%d") if t else ""


def erp_type(name, content_type, group):
    """Map a Manager account onto the ERP's (type, sub_type) vocabulary."""
    n = name.lower()
    if content_type == "1408c33b-6284-4f50-9e31-48cbea21f3cf":
        return "Assets", "Bank & Cash"
    if content_type in ("f361339b-932a-4436-b56e-a337c1587c72", "74dfd025-d68e-4a99-9c78-5d43e17c0e09"):
        if "retained" in n:
            return "Equity", "Retained Earnings"
        return "Equity", "Capital" if "funds" in n else "Owner's Equity"
    if group == INCOME_GROUP:
        if any(w in n for w in ("donation", "welfare")):
            return "Income", "Grants & Donations"
        if any(w in n for w in ("fee", "course", "sales", "school fund")):
            return "Income", "Fee Income"
        return "Income", "Other Income"
    if group == EXPENSE_GROUP:
        if any(w in n for w in ("salar", "bonus")) or n.endswith("allowance"):
            if any(w in n for w in ("fuel", "travel")):
                return "Expenses", "Transport"
            return "Expenses", "Salaries & Wages"
        if any(w in n for w in ("rent", "utilit", "electric", "gas bill", "water bill")):
            return "Expenses", "Rent & Utilities"
        if any(w in n for w in ("repair", "maintenance")):
            return "Expenses", "Maintenance"
        if any(w in n for w in ("stationar", "stationery", "printing", "equipment", "designing", "cleaning")):
            return "Expenses", "Supplies"
        return "Expenses", "Other Expenses"
    if group == ASSET_GROUP:
        if "rec" in n:
            return "Assets", "Accounts Receivable"
        return "Assets", "Current Assets"
    if group == LIABILITY_GROUP:
        if "payable" in n:
            return "Liabilities", "Accounts Payable"
        return "Liabilities", "Current Liabilities"
    if group == UNKNOWN_GROUP:
        return "Equity", "Capital"  # unnamed group; only "Welfare" in the original book, outvoted by Income elsewhere
    # accounts nested under a custom group (e.g. Suppliers under Payables)
    return "Liabilities", "Accounts Payable"


def read_ledger(path):
    con = sqlite3.connect("file:%s?mode=ro" % path, uri=True)
    created = dict(con.execute(
        "select Object, min(Timestamp) from Changes "
        "where ContentBefore is null or length(ContentBefore)=0 group by Object"))
    rows = []
    for key, ct, content in con.execute("select Key, ContentType, Content from Objects"):
        if ct not in ACCOUNT_TYPES:
            continue
        d = decode(content)
        if not d:
            continue
        f = dict(d)
        if not isinstance(f.get(1), str):
            continue
        group = group_ref(f.get(3)) if 3 in f else None
        t, sub = erp_type(f[1], ct, group)
        code = f.get(13) if isinstance(f.get(13), str) else ""
        rows.append(dict(name=f[1].strip(), code=code, type=t, sub_type=sub,
                         created=ticks_to_date(created.get(key))))
    return rows


def q(s):
    return "'" + s.replace("'", "''") + "'"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dir")
    ap.add_argument("--csv", default="data/manager_chart_of_accounts.csv")
    ap.add_argument("--sql", default="supabase/seed_chart_of_accounts.sql")
    a = ap.parse_args()
    root = glob.glob(os.path.join(a.dir, "**", LEDGERS[0]), recursive=True)
    base = os.path.dirname(root[0])

    merged = {}  # lower(name) -> record, first ledger wins
    for ledger in LEDGERS:
        for r in read_ledger(os.path.join(base, ledger)):
            k = r["name"].lower()
            if k in merged:
                merged[k]["ledgers"].append(ledger)
                merged[k]["kinds"].append((r["type"], r["sub_type"]))
                continue
            r["first_ledger"] = ledger
            r["ledgers"] = [ledger]
            r["kinds"] = [(r["type"], r["sub_type"])]
            merged[k] = r
    # An account may be classified differently across ledgers (e.g. Welfare);
    # take the classification used by most ledgers, first-seen wins ties.
    for r in merged.values():
        r["type"], r["sub_type"] = max(r["kinds"], key=lambda t: (r["kinds"].count(t), -r["kinds"].index(t)))
        # "initial" = created on the day the original book was set up
        r["initial"] = r["first_ledger"] == LEDGERS[0] and r["created"] <= "2022-11-14"
    order = {"Assets": 0, "Liabilities": 1, "Equity": 2, "Income": 3, "Expenses": 4}
    accts = sorted(merged.values(), key=lambda r: (order[r["type"]], r["sub_type"], r["name"].lower()))

    os.makedirs(os.path.dirname(a.csv) or ".", exist_ok=True)
    with open(a.csv, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["code", "name", "type", "sub_type", "first_created", "first_ledger", "ledger_count", "initial"])
        for r in accts:
            w.writerow([r["code"], r["name"], r["type"], r["sub_type"], r["created"], r["first_ledger"], len(r["ledgers"]), "yes" if r["initial"] else ""])

    vals = ",\n".join("  (%s, %s, %s, %s, %s)" % (
        q(r["code"]) if r["code"] else "null", q(r["name"]), q(r["type"]), q(r["sub_type"]),
        q('{"source":"manager.io","ledger":"%s"}' % r["first_ledger"].replace(".manager", "")))
        for r in accts)
    with open(a.sql, "w", encoding="utf-8") as fh:
        fh.write(f"""-- ============================================================
-- Chart of accounts imported from the Manager.io backups
-- Generated by scripts/extract_manager_chart_of_accounts.py
-- ({len(accts)} accounts). Safe to re-run: skips any account whose name already
-- exists (payments/journals link to accounts by NAME, so names are kept
-- exactly as in Manager). Opening balances are NOT included.
-- ============================================================
insert into public.accounts (code, name, type, sub_type, extra)
select v.code, v.name, v.type, v.sub_type, v.extra::jsonb
from (values
{vals}
) as v(code, name, type, sub_type, extra)
where not exists (
  select 1 from public.accounts a where lower(a.name) = lower(v.name)
);
""")
    print("wrote %d accounts -> %s, %s" % (len(accts), a.csv, a.sql))


if __name__ == "__main__":
    main()
