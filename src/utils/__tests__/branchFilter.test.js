import { matchesBranch } from "../branchFilter";

describe("matchesBranch", () => {
  test('"all" matches everything, even a null record', () => {
    expect(matchesBranch({ branchId: "b1" }, "all")).toBe(true);
    expect(matchesBranch({}, "all")).toBe(true);
    expect(matchesBranch(null, "all")).toBe(true);
  });

  test('"main" matches missing, empty and "main" branch ids only', () => {
    expect(matchesBranch({}, "main")).toBe(true);
    expect(matchesBranch({ branchId: "" }, "main")).toBe(true);
    expect(matchesBranch({ branchId: null }, "main")).toBe(true);
    expect(matchesBranch({ branchId: "main" }, "main")).toBe(true);
    expect(matchesBranch({ branchId: "b1" }, "main")).toBe(false);
  });

  test("a specific branch matches exactly", () => {
    expect(matchesBranch({ branchId: "b1" }, "b1")).toBe(true);
    expect(matchesBranch({ branchId: "b2" }, "b1")).toBe(false);
    expect(matchesBranch({}, "b1")).toBe(false);
  });

  test("a null record never matches a specific branch and does not throw", () => {
    expect(matchesBranch(null, "b1")).toBe(false);
    expect(matchesBranch(undefined, "main")).toBe(false);
  });
});
