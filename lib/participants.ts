import { getDb, initDb } from './db';
import { supabase } from './supabase';
import type { Participant } from './types';

/** Pulls the participant list into local SQLite so scanning still works
 * (lookup + queued logging) even with zero connectivity at the venue. */
export async function syncParticipantsToLocal(): Promise<number> {
  const db = await initDb();
  const { data, error } = await supabase
    .from('participants')
    .select('id, first_name, middle_name, last_name, email, ticket_token, reg_status');

  if (error) throw error;
  if (!data) return 0;

  await db.withTransactionAsync(async () => {
    for (const p of data) {
      await db.runAsync(
        `INSERT INTO participants_cache (id, first_name, middle_name, last_name, email, ticket_token, reg_status)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           first_name = excluded.first_name,
           middle_name = excluded.middle_name,
           last_name = excluded.last_name,
           email = excluded.email,
           ticket_token = excluded.ticket_token,
           reg_status = excluded.reg_status;`,
        [p.id, p.first_name, p.middle_name, p.last_name, p.email, p.ticket_token, p.reg_status]
      );
    }
  });

  return data.length;
}

export async function findParticipantByToken(ticketToken: string): Promise<Participant | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<Participant>(
    `SELECT id, first_name, middle_name, last_name, email, ticket_token, reg_status
     FROM participants_cache WHERE ticket_token = ?;`,
    [ticketToken]
  );
  return row ?? null;
}

export async function localParticipantCount(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM participants_cache;`
  );
  return row?.count ?? 0;
}
