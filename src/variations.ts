export async function variationStore<T>(
  key: string,
  value?: T,
): Promise<T | undefined> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("pokecritic-variations", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("replays");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const transaction = database.transaction(
        "replays",
        value === undefined ? "readonly" : "readwrite",
      );
      const store = transaction.objectStore("replays");
      const request =
        value === undefined ? store.get(key) : store.put(value, key);
      transaction.oncomplete = () =>
        resolve(value === undefined ? request.result : value);
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("Could not save variations"));
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}
