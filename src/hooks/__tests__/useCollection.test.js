import { compareForSort } from "../useCollection";

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
