// Unit tests for the ledger helpers (CODE-47 target #1 and #8).
// firebase.js and the Supabase client are replaced by a tiny in-memory
// database that understands exactly the calls accounting.js makes.

/* eslint-disable import/first */
const mockDb = { payments: [], invoices: [], payslips: [], expenses: [] };
const mockFail = { addDoc: null, update: null, read: null };
let mockSeq = 0;

const mockCols = {
  payments: ["type", "account", "description", "category", "amount", "date", "reference", "branch_id", "source", "source_id", "reversed", "reversal_of"],
  invoices: ["student_id", "branch_id", "amount", "status", "due_date", "date", "paid_amount", "paid_account", "paid_date", "concession_amount", "concession_note"],
  payslips: ["employee_id", "branch_id", "amount", "month", "date", "status", "paid_account", "paid_date"],
  expenses: ["description", "category", "amount", "date", "branch_id", "paid_account"],
};
const mockSnake = (s) => s.replace(/[A-Z]/g, (m) => "_" + m.toLowerCase());
const mockCamel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
function mockEncode(table, data) {
  const row = {}; const extra = {};
  for (const [k, v] of Object.entries(data)) {
    if (k === "id") continue;
    const val = v === "__SERVER_TIMESTAMP__" ? "NOW" : v;
    if (mockCols[table].includes(mockSnake(k))) row[mockSnake(k)] = val; else extra[k] = val;
  }
  if (Object.keys(extra).length) row.extra = extra;
  return row;
}
function mockDecode(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === "extra") Object.assign(out, v); else out[mockCamel(k)] = v;
  }
  return out;
}

jest.mock("../firebase", () => ({
  db: {},
  serverTimestamp: () => "__SERVER_TIMESTAMP__",
  collection: (_d, name) => ({ table: name }),
  doc: (_d, name, id) => ({ table: name, id }),
  addDoc: async (ref, data) => {
    if (mockFail.addDoc === ref.table) throw new Error("insert failed");
    const row = { id: "id" + ++mockSeq, deleted_at: null, ...mockEncode(ref.table, data) };
    mockDb[ref.table].push(row);
    return { id: row.id };
  },
  getDoc: async (ref) => {
    if (mockFail.read === ref.table) throw new Error("read failed");
    const row = mockDb[ref.table].find((r) => r.id === ref.id);
    return { exists: () => !!row, data: () => { const { id, ...rest } = mockDecode(row); return rest; } };
  },
  deleteDoc: async (ref) => { mockDb[ref.table].find((r) => r.id === ref.id).deleted_at = "T"; },
  restoreDoc: async (ref) => {
    if (mockFail.update === "restore") throw new Error("restore failed");
    mockDb[ref.table].find((r) => r.id === ref.id).deleted_at = null;
  },
  updateDocs: async (table, ids, patch) => {
    if (mockFail.update === table) throw new Error("update failed");
    let n = 0;
    for (const id of ids) {
      const row = mockDb[table].find((r) => r.id === id);
      if (!row) continue;
      const enc = mockEncode(table, patch);
      const { extra, ...direct } = enc;
      Object.assign(row, direct);
      if (extra) row.extra = { ...(row.extra || {}), ...extra };
      n++;
    }
    return n;
  },
}));

jest.mock("../lib/supabaseClient", () => {
  class Q {
    constructor(table) { this.table = table; this.filters = []; this.op = "select"; }
    select() { return this; }
    update(p) { this.op = "update"; this.patch = p; return this; }
    eq(c, v) { this.filters.push((r) => r[c] === v); return this; }
    is(c, v) { this.filters.push((r) => (r[c] ?? null) === v); return this; }
    or(str) {
      const preds = str.split(",").map((t) => {
        const [col, op, val] = t.split(".");
        if (op === "is" && val === "null") return (r) => r[col] === null || r[col] === undefined;
        return (r) => String(r[col]) === val;
      });
      this.filters.push((r) => preds.some((p) => p(r)));
      return this;
    }
    maybeSingle() { this.single = true; return this; }
    then(res, rej) {
      try {
        if (mockFail.read === "ledger" && this.op === "select") throw new Error("ledger read failed");
        const rows = mockDb[this.table].filter((r) => this.filters.every((f) => f(r)));
        if (this.op === "update") {
          if (mockFail.update === "claim-undo" && this.patch.reversed === false) throw new Error("undo failed");
          rows.forEach((r) => Object.assign(r, this.patch));
          return Promise.resolve({ data: rows.map((r) => ({ id: r.id })), error: null }).then(res, rej);
        }
        return Promise.resolve({ data: this.single ? (rows[0] || null) : rows, error: null }).then(res, rej);
      } catch (e) {
        return Promise.resolve({ data: null, error: e }).then(res, rej);
      }
    }
  }
  return { supabase: { from: (t) => new Q(t) } };
});

