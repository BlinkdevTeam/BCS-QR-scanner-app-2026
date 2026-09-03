import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import Constants from 'expo-constants';
import { useAuth } from '../../lib/auth';
import { syncParticipantsToLocal, localParticipantCount } from '../../lib/participants';
import { recordScan, syncPendingScans, pendingCount } from '../../lib/scanQueue';
import { fullName } from '../../lib/types';
import type { ScanResult } from '../../lib/types';

const SYNC_INTERVAL_MS = 10_000;
const RESCAN_COOLDOWN_MS = 2_000;

export default function Scanner() {
  const { profile, profileLoading, session } = useAuth();
  const [permission, requestPermission] = useCameraPermissions();
  const [lastResult, setLastResult] = useState<ScanResult | null>(null);
  const [paused, setPaused] = useState(false);
  const [rosterCount, setRosterCount] = useState<number | null>(null);
  const [rosterLoading, setRosterLoading] = useState(true);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const lastCodeRef = useRef<{ code: string; at: number } | null>(null);

  useEffect(() => {
    if (!permission?.granted) requestPermission();
  }, [permission]);

  // Pull the participant roster to local SQLite so scanning works even if
  // the venue wifi drops mid-event.
  useEffect(() => {
    if (!profile) return;
    setRosterLoading(true);
    syncParticipantsToLocal()
      .then(() => localParticipantCount())
      .then((count) => {
        setRosterCount(count);
        setRosterLoading(false);
      })
      .catch((e) => {
        console.warn('Roster sync failed', e);
        setRosterLoading(false);
      });
  }, [profile]);

  const runSync = useCallback(async () => {
    setSyncing(true);
    try {
      await syncPendingScans();
    } catch (e) {
      console.warn('Sync error', e);
    }
    try {
      setPending(await pendingCount());
    } catch (e) {
      console.warn('Pending count failed', e);
    }
    setSyncing(false);
  }, []);

  useEffect(() => {
    runSync();
    const interval = setInterval(runSync, SYNC_INTERVAL_MS);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') runSync();
    });
    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, [runSync]);

  const handleScan = useCallback(
    async ({ data }: { data: string }) => {
      const now = Date.now();
      if (lastCodeRef.current?.code === data && now - lastCodeRef.current.at < RESCAN_COOLDOWN_MS) {
        return; // ignore rapid re-fires of the same code while it's still in frame
      }
      lastCodeRef.current = { code: data, at: now };

      if (!profile || !session) return;
      setPaused(true);

      const result = await recordScan({
        scannedCode: data,
        scannedBy: profile.id,
        scannerName: profile.display_name,
        deviceId: Constants.sessionId ?? 'unknown-device',
      });

      setLastResult(result);
      if (result.status === 'queued_offline') setPending((p) => p + 1);

      setTimeout(() => setPaused(false), RESCAN_COOLDOWN_MS);
    },
    [profile, session]
  );

  if (profileLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#000" />
        <Text style={styles.permText}>Checking your operator account…</Text>
      </View>
    );
  }

  if (!profile) {
    return (
      <View style={styles.center}>
        <Text style={styles.permText}>
          This login isn't set up as a scanner operator yet.{'\n\n'}
          Ask your event admin to add your account's UUID to the scanner_profiles table.
        </Text>
      </View>
    );
  }

  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#000" />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.permText}>Camera access is required to scan attendance QR codes.</Text>
        <Pressable style={styles.button} onPress={requestPermission}>
          <Text style={styles.buttonText}>Grant Camera Access</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={paused ? undefined : handleScan}
      />

      <ScanFrame />

      <View style={styles.statusStack}>
        <StatusPill
          loading={rosterLoading}
          label={
            rosterLoading
              ? 'Loading participant list…'
              : rosterCount !== null
              ? `${rosterCount.toLocaleString()} participants ready`
              : 'Roster unavailable'
          }
        />
        {pending > 0 ? (
          <StatusPill loading={syncing} label={`${pending} scan${pending === 1 ? '' : 's'} waiting to sync`} dim />
        ) : null}
      </View>

      {lastResult ? <ResultBanner result={lastResult} /> : null}
    </View>
  );
}

