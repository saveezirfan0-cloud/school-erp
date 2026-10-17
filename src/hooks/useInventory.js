// src/hooks/useInventory.js
//
// Live inventory data for the Storage, Reception Inventory and Take Out
// Stock pages: items, every stock movement, reception sales, and the stock
// figures worked out from them (utils/inventory.js summarizeStock).
// Pass { sales: false } when a page does not need the sales list.

import { useEffect, useMemo, useState } from "react";
import { db, collection, onSnapshot } from "../firebase";
import { summarizeStock } from "../utils/inventory";

const byName = (a, b) => String(a.name || "").localeCompare(String(b.name || ""), undefined, { numeric: true })
  || String(a.code || "").localeCompare(String(b.code || ""), undefined, { numeric: true });

export function useInventory({ sales: wantSales = true } = {}) {
  const [items, setItems] = useState(null);
  const [movements, setMovements] = useState(null);
  const [sales, setSales] = useState(wantSales ? null : []);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fail = (e) => { console.error("Inventory load failed:", e); setError(e); };
    const subs = [
      onSnapshot(collection(db, "inventoryItems"), (s) => setItems(s.docs.map((d) => ({ id: d.id, ...d.data() })).sort(byName)), fail),
      onSnapshot(collection(db, "inventoryMovements"), (s) => setMovements(s.docs.map((d) => ({ id: d.id, ...d.data() }))), fail),
    ];
    if (wantSales) {
      subs.push(onSnapshot(collection(db, "receptionSales"), (s) => setSales(s.docs.map((d) => ({ id: d.id, ...d.data() }))), fail));
    }
    return () => subs.forEach((u) => u && u());
  }, [wantSales]);

  const loading = !error && (items === null || movements === null || sales === null);
  const summary = useMemo(
    () => summarizeStock(items || [], movements || [], sales || []),
    [items, movements, sales]
  );
  const itemById = useMemo(() => new Map((items || []).map((i) => [i.id, i])), [items]);

  return {
    items: items || [], movements: movements || [], sales: sales || [],
    summary, itemById, loading, error,
  };
}
