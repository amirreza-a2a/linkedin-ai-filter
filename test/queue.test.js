import test from "node:test";
import assert from "node:assert/strict";

test("Request Queue - resilience and deadlock prevention via try/finally", async () => {
  const processedBatches = [];
  const batchQueue = [];
  let isProcessingQueue = false;

  function simulateSendBatchMessage(batch, callback) {
    try {
      if (batch.shouldThrow) {
        throw new Error("Simulated unexpected dispatch exception");
      }
      processedBatches.push(batch.id);
      callback();
    } catch (e) {
      // simulate extension disconnected or sync exception
      callback();
    }
  }

  async function processQueue() {
    if (isProcessingQueue || batchQueue.length === 0) return;
    isProcessingQueue = true;

    try {
      while (batchQueue.length > 0) {
        const nextBatch = batchQueue.shift();
        await new Promise((resolve) => {
          try {
            simulateSendBatchMessage(nextBatch, resolve);
          } catch (sendErr) {
            resolve();
          }
        });
      }
    } catch (err) {
      // Catch unexpected errors
    } finally {
      isProcessingQueue = false;
      if (batchQueue.length > 0) {
        setTimeout(processQueue, 0);
      }
    }
  }

  // 1. Queue three batches where the second one throws an unexpected exception
  batchQueue.push({ id: 1 });
  batchQueue.push({ id: 2, shouldThrow: true });
  batchQueue.push({ id: 3 });

  await processQueue();

  // Verify that batch 1 and batch 3 were processed and isProcessingQueue reset to false
  assert.equal(isProcessingQueue, false);
  assert.deepEqual(processedBatches, [1, 3]);

  // 2. Queue another batch afterwards to verify the queue is not deadlocked
  batchQueue.push({ id: 4 });
  await processQueue();

  assert.equal(isProcessingQueue, false);
  assert.deepEqual(processedBatches, [1, 3, 4]);
});
