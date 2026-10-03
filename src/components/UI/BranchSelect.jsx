import React from "react";
import { useBranch } from "../../context/BranchContext";

// Branch picker for create/edit forms. Only offers what the current
// workspace may assign: head office view can pick head office or any
// branch; a branch workspace (or a branch-locked user) only its own branch.
export default function BranchSelect({ value, onChange, style, headOfficeLabel = "Head Office" }) {
  const { branchChoices, canAssignHeadOffice, branches } = useBranch();

  // When editing a record that belongs to a branch outside the current
  // choices, keep it selectable so the form doesn't silently change it.
  const current = value && !branchChoices.some(b => b.id === value)
    ? branches.find(b => b.id === value)
    : null;

  return (
    <select value={value || ""} onChange={e => onChange(e.target.value)} style={style}>
      {(canAssignHeadOffice || !value) && <option value="">{headOfficeLabel}</option>}
      {current && <option value={current.id}>{current.name}</option>}
      {branchChoices.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
    </select>
  );
}
