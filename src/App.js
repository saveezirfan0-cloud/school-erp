import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { BranchProvider } from "./context/BranchContext";
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

function PrivateRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh" }}>Loading...</div>;
  return user ? children : <Navigate to="/login" />;
}

export default function App() {
  return (
    <AuthProvider>
      <BranchProvider>
        <BrowserRouter>
          <Toaster position="top-right" />
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/quick-payment" element={<QuickPayment />} />
            <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
              <Route index element={<Dashboard />} />
              <Route path="students" element={<Students />} />
              <Route path="employees" element={<Employees />} />
              <Route path="fees" element={<Fees />} />
              <Route path="expenses" element={<Expenses />} />
              <Route path="branches" element={<Branches />} />
              <Route path="chart-of-accounts" element={<ChartOfAccounts />} />
              <Route path="payments" element={<Payments />} />
              <Route path="payslips" element={<Payslips />} />
              <Route path="reports" element={<Reports />} />
              <Route path="settings" element={<Settings />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </BranchProvider>
    </AuthProvider>
  );
}