function StatusPill({ label, loading, dim }: { label: string; loading?: boolean; dim?: boolean }) {
  return (
    <View style={[styles.pill, dim && styles.pillDim]}>
      {loading ? <ActivityIndicator size="small" color="#fff" style={{ marginRight: 8 }} /> : null}
      <Text style={styles.pillText}>{label}</Text>
    </View>
  );
}

function ScanFrame() {
  return (
    <View style={styles.frameWrap} pointerEvents="none">
      <View style={[styles.corner, styles.cornerTL]} />
      <View style={[styles.corner, styles.cornerTR]} />
      <View style={[styles.corner, styles.cornerBL]} />
      <View style={[styles.corner, styles.cornerBR]} />
    </View>
  );
}

function ResultBanner({ result }: { result: ScanResult }) {
  if (result.status === 'success') {
    return (
      <View style={styles.banner}>
        <View style={styles.iconCircleFilled}>
          <Text style={styles.iconTextLight}>✓</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.bannerTitle}>Checked in</Text>
          <Text style={styles.bannerName}>{fullName(result.participant)}</Text>
        </View>
      </View>
    );
  }
  if (result.status === 'duplicate') {
    return (
      <View style={styles.banner}>
        <View style={styles.iconCircleOutline}>
          <Text style={styles.iconTextDark}>!</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.bannerTitle}>Already checked in</Text>
          <Text style={styles.bannerName}>{fullName(result.participant)}</Text>
          <Text style={styles.bannerSub}>by {result.scannedBy}</Text>
        </View>
      </View>
    );
  }
  if (result.status === 'queued_offline') {
    return (
      <View style={styles.banner}>
        <View style={styles.iconCircleOutline}>
          <Text style={styles.iconTextDark}>↻</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.bannerTitle}>Saved offline</Text>
          <Text style={styles.bannerSub}>Will sync once connection returns</Text>
        </View>
      </View>
    );
  }
  if (result.status === 'not_found') {
    return (
      <View style={styles.banner}>
        <View style={styles.iconCircleOutline}>
          <Text style={styles.iconTextDark}>✕</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.bannerTitle}>Not on the list</Text>
          <Text style={styles.bannerSub}>Code: {result.code}</Text>
        </View>
      </View>
    );
  }
  return (
    <View style={styles.banner}>
      <View style={styles.iconCircleOutline}>
        <Text style={styles.iconTextDark}>✕</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.bannerTitle}>Error</Text>
        <Text style={styles.bannerSub}>{result.message}</Text>
      </View>
    </View>
  );
}

const FRAME_SIZE = 260;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#fff' },
  permText: { textAlign: 'center', marginBottom: 16, fontSize: 15, color: '#111' },
  button: { backgroundColor: '#111', borderRadius: 10, paddingVertical: 14, paddingHorizontal: 24 },
  buttonText: { color: '#fff', fontWeight: '600' },

  frameWrap: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: FRAME_SIZE,
    height: FRAME_SIZE,
    marginLeft: -FRAME_SIZE / 2,
    marginTop: -FRAME_SIZE / 2 - 30,
  },
  corner: { position: 'absolute', width: 32, height: 32, borderColor: '#fff' },
  cornerTL: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 12 },
  cornerTR: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 12 },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 12 },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 12 },

  statusStack: {
    position: 'absolute',
    top: 16,
    left: 16,
    right: 16,
    alignItems: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#000',
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginBottom: 8,
  },
  pillDim: { backgroundColor: 'rgba(0,0,0,0.55)' },
  pillText: { color: '#fff', fontSize: 13, fontWeight: '500' },

  banner: {
    position: 'absolute',
    bottom: 36,
    left: 16,
    right: 16,
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  iconCircleFilled: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#111',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  iconCircleOutline: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: '#111',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  iconTextLight: { color: '#fff', fontSize: 20, fontWeight: '700' },
  iconTextDark: { color: '#111', fontSize: 18, fontWeight: '700' },
  bannerTitle: { fontSize: 16, fontWeight: '700', color: '#111' },
  bannerName: { fontSize: 15, color: '#111', marginTop: 2 },
  bannerSub: { fontSize: 12, color: '#666', marginTop: 2 },
});