import React, { useEffect, useState } from "react";
import { db } from "../firebase";
import { collection, getDocs, query, where } from "firebase/firestore";
import { useBranch } from "../context/BranchContext";
import { Users, Receipt, TrendingDown, TrendingUp } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

export default function Dashboard() {
  const { activeBranch } = useBranch();
  const [stats, setStats] = useState({ students: 0, feesCollected: 0, expenses: 0, pending: 0 });
  const [chartData, setChartData] = useState([]);

  useEffect(() => {
    const fetchStats = async () => {
      const studentsSnap = await getDocs(collection(db, "students"));
      const feesSnap = await getDocs(collection(db, "invoices"));
      const expSnap = await getDocs(collection(db, "expenses"));

      const fees = feesSnap.docs.map(d => d.data());
      const collected = fees.filter(f => f.status === "paid").reduce((s, f) => s + (f.amount || 0), 0);
      const pending = fees.filter(f => f.status === "pending").reduce((s, f) => s + (f.amount || 0), 0);
      const expenses = expSnap.docs.reduce((s, d) => s + (d.data().amount || 0), 0);

      setStats({ students: studentsSnap.size, feesCollected: collected, expenses, pending });

      const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      const monthly = months.map((month, i) => ({
        month,
        fees: fees.filter(f => f.status === "paid" && new Date(f.paidDate?.toDate?.() || f.paidDate).getMonth() === i).reduce((s, f) => s + f.amount, 0),
        expenses: expSnap.docs.filter(d => new Date(d.data().date?.toDate?.() || d.data().date).getMonth() === i).reduce((s, d) => s + d.data().amount, 0),
      }));
      setChartData(monthly);
    };
    fetchStats();
  }, [activeBranch]);

  const cards = [
    { label: "Total Students", value: stats.students, icon: Users, color: "#4f46e5", bg: "#eef2ff" },
    { label: "Fees Collected", value: `$${stats.feesCollected.toLocaleString()}`, icon: TrendingUp, color: "#10b981", bg: "#ecfdf5" },
    { label: "Total Expenses", value: `$${stats.expenses.toLocaleString()}`, icon: TrendingDown, color: "#ef4444", bg: "#fef2f2" },
    { label: "Pending Fees", value: `$${stats.pending.toLocaleString()}`, icon: Receipt, color: "#f59e0b", bg: "#fffbeb" },
  ];

  return (
    <div>
      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 24 }}>Dashboard</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 32 }}>
        {cards.map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} style={{ background: "white", borderRadius: 12, padding: 20, border: "1px solid var(--border)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 6 }}>{label}</div>
                <div style={{ fontSize: 26, fontWeight: 700 }}>{value}</div>
              </div>
              <div style={{ width: 42, height: 42, borderRadius: 10, background: bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Icon size={20} color={color} />
              </div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ background: "white", borderRadius: 12, padding: 24, border: "1px solid var(--border)" }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 20 }}>Monthly Overview</h3>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={chartData}>
            <XAxis dataKey="month" />
            <YAxis />
            <Tooltip />
            <Bar dataKey="fees" fill="#4f46e5" name="Fees Collected" radius={[4,4,0,0]} />
            <Bar dataKey="expenses" fill="#ef4444" name="Expenses" radius={[4,4,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}