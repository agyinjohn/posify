/**
 * offlineSync.js
 *
 * - syncQueue()        : drain all pending items in sale_queue one at a time.
 * - useOfflineSync()   : React hook — returns { online, queue, syncing, sync }.
 *
 * The hook re-renders whenever the queue changes or connectivity flips.
 * It also auto-syncs when the browser comes back online.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getAllQueued, markSynced, markFailed, retryQueued,
  discardQueued as dbDiscard,
} from './offlineDb.js';

// Token is read lazily so it always reflects the current login.
function getToken() {
  return localStorage.getItem('pos_token') || '';
}

const BASE = import.meta.env.VITE_API_URL || '/api';

/**
 * POST one queued sale to the server.
 * Returns the created sale on success, throws on failure.
 */
async function postSale(payload) {
  let res;
  try {
    res = await fetch(`${BASE}/sales`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getToken()}`,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    // fetch only rejects when the server can't be reached (every browser words it differently).
    throw Object.assign(new Error('Server unreachable'), { network: true });
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(data?.error || `Server error (${res.status})`), { status: res.status });
  return data;
}

/**
 * Drain all pending items. Stops on the first network failure (server
 * unreachable) or 401 and leaves the sale pending; continues past real
 * rejections (e.g. 409 oversell) so one bad sale doesn't block the rest.
 *
 * @param {function} onProgress  called after each item with the updated queue
 */
export async function syncQueue(onProgress) {
  const items = await getAllQueued();
  const pending = items.filter((i) => i.status === 'pending');
  for (const item of pending) {
    try {
      await postSale(item.payload);
      await markSynced(item.id);
    } catch (err) {
      // Server unreachable or signed out: nothing is wrong with the sale itself, so leave it pending
      // and stop; it goes through on the next sync. Only real rejections (e.g. out of stock) are marked failed.
      if (err.network || err.status === 401) break;
      await markFailed(item.id, err.message);
    }
    if (onProgress) onProgress(await getAllQueued());
  }
  return getAllQueued();
}

// ── React hook ────────────────────────────────────────────────────────────────

export function useOfflineSync() {
  const [online, setOnline] = useState(navigator.onLine);
  const [queue, setQueue] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const syncingRef = useRef(false); // guard against concurrent runs

  const refreshQueue = useCallback(async () => {
    setQueue(await getAllQueued());
  }, []);

  // Sync all pending items and refresh queue state.
  const sync = useCallback(async () => {
    if (syncingRef.current || !navigator.onLine) return;
    syncingRef.current = true;
    setSyncing(true);
    try {
      const final = await syncQueue((updated) => setQueue(updated));
      setQueue(final);
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, []);

  const retry = useCallback(async (id) => {
    await retryQueued(id);
    await refreshQueue();
    sync();
  }, [refreshQueue, sync]);

  const discard = useCallback(async (id) => {
    await dbDiscard(id);
    await refreshQueue();
  }, [refreshQueue]);

  // Track online/offline.
  useEffect(() => {
    const goOnline = () => { setOnline(true); sync(); };
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, [sync]);

  // Load queue on mount and auto-sync if already online.
  useEffect(() => {
    refreshQueue().then(() => { if (navigator.onLine) sync(); });
  }, [refreshQueue, sync]);

  return { online, queue, syncing, sync, retry, discard };
}
