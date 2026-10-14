// An employee who has left is kept (their payslip history stays on record)
// but must not be paid again automatically: recurring payslip generation
// skips them. Stored as `status: "left"` (+ optional `leftDate`) on the employee.
export const isLeftEmployee = (employee) => employee?.status === "left";

// Fields to merge into an employee record when toggling the "left" state.
export function employeeLeftFields(left, today = new Date().toISOString().slice(0, 10)) {
  return left
    ? { status: "left", leftDate: today, recurringPayslip: false }
    : { status: "active", leftDate: "" };
}
