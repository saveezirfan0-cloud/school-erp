import { isLeftStudent, leftStatusFields } from "./studentStatus";

describe("studentStatus", () => {
  test("isLeftStudent only matches status 'left'", () => {
    expect(isLeftStudent({ status: "left" })).toBe(true);
    expect(isLeftStudent({ status: "active" })).toBe(false);
    expect(isLeftStudent({})).toBe(false);
    expect(isLeftStudent(null)).toBe(false);
  });

  test("marking left stops recurring fees and stamps the date", () => {
    expect(leftStatusFields(true, "2026-09-30")).toEqual({
      status: "left", leftDate: "2026-09-30", recurringFee: false,
    });
  });

  test("unmarking returns the student to active", () => {
    expect(leftStatusFields(false)).toEqual({ status: "active", leftDate: "" });
  });
});