import {
  AccountingError, ERR, bankCashAccounts, isBankCashAccount, resolvePostingAccount, describeAccountsProblem,
  recordPayment, getSourcePayments, getSourcePaidTotal, sumLive, reversePayment, reverseSourcePayments,
  restoreWithLedger, collectInvoicePayment, createInvoiceAndCollect, postUnpostedInvoice, payPayslip,
  createExpenseAndPost, pickDefaultAccountId, rememberAccountChoice,
} from "./accounting";
import { todayLocal } from "./money";

const ACCOUNTS = [
  { id: "a-cash", name: "Cash in Hand", type: "Assets", subType: "Bank & Cash" },
  { id: "a-bank", name: "Meezan Bank", type: "Assets", subType: "Bank & Cash" },
  { id: "a-fixed", name: "Furniture", type: "Assets", subType: "Fixed Assets" },
  { id: "a-ar", name: "Accounts Receivable", type: "Assets", subType: "Accounts Receivable" },
  { id: "a-inc", name: "Fee Income", type: "Income", subType: "Fee Income" },
];

beforeEach(() => {
  mockDb.payments = []; mockDb.invoices = []; mockDb.payslips = []; mockDb.expenses = [];
  mockFail.addDoc = null; mockFail.update = null; mockFail.read = null;
  mockSeq = 0;
  window.localStorage.clear();
});

const seedInvoice = (over = {}) => {
  const row = { id: "inv" + ++mockSeq, deleted_at: null, amount: 5000, status: "pending", paid_amount: 0, extra: { studentName: "Ali", month: "March", year: 2026 }, ...over };
  mockDb.invoices.push(row);
  return { id: row.id, amount: row.amount, studentName: "Ali", month: "March", year: 2026, branchId: "", concessionAmount: 0 };
};
const livePayments = () => mockDb.payments.filter((p) => !p.deleted_at);
const nets = () => sumLive(livePayments().map((p) => ({ type: p.type, amount: p.amount, reversed: p.reversed === true, reversalOf: p.reversal_of })));

