import { supabase } from "../../lib/supabaseClient";
import { addDoc, collection, serverTimestamp } from "../../firebase";
import { logActivity, logAction } from "../auditLog";

jest.mock("../../lib/supabaseClient", () => ({ supabase: { auth: { getSession: jest.fn() } } }));
jest.mock("../../firebase", () => ({
  db: {},
  collection: jest.fn(),
  addDoc: jest.fn(),
  serverTimestamp: jest.fn(),
}));

// CRA resets mock implementations before every test, so set them here.
beforeEach(() => {
  collection.mockImplementation((_db, name) => ({ name }));
  serverTimestamp.mockReturnValue("TS");
});

const signedIn = (user) => supabase.auth.getSession.mockResolvedValue({ data: { session: user ? { user } : null } });

describe("logActivity", () => {
  test("records the real auth identity", async () => {
    signedIn({ id: "uid-1", email: "a@b.c" });
    addDoc.mockResolvedValue({ id: null });
    expect(await logActivity("created", "Invoices", "x")).toBe(true);
    expect(addDoc).toHaveBeenCalledWith({ name: "auditLog" }, {
      user: "a@b.c", userId: "uid-1", action: "created", module: "Invoices", details: "x", timestamp: "TS",
    });
  });

  test("falls back to the user id when the account has no email", async () => {
    signedIn({ id: "uid-2" });
    addDoc.mockResolvedValue({});
    await logActivity("a", "m");
    expect(addDoc.mock.calls[0][1]).toMatchObject({ user: "uid-2", userId: "uid-2" });
  });

  test("the legacy logAction cannot log as someone else", async () => {
    signedIn({ id: "real", email: "real@x.y" });
    addDoc.mockResolvedValue({});
    await logAction({ email: "boss@x.y", id: "other" }, "deleted", "Users", "d");
    const row = addDoc.mock.calls[0][1];
    expect(row.user).toBe("real@x.y");
    expect(row.userId).toBe("real");
  });

  test("does nothing when nobody is signed in", async () => {
    signedIn(null);
    expect(await logActivity("a", "m")).toBe(false);
    expect(addDoc).not.toHaveBeenCalled();
  });

  test("never throws: a failed insert or auth lookup resolves false", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    signedIn({ id: "u" });
    addDoc.mockRejectedValue(new Error("rls"));
    await expect(logActivity("a", "m")).resolves.toBe(false);
    supabase.auth.getSession.mockRejectedValue(new Error("net"));
    await expect(logActivity("a", "m")).resolves.toBe(false);
    warn.mockRestore();
  });
});
