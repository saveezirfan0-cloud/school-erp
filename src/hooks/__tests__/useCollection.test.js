import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { compareForSort, useCollection } from "../useCollection";
import { onSnapshot } from "../../firebase";

jest.mock("../../firebase", () => ({ db: {}, collection: jest.fn(), onSnapshot: jest.fn() }));

describe("compareForSort", () => {
  const sortAsc = (arr) => arr.slice().sort((a, b) => compareForSort(a, b, 1));
  const sortDesc = (arr) => arr.slice().sort((a, b) => compareForSort(a, b, -1));

  test("numbers sort numerically, not as text", () => {
    expect(sortAsc([10, 9, 100, 1])).toEqual([1, 9, 10, 100]);
    expect(sortAsc(["10", "9"])).toEqual(["9", "10"]);
  });

  test("blank values (null, undefined, empty) always sort last, in both directions", () => {
    expect(sortAsc([null, 5, "", 1, undefined])).toEqual([1, 5, null, "", undefined]);
    expect(sortDesc([null, 5, 1])).toEqual([5, 1, null]);
  });

  test("text is case-insensitive", () => {
    expect(sortAsc(["b", "A", "c"])).toEqual(["A", "b", "c"]);
  });

  test("numerically equal ids fall back to text order", () => {
    expect(compareForSort("001", "1", 1)).toBeLessThan(0);
  });
});

describe("useCollection custom filter functions", () => {
  beforeAll(() => { global.IS_REACT_ACT_ENVIRONMENT = true; });
  const payments = [
    { id: "a", date: "2026-08-31", type: "cash_in" },
    { id: "b", date: "2026-09-01", type: "cash_in" },
    { id: "c", date: "2026-09-15", type: "cash_out" },
    { id: "d", date: "2026-09-30", type: "cash_in" },
    { id: "e", date: "2026-10-01", type: "cash_in" },
  ];
  beforeEach(() => {
    onSnapshot.mockImplementation((_ref, onNext) => {
      onNext({ docs: payments.map(({ id, ...rest }) => ({ id, data: () => rest })), truncated: false });
      return () => {};
    });
  });
  const run = (filters) => {
    let ids = null;
    function Probe() {
      ids = useCollection("payments", {
        filters,
        filterFns: {
          dateFrom: (row, val) => !val || (row.date || "") >= val,
          dateTo: (row, val) => !val || (row.date || "") <= val,
        },
        sortBy: "date",
        sortDir: "asc",
      }).filtered.map((r) => r.id);
      return null;
    }
    const root = createRoot(document.createElement("div"));
    // react-dom root (no Testing Library in this repo), so act() is required here
    // eslint-disable-next-line testing-library/no-unnecessary-act
    act(() => { root.render(<Probe />); });
    act(() => { root.unmount(); });
    return ids;
  };

  test("a date range keeps rows inside it (inclusive) and drops the rest", () => {
    expect(run({ type: "", dateFrom: "2026-09-01", dateTo: "2026-09-30" })).toEqual(["b", "c", "d"]);
  });

  test("from-only and to-only ranges work", () => {
    expect(run({ dateFrom: "2026-09-30", dateTo: "" })).toEqual(["d", "e"]);
    expect(run({ dateFrom: "", dateTo: "2026-08-31" })).toEqual(["a"]);
  });

  test("date range combines with a plain equality filter", () => {
    expect(run({ type: "cash_in", dateFrom: "2026-09-01", dateTo: "2026-09-30" })).toEqual(["b", "d"]);
  });
});
