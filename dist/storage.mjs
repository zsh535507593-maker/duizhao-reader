let database;
async function db() {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open('duizhao-reader', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('session');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return database;
}
export async function storage(action, key, value) {
  const connection = await db();
  return new Promise((resolve, reject) => {
    const transaction = connection.transaction('session', action === 'get' ? 'readonly' : 'readwrite');
    const store = transaction.objectStore('session');
    const request = action === 'get' ? store.get(key) : action === 'put' ? store.put(value, key) : action === 'clear' ? store.clear() : store.delete(key);
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
