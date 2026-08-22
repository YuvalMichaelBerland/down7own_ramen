import { database } from './database';

const STALE_DAYS = 3;

// Chat threads with no activity for a while are just noise for the chef to scroll past,
// so any thread untouched for STALE_DAYS gets swept on the next read of either side.
export async function purgeStaleThreads() {
  const cutoff = new Date(Date.now() - STALE_DAYS * 86_400_000).toISOString();
  await database().prepare(`DELETE FROM messages WHERE google_subject IN (SELECT google_subject FROM messages GROUP BY google_subject HAVING MAX(created_at) < ?)`).bind(cutoff).run();
}
