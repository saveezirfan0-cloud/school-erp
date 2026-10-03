// Student name/ID are optional, so anything that displays a student needs a
// fallback rather than rendering a blank.
export const studentName = (s) => s?.name || s?.studentId || "Unnamed student";

export const studentOptionLabel = (s) =>
  s?.name && s?.studentId ? `${s.name} (${s.studentId})` : studentName(s);
