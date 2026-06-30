import React, { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { BranchProvider } from "./context/BranchContext";
import { UserProvider, useUser } from "./context/UserContext";
import Layout from "./components/Layout/Layout";

// Login is needed immediately; keep it eager. Everything else is
// lazy-loaded so the initial bundle stays small and heavy pages
// (charts, Excel export) only download when actually opened.
import Login from "./pages/Login";

const Dashboard = lazy(() => import("./pages/Dashboard"));
const Students = lazy(() => import("./pages/Students"));
const StudentLedger = lazy(() => import("./pages/StudentLedger"));
const Employees = lazy(() => import("./pages/Employees"));
const Fees = lazy(() => import("./pages/Fees"));
const Expenses = lazy(() => import("./pages/Expenses"));
const QuickPayment = lazy(() => import("./pages/QuickPayment"));
const Branches = lazy(() => import("./pages/Branches"));
const Settings = lazy(() => import("./pages/Settings"));
const ChartOfAccounts = lazy(() => import("./pages/ChartOfAccounts"));
const Payments = lazy(() => import("./pages/Payments"));
const Payslips = lazy(() => import("./pages/Payslips"));
const Reports = lazy(() => import("./pages/Reports"));
const BankCash = lazy(() => import("./pages/BankCash"));
const AccountDetail = lazy(() => import("./pages/AccountDetail"));
const Journals = lazy(() => import("./pages/Journals"));
const Users = lazy(() => import("./pages/Users"));
const Unauthorized = lazy(() => import("./pages/Unauthorized"));
const ReminderLogs = lazy(() => import("./pages/ReminderLogs"));
const Import = lazy(() => import("./pages/Import"));
const Trash = lazy(() => import("./pages/Trash"));

const PageLoader = () => (
  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 60 }}>
    <div style={{ width: 32, height: 32, border: "3px solid #f5eaec", borderTop: "3px solid #7a2535", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
  </div>
);

function PrivateRoute({ children, permission }) {
  const { user, loading } = useAuth();
  const { can, loadingProfile } = useUser();

  if (loading || loadingProfile) return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "center",
      height: "100vh", flexDirection: "column", gap: 12
    }}>
      <div style={{
        width: 36, height: 36,
        border: "3px solid #f5eaec",
        borderTop: "3px solid #7a2535",
        borderRadius: "50%",
        animation: "spin 0.8s linear infinite"
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <p style={{ color: "#64748b", fontSize: 14 }}>Loading...</p>
    </div>
  );

  if (!user) return <Navigate to="/login" />;
  if (permission && !can(permission)) return <Navigate to="/unauthorized" />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <BranchProvider>
        <UserProvider>
          <BrowserRouter>
            <Toaster position="top-right" />
            <Suspense fallback={<PageLoader />}>
            <Routes>
              {/* Public routes */}
              <Route path="/login" element={<Login />} />
              <Route path="/quick-payment" element={<QuickPayment />} />
              <Route path="/unauthorized" element={<Unauthorized />} />

              {/* Protected routes */}
              <Route path="/" element={
                <PrivateRoute>
                  <Layout />
                </PrivateRoute>
              }>
                <Route index element={
                  <PrivateRoute permission="canViewDashboard">
                    <Dashboard />
                  </PrivateRoute>
                } />
                <Route path="students" element={
                  <PrivateRoute permission="canViewStudents">
                    <Students />
                  </PrivateRoute>
                } />
                <Route path="students/:id/ledger" element={
                  <PrivateRoute permission="canViewStudents">
                    <StudentLedger />
                  </PrivateRoute>
                } />
                <Route path="employees" element={
                  <PrivateRoute permission="canViewEmployees">
                    <Employees />
                  </PrivateRoute>
                } />
                <Route path="fees" element={
                  <PrivateRoute permission="canViewFees">
                    <Fees />
                  </PrivateRoute>
                } />
                <Route path="expenses" element={
                  <PrivateRoute permission="canViewExpenses">
                    <Expenses />
                  </PrivateRoute>
                } />
                <Route path="branches" element={
                  <PrivateRoute permission="canManageBranches">
                    <Branches />
                  </PrivateRoute>
                } />
                <Route path="chart-of-accounts" element={
                  <PrivateRoute permission="canViewAccounting">
                    <ChartOfAccounts />
                  </PrivateRoute>
                } />
                <Route path="bank-cash" element={
                  <PrivateRoute permission="canViewAccounting">
                    <BankCash />
                  </PrivateRoute>
                } />
                <Route path="bank-cash/:accountId" element={
                  <PrivateRoute permission="canViewAccounting">
                    <AccountDetail />
                  </PrivateRoute>
                } />
                <Route path="journals" element={
                  <PrivateRoute permission="canViewAccounting">
                    <Journals />
                  </PrivateRoute>
                } />
                <Route path="payments" element={
                  <PrivateRoute permission="canViewPayments">
                    <Payments />
                  </PrivateRoute>
                } />
                <Route path="payslips" element={
                  <PrivateRoute permission="canViewPayslips">
                    <Payslips />
                  </PrivateRoute>
                } />
                <Route path="reports" element={
                  <PrivateRoute permission="canViewReports">
                    <Reports />
                  </PrivateRoute>
                } />
                <Route path="users" element={
                  <PrivateRoute permission="canManageUsers">
                    <Users />
                  </PrivateRoute>
                } />
                <Route path="reminder-logs" element={
                  <PrivateRoute permission="canViewReports">
                    <ReminderLogs />
                  </PrivateRoute>
                } />
                <Route path="import" element={
                  <PrivateRoute permission="canManageUsers">
                    <Import />
                  </PrivateRoute>
                } />
                <Route path="settings" element={
                  <PrivateRoute>
                    <Settings />
                  </PrivateRoute>
                } />
                <Route path="trash" element={
                  <PrivateRoute>
                    <Trash />
                  </PrivateRoute>
                } />
              </Route>
            </Routes>
            </Suspense>
          </BrowserRouter>
        </UserProvider>
      </BranchProvider>
    </AuthProvider>
  );
}