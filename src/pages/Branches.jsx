import React, { useState } from "react";
import { db } from "../firebase";
import { collection, addDoc, deleteDoc, doc, serverTimestamp } from "firebase/firestore";
import { useBranch } from "../context/BranchContext";
import toast from "react-hot-toast";
import { Plus, Trash2, Building2 } from "lucide-react";

export default function Branches() {
  const { branches } = useBranch();
  const [form, setForm] = useState({ name: "", address: "", phone: "", manager: "" });
  const [showForm, setShowForm] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (branches.length >= 4) return toast.error("Maximum 4 branches allowed");
    await addDoc(collection(db, "branches"), { ...form, createdAt: serverTimestamp() });
    toast.success("Branch added");
    setForm({ name: "", address: "", phone: "", manager: "" });
    setShowForm(false);
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 700 }}>Branches / Business Units</h2>
          <p style={{ color: "var(--text-muted)", fontSize: 14, marginTop: 2 }}>Main organization + up to 4 branches</p>
        </div>
        <button onClick={() => setShowForm(!showForm)}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 18px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>
          <Plus size={16} /> Add Branch
        </button>
      </div>

      {showForm && (
        <div style={{ background: "white", borderRadius: 12, padding: 24, border: "1px solid var(--border)", marginBottom: 24 }}>
          <h3 style={{ fontWeight: 600, marginBottom: 16 }}>New Branch</h3>
          <form onSubmit={handleSubmit}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              {[{ label: "Branch Name", key: "name" }, { label: "Manager", key: "manager" }, { label: "Phone", key: "phone" }, { label: "Address", key: "address" }].map(({ label, key }) => (
                <div key={key}>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>{label}</label>
                  <input value={form[key]} onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))} required={key === "name"}
                    style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }} />
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
              <button type="submit" style={{ padding: "10px 20px", background: "var(--primary)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>Create Branch</button>
              <button type="button" onClick={() => setShowForm(false)} style={{ padding: "10px 20px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer" }}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16 }}>
        <div style={{ background: "linear-gradient(135deg, #1e1b4b, #4f46e5)", borderRadius: 12, padding: 24, color: "white" }}>
          <Building2 size={28} style={{ marginBottom: 12, opacity: 0.8 }} />
          <div style={{ fontSize: 18, fontWeight: 700 }}>Main Organization</div>
          <div style={{ opacity: 0.7, fontSize: 14, marginTop: 4 }}>Headquarters</div>
        </div>
        {branches.map(b => (
          <div key={b.id} style={{ background: "white", borderRadius: 12, padding: 24, border: "1px solid var(--border)" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <Building2 size={24} color="var(--primary)" />
              <button onClick={() => deleteDoc(doc(db, "branches", b.id))} style={{ border: "none", background: "none", cursor: "pointer", color: "var(--text-muted)" }}><Trash2 size={15} /></button>
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, marginTop: 12 }}>{b.name}</div>
            <div style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 4 }}>{b.address}</div>
            <div style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 2 }}>Manager: {b.manager}</div>
            <div style={{ color: "var(--text-muted)", fontSize: 13 }}>{b.phone}</div>
          </div>
        ))}
      </div>
    </div>
  );
}