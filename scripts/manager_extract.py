#!/usr/bin/env python3
"""
Read Manager.io ".manager" backup files (SQLite + protobuf) into plain Python
structures: customers, employees, invoices, receipts, payments, transfers and
payslips.

Encoding notes (worked out by cross-checking against object create times):
  * Objects(Key, ContentType, Content): Content is a schema-less protobuf blob.
  * Dates are {1: zigzag-varint days since 1970-01-01}.
  * Amounts are {1: plain integer}.
  * References to other objects are a message of two fixed64 values that
    together form a .NET GUID (little-endian byte order).
"""
import datetime, re, sqlite3, uuid

# ---------------------------------------------------------------- protobuf --
def _varint(b, i):
    r = s = 0
    while True:
        x = b[i]; i += 1
        r |= (x & 0x7F) << s; s += 7
        if not x & 0x80:
            return r, i


def decode(b, depth=0):
    """Schema-less protobuf decode -> list of (field, value), or None."""
    i, out = 0, []
    try:
        while i < len(b):
            k, i = _varint(b, i)
            f, w = k >> 3, k & 7
            if w == 0:
                v, i = _varint(b, i)
            elif w == 1:
                v = b[i:i + 8]; i += 8
            elif w == 5:
                v = b[i:i + 4]; i += 4
            elif w == 2:
                n, i = _varint(b, i)
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


def zigzag(n):
    return (n >> 1) ^ -(n & 1)


def day_to_iso(n):
    return (datetime.date(1970, 1, 1) + datetime.timedelta(days=zigzag(n))).isoformat()


def norm_name(s):
    return re.sub(r"\s+", " ", (s or "").strip().lower())


# ------------------------------------------------------------------ ledger --
T_CUSTOMER = "ec37c11e-2b67-49c6-8a58-6eccb7dd75ee"
T_EMPLOYEE = "dadb7f95-a5dd-45c0-945d-6ad4ee28776e"
T_INVOICE = "ad12b60b-23bf-4421-94df-8be79cef533e"
T_RECEIPT = "7662b887-c8d8-486e-98fd-f9dbcd41c6dc"
T_PAYMENT = "79f99d26-e43a-4ecb-a9c9-0774601a9b2e"
T_TRANSFER = "dea4f923-c498-4504-b3ef-30be3c33175e"
T_PAYSLIP = "1d103fa7-6fc1-4951-811e-972968b842cc"
T_PAYSLIP_TMPL = "ae6e14e3-1d3d-4996-b466-ba41732a8dbe"


