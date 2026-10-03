// A student who has left is kept (their paid history and any dues stay on
// record) but must not be billed again: recurring and bulk fee generation
// skip them. Stored as `status: "left"` (+ optional `leftDate`) on the student.
export const isLeftStudent = (student) => student?.status === "left";

// Fields to merge into a student record when toggling the "left" state.
export function leftStatusFields(left, today = new Date().toISOString().slice(0, 10)) {
  return left
    ? { status: "left", leftDate: today, recurringFee: false }
    : { status: "active", leftDate: "" };
}
