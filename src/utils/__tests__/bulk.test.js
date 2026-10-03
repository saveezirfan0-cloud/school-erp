import { runBulk, bulkResultMessage } from "../bulk";

describe("runBulk", () => {
  test("processes every item in order and reports ok rows", async () => {
    const seen = [];
    const { ok, failed } = await runBulk([1, 2, 3, 4, 5], async (n) => { seen.push(n); }, { chunkSize: 2 });
    expect(ok).toEqual([1, 2, 3, 4, 5]);
    expect(failed).toEqual([]);
    expect(seen).toEqual([1, 2, 3, 4, 5]);
  });

  test("a failing row does not abort the batch and is reported with its error", async () => {
    const boom = new Error("bad");
    const { ok, failed } = await runBulk(["a", "b", "c"], async (x) => { if (x === "b") throw boom; }, { chunkSize: 2 });
    expect(ok).toEqual(["a", "c"]);
    expect(failed).toEqual([{ item: "b", error: boom }]);
  });

  test("limits concurrency to the chunk size", async () => {
    let running = 0;
    let max = 0;
    await runBulk(Array.from({ length: 10 }, (_, i) => i), async () => {
      running += 1; max = Math.max(max, running);
      await new Promise((r) => setTimeout(r, 1));
      running -= 1;
    }, { chunkSize: 3 });
    expect(max).toBe(3);
  });

  test("reports progress after each chunk, capped at the total", async () => {
    const progress = jest.fn();
    await runBulk([1, 2, 3, 4, 5], async () => {}, { chunkSize: 2, onProgress: progress });
    expect(progress.mock.calls).toEqual([[2, 5], [4, 5], [5, 5]]);
  });

  test("empty input", async () => {
    expect(await runBulk([], async () => {})).toEqual({ ok: [], failed: [] });
  });
});

describe("bulkResultMessage", () => {
  test("all ok", () => expect(bulkResultMessage(3, 0, "deleted", "invoices")).toBe("3 invoices deleted"));
  test("all failed", () => expect(bulkResultMessage(0, 2, "deleted", "invoices")).toBe("Failed — no invoices were deleted"));
  test("mixed", () => expect(bulkResultMessage(2, 1, "paid", "invoices")).toBe("2 invoices paid · 1 failed"));
});