describe("account helpers (ACC-07, ACC-08)", () => {
  test("only Bank & Cash accounts are postable, never Fixed Assets or Receivable", () => {
    expect(bankCashAccounts(ACCOUNTS).map((a) => a.id)).toEqual(["a-cash", "a-bank"]);
    expect(isBankCashAccount({ subType: "bank and cash" })).toBe(true);
    expect(isBankCashAccount({ subType: "Assets", type: "Assets" })).toBe(false);
    expect(isBankCashAccount(undefined)).toBe(false);
    expect(bankCashAccounts(null)).toEqual([]);
  });
  test("resolves by id and survives a rename", () => {
    const renamed = ACCOUNTS.map((a) => (a.id === "a-bank" ? { ...a, name: "Meezan Bank Ltd" } : a));
    expect(resolvePostingAccount(renamed, { accountId: "a-bank" })).toEqual({ id: "a-bank", name: "Meezan Bank Ltd" });
  });
  test("an empty or unreadable list is an error, not a silent skip", () => {
    expect(() => resolvePostingAccount([], { accountId: "x" })).toThrow(expect.objectContaining({ code: ERR.NO_ACCOUNTS }));
    expect(() => resolvePostingAccount(undefined, {})).toThrow(expect.objectContaining({ code: ERR.NO_ACCOUNTS }));
    expect(() => resolvePostingAccount([ACCOUNTS[2]], {})).toThrow(expect.objectContaining({ code: ERR.NO_CASH_ACCOUNTS }));
  });
  test("non-cash, missing, and unspecified accounts are rejected", () => {
    expect(() => resolvePostingAccount(ACCOUNTS, { accountId: "a-fixed" })).toThrow(expect.objectContaining({ code: ERR.NOT_CASH_ACCOUNT }));
    expect(() => resolvePostingAccount(ACCOUNTS, { accountId: "nope" })).toThrow(expect.objectContaining({ code: ERR.ACCOUNT_NOT_FOUND }));
    expect(() => resolvePostingAccount(ACCOUNTS, {})).toThrow(expect.objectContaining({ code: ERR.ACCOUNT_REQUIRED }));
  });
  test("legacy name lookup works only when unambiguous", () => {
    expect(resolvePostingAccount(ACCOUNTS, { accountName: "cash in hand" }).id).toBe("a-cash");
    const dup = [...ACCOUNTS, { id: "a-cash2", name: "Cash in Hand", subType: "Bank & Cash" }];
    expect(() => resolvePostingAccount(dup, { accountName: "Cash in Hand" })).toThrow(AccountingError);
  });
  test("describeAccountsProblem distinguishes the cases", () => {
    expect(describeAccountsProblem([], "loading")).toBe("");
    expect(describeAccountsProblem([], "error")).toMatch(/could not be loaded/);
    expect(describeAccountsProblem([], "ready")).toMatch(/No accounts are visible/);
    expect(describeAccountsProblem([ACCOUNTS[2]], "ready")).toMatch(/Bank & Cash/);
    expect(describeAccountsProblem(ACCOUNTS, "ready")).toBe("");
  });
  test("default account is remembered but never an arbitrary pick", () => {
    const postable = bankCashAccounts(ACCOUNTS);
    expect(pickDefaultAccountId(postable)).toBe("");
    expect(pickDefaultAccountId([postable[0]])).toBe("a-cash");
    rememberAccountChoice("a-bank");
    expect(pickDefaultAccountId(postable)).toBe("a-bank");
    rememberAccountChoice("gone");
    expect(pickDefaultAccountId(postable)).toBe("");
  });
});

describe("recordPayment", () => {
  const base = { type: "cash_in", account: "Cash in Hand", accountId: "a-cash", category: "Fee Collection", description: "x" };
  test("rejects missing account, bad type and non-positive / non-numeric amounts", async () => {
    await expect(recordPayment({ ...base, account: "", amount: 10 })).rejects.toThrow("No account selected");
    await expect(recordPayment({ ...base, type: "transfer", amount: 10 })).rejects.toMatchObject({ code: ERR.BAD_TYPE });
    for (const bad of [0, "-5", -5, "abc", NaN, "", null, undefined, Infinity]) {
      await expect(recordPayment({ ...base, amount: bad })).rejects.toMatchObject({ code: ERR.BAD_AMOUNT });
    }
    expect(mockDb.payments).toHaveLength(0);
  });
  test("coerces strings, rounds to 2 dp, stores the account id and a local date", async () => {
    await recordPayment({ ...base, amount: "100.10" });
    await recordPayment({ ...base, amount: 200.2 + 100.1 });
    expect(mockDb.payments.map((p) => p.amount)).toEqual([100.1, 300.3]);
    expect(mockDb.payments[0].extra.accountId).toBe("a-cash");
    expect(mockDb.payments[0].date).toBe(todayLocal());
    expect(mockDb.payments[0].reversed).toBe(false);
  });
  test("rejects an impossible explicit date", async () => {
    await expect(recordPayment({ ...base, amount: 5, date: "2026-02-31" })).rejects.toMatchObject({ code: ERR.BAD_DATE });
  });
});

describe("getSourcePaidTotal / sumLive", () => {
  test("cash_in minus cash_out, ignoring reversed originals and reversal rows", () => {
    expect(sumLive([
      { type: "cash_in", amount: 100.1 },
      { type: "cash_in", amount: 200.2 },
      { type: "cash_out", amount: 50 },
      { type: "cash_in", amount: 999, reversed: true },
      { type: "cash_out", amount: 999, reversalOf: "x" },
    ])).toBe(250.3);
  });
  test("empty source id reads nothing", async () => {
    expect(await getSourcePayments("invoice", "")).toEqual([]);
    expect(await getSourcePaidTotal("invoice", "")).toBe(0);
  });
});

describe("collectInvoicePayment: the one path that marks an invoice paid (ACC-01)", () => {
  test("full payment posts a cash_in by account id and marks the invoice paid and posted", async () => {
    const inv = seedInvoice();
    const r = await collectInvoicePayment({ invoice: inv, accounts: ACCOUNTS, accountId: "a-bank", amount: 5000, date: "2026-03-05" });
    expect(r).toMatchObject({ status: "paid", paidAmount: 5000, cash: 5000, posted: true, accountName: "Meezan Bank" });
    expect(livePayments()).toHaveLength(1);
    expect(livePayments()[0]).toMatchObject({ type: "cash_in", account: "Meezan Bank", amount: 5000, source: "invoice", source_id: inv.id, date: "2026-03-05" });
    expect(livePayments()[0].extra.accountId).toBe("a-bank");
    const row = mockDb.invoices[0];
    expect(row).toMatchObject({ status: "paid", paid_amount: 5000, paid_account: "Meezan Bank", paid_date: "2026-03-05" });
    expect(row.extra).toMatchObject({ studentName: "Ali", month: "March", paidAccountId: "a-bank", ledgerPosted: true });
  });
  test("partial then remainder accumulates from the ledger", async () => {
    const inv = seedInvoice();
    const a = await collectInvoicePayment({ invoice: inv, accounts: ACCOUNTS, accountId: "a-cash", amount: 2000 });
    expect(a).toMatchObject({ status: "partial", paidAmount: 2000, balance: 3000 });
    const b = await collectInvoicePayment({ invoice: inv, accounts: ACCOUNTS, accountId: "a-cash", amount: 3000 });
    expect(b).toMatchObject({ status: "paid", paidAmount: 5000 });
    expect(nets()).toBe(5000);
  });
  test("overpayment is refused and nothing is posted", async () => {
    const inv = seedInvoice();
    await collectInvoicePayment({ invoice: inv, accounts: ACCOUNTS, accountId: "a-cash", amount: 4000 });
    await expect(collectInvoicePayment({ invoice: inv, accounts: ACCOUNTS, accountId: "a-cash", amount: 1000.01 })).rejects.toMatchObject({ code: ERR.BAD_AMOUNT });
    expect(livePayments()).toHaveLength(1);
  });
  test("an empty / unreadable account list throws instead of silently skipping", async () => {
    const inv = seedInvoice();
    await expect(collectInvoicePayment({ invoice: inv, accounts: [], accountId: "", amount: 5000 })).rejects.toMatchObject({ code: ERR.NO_ACCOUNTS });
    expect(livePayments()).toHaveLength(0);
    expect(mockDb.invoices[0].status).toBe("pending");
  });
  test("a non-cash asset account is refused (ACC-08)", async () => {
    const inv = seedInvoice();
    await expect(collectInvoicePayment({ invoice: inv, accounts: ACCOUNTS, accountId: "a-fixed", amount: 5000 })).rejects.toMatchObject({ code: ERR.NOT_CASH_ACCOUNT });
    expect(livePayments()).toHaveLength(0);
  });
  test("allowUnposted marks paid with a visible ledgerPosted:false flag and no ledger row", async () => {
    const inv = seedInvoice();
    const r = await collectInvoicePayment({ invoice: inv, accounts: [], amount: 5000, allowUnposted: true, date: "2026-03-05" });
    expect(r).toMatchObject({ status: "paid", posted: false });
    expect(livePayments()).toHaveLength(0);
    expect(mockDb.invoices[0].extra.ledgerPosted).toBe(false);
    expect(mockDb.invoices[0].extra.unpostedReason).toMatch(/not been posted/);
  });
  test("allowUnposted does not excuse an explicitly chosen bad account", async () => {
    const inv = seedInvoice();
    await expect(collectInvoicePayment({ invoice: inv, accounts: ACCOUNTS, accountId: "a-fixed", amount: 5000, allowUnposted: true })).rejects.toMatchObject({ code: ERR.NOT_CASH_ACCOUNT });
  });
  test("an unposted invoice cannot be collected again until posted", async () => {
    await expect(collectInvoicePayment({ invoice: { ...seedInvoice(), ledgerPosted: false }, accounts: ACCOUNTS, accountId: "a-cash", amount: 10 })).rejects.toMatchObject({ code: ERR.UNPOSTED_PENDING });
  });
  test("postUnpostedInvoice posts the receipt later and clears the flag", async () => {
    const inv = seedInvoice();
    await collectInvoicePayment({ invoice: inv, accounts: [], amount: 5000, allowUnposted: true, date: "2026-03-05" });
    const unposted = { ...inv, ledgerPosted: false, paidAmount: 5000, paidDate: "2026-03-05" };
    const r = await postUnpostedInvoice({ invoice: unposted, accounts: ACCOUNTS, accountId: "a-cash" });
    expect(r.cash).toBe(5000);
    expect(livePayments()[0]).toMatchObject({ amount: 5000, date: "2026-03-05", account: "Cash in Hand" });
    expect(mockDb.invoices[0].extra.ledgerPosted).toBe(true);
  });
  test("concession-only closes the invoice without any cash row", async () => {
    const inv = seedInvoice();
    const r = await collectInvoicePayment({ invoice: inv, accounts: [], amount: 0, concession: true, concessionNote: "Hardship" });
    expect(r).toMatchObject({ status: "paid", cash: 0, concessionAdded: 5000, posted: true });
    expect(livePayments()).toHaveLength(0);
    expect(mockDb.invoices[0]).toMatchObject({ concession_amount: 5000, concession_note: "Hardship", status: "paid" });
  });
  test("if the invoice update fails the posted cash is reversed again", async () => {
    const inv = seedInvoice();
    mockFail.update = "invoices";
    await expect(collectInvoicePayment({ invoice: inv, accounts: ACCOUNTS, accountId: "a-cash", amount: 5000 })).rejects.toMatchObject({ code: ERR.UPDATE_FAILED });
    expect(nets()).toBe(0);
    expect(mockDb.payments).toHaveLength(2);
  });
  test("a failed ledger read blocks the payment instead of assuming nothing was paid", async () => {
    const inv = seedInvoice();
    mockFail.read = "ledger";
    await expect(collectInvoicePayment({ invoice: inv, accounts: ACCOUNTS, accountId: "a-cash", amount: 5000 })).rejects.toMatchObject({ code: ERR.LEDGER_LOOKUP });
    expect(mockDb.payments).toHaveLength(0);
  });
  test("collectRemaining takes whatever balance the ledger says is left", async () => {
    const inv = seedInvoice();
    await collectInvoicePayment({ invoice: inv, accounts: ACCOUNTS, accountId: "a-cash", amount: 1250.5 });
    const r = await collectInvoicePayment({ invoice: inv, accounts: ACCOUNTS, accountId: "a-cash", collectRemaining: true });
    expect(r).toMatchObject({ status: "paid", cash: 3749.5, paidAmount: 5000 });
    await expect(collectInvoicePayment({ invoice: inv, accounts: ACCOUNTS, accountId: "a-cash", collectRemaining: true })).rejects.toMatchObject({ code: ERR.BAD_AMOUNT });
    expect(nets()).toBe(5000);
  });
  test("invalid amounts and dates never reach the ledger", async () => {
    const inv = seedInvoice();
    for (const bad of [-1, "abc", NaN]) {
      await expect(collectInvoicePayment({ invoice: inv, accounts: ACCOUNTS, accountId: "a-cash", amount: bad })).rejects.toThrow(AccountingError);
    }
    await expect(collectInvoicePayment({ invoice: inv, accounts: ACCOUNTS, accountId: "a-cash", amount: 10, date: "31/03/2026" })).rejects.toMatchObject({ code: ERR.BAD_DATE });
    expect(mockDb.payments).toHaveLength(0);
  });
});

describe("createInvoiceAndCollect", () => {
  const data = { studentId: "s1", studentName: "Ali", month: "March", year: 2026, branchId: "", amount: "5000" };
  test("creates the invoice and posts one ledger row", async () => {
    const r = await createInvoiceAndCollect({ invoiceData: data, accounts: ACCOUNTS, accountId: "a-cash", date: "2026-03-05" });
    expect(r).toMatchObject({ status: "paid", posted: true });
    expect(mockDb.invoices).toHaveLength(1);
    expect(livePayments()).toHaveLength(1);
  });
  test("a part-paid imported invoice posts only what was received", async () => {
    const r = await createInvoiceAndCollect({ invoiceData: data, accounts: ACCOUNTS, accountId: "a-cash", date: "2026-03-05", receivedAmount: 2000 });
    expect(r).toMatchObject({ status: "partial", paidAmount: 2000, balance: 3000, cash: 2000 });
    expect(nets()).toBe(2000);
    await expect(createInvoiceAndCollect({ invoiceData: data, accounts: ACCOUNTS, accountId: "a-cash", receivedAmount: 6000 })).rejects.toMatchObject({ code: ERR.BAD_AMOUNT });
    expect(mockDb.invoices).toHaveLength(1);
  });
  test("a bad account is rejected BEFORE the invoice is written", async () => {
    await expect(createInvoiceAndCollect({ invoiceData: data, accounts: ACCOUNTS, accountId: "" })).rejects.toMatchObject({ code: ERR.ACCOUNT_REQUIRED });
    await expect(createInvoiceAndCollect({ invoiceData: data, accounts: [], accountId: "" })).rejects.toMatchObject({ code: ERR.NO_ACCOUNTS });
    await expect(createInvoiceAndCollect({ invoiceData: { ...data, amount: "-5" }, accounts: ACCOUNTS, accountId: "a-cash" })).rejects.toMatchObject({ code: ERR.BAD_AMOUNT });
    expect(mockDb.invoices).toHaveLength(0);
  });
  test("a failure after the invoice exists moves it back to Trash (no duplicate on retry)", async () => {
    mockFail.addDoc = "payments";
    await expect(createInvoiceAndCollect({ invoiceData: data, accounts: ACCOUNTS, accountId: "a-cash" })).rejects.toThrow("insert failed");
    expect(mockDb.invoices).toHaveLength(1);
    expect(mockDb.invoices[0].deleted_at).toBe("T");
  });
  test("QuickPayment style: no usable accounts -> paid but flagged unposted", async () => {
    const r = await createInvoiceAndCollect({ invoiceData: data, accounts: [], allowUnposted: true });
    expect(r).toMatchObject({ status: "paid", posted: false });
    expect(mockDb.invoices[0].extra.ledgerPosted).toBe(false);
    expect(livePayments()).toHaveLength(0);
  });
});

