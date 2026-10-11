import { isLeftEmployee, leftEmployeeFields, matchesStatusFilter } from "./employeeStatus";

describe("employeeStatus", () => {
  test("isLeftEmployee only matches status 'left'", () => {
    expect(isLeftEmployee({ status: "left" })).toBe(true);
    expect(isLeftEmployee({ status: "active" })).toBe(false);
    expect(isLeftEmployee({})).toBe(false);
    expect(isLeftEmployee(null)).toBe(false);
  });

  test("marking left stops recurring payslips and stamps the date", () => {
    expect(leftEmployeeFields(true, "2026-09-30")).toEqual({
      status: "left", leftDate: "2026-09-30", recurringPayslip: false,
    });
  });

  test("unmarking returns the employee to active", () => {
    expect(leftEmployeeFields(false)).toEqual({ status: "active", leftDate: "" });
  });

  test("status filter treats a missing status as active", () => {
    const left = { status: "left" }, active = { status: "active" }, legacy = {};
    expect([left, active, legacy].filter((r) => matchesStatusFilter(r, "left"))).toEqual([left]);
    expect([left, active, legacy].filter((r) => matchesStatusFilter(r, "active"))).toEqual([active, legacy]);
    expect([left, active, legacy].filter((r) => matchesStatusFilter(r, ""))).toHaveLength(3);
  });
});
