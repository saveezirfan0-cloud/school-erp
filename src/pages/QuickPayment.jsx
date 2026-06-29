import React, { useState, useEffect } from "react";
import { db } from "../firebase";
import { collection, addDoc, getDocs, serverTimestamp } from "../firebase";
import { uploadReceipt } from "../lib/storage";
import { sendWhatsAppMessage } from "../utils/whatsapp";
import toast from "react-hot-toast";
import { Search, CheckCircle, ChevronLeft, ChevronRight } from "lucide-react";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

export default function QuickPayment() {
  const [students, setStudents] = useState([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [amount, setAmount] = useState("");
  const [month, setMonth] = useState(MONTHS[new Date().getMonth()]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [receipt, setReceipt] = useState(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    getDocs(collection(db, "students")).then(snap =>
      setStudents(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
  }, []);

  const filtered = search.length > 1
    ? students.filter(s =>
        s.name?.toLowerCase().includes(search.toLowerCase()) ||
        s.studentId?.toLowerCase().includes(search.toLowerCase())
      )
    : [];

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selected) return toast.error("Please select a student");
    setLoading(true);
    try {
      let receiptUrl = null;
      if (receipt) {
        receiptUrl = await uploadReceipt(receipt);
      }
      await addDoc(collection(db, "invoices"), {
        studentId: selected.id,
        studentName: selected.name,
        parentPhone: selected.parentPhone,
        branchId: selected.branchId,
        amount: Number(amount),
        month,
        year,
        paidDate: date,
        status: "paid",
        receiptUrl,
        lineItems: [{ description: "Tuition Fee", amount }],
        createdAt: serverTimestamp()
      });
      if (selected.parentPhone) {
        await sendWhatsAppMessage(
          selected.parentPhone,
          `✅ Payment of Rs. ${amount} received for ${selected.name} for ${month} ${year}. Date: ${date}. Thank you!`
        );
      }
      setDone(true);
      toast.success("Payment recorded!");
    } catch (err) {
      toast.error("Error recording payment");
    }
    setLoading(false);
  };

  const reset = () => {
    setDone(false); setSelected(null); setSearch("");
    setAmount(""); setReceipt(null);
    setMonth(MONTHS[new Date().getMonth()]);
    setYear(new Date().getFullYear());
    setDate(new Date().toISOString().split("T")[0]);
  };

  if (done) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fafc", padding: 16 }}>
      <div style={{ background: "white", borderRadius: 20, padding: 48, textAlign: "center", boxShadow: "0 4px 24px rgba(0,0,0,0.08)", maxWidth: 400, width: "100%" }}>
        <div style={{ width: 64, height: 64, borderRadius: "50%", background: "#ecfdf5", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
          <CheckCircle size={32} color="#10b981" />
        </div>
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Payment Recorded!</h2>
        <p style={{ color: "#64748b", fontSize: 14, marginBottom: 6 }}>
          <strong>{selected?.name}</strong> — {month} {year}
        </p>
        <p style={{ color: "#64748b", fontSize: 14, marginBottom: 24 }}>
          Rs. {Number(amount).toLocaleString()} received
        </p>
        <p style={{ color: "#10b981", fontSize: 13, marginBottom: 28 }}>
          WhatsApp receipt sent to parent ✓
        </p>
        <button onClick={reset}
          style={{ width: "100%", padding: "13px", background: "#7a2535", color: "white", border: "none", borderRadius: 10, cursor: "pointer", fontWeight: 600, fontSize: 15 }}>
          Record Another Payment
        </button>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #4a1520 0%, #7a2535 100%)", padding: 16 }}>
      <div style={{ background: "white", borderRadius: 20, padding: "32px 28px", width: "100%", maxWidth: 440, boxShadow: "0 20px 60px rgba(0,0,0,0.15)" }}>

        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <img src="/zmi_logo.png" alt="ZMI" style={{ width: 60, height: 60, objectFit: "contain", marginBottom: 12 }} />
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "#1e293b" }}>Quick Fee Payment</h1>
          <p style={{ color: "#64748b", fontSize: 13, marginTop: 4 }}>Log a cash or bank payment</p>
        </div>

        {/* Student Search */}
        <div style={{ marginBottom: 18 }}>
          <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#374151" }}>
            Search Student
          </label>
          <div style={{ position: "relative" }}>
            <Search size={15} style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "#94a3b8" }} />
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setSelected(null); }}
              placeholder="Type name or student ID..."
              style={{ width: "100%", padding: "10px 10px 10px 34px", border: "1.5px solid #e2e8f0", borderRadius: 10, fontSize: 15, boxSizing: "border-box" }}
            />
          </div>

          {/* Search results dropdown */}
          {filtered.length > 0 && !selected && (
            <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, marginTop: 4, overflow: "hidden", boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }}>
              {filtered.slice(0, 5).map(s => (
                <div
                  key={s.id}
                  onClick={() => { setSelected(s); setSearch(s.name); setAmount(s.monthlyFee || ""); }}
                  style={{ padding: "11px 14px", cursor: "pointer", borderBottom: "1px solid #f1f5f9", fontSize: 14, background: "white" }}
                  onMouseEnter={e => e.currentTarget.style.background = "#f8fafc"}
                  onMouseLeave={e => e.currentTarget.style.background = "white"}
                >
                  <strong>{s.name}</strong>
                  <span style={{ color: "#94a3b8", fontSize: 12, marginLeft: 8 }}>({s.studentId})</span>
                  <span style={{ float: "right", fontSize: 12, color: "#64748b" }}>{s.grade}</span>
                </div>
              ))}
            </div>
          )}

          {/* Selected student confirmation */}
          {selected && (
            <div style={{ marginTop: 8, padding: "10px 14px", background: "#ecfdf5", borderRadius: 10, fontSize: 13, border: "1px solid #bbf7d0" }}>
              <div style={{ fontWeight: 600, color: "#065f46" }}>✓ {selected.name}</div>
              <div style={{ color: "#047857", marginTop: 2 }}>
                {selected.grade} · Parent: {selected.parentName} · {selected.parentPhone}
              </div>
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit}>

          {/* Month & Year row */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, marginBottom: 16 }}>

            {/* Month dropdown */}
            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#374151" }}>Month</label>
              <select
                value={month}
                onChange={e => setMonth(e.target.value)}
                style={{ width: "100%", padding: "10px 12px", border: "1.5px solid #e2e8f0", borderRadius: 10, fontSize: 15, background: "white", cursor: "pointer" }}
              >
                {MONTHS.map(m => <option key={m}>{m}</option>)}
              </select>
            </div>

            {/* Year stepper */}
            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#374151" }}>Year</label>
              <div style={{ display: "flex", alignItems: "center", gap: 0, border: "1.5px solid #e2e8f0", borderRadius: 10, overflow: "hidden", height: 44 }}>
                <button
                  type="button"
                  onClick={() => setYear(y => y - 1)}
                  style={{ border: "none", background: "#f8fafc", cursor: "pointer", padding: "0 10px", height: "100%", display: "flex", alignItems: "center", color: "#475569" }}
                >
                  <ChevronLeft size={16} />
                </button>
                <span style={{ padding: "0 10px", fontSize: 15, fontWeight: 600, color: "#1e293b", minWidth: 50, textAlign: "center" }}>
                  {year}
                </span>
                <button
                  type="button"
                  onClick={() => setYear(y => y + 1)}
                  style={{ border: "none", background: "#f8fafc", cursor: "pointer", padding: "0 10px", height: "100%", display: "flex", alignItems: "center", color: "#475569" }}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          </div>

          {/* Amount */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#374151" }}>
              Amount Received (Rs.)
            </label>
            <input
              type="number"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              required
              placeholder="0"
              style={{ width: "100%", padding: "10px 12px", border: "1.5px solid #e2e8f0", borderRadius: 10, fontSize: 15, boxSizing: "border-box" }}
            />
          </div>

          {/* Payment Date */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#374151" }}>
              Payment Date
            </label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              required
              style={{ width: "100%", padding: "10px 12px", border: "1.5px solid #e2e8f0", borderRadius: 10, fontSize: 15, boxSizing: "border-box" }}
            />
          </div>

          {/* Receipt upload */}
          <div style={{ marginBottom: 24 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#374151" }}>
              Receipt Photo <span style={{ color: "#94a3b8", fontWeight: 400 }}>(optional)</span>
            </label>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={e => setReceipt(e.target.files[0])}
              style={{ width: "100%", padding: "8px", border: "1.5px solid #e2e8f0", borderRadius: 10, fontSize: 13, boxSizing: "border-box" }}
            />
          </div>

          <button
            type="submit"
            disabled={loading || !selected}
            style={{
              width: "100%",
              padding: "13px",
              background: loading || !selected ? "#c4a0a8" : "#7a2535",
              color: "white",
              border: "none",
              borderRadius: 10,
              cursor: loading || !selected ? "not-allowed" : "pointer",
              fontWeight: 700,
              fontSize: 15,
              transition: "background 0.15s",
            }}
          >
            {loading ? "Recording..." : "Record Payment"}
          </button>

          <p style={{ textAlign: "center", marginTop: 14, fontSize: 11, color: "#94a3b8" }}>
            WhatsApp receipt will be sent to parent automatically
          </p>
        </form>
      </div>
    </div>
  );
}