// src/hooks/useProfileData.js
//
// Small real-time hooks for the student / employee profile pages.
// They sit on the same Firestore-shaped shim as useCollection, so a
// change made in another tab or by another user shows up live.

import { useEffect, useState } from "react";
import { db, doc, collection, query, where, onSnapshot } from "../firebase";

// One document by id: { record, loading, notFound }.
export function useDocument(name, id) {
  const [state, setState] = useState({ record: null, loading: true, notFound: false });
  useEffect(() => {
    setState({ record: null, loading: true, notFound: false });
    return onSnapshot(
      doc(db, name, id),
      (snap) => setState(snap.exists()
        ? { record: { id: snap.id, ...snap.data() }, loading: false, notFound: false }
        : { record: null, loading: false, notFound: true }),
      (err) => { console.error(`useDocument(${name}) error:`, err); setState({ record: null, loading: false, notFound: true }); }
    );
  }, [name, id]);
  return state;
}

// Rows of `name` where every `filters` field equals its value.
// `enabled=false` skips the subscription (e.g. no permission to read it).
// Filter fields must be real columns (student_id, employee_id, ...).
export function useRelated(name, filters, enabled = true) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(enabled);
  const key = JSON.stringify(filters);
  useEffect(() => {
    if (!enabled) { setRows([]); setLoading(false); return undefined; }
    setLoading(true);
    const clauses = Object.entries(JSON.parse(key)).map(([f, v]) => where(f, "==", v));
    return onSnapshot(
      query(collection(db, name), ...clauses),
      (snap) => { setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() }))); setLoading(false); },
      (err) => { console.error(`useRelated(${name}) error:`, err); setLoading(false); }
    );
  }, [name, key, enabled]);
  return { rows, loading };
}
