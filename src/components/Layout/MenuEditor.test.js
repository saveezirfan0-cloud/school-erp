/* eslint-disable testing-library/no-unnecessary-act */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { MemoryRouter } from "react-router-dom";
import MenuEditor from "./MenuEditor";
import CommandPalette from "./CommandPalette";
import { useUser } from "../../context/UserContext";

jest.mock("react-hot-toast", () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../../context/UserContext", () => ({ useUser: jest.fn() }));
const mockNavigate = jest.fn();
jest.mock("react-router-dom", () => ({ ...jest.requireActual("react-router-dom"), useNavigate: () => mockNavigate }));

global.IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollIntoView = jest.fn(); // not implemented in jsdom

let container, root, user;
const baseUser = () => ({
  can: () => true, isAdmin: true, role: "admin",
  menuLayout: null, ownMenuLayout: null, roleMenuLayout: null, roleMenuDefaults: {}, customRolePerms: {},
  saveMenuLayout: jest.fn().mockResolvedValue(), saveRoleMenuDefault: jest.fn().mockResolvedValue(),
  menuPrefs: { pinned: [], collapsed: null }, saveMenuPrefs: jest.fn(),
});

const render = (el) => act(() => { root.render(<MemoryRouter>{el}</MemoryRouter>); });
const $ = (sel) => document.body.querySelector(sel);
const click = (sel) => act(() => { $(sel).click(); });
const type = (el, value) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
});
const sectionItems = (layout, id) => layout.sections.find((s) => s.id === id).items;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  user = baseUser();
  useUser.mockImplementation(() => user);
  window.confirm = jest.fn(() => true);
  mockNavigate.mockClear();
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

test("reorder + hide, then Save stores the layout on the user", async () => {
  render(<MenuEditor onClose={jest.fn()} />);
  click('[aria-label="Move Employees up"]');
  click('[aria-label="Hide Trash"]');
  await act(async () => { [...document.body.querySelectorAll("button")].find((b) => b.textContent === "Save menu").click(); });
  expect(user.saveMenuLayout).toHaveBeenCalledTimes(1);
  const saved = user.saveMenuLayout.mock.calls[0][0];
  expect(sectionItems(saved, "people")).toEqual(["employees", "students"]);
  expect(saved.hidden).toEqual(["trash"]);
  expect(user.saveRoleMenuDefault).not.toHaveBeenCalled();
});

test("pin star updates preferences immediately", () => {
  render(<MenuEditor onClose={jest.fn()} />);
  click('[aria-label="Pin Fees & Invoices"]');
  expect(user.saveMenuPrefs).toHaveBeenCalledWith({ pinned: ["fees"], collapsed: null });
});

test("admins can edit a role's default menu; it saves to that role, not the user", async () => {
  render(<MenuEditor onClose={jest.fn()} />);
  act(() => { [...document.body.querySelectorAll("button")].find((b) => b.textContent === "Role defaults").click(); });
  expect($('select[aria-label="Role"]').value).toBe("branch_manager");
  click('[aria-label="Hide Reports"]');
  await act(async () => { [...document.body.querySelectorAll("button")].find((b) => b.textContent === "Save menu").click(); });
  expect(user.saveRoleMenuDefault).toHaveBeenCalledTimes(1);
  const [roleId, layout] = user.saveRoleMenuDefault.mock.calls[0];
  expect(roleId).toBe("branch_manager");
  expect(layout.hidden).toEqual(["reports"]);
  expect(user.saveMenuLayout).not.toHaveBeenCalled();
});

test("non-admins don't get role-default controls and only see pages they can open", () => {
  user = { ...baseUser(), isAdmin: false, role: "accountant", can: (p) => p === "canViewStudents" };
  useUser.mockImplementation(() => user);
  render(<MenuEditor onClose={jest.fn()} />);
  expect([...document.body.querySelectorAll("button")].some((b) => b.textContent === "Role defaults")).toBe(false);
  expect($('[aria-label="Move Students up"]')).not.toBeNull();
  expect($('[aria-label="Move Payslips up"]')).toBeNull();
});

test("reset to default saves null when a custom layout exists", async () => {
  user.ownMenuLayout = user.menuLayout = { sections: [{ id: "a", label: "Mine", items: ["students"] }], hidden: [] };
  render(<MenuEditor onClose={jest.fn()} />);
  await act(async () => { [...document.body.querySelectorAll("button")].find((b) => b.textContent.includes("Reset")).click(); });
  expect(user.saveMenuLayout).toHaveBeenCalledWith(null);
});

test("command palette filters pages, ignores forbidden ones, and Enter navigates", () => {
  user = { ...baseUser(), isAdmin: false, can: (p) => p === "canViewPayslips" };
  useUser.mockImplementation(() => user);
  const onClose = jest.fn();
  render(<CommandPalette onClose={onClose} />);
  type($('input[aria-label="Search pages"]'), "salary");
  const options = [...document.body.querySelectorAll('[role="option"]')].map((o) => o.textContent);
  expect(options).toEqual([expect.stringContaining("Payslips")]);
  act(() => { $('[role="dialog"]').dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
  expect(mockNavigate).toHaveBeenCalledWith("/payslips");
  expect(onClose).toHaveBeenCalled();
  type($('input[aria-label="Search pages"]'), "students");
  expect(document.body.textContent).toContain("No pages match");
});
