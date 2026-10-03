import { splitPaymentByHead, feeIncomeAccount, findAccountByName, isAutoJournal } from "./autoJournals";

const accounts = [
  { id: "1", name: "Fees", type: "Income" },
  { id: "2", name: "Admission Fees", type: "Income" },
  { id: "3", name: "Evening Fees", type: "Income" },
  { id: "4", name: "Welfare", type: "Income" },
  { id: "5", name: "Welfare", type: "Expenses" },
  { id: "6", name: "Salaries", type: "Expenses" },
];

test("splits a payment pro rata and always sums to the payment", () => {
  const parts = splitPaymentByHead(1000, [
    { description: "Tuition Fee", amount: 800 }, { description: "Admission Fees", amount: 200 },
  ]);
  expect(parts).toEqual([{ head: "Tuition Fee", amount: 800 }, { head: "Admission Fees", amount: 200 }]);

  const odd = splitPaymentByHead(100, [{ description: "A", amount: 1 }, { description: "B", amount: 1 }, { description: "C", amount: 1 }]);
  expect(odd.reduce((s, p) => s + p.amount, 0)).toBeCloseTo(100, 2);
});

test("a part payment is shared across heads by weight", () => {
  const parts = splitPaymentByHead(500, [{ description: "Tuition Fee", amount: 800 }, { description: "Admission Fees", amount: 200 }]);
  expect(parts.map((p) => p.amount)).toEqual([400, 100]);
});

test("invoices without line items post one Tuition Fee part", () => {
  expect(splitPaymentByHead(750, [])).toEqual([{ head: "Tuition Fee", amount: 750 }]);
  expect(splitPaymentByHead(750, undefined)).toEqual([{ head: "Tuition Fee", amount: 750 }]);
});

test("custom descriptions win over the standard description", () => {
  const [p] = splitPaymentByHead(10, [{ description: "Other", customDescription: "Summer Course", amount: 10 }]);
  expect(p.head).toBe("Summer Course");
});

test("fee heads map to income accounts, ignoring case and 'xN' repeat counts", () => {
  expect(feeIncomeAccount("admission fees", accounts).id).toBe("2");
  expect(feeIncomeAccount("Evening Fees x2", accounts).id).toBe("3");
});

test("heads with no income account fall back to Fees; never an Expenses account", () => {
  expect(feeIncomeAccount("Tuition Fee", accounts).id).toBe("1");
  expect(feeIncomeAccount("Welfare", accounts).id).toBe("4");
  expect(feeIncomeAccount("Tuition Fee", [{ id: "9", name: "Salaries", type: "Expenses" }])).toBeNull();
});

test("findAccountByName respects type", () => {
  expect(findAccountByName(accounts, " salaries ", "Expenses").id).toBe("6");
  expect(findAccountByName(accounts, "Salaries", "Income")).toBeNull();
});

test("isAutoJournal recognises expense and payment sources only", () => {
  expect(isAutoJournal({ source: "expense" })).toBe(true);
  expect(isAutoJournal({ source: "payment" })).toBe(true);
  expect(isAutoJournal({})).toBe(false);
  expect(isAutoJournal(undefined)).toBe(false);
});
