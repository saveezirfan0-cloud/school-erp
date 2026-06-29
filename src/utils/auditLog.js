import { db } from "../firebase";
import { collection, addDoc, serverTimestamp } from "../firebase";

export async function logAction(user, action, module, details = "") {
  try {
    await addDoc(collection(db, "auditLog"), {
      user: user?.email || "unknown",
      action,
      module,
      details,
      timestamp: serverTimestamp()
    });
  } catch (e) {
    console.error("Audit log error", e);
  }
}