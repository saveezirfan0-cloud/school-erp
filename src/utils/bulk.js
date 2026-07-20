// src/utils/bulk.js
//
// Run a per-row async job over many records with limited concurrency,
// progress callbacks, and per-row failure tracking. Used by bulk
// actions that can't be a single SQL statement — e.g. reversing an
// invoice's ledger payments before deleting it, or posting one fee
// payment per selected invoice.
//
// Unlike Promise.all, one failing row does not abort the batch: we
// finish the rest and report exactly which rows failed, so a bulk
// action never leaves the user guessing what happened.

export async function runBulk(items, worker, { chunkSize = 4, onProgress } = {}) {
  const ok = [];
  const failed = []; // [{ item, error }]
  let done = 0;

  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const results = await Promise.allSettled(chunk.map((item) => worker(item)));
    results.forEach((res, idx) => {
      const item = chunk[idx];
      if (res.status === "fulfilled") ok.push(item);
      else failed.push({ item, error: res.reason });
    });
    done += chunk.length;
    if (onProgress) onProgress(Math.min(done, items.length), items.length);
  }

  return { ok, failed };
}

// Standard toast copy for a finished bulk run. `verb` is past tense
// ("deleted", "updated", "paid", "restored").
export function bulkResultMessage(okCount, failedCount, verb, noun) {
  if (failedCount === 0) return `${okCount} ${noun} ${verb}`;
  if (okCount === 0) return `Failed — no ${noun} were ${verb}`;
  return `${okCount} ${noun} ${verb} · ${failedCount} failed`;
}
