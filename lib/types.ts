export type Participant = {
  id: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  email: string | null;
  ticket_token: string;
  reg_status: string | null;
};

export function fullName(p: Pick<Participant, 'first_name' | 'middle_name' | 'last_name'>) {
  return [p.first_name, p.middle_name, p.last_name].filter(Boolean).join(' ');
}

export type ScanLogRow = {
  id: string;
  participant_id: string;
  scanned_by: string;
  scanned_at: string;
  device_id: string | null;
  synced: boolean;
  participant_name: string;
  scanner_name: string | null;
};

export type ScanResult =
  | { status: 'success'; participant: Participant; scannedAt: string }
  | { status: 'duplicate'; participant: Participant; scannedAt: string; scannedBy: string }
  | { status: 'not_found'; code: string }
  | { status: 'queued_offline'; code: string }
  | { status: 'error'; message: string };
