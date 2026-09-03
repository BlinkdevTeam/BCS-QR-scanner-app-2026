import * as Crypto from 'expo-crypto';
import { getDb, initDb } from './db';
import { supabase } from './supabase';
import { findParticipantByToken } from './participants';
import { fullName } from './types';
import type { ScanResult } from './types';

const POSTGRES_UNIQUE_VIOLATION = '23505';

/** Called every time the operator's camera decodes a QR code. The code is
 * assumed to be the participant's ticket_token. Always resolves locally
 * first (works offline), then tries to push to Supabase. */
export async function recordScan(params: {
  scannedCode: string;
  scannedBy: string;
  scannerName: string;
  deviceId: string;
}): Promise<ScanResult> {
  const { scannedCode, scannedBy, scannerName, deviceId } = params;
  const db = await initDb();

  const participant = await findParticipantByToken(scannedCode);
  if (!participant) {
    return { status: 'not_found', code: scannedCode };
  }

  // Local duplicate check — catches repeat scans on this device instantly,
  // without waiting on a network round trip.
  const alreadyLogged = await db.getFirstAsync<{ id: string; scanner_name: string | null; scanned_at: string }>(
    `SELECT id, scanner_name, scanned_at FROM scan_log_cache WHERE participant_id = ? LIMIT 1;`,
    [participant.id]
  );
  if (alreadyLogged) {
    return {
      status: 'duplicate',
      participant,
      scannedAt: alreadyLogged.scanned_at,
      scannedBy: alreadyLogged.scanner_name ?? 'another scanner',
    };
  }

  const scannedAt = new Date().toISOString();
  const localId = Crypto.randomUUID();
  const participantName = fullName(participant);

  // Try the real insert first. The DB's unique(participant_id) constraint
  // is the source of truth for cross-device duplicates.
  const { error } = await supabase.from('attendance_logs').insert({
    id: localId,
    participant_id: participant.id,
    scanned_by: scannedBy,
    scanned_at: scannedAt,
    device_id: deviceId,
  });

  if (!error) {
    await db.runAsync(
      `INSERT INTO scan_log_cache (id, participant_id, participant_name, scanned_by, scanner_name, scanned_at, synced)
       VALUES (?, ?, ?, ?, ?, ?, 1);`,
      [localId, participant.id, participantName, scannedBy, scannerName, scannedAt]
    );
    return { status: 'success', participant, scannedAt };
  }

  // A unique-constraint violation means someone else already checked this
  // person in — fetch that record so the operator sees who/when.
  if (error.code === POSTGRES_UNIQUE_VIOLATION) {
    const { data: existing } = await supabase
      .from('attendance_logs')
      .select('scanned_at, scanner_profiles(display_name)')
      .eq('participant_id', participant.id)
      .maybeSingle();

    await db.runAsync(
      `INSERT INTO scan_log_cache (id, participant_id, participant_name, scanned_by, scanner_name, scanned_at, synced)
       VALUES (?, ?, ?, ?, ?, ?, 1);`,
      [
        localId,
        participant.id,
        participantName,
        scannedBy,
        (existing as any)?.scanner_profiles?.display_name ?? 'another scanner',
        existing?.scanned_at ?? scannedAt,
      ]
    );

    return {
      status: 'duplicate',
      participant,
      scannedAt: existing?.scanned_at ?? scannedAt,
      scannedBy: (existing as any)?.scanner_profiles?.display_name ?? 'another scanner',
    };
  }

  // Any other error (almost always: no network) — queue it locally and
  // show it in history immediately as "pending sync".
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO pending_scans (local_id, participant_id, scanned_by, scanned_at, device_id, attempts)
       VALUES (?, ?, ?, ?, ?, 0);`,
      [localId, participant.id, scannedBy, scannedAt, deviceId]
    );
    await db.runAsync(
      `INSERT INTO scan_log_cache (id, participant_id, participant_name, scanned_by, scanner_name, scanned_at, synced)
       VALUES (?, ?, ?, ?, ?, ?, 0);`,
      [localId, participant.id, participantName, scannedBy, scannerName, scannedAt]
    );
  });

  return { status: 'queued_offline', code: scannedCode };
}

/** Call periodically (e.g. every 15s) and whenever connectivity is restored. */
export async function syncPendingScans(): Promise<{ synced: number; duplicates: number; failed: number }> {
  const db = await getDb();
  const pending = await db.getAllAsync<{
    local_id: string;
    participant_id: string;
    scanned_by: string;
    scanned_at: string;
    device_id: string | null;
    attempts: number;
  }>(`SELECT * FROM pending_scans ORDER BY scanned_at ASC LIMIT 25;`);

  let synced = 0;
  let duplicates = 0;
  let failed = 0;

  for (const item of pending) {
    const { error } = await supabase.from('attendance_logs').insert({
      id: item.local_id,
      participant_id: item.participant_id,
      scanned_by: item.scanned_by,
      scanned_at: item.scanned_at,
      device_id: item.device_id,
    });

    if (!error) {
      await db.runAsync(`DELETE FROM pending_scans WHERE local_id = ?;`, [item.local_id]);
      await db.runAsync(`UPDATE scan_log_cache SET synced = 1 WHERE id = ?;`, [item.local_id]);
      synced++;
      continue;
    }

    if (error.code === POSTGRES_UNIQUE_VIOLATION) {
      // Someone else's scan of this participant already landed first — ours
      // is redundant, so drop it from the queue but leave local history intact.
      await db.runAsync(`DELETE FROM pending_scans WHERE local_id = ?;`, [item.local_id]);
      await db.runAsync(`UPDATE scan_log_cache SET synced = 1 WHERE id = ?;`, [item.local_id]);
      duplicates++;
      continue;
    }

    await db.runAsync(
      `UPDATE pending_scans SET attempts = attempts + 1, last_error = ? WHERE local_id = ?;`,
      [String(error.message ?? 'unknown error'), item.local_id]
    );
    failed++;
  }

  return { synced, duplicates, failed };
}

export async function pendingCount(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ count: number }>(`SELECT COUNT(*) as count FROM pending_scans;`);
  return row?.count ?? 0;
}