describe("reversePayment (ACC-02, ACC-14)", () => {
  const post = async () => (await recordPayment({ type: "cash_in", account: "Cash in Hand", accountId: "a-cash", amount: 4000, category: "Fee Collection", description: "d", source: "invoice", sourceId: "inv1" })).id;

  test("flags the original, posts the opposite row, and links it by reference", async () => {
    const id = await post();
    const rev = await reversePayment({ id, type: "cash_in", account: "Cash in Hand", accountId: "a-cash", amount: 4000, category: "Fee Collection", description: "d", source: "invoice", sourceId: "inv1" });
    expect(rev).toBeTruthy();
    expect(mockDb.payments[0].reversed).toBe(true);
    expect(mockDb.payments[1]).toMatchObject({ type: "cash_out", amount: 4000, reversal_of: id, reference: id, reversed: false });
    expect(nets()).toBe(0);
  });
  test("a second (concurrent) reversal is a no-op, not a double reversal", async () => {
    const id = await post();
    const p = { id, type: "cash_in", account: "x", amount: 4000 };
    expect(await reversePayment(p)).toBeTruthy();
    expect(await reversePayment(p)).toBeNull();
    expect(mockDb.payments).toHaveLength(2);
  });
  test("if the opposite row cannot be written the original is NOT left reversed", async () => {
    const id = await post();
    mockFail.addDoc = "payments";
    await expect(reversePayment({ id, type: "cash_in", account: "x", amount: 4000 })).rejects.toThrow("insert failed");
    expect(mockDb.payments[0].reversed).toBe(false);
    expect(nets()).toBe(4000);
  });
  test("a reversal row cannot be reversed", async () => {
    await expect(reversePayment({ id: "r", reversalOf: "x", type: "cash_out", amount: 1 })).rejects.toMatchObject({ code: ERR.NOT_REVERSIBLE });
  });
  test("rows with no reversed flag at all (legacy manual entries) can be reversed", async () => {
    mockDb.payments.push({ id: "legacy", type: "cash_out", account: "Cash in Hand", amount: 70, deleted_at: null });
    expect(await reversePayment({ id: "legacy", type: "cash_out", account: "Cash in Hand", amount: 70 })).toBeTruthy();
  });
  test("reverseSourcePayments is idempotent", async () => {
    await post(); await post();
    expect(await reverseSourcePayments("invoice", "inv1")).toBe(2);
    expect(await reverseSourcePayments("invoice", "inv1")).toBe(0);
    expect(mockDb.payments).toHaveLength(4);
    expect(nets()).toBe(0);
  });
});

