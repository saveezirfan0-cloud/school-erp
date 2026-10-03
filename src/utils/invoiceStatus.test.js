import { deriveInvoiceStatus } from "./invoiceStatus";

describe("deriveInvoiceStatus", () => {
  it("is paid once received + conceded covers the total", () => {
    expect(deriveInvoiceStatus(3500, 3500)).toBe("paid");
    expect(deriveInvoiceStatus(3500, 3000, 500)).toBe("paid");
  });
  it("is partial when some money is in but not enough", () => {
    expect(deriveInvoiceStatus(5000, 3500)).toBe("partial");
  });
  it("is pending when nothing has been received", () => {
    expect(deriveInvoiceStatus(5000, 0)).toBe("pending");
  });
  it("raising the total of a paid invoice reopens it", () => {
    expect(deriveInvoiceStatus(4000, 3500)).toBe("partial");
  });
});
