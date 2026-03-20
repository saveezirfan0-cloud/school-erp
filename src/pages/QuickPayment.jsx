import React, { useState, useEffect } from "react";
import { db, storage } from "../firebase";
import { collection, addDoc, updateDoc, doc, getDocs, serverTimestamp } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { sendWhatsAppMessage } from "../utils/whatsapp";
import toast from "react-hot-toast";
import { Search, CheckCircle } from "lucide-react";

export default function QuickPayment() {
  const [students, setStudents] = useState([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [month, setMonth] = useState("");
  const [receipt, setReceipt] = useState(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    getDocs(collection(db, "students")).then(snap => setStudents(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
  }, []);

  const filtered = search.length > 1 ? students.filter(s =>
    s.name?.toLowerCase().includes(search.toLowerCase()) || s.studentId?.toLowerCase().includes(search.toLowerCase())
  ) : [];

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selected) return toast.error("Please select a student");
    setLoading(true);
    try {
      let receiptUrl = null;
      if (receipt) {
        const fileRef = ref(storage, `receipts/Rs.{Date.now()}_Rs.{receipt.name}`);
        await uploadBytes(fileRef, receipt);
        receiptUrl = await getDownloadURL(fileRef);
      }
      await addDoc(collection(db, "invoices"), {
        studentId: selected.id, studentName: selected.name, parentPhone: selected.parentPhone,
        branchId: selected.branchId, amount: Number(amount), month, paidDate: date,
        status: "paid", receiptUrl, createdAt: serverTimestamp()
      });
      if (selected.parentPhone) {
        await sendWhatsAppMessage(selected.parentPhone, `✅ Payment of Rs. ${amount} received for Rs.{selected.name} for Rs.{month}. Date: Rs.{date}. Thank you!`);
      }
      setDone(true);
      toast.success("Payment recorded & WhatsApp sent!");
    } catch (err) { toast.error("Error recording payment"); }
    setLoading(false);
  };

  if (done) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fafc" }}>
      <div style={{ background: "white", borderRadius: 16, padding: 48, textAlign: "center", boxShadow: "0 4px 24px rgba(0,0,0,0.08)" }}>
        <CheckCircle size={56} color="#10b981" style={{ marginBottom: 16 }} />
        <h2 style={{ fontSize: 22, fontWeight: 700 }}>Payment Recorded!</h2>
        <p style={{ color: "var(--text-muted)", marginTop: 8 }}>Invoice created & WhatsApp notification sent to parent</p>
        <button onClick={() => { setDone(false); setSelected(null); setSearch(""); setAmount(""); setReceipt(null); }}
          style={{ marginTop: 24, padding: "12px 28px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>
          Record Another Payment
        </button>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #1e1b4b 0%, #4f46e5 100%)", padding: 24 }}>
      <div style={{ background: "white", borderRadius: 20, padding: 40, width: "100%", maxWidth: 480, boxShadow: "0 20px 60px rgba(0,0,0,0.15)" }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>💳</div>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>Quick Fee Payment</h1>
          <p style={{ color: "var(--text-muted)", fontSize: 14, marginTop: 4 }}>Log a cash or bank payment</p>
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Search Student</label>
          <div style={{ position: "relative" }}>
            <Search size={16} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
            <input value={search} onChange={e => { setSearch(e.target.value); setSelected(null); }} placeholder="Type name or student ID..."
              style={{ width: "100%", padding: "10px 10px 10px 34px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }} />
          </div>
          {filtered.length > 0 && !selected && (
            <div style={{ border: "1px solid var(--border)", borderRadius: 8, marginTop: 4, overflow: "hidden" }}>
              {filtered.map(s => (
                <div key={s.id} onClick={() => { setSelected(s); setSearch(s.name); setAmount(s.monthlyFee || ""); }}
                  style={{ padding: "10px 14px", cursor: "pointer", borderBottom: "1px solid var(--border)", fontSize: 14 }}
                  onMouseEnter={e => e.target.style.background = "#f8fafc"} onMouseLeave={e => e.target.style.background = "white"}>
                  <strong>{s.name}</strong> <span style={{ color: "var(--text-muted)" }}>({s.studentId})</span>
                </div>
              ))}
            </div>
          )}
          {selected && (
            <div style={{ marginTop: 8, padding: "10px 14px", background: "#ecfdf5", borderRadius: 8, fontSize: 14 }}>
              ✅ <strong>{selected.name}</strong> — {selected.grade} | Parent: {selected.parentName}
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ display: "grid", gap: 16 }}>
            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Month (e.g. January 2026)</label>
              <input value={month} onChange={e => setMonth(e.target.value)} placeholder="January 2026" required
                style={{ width: "100%", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }} />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Amount Received (Rs.)</label>
              <input type="number" value={amount} onChange={e => setAmount(e.target.value)} required
                style={{ width: "100%", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }} />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Payment Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} required
                style={{ width: "100%", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }} />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Receipt Photo (optional)</label>
              <input type="file" accept="image/*" onChange={e => setReceipt(e.target.files[0])}
                style={{ width: "100%", padding: "8px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 13 }} />
            </div>
          </div>
          <button type="submit" disabled={loading || !selected}
            style={{ width: "100%", marginTop: 24, padding: "13px", background: loading || !selected ? "#a5b4fc" : "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 15 }}>
            {loading ? "Recording..." : "Record Payment"}
          </button>
        </form>
        <p style={{ textAlign: "center", marginTop: 16, fontSize: 12, color: "var(--text-muted)" }}>This will create an invoice entry & notify parents via WhatsApp</p>
      </div>
    </div>
  );
}