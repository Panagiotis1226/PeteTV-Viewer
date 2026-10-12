/** Tiny IndexedDB key/value wrapper with a localStorage/in-memory fallback. */
const DB = 'petetv';
const STORE = 'kv';

let dbp: Promise<IDBDatabase | null> | null = null;
const mem = new Map<string, unknown>();

function openOnce(timeoutMs: number): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (db: IDBDatabase | null) => {
      if (!done) {
        done = true;
        resolve(db);
      }
    };
    // IndexedDB occasionally never answers (seen in Chrome/WebView under load):
    // don't let that freeze the app on its splash screen.
    setTimeout(() => finish(null), timeoutMs);
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => {
        if (done) req.result.close();
        else finish(req.result);
      };
      req.onerror = () => finish(null);
    } catch {
      finish(null);
    }
  });
}

function open(): Promise<IDBDatabase | null> {
  if (!dbp) {
    // One retry, then fall back to in-memory storage for this session.
    dbp = openOnce(4000).then((db) => db || openOnce(4000)).then((db) => {
      if (!db) console.warn('IndexedDB unavailable: settings will not be saved this session');
      return db;
    });
  }
  return dbp;
}

export async function get<T>(key: string): Promise<T | undefined> {
  const db = await open();
  if (!db) return mem.get(key) as T | undefined;
  return new Promise((resolve) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => resolve(undefined);
  });
}

export async function set(key: string, value: unknown): Promise<void> {
  const db = await open();
  if (!db) {
    mem.set(key, value);
    return;
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function del(key: string): Promise<void> {
  const db = await open();
  if (!db) {
    mem.delete(key);
    return;
  }
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}
