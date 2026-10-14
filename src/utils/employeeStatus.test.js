import { isLeftEmployee, employeeLeftFields } from "./employeeStatus";

describe("employeeStatus", () => {
  test("isLeftEmployee only matches status 'left'", () => {
    expect(isLeftEmployee({ status: "left" })).toBe(true);
    expect(isLeftEmployee({ status: "active" })).toBe(false);
    expect(isLeftEmployee({})).toBe(false);
    expect(isLeftEmployee(null)).toBe(false);
  });

  test("marking left stops recurring payslips and stamps the date", () => {
    expect(employeeLeftFields(true, "2026-10-14")).toEqual({
      status: "left", leftDate: "2026-10-14", recurringPayslip: false,
    });
  });

  test("unmarking returns the employee to active", () => {
    expect(employeeLeftFields(false)).toEqual({ status: "active", leftDate: "" });
  });
});
