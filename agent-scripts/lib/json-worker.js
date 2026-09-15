import { parentPort } from 'node:worker_threads';

parentPort.on('message', (msg) => {
  const { id, data } = msg;

  // DoS Prevention: Limit input size to 5MB
  if (typeof data !== 'string' || data.length > 5 * 1024 * 1024) {
    parentPort.postMessage({ id, error: 'Input data exceeds 5MB size limit.' });
    return;
  }

  try {
    const parsedData = JSON.parse(data);
    parentPort.postMessage({ id, result: parsedData });
  } catch (err) {
    // Let the caller apply its supplied fallback
    parentPort.postMessage({ id, error: err.message });
  }
});
