import { useEffect, useState, useCallback } from 'react';
import { supabase } from './supabase';

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

export type TicketTag = 'bug' | 'to_verify' | 'evolution' | 'other';
export type TicketStatus = 'backlog' | 'in_work' | 'done' | 'archived';

export interface TicketAuthor {
  id: string | null;
  email: string | null;
  full_name: string | null;
}

export interface Ticket {
  id: string;
  author_id: string;
  title: string;
  description: string;
  tag: TicketTag;
  status: TicketStatus;
  attachment_path: string | null;
  attachment_name: string | null;
  attachment_size: number | null;
  upvotes_count: number;
  comments_count: number;
  last_activity_at: string;
  created_at: string;
  updated_at: string;
  author?: TicketAuthor | null;
}

export interface TicketComment {
  id: string;
  ticket_id: string;
  author_id: string;
  body: string;
  created_at: string;
  author?: TicketAuthor | null;
}

export interface TicketHistoryEvent {
  id: number;
  ticket_id: string;
  actor_id: string | null;
  field: string;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
  actor?: TicketAuthor | null;
}

// ──────────────────────────────────────────────────────────────────────────
// Display constants
// ──────────────────────────────────────────────────────────────────────────

export const TAG_LABELS: Record<TicketTag, string> = {
  bug: 'Bug',
  to_verify: 'À vérifier',
  evolution: 'Evolution',
  other: 'Autre',
};

export const TAG_COLORS: Record<TicketTag, string> = {
  bug: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  to_verify: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  evolution: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
  other: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
};

export const STATUS_LABELS: Record<TicketStatus, string> = {
  backlog: 'Backlog',
  in_work: 'In work',
  done: 'Done',
  archived: 'Archived',
};

export const STATUS_COLORS: Record<TicketStatus, string> = {
  backlog: 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
  in_work: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  done: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  archived: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500',
};

export const KANBAN_COLUMNS: TicketStatus[] = ['backlog', 'in_work', 'done'];

export const ALLOWED_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/json',
];

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB
export const ATTACHMENT_BUCKET = 'ticket-attachments';

// ──────────────────────────────────────────────────────────────────────────
// Storage helpers
// ──────────────────────────────────────────────────────────────────────────

/**
 * Sanitises a filename to a storage-safe slug while preserving the
 * extension. Spaces become "_" and any non [a-z0-9._-] is dropped.
 */
function sanitizeFilename(name: string): string {
  const dot = name.lastIndexOf('.');
  const base = (dot >= 0 ? name.slice(0, dot) : name)
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9._-]/g, '');
  const ext = (dot >= 0 ? name.slice(dot) : '').toLowerCase().replace(/[^a-z0-9.]/g, '');
  const safeBase = base || 'file';
  return `${safeBase}${ext}`;
}

/**
 * Validate + upload one attachment to the private `ticket-attachments`
 * bucket under `tickets/{authorId}/{ticketId}/{filename}`. Returns the
 * storage path on success.
 */
export async function uploadAttachment(
  file: File,
  authorId: string,
  ticketId: string
): Promise<{ path: string; name: string; size: number }> {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(
      `File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB.`
    );
  }
  if (file.type && !ALLOWED_MIME_TYPES.includes(file.type)) {
    throw new Error(`Unsupported file type: ${file.type}`);
  }

  const safe = sanitizeFilename(file.name);
  const path = `tickets/${authorId}/${ticketId}/${safe}`;
  const { error } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .upload(path, file, {
      cacheControl: '3600',
      upsert: true,
      contentType: file.type || undefined,
    });
  if (error) throw error;

  return { path, name: file.name, size: file.size };
}

/**
 * Generate a short-lived signed URL for downloading an attachment.
 * Returns null if the path is empty or signing failed.
 */
export async function getAttachmentSignedUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .createSignedUrl(path, 60 * 10);
  if (error) {
    console.error('signed url error', error);
    return null;
  }
  return data?.signedUrl ?? null;
}

// ──────────────────────────────────────────────────────────────────────────
// Unread badge
// ──────────────────────────────────────────────────────────────────────────

/**
 * Compromise unread badge:
 *   - client : tickets I authored where last_activity_at > my last_seen
 *   - manager: backlog tickets created after my last_seen
 *
 * Resets via `markTicketsSeen()` whenever the user opens /tickets.
 */
export function useUnreadTicketsCount(
  userId: string | null,
  role: string | null | undefined
): { count: number; refresh: () => void } {
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!userId || !supabase) {
      setCount(0);
      return;
    }
    try {
      // Read user's last_seen pointer.
      const { data: u } = await supabase
        .from('users')
        .select('tickets_last_seen_at')
        .eq('id', userId)
        .maybeSingle();
      const lastSeen: string = (u as any)?.tickets_last_seen_at || '1970-01-01T00:00:00Z';

      const isManager = role === 'admin' || role === 'manager';
      let query = supabase.from('tickets').select('id', { count: 'exact', head: true });
      if (isManager) {
        query = query.eq('status', 'backlog').gt('created_at', lastSeen);
      } else {
        query = query.eq('author_id', userId).gt('last_activity_at', lastSeen);
      }
      const { count: c } = await query;
      setCount(c ?? 0);
    } catch (err) {
      console.error('useUnreadTicketsCount', err);
      setCount(0);
    }
  }, [userId, role]);

  useEffect(() => {
    refresh();
    if (!userId || !supabase) return;
    // Light realtime: re-poll on any tickets change.
    const ch = supabase
      .channel(`tickets-badge-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, () => {
        refresh();
      })
      .subscribe();
    return () => {
      try {
        supabase.removeChannel(ch);
      } catch {
        /* noop */
      }
    };
  }, [userId, refresh]);

  return { count, refresh };
}

/** Set users.tickets_last_seen_at = now() for the current user. */
export async function markTicketsSeen(userId: string): Promise<void> {
  if (!userId || !supabase) return;
  await supabase
    .from('users')
    .update({ tickets_last_seen_at: new Date().toISOString() })
    .eq('id', userId);
}

// ──────────────────────────────────────────────────────────────────────────
// Misc UI helpers
// ──────────────────────────────────────────────────────────────────────────

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
