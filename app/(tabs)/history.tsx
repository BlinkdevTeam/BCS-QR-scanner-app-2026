import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../lib/auth';
import { getDb, initDb } from '../../lib/db';
import { supabase } from '../../lib/supabase';
import type { ScanLogRow } from '../../lib/types';

export default function History() {
  const { profile, session, signOut } = useAuth();
  const [rows, setRows] = useState<ScanLogRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [totalCheckedIn, setTotalCheckedIn] = useState(0);

  const loadLocal = useCallback(async () => {
    const db = await initDb();
    const local = await db.getAllAsync<any>(
      `SELECT id, participant_id, participant_name, scanned_by, scanner_name, scanned_at, synced
       FROM scan_log_cache ORDER BY scanned_at DESC LIMIT 500;`
    );
    setRows(
      local.map((r) => ({
        id: r.id,
        participant_id: r.participant_id,
        scanned_by: r.scanned_by,
        scanned_at: r.scanned_at,
        device_id: null,
        synced: !!r.synced,
        scanner_name: r.scanner_name,
        participant_name: r.participant_name,
      }))
    );
  }, []);

  // Pull everyone's scans (including scans made on OTHER devices) and merge
  // them into the local cache so this device's history view stays complete.
  const pullRemote = useCallback(async () => {
    const { data, error } = await supabase
      .from('attendance_logs')
      .select(
        'id, participant_id, scanned_by, scanned_at, participants(first_name, middle_name, last_name), scanner_profiles(display_name)'
      )
      .order('scanned_at', { ascending: false })
      .limit(500);

    if (error || !data) return;
    const db = await getDb();
    await db.withTransactionAsync(async () => {
      for (const r of data as any[]) {
        const name = [r.participants?.first_name, r.participants?.middle_name, r.participants?.last_name]
          .filter(Boolean)
          .join(' ');
        await db.runAsync(
          `INSERT INTO scan_log_cache (id, participant_id, participant_name, scanned_by, scanner_name, scanned_at, synced)
           VALUES (?, ?, ?, ?, ?, ?, 1)
           ON CONFLICT(id) DO UPDATE SET synced = 1;`,
          [r.id, r.participant_id, name || 'Unknown', r.scanned_by, r.scanner_profiles?.display_name ?? null, r.scanned_at]
        );
      }
    });
    setTotalCheckedIn(data.length);
  }, []);

  useEffect(() => {
    if (!profile) return;
    pullRemote().then(loadLocal);

    const channel = supabase
      .channel('attendance_logs')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'attendance_logs' },
        () => {
          pullRemote().then(loadLocal);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile, pullRemote, loadLocal]);

  const onRefresh = async () => {
    setRefreshing(true);
    await pullRemote();
    await loadLocal();
    setRefreshing(false);
  };

  return (
    <View style={styles.container}>
      <View style={styles.accountBar}>
        <View style={{ flex: 1 }}>
          <Text style={styles.accountLabel}>Signed in as</Text>
          <Text style={styles.accountEmail}>{session?.user?.email ?? 'unknown'}</Text>
          {profile ? <Text style={styles.accountRole}>Operator: {profile.display_name}</Text> : null}
        </View>
        <Pressable style={styles.signOutButton} onPress={signOut}>
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </View>

      <View style={styles.summary}>
        <Text style={styles.summaryCount}>{totalCheckedIn}</Text>
        <Text style={styles.summaryLabel}>checked in</Text>
      </View>
      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.participant_name}</Text>
              <Text style={styles.meta}>
                {new Date(item.scanned_at).toLocaleTimeString()} · scanned by {item.scanner_name ?? '—'}
              </Text>
            </View>
            {!item.synced ? <Text style={styles.pendingBadge}>pending</Text> : null}
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={styles.emptyText}>No scans yet.</Text>
          </View>
        }
        contentContainerStyle={rows.length === 0 ? { flex: 1 } : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  accountBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderColor: '#eee',
  },
  accountLabel: { fontSize: 11, color: '#888' },
  accountEmail: { fontSize: 14, fontWeight: '600', color: '#111', marginTop: 1 },
  accountRole: { fontSize: 12, color: '#666', marginTop: 1 },
  signOutButton: {
    borderWidth: 1,
    borderColor: '#111',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  signOutText: { fontSize: 13, fontWeight: '600', color: '#111' },
  summary: { alignItems: 'center', paddingVertical: 16, borderBottomWidth: 1, borderColor: '#eee' },
  summaryCount: { fontSize: 32, fontWeight: '800' },
  summaryLabel: { fontSize: 13, color: '#666' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: '#f0f0f0',
  },
  name: { fontSize: 16, fontWeight: '600' },
  meta: { fontSize: 12, color: '#888', marginTop: 2 },
  pendingBadge: {
    fontSize: 11,
    color: '#fff',
    backgroundColor: '#111',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    overflow: 'hidden',
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: '#999' },
});