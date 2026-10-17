// src/utils/columns.js
//
// Value clean-up applied by the Firestore shim before a row reaches Postgres.
//
// Form inputs hand us "" for an empty number field, but Postgres rejects ""
// for a numeric column ("invalid input syntax for type numeric"). Blank
// numeric columns are therefore stored as NULL.

export const NUMERIC_COLUMNS = {
  students: ["monthly_fee"],
  invoices: ["amount", "paid_amount", "concession_amount"],
  expenses: ["amount"],
  payments: ["amount"],
  payslips: ["amount"],
  accounts: ["balance"],
  journals: ["amount"],
  budgets: ["amount"],
  inventory_items: ["unit_price", "opening_stock", "reception_opening", "low_stock_level"],
  inventory_movements: ["quantity"],
  reception_sales: ["quantity", "unit_price", "amount"],
};

export function coerceColumn(table, column, value) {
  const blank = value === "" || value === undefined;
  return blank && NUMERIC_COLUMNS[table]?.includes(column) ? null : value;
}
