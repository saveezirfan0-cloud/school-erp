import { isLeftStudent } from "./studentStatus";

// Staff who have left (resigned, retired, contract ended) stay on record —
// their payslips and history are kept — but must not get new payslips:
// recurring payslip generation skips them. Stored as `status: "left"`
// (+ optional `leftDate`) on the employee, the same shape as students.
export const isLeftEmployee = (employee) => employee?.status === "left";

// Fields to merge into an employee record when toggling the "left" state.
export function leftEmployeeFields(left, today = new Date().toISOString().slice(0, 10)) {
  return left
    ? { status: "left", leftDate: today, recurringPayslip: false }
    : { status: "active", leftDate: "" };
}

// Shared by the Students and Employees list filters. Anything that is not
// explicitly "left" counts as active, including records with no status yet.
export const STATUS_FILTER_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "left", label: "Left / inactive" },
];

export const matchesStatusFilter = (row, want) =>
  want === "left" ? isLeftStudent(row) : want === "active" ? !isLeftStudent(row) : true;