describe("restoreWithLedger (ACC-03, CODE-09/10)", () => {
  test("delete then restore round trip puts the money back exactly once", async () => {
    const inv = seedInvoice();
    await collectInvoicePayment({ invoice: inv, accounts: ACCOUNTS, accountId: "a-cash", amount: 5000 });
    await reverseSourcePayments("invoice", inv.id); // what Fees.handleDelete does first
    mockDb.invoices[0].deleted_at = "T";
    expect(nets()).toBe(0);
    expect(await getSourcePaidTotal("invoice", inv.id)).toBe(0);

    const r = await restoreWithLedger("invoices", inv.id);
    expect(r.reposted).toBe(1);
    expect(mockDb.invoices[0].deleted_at).toBeNull();
    expect(nets()).toBe(5000);
    expect(await getSourcePaidTotal("invoice", inv.id)).toBe(5000);

    // restoring again (e.g. double click) does not post again
    mockDb.invoices[0].deleted_at = "T";
    expect((await restoreWithLedger("invoices", inv.id)).reposted).toBe(0);
    expect(nets()).toBe(5000);
  });
  test("a re-posted entry reverses cleanly on the next delete", async () => {
    const inv = seedInvoice();
    await collectInvoicePayment({ invoice: inv, accounts: ACCOUNTS, accountId: "a-cash", amount: 5000 });
    await reverseSourcePayments("invoice", inv.id);
    await restoreWithLedger("invoices", inv.id);
    await reverseSourcePayments("invoice", inv.id);
    expect(nets()).toBe(0);
    await restoreWithLedger("invoices", inv.id);
    expect(nets()).toBe(5000);
  });
  test("a legacy half-finished reversal (flag only) is un-flagged, not double counted", async () => {
    mockDb.payments.push({ id: "p1", type: "cash_in", account: "Cash in Hand", amount: 300, reversed: true, source: "expense", source_id: "e1", deleted_at: null });
    // book as cash_out for expense
    mockDb.payments[0].type = "cash_out";
    mockDb.expenses.push({ id: "e1", deleted_at: "T" });
    await restoreWithLedger("expenses", "e1");
    expect(mockDb.payments).toHaveLength(1);
    expect(mockDb.payments[0].reversed).toBe(false);
  });
  test("if the restore fails after re-posting, the re-posts are undone", async () => {
    const inv = seedInvoice();
    await collectInvoicePayment({ invoice: inv, accounts: ACCOUNTS, accountId: "a-cash", amount: 5000 });
    await reverseSourcePayments("invoice", inv.id);
    mockDb.invoices[0].deleted_at = "T";
    mockFail.update = "restore";
    await expect(restoreWithLedger("invoices", inv.id)).rejects.toThrow("restore failed");
    expect(nets()).toBe(0);
    expect(mockDb.invoices[0].deleted_at).toBe("T");
  });
  test("collections without ledger entries just restore", async () => {
    mockDb.invoices.push({ id: "z", deleted_at: "T" });
    expect(await restoreWithLedger("students", "z").catch(() => ({ reposted: 0 }))).toEqual({ reposted: 0 });
  });
});