class Ledger:
    def __init__(self, path):
        self.path = path
        con = sqlite3.connect("file:%s?mode=ro" % path, uri=True)
        self.obj = {}   # key -> (content_type, decoded fields as dict-of-lists)
        for k, ct, b in con.execute("select Key, ContentType, Content from Objects"):
            d = decode(b)
            self.obj[k] = (ct, d)
        con.close()
        self.name = {}
        for k, (ct, d) in self.obj.items():
            if d:
                f = dict(d)
                for fld in (1, 2, 11):
                    if isinstance(f.get(fld), str):
                        self.name[k] = f[fld]
                        break

    # -- helpers
    @staticmethod
    def guid(m):
        if isinstance(m, list) and len(m) == 2:
            d = dict(m)
            a, b = d.get(1), d.get(2)
            if isinstance(a, bytes) and isinstance(b, bytes) and len(a) == len(b) == 8:
                return str(uuid.UUID(bytes_le=a + b))
        return None

    def ref_name(self, m):
        g = self.guid(m)
        return self.name.get(g) if g else None

    @staticmethod
    def date(m):
        if isinstance(m, list):
            v = dict(m).get(1)
            if isinstance(v, int):
                return day_to_iso(v)
        return None

    @staticmethod
    def amount(m):
        if isinstance(m, list):
            v = dict(m).get(1)
            if isinstance(v, int):
                return v
        return 0

    def of_type(self, ct):
        for k, (c, d) in self.obj.items():
            if c == ct and d:
                yield k, d

    # -- entities
    def customers(self):
        out = {}
        for k, d in self.of_type(T_CUSTOMER):
            f = dict(d)
            if not isinstance(f.get(1), str):
                continue
            out[k] = dict(key=k, name=f[1].strip(), code=f.get(13) if isinstance(f.get(13), str) else "",
                          division=self.ref_name(f.get(25)) or "")
        return out

    def employees(self):
        out = {}
        for k, d in self.of_type(T_EMPLOYEE):
            f = dict(d)
            if not isinstance(f.get(1), str):
                continue
            out[k] = dict(key=k, name=f[1].strip(), code=f.get(14) if isinstance(f.get(14), str) else "",
                          division=self.ref_name(f.get(16)) or "")
        return out

    def invoices(self):
        out = {}
        for k, d in self.of_type(T_INVOICE):
            f = dict(d)
            lines = []
            for fld, v in d:
                if fld != 49 or not isinstance(v, list):
                    continue
                lf = dict(v)
                price = self.amount(lf.get(19))
                qty = self.amount(lf.get(18)) if 18 in lf else 1
                if price:
                    lines.append(dict(item=self.ref_name(lf.get(2)) or "Fees", qty=qty or 1, price=price,
                                      amount=(qty or 1) * price, division=self.ref_name(lf.get(22)) or ""))
            if not lines or not self.date(f.get(1)):
                continue
            out[k] = dict(key=k, date=self.date(f.get(1)), ref=f.get(2) if isinstance(f.get(2), str) else "",
                          customer=self.guid(f.get(3)), lines=lines, note=f.get(12) if isinstance(f.get(12), str) else "",
                          amount=sum(l["amount"] for l in lines))
        return out

    def _bank(self, f):
        return self.ref_name(f.get(7)) or ""

    def receipts(self):
        out = {}
        for k, d in self.of_type(T_RECEIPT):
            f = dict(d)
            if not self.date(f.get(1)):
                continue
            lines = []
            for fld, v in d:
                if fld != 11 or not isinstance(v, list):
                    continue
                lf = dict(v)
                amt = self.amount(lf.get(18))
                if not amt:
                    continue
                inv = self.guid(lf.get(4))
                lines.append(dict(amount=amt, account=self.ref_name(lf.get(2)) if self.guid(lf.get(2)) in self.name else "",
                                  customer=self.guid(lf.get(3)) or self.guid(f.get(4)),
                                  invoice=inv if inv in self.obj and self.obj[inv][0] == T_INVOICE else None,
                                  desc=lf.get(15) if isinstance(lf.get(15), str) else ""))
            if lines:
                out[k] = dict(key=k, date=self.date(f.get(1)), ref=f.get(2) if isinstance(f.get(2), str) else "",
                              bank=self._bank(f), payer=self.guid(f.get(4)), lines=lines,
                              note=f.get(10) if isinstance(f.get(10), str) else "")
        return out

    def payments(self):
        out = {}
        for k, d in self.of_type(T_PAYMENT):
            f = dict(d)
            if not self.date(f.get(1)):
                continue
            lines = []
            for fld, v in d:
                if fld != 11 or not isinstance(v, list):
                    continue
                lf = dict(v)
                amt = self.amount(lf.get(18))
                if not amt:
                    continue
                acc = self.guid(lf.get(2))
                lines.append(dict(amount=amt, account=self.name.get(acc, "") if acc else "",
                                  employee=self.guid(lf.get(9)), customer=self.guid(lf.get(3)),
                                  desc=lf.get(15) if isinstance(lf.get(15), str) else ""))
            if lines:
                out[k] = dict(key=k, date=self.date(f.get(1)), ref=f.get(2) if isinstance(f.get(2), str) else "",
                              bank=self._bank(f), lines=lines, note=f.get(10) if isinstance(f.get(10), str) else "")
        return out

    def transfers(self):
        out = {}
        for k, d in self.of_type(T_TRANSFER):
            f = dict(d)
            amt = self.amount(f.get(8))
            if not amt or not self.date(f.get(1)):
                continue
            out[k] = dict(key=k, date=self.date(f.get(1)), ref=f.get(6) if isinstance(f.get(6), str) else "",
                          src=self.ref_name(f.get(2)) or "", dst=self.ref_name(f.get(3)) or "", amount=amt)
        return out

    def payslips(self):
        out = {}
        for k, d in self.of_type(T_PAYSLIP):
            f = dict(d)
            if not self.date(f.get(1)) or not self.guid(f.get(2)):
                continue
            lines = []
            for fld, v in d:
                if fld != 3 or not isinstance(v, list):
                    continue
                lf = dict(v)
                amt = self.amount(lf.get(3))
                if amt:
                    lines.append(dict(item=self.ref_name(lf.get(4)) or "Salary", amount=amt,
                                      desc=lf.get(6) if isinstance(lf.get(6), str) else ""))
            if lines:
                out[k] = dict(key=k, date=self.date(f.get(1)), ref=f.get(12) if isinstance(f.get(12), str) else "",
                              employee=self.guid(f.get(2)), lines=lines)
        return out

    def payslip_templates(self):
        """Per-employee default pay (the 'Monthly Salary' amount)."""
        out = {}
        for k, d in self.of_type(T_PAYSLIP_TMPL):
            f = dict(d)
            emp = self.guid(f.get(1))
            amt = 0
            for fld, v in d:
                if fld == 2 and isinstance(v, list):
                    amt += self.amount(dict(v).get(3))
            if emp and amt:
                out[emp] = amt
        return out
