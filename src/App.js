import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { BranchProvider } from "./context/BranchContext";
import { UserProvider, useUser } from "./context/UserContext";
import Layout from "./components/Layout/Layout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Students from "./pages/Students";
import Employees from "./pages/Employees";
import Fees from "./pages/Fees";
import Expenses from "./pages/Expenses";
import QuickPayment from "./pages/QuickPayment";
import Branches from "./pages/Branches";
import Settings from "./pages/Settings";
import ChartOfAccounts from "./pages/ChartOfAccounts";
import Payments from "./pages/Payments";
import Payslips from "./pages/Payslips";
import Reports from "./pages/Reports";
import BankCash from "./pages/BankCash";
import AccountDetail from "./pages/AccountDetail";
import Journals from "./pages/Journals";
import Users from "./pages/Users";
import Unauthorized from "./pages/Unauthorized";

function PrivateRoute({ children, permission }) {
  const { user, loading } = useAuth();
  const { can, loadingProfile } = useUser();

  if (loading || loadingProfile) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh" }}>
      <div style={{ width: 36, height: 36, border: "3px solid #f5eaec", borderTop: "3px solid #7a2535", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
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
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/quick-payment" element={<QuickPayment />} />
              <Route path="/unauthorized" element={<Unauthorized />} />
              <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
                <Route index element={<PrivateRoute permission="canViewDashboard"><Dashboard /></PrivateRoute>} />
                <Route path="students" element={<PrivateRoute permission="canViewStudents"><Students /></PrivateRoute>} />
                <Route path="employees" element={<PrivateRoute permission="canViewEmployees"><Employees /></PrivateRoute>} />
                <Route path="fees" element={<PrivateRoute permission="canViewFees"><Fees /></PrivateRoute>} />
                <Route path="expenses" element={<PrivateRoute permission="canViewExpenses"><Expenses /></PrivateRoute>} />
                <Route path="branches" element={<PrivateRoute permission="canManageBranches"><Branches /></PrivateRoute>} />
                <Route path="chart-of-accounts" element={<PrivateRoute permission="canViewAccounting"><ChartOfAccounts /></PrivateRoute>} />
                <Route path="bank-cash" element={<PrivateRoute permission="canViewAccounting"><BankCash /></PrivateRoute>} />
                <Route path="bank-cash/:accountId" element={<PrivateRoute permission="canViewAccounting"><AccountDetail /></PrivateRoute>} />
                <Route path="journals" element={<PrivateRoute permission="canViewAccounting"><Journals /></PrivateRoute>} />
                <Route path="payments" element={<PrivateRoute permission="canViewPayments"><Payments /></PrivateRoute>} />
                <Route path="payslips" element={<PrivateRoute permission="canViewPayslips"><Payslips /></PrivateRoute>} />
                <Route path="reports" element={<PrivateRoute permission="canViewReports"><Reports /></PrivateRoute>} />
                <Route path="users" element={<PrivateRoute permission="canManageUsers"><Users /></PrivateRoute>} />
                <Route path="settings" element={<PrivateRoute><Settings /></PrivateRoute>} />
              </Route>
            </Routes>
          </BrowserRouter>
        </UserProvider>
      </BranchProvider>
    </AuthProvider>
  );
}