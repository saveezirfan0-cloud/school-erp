export function exportToCSV(filename, headers, rows) {
  const csvContent = [
    headers.join(","),
    ...rows.map(row => row.map(cell => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
  ].join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// Cells and titles are data (student names, branch names…): escape them
// before they go into the printable document.
const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function exportToPDF(rawTitle, rawHeaders, rawRows) {
  const title = esc(rawTitle);
  const headers = rawHeaders.map(esc);
  const rows = rawRows.map(row => row.map(esc));
  const w = window.open("", "_blank");
  w.document.write(`<html><head><title>${title}</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 32px; color: #1e293b; }
    h2 { color: #7a2535; margin-bottom: 4px; }
    p { color: #64748b; font-size: 13px; margin-bottom: 20px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { background: #7a2535; color: white; padding: 10px 12px; text-align: left; }
    td { padding: 9px 12px; border-bottom: 1px solid #e2e8f0; }
    tr:nth-child(even) td { background: #f8fafc; }
    .footer { margin-top: 32px; font-size: 12px; color: #94a3b8; text-align: center; }
  </style></head><body>
  <h2>${title}</h2>
  <p>Zohra Majeed Islamic Institute — Generated ${new Date().toLocaleDateString()}</p>
  <table>
    <thead><tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr></thead>
    <tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${cell ?? ""}</td>`).join("")}</tr>`).join("")}</tbody>
  </table>
  <div class="footer">ZMI School Management System — zmi.skofi.tech</div>
  </body></html>`);
  w.document.close();
  w.print();
}