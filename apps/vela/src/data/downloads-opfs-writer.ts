// Older WebKit exposes OPFS sync handles in dedicated workers only. Keep the file
// handle in the worker and acknowledge writes only after flushing them.
const syncWriterScript = `
let file;
onmessage = async ({ data: [method, value, offset] }) => {
  try {
    if (method === 'open') {
      file = await value.createSyncAccessHandle();
      if (offset === 0) file.truncate(0);
    } else if (method === 'write') {
      if (file.write(value, { at: offset }) !== value.byteLength)
        throw new DOMException('Incomplete OPFS write', 'QuotaExceededError');
      file.flush();
    } else {
      file.flush();
      file.close();
    }
    postMessage(null);
  } catch (error) {
    postMessage(error.name || 'UnknownError');
  }
};
`;

export async function openOpfsWriter(handle: FileSystemFileHandle, offset: number) {
  if (typeof handle.createWritable === 'function') {
    const writer = await handle.createWritable({ keepExistingData: offset > 0 });
    try {
      if (offset > 0) await writer.seek(offset);
    } catch (error) {
      await writer.abort().catch(() => {});
      throw error;
    }
    return {
      write: (chunk: Uint8Array<ArrayBuffer>) => writer.write(chunk),
      close: () => writer.close(),
      abort: () => writer.abort(),
    };
  }
  const url = URL.createObjectURL(new Blob([syncWriterScript], { type: 'text/javascript' }));
  let worker: Worker;
  try {
    worker = new Worker(url);
  } finally {
    URL.revokeObjectURL(url);
  }
  const call = (method: string, value?: FileSystemFileHandle | Uint8Array, at?: number) =>
    new Promise<void>((resolve, reject) => {
      worker.onmessage = ({ data }) => data ? reject(new DOMException('OPFS write failed', data)) : resolve();
      worker.onerror = () => reject(new Error('OPFS worker unavailable'));
      worker.postMessage([method, value, at]);
    });
  try {
    await call('open', handle, offset);
  } catch (error) {
    worker.terminate();
    throw error;
  }
  let position = offset;
  return {
    async write(chunk: Uint8Array<ArrayBuffer>) {
      await call('write', chunk, position);
      position += chunk.byteLength;
    },
    async close() {
      try {
        await call('close');
      } finally {
        worker.terminate();
      }
    },
    async abort() { worker.terminate(); },
  };
}

export async function writeOpfsFile(handle: FileSystemFileHandle, contents: Blob) {
  const writer = await openOpfsWriter(handle, 0);
  try {
    for (let offset = 0; offset < contents.size; offset += 1024 * 1024) {
      await writer.write(new Uint8Array(await contents.slice(offset, offset + 1024 * 1024).arrayBuffer()));
    }
    await writer.close();
  } catch (error) {
    await writer.abort().catch(() => {});
    throw error;
  }
}