describe("payPayslip (ACC-09 / CODE-14)", () => {
  const seedSlip = (over = {}) => {
    mockDb.payslips.push({ id: "ps1", deleted_at: null, status: "pending", month: "March", extra: { employeeName: "Sara", year: 2026, netPay: 25000 }, ...over });
    return { id: "ps1" };
  };
  test("pays once, and a second attempt is refused as already paid", async () => {
    const slip = seedSlip();
    const r = await payPayslip({ payslip: slip, accounts: ACCOUNTS, accountId: "a-bank", date: "2026-03-31" });
    expect(r.amount).toBe(25000);
    expect(livePayments()).toHaveLength(1);
    expect(livePayments()[0]).toMatchObject({ type: "cash_out", amount: 25000, account: "Meezan Bank", source: "payslip" });
    expect(mockDb.payslips[0]).toMatchObject({ status: "paid", paid_account: "Meezan Bank" });
    await expect(payPayslip({ payslip: slip, accounts: ACCOUNTS, accountId: "a-bank" })).rejects.toMatchObject({ code: ERR.ALREADY_PAID });
    expect(livePayments()).toHaveLength(1);
  });
  test("uses the fresh payslip, not a stale object passed in", async () => {
    seedSlip({ status: "paid" });
    await expect(payPayslip({ payslip: { id: "ps1", status: "pending", netPay: 25000 }, accounts: ACCOUNTS, accountId: "a-cash" })).rejects.toMatchObject({ code: ERR.ALREADY_PAID });
    expect(mockDb.payments).toHaveLength(0);
  });
  test("a cash_out that exists without a paid status is healed, never paid twice", async () => {
    const slip = seedSlip();
    mockFail.update = "payslips";
    await expect(payPayslip({ payslip: slip, accounts: ACCOUNTS, accountId: "a-cash" })).rejects.toMatchObject({ code: ERR.UPDATE_FAILED });
    expect(livePayments()).toHaveLength(1);
    mockFail.update = null;
    const r = await payPayslip({ payslip: slip, accounts: ACCOUNTS, accountId: "a-cash" });
    expect(r.healed).toBe(true);
    expect(livePayments()).toHaveLength(1);
    expect(mockDb.payslips[0].status).toBe("paid");
  });
  test("refuses zero / negative / missing net pay and a non-cash account", async () => {
    const slip = seedSlip({ extra: { employeeName: "Sara", year: 2026, netPay: -5 } });
    await expect(payPayslip({ payslip: slip, accounts: ACCOUNTS, accountId: "a-cash" })).rejects.toMatchObject({ code: ERR.BAD_AMOUNT });
    mockDb.payslips[0].extra.netPay = 100;
    await expect(payPayslip({ payslip: slip, accounts: ACCOUNTS, accountId: "a-fixed" })).rejects.toMatchObject({ code: ERR.NOT_CASH_ACCOUNT });
    await expect(payPayslip({ payslip: slip, accounts: [], accountId: "" })).rejects.toMatchObject({ code: ERR.NO_ACCOUNTS });
    expect(mockDb.payments).toHaveLength(0);
  });
});

describe("createExpenseAndPost", () => {
  const exp = { description: "Rent", amount: "20000", category: "Rent", date: "2026-03-01", branchId: "" };
  test("posts the cash_out for a paid expense", async () => {
    const r = await createExpenseAndPost({ expense: exp, accounts: ACCOUNTS, accountId: "a-cash" });
    expect(r).toMatchObject({ posted: true, paid: true });
    expect(livePayments()[0]).toMatchObject({ type: "cash_out", amount: 20000, source: "expense", date: "2026-03-01" });
  });
  test("unpaid expense has no ledger row", async () => {
    const r = await createExpenseAndPost({ expense: exp, accounts: ACCOUNTS, accountId: "" });
    expect(r).toMatchObject({ posted: false, paid: false });
    expect(mockDb.payments).toHaveLength(0);
  });
  test("bad amount or account stops before any write", async () => {
    await expect(createExpenseAndPost({ expense: { ...exp, amount: "-1" }, accounts: ACCOUNTS, accountId: "a-cash" })).rejects.toMatchObject({ code: ERR.BAD_AMOUNT });
    await expect(createExpenseAndPost({ expense: exp, accounts: ACCOUNTS, accountId: "a-fixed" })).rejects.toMatchObject({ code: ERR.NOT_CASH_ACCOUNT });
    expect(mockDb.expenses).toHaveLength(0);
  });
  test("a failed posting is reported and the expense is flagged, not silently accepted", async () => {
    mockFail.addDoc = "payments";
    const r = await createExpenseAndPost({ expense: exp, accounts: ACCOUNTS, accountId: "a-cash" });
    expect(r.posted).toBe(false);
    expect(r.error).toBeTruthy();
    expect(mockDb.expenses[0].extra.ledgerPosted).toBe(false);
  });
});
