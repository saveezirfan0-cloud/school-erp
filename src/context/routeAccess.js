// Ordered list of landing candidates. The first one a user may open
// becomes their "home" page, so roles without dashboard access (for
// example fee collectors) are sent somewhere that works instead of an
// Access Denied loop. Settings and Trash are deliberately not listed:
// every signed-in user can open them, so they say nothing about whether
// a person actually has any working access.
export const HOME_CANDIDATES = [
  { to: "/", permission: "canViewDashboard" },
  { to: "/fees", permission: "canViewFees" },
  { to: "/students", permission: "canViewStudents" },
  { to: "/payments", permission: "canViewPayments" },
  { to: "/expenses", permission: "canViewExpenses" },
  { to: "/payslips", permission: "canViewPayslips" },
  { to: "/employees", permission: "canViewEmployees" },
  { to: "/reports", permission: "canViewReports" },
  { to: "/chart-of-accounts", permission: "canViewAccounting" },
  { to: "/bank-cash", permission: "canViewAccounting" },
  { to: "/journals", permission: "canViewAccounting" },
  { to: "/branches", permission: "canManageBranches" },
  { to: "/users", permission: "canManageUsers" },
];

export function firstPermittedRoute(permissions) {
  const hit = HOME_CANDIDATES.find((r) => permissions?.[r.permission] === true);
  return hit ? hit.to : null;
}

// Delete flags that make the Trash screen useful.
export const DELETE_PERMISSIONS = [
  "canDeleteStudents",
  "canDeleteEmployees",
  "canDeleteExpenses",
];
