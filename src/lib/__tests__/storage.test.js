import { supabase } from "../supabaseClient";
import { uploadReceipt, validateReceipt, receiptPath, MAX_RECEIPT_BYTES } from "../storage";

jest.mock("../supabaseClient", () => ({ supabase: { storage: { from: jest.fn() } } }));

// jsdom has no Web Crypto; use Node's.
beforeAll(() => {
  Object.defineProperty(window, "crypto", { value: require("crypto").webcrypto, configurable: true });
});

const file = (over = {}) => ({ name: "../../evil name.PNG", type: "image/png", size: 1000, ...over });

describe("validateReceipt", () => {
  test("accepts images and PDF within the size limit", () => {
    ["image/jpeg", "image/png", "image/webp", "application/pdf"].forEach((type) => {
      expect(() => validateReceipt(file({ type }))).not.toThrow();
    });
  });

  test.each([
    ["image/svg+xml"], ["text/html"], ["application/javascript"], ["application/x-msdownload"], [""], ["toString"],
  ])("rejects type %j", (type) => {
    expect(() => validateReceipt(file({ type }))).toThrow(/JPG, PNG, WebP/);
  });

  test("rejects empty, oversized and missing files", () => {
    expect(() => validateReceipt(file({ size: 0 }))).toThrow(/empty/);
    expect(() => validateReceipt(file({ size: MAX_RECEIPT_BYTES + 1 }))).toThrow(/too large/);
    expect(() => validateReceipt(null)).toThrow(/No file/);
    expect(() => validateReceipt(file({ size: MAX_RECEIPT_BYTES }))).not.toThrow();
  });
});

describe("receiptPath", () => {
  test("is month folder + random id + extension from the MIME type, never the file name", () => {
    const p = receiptPath(file(), new Date(Date.UTC(2026, 2, 5)));
    expect(p).toMatch(/^2026-03\/[0-9a-f-]{16,}\.png$/);
    expect(p).not.toContain("evil");
    expect(p).not.toContain("..");
  });

  test("two uploads of the same file get different paths", () => {
    expect(receiptPath(file())).not.toBe(receiptPath(file()));
  });
});

describe("uploadReceipt", () => {
  test("validates before touching storage", async () => {
    const from = jest.fn();
    supabase.storage.from.mockImplementation(from);
    await expect(uploadReceipt(file({ type: "text/html" }))).rejects.toThrow(/JPG, PNG/);
    expect(from).not.toHaveBeenCalled();
  });

  test("uploads to a generated path with the declared content type and returns the public URL", async () => {
    const upload = jest.fn(async () => ({ error: null }));
    const getPublicUrl = jest.fn((path) => ({ data: { publicUrl: `https://x/${path}` } }));
    supabase.storage.from.mockImplementation(() => ({ upload, getPublicUrl }));
    const url = await uploadReceipt(file());
    const [path, , opts] = upload.mock.calls[0];
    expect(path).toMatch(/^\d{4}-\d{2}\/.+\.png$/);
    expect(opts).toMatchObject({ upsert: false, contentType: "image/png" });
    expect(url).toBe(`https://x/${path}`);
  });

  test("propagates storage errors", async () => {
    supabase.storage.from.mockImplementation(() => ({ upload: async () => ({ error: new Error("quota") }) }));
    await expect(uploadReceipt(file())).rejects.toThrow("quota");
  });
});
