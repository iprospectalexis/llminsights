import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Inbox, Plus, LayoutGrid, List as ListIcon, Filter as FilterIcon } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { supabase } from '../lib/supabase';
import {
  Ticket,
  TicketTag,
  TicketStatus,
  TAG_LABELS,
  markTicketsSeen,
} from '../lib/tickets';
import { TicketKanban } from './tickets/TicketKanban';
import { TicketList } from './tickets/TicketList';
import { NewTicketModal } from './tickets/NewTicketModal';
import { TicketDetailDrawer } from './tickets/TicketDetailDrawer';

type ViewMode = 'kanban' | 'list';

export const TicketsPage: React.FC = () => {
  const [userId, setUserId] = useState<string | null>(null);
  const [role, setRole] = useState<string>('client');
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>('kanban');
  const [tagFilter, setTagFilter] = useState<TicketTag | 'all'>('all');
  const [showArchived, setShowArchived] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [activeTicketId, setActiveTicketId] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState<boolean>(
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  );

  const isManager = role === 'admin' || role === 'manager';

  // Resize listener for kanban → list fallback on mobile
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Default view is list for clients and on mobile, kanban otherwise.
  useEffect(() => {
    if (isMobile || !isManager) setView('list');
    else setView('kanban');
  }, [isMobile, isManager]);

  // ── Auth + role bootstrap ────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getUser();
      const u = data.user;
      if (!u) return;
      if (cancelled) return;
      setUserId(u.id);
      const { data: profile } = await supabase
        .from('users')
        .select('role')
        .eq('id', u.id)
        .maybeSingle();
      if (cancelled) return;
      setRole((profile as any)?.role || 'client');
      // Mark as seen on mount so the badge resets after the page renders.
      markTicketsSeen(u.id);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Fetch tickets ────────────────────────────────────────────────
  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Author profile is fetched separately to avoid an FK-name dependency.
      const { data, error: err } = await supabase
        .from('tickets')
        .select('*')
        .order('last_activity_at', { ascending: false });
      if (err) throw err;

      const list = (data || []) as Ticket[];
      const ids = Array.from(new Set(list.map(t => t.author_id).filter(Boolean)));
      let authorsById: Record<string, any> = {};
      if (ids.length > 0) {
        const { data: authors } = await supabase
          .from('users')
          .select('id, email, full_name')
          .in('id', ids);
        for (const a of authors || []) {
          authorsById[(a as any).id] = a;
        }
      }
      const enriched = list.map(t => ({ ...t, author: authorsById[t.author_id] || null }));
      setTickets(enriched);
    } catch (e: any) {
      console.error(e);
      setError(e?.message || 'Failed to load tickets');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (userId) refetch();
  }, [userId, refetch]);

  // ── Realtime: any change → refetch ───────────────────────────────
  useEffect(() => {
    if (!userId) return;
    const ch = supabase
      .channel('tickets-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, () => {
        refetch();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ticket_comments' }, () => {
        refetch();
      })
      .subscribe();
    return () => {
      try {
        supabase.removeChannel(ch);
      } catch {
        /* noop */
      }
    };
  }, [userId, refetch]);

  // ── Filter pipeline ──────────────────────────────────────────────
  const filtered = useMemo(() => {
    return tickets.filter(t => {
      if (!showArchived && t.status === 'archived') return false;
      if (tagFilter !== 'all' && t.tag !== tagFilter) return false;
      return true;
    });
  }, [tickets, tagFilter, showArchived]);

  // ── Status mutations from kanban DnD ─────────────────────────────
  const handleStatusChange = useCallback(
    async (ticketId: string, nextStatus: TicketStatus) => {
      // Optimistic update
      setTickets(prev =>
        prev.map(t => (t.id === ticketId ? { ...t, status: nextStatus } : t))
      );
      const { error: err } = await supabase
        .from('tickets')
        .update({ status: nextStatus })
        .eq('id', ticketId);
      if (err) {
        console.error('status update failed', err);
        refetch();
      }
    },
    [refetch]
  );

  // ── Render ───────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-brand-primary/10 flex items-center justify-center">
            <Inbox className="w-5 h-5 text-brand-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Tickets</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {isManager
                ? 'Backlog of bugs, ideas and to-verify items from all users'
                : 'Report a bug or suggest an idea — we read every ticket'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setCreateOpen(true)} variant="gradient">
            <Plus className="w-4 h-4 mr-2" /> New ticket
          </Button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-3">
        <div className="flex items-center gap-2">
          <FilterIcon className="w-4 h-4 text-gray-400" />
          <select
            value={tagFilter}
            onChange={e => setTagFilter(e.target.value as any)}
            className="text-sm border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-1.5 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
          >
            <option value="all">All tags</option>
            {(['bug', 'to_verify', 'evolution', 'other'] as TicketTag[]).map(tg => (
              <option key={tg} value={tg}>
                {TAG_LABELS[tg]}
              </option>
            ))}
          </select>
        </div>
        {isManager && (
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={e => setShowArchived(e.target.checked)}
              className="rounded"
            />
            Show archived
          </label>
        )}
        {isManager && !isMobile && (
          <div className="ml-auto inline-flex border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
            <button
              onClick={() => setView('kanban')}
              className={`px-3 py-1.5 text-sm flex items-center gap-1 ${
                view === 'kanban'
                  ? 'bg-brand-primary text-white'
                  : 'bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300'
              }`}
            >
              <LayoutGrid className="w-4 h-4" /> Kanban
            </button>
            <button
              onClick={() => setView('list')}
              className={`px-3 py-1.5 text-sm flex items-center gap-1 ${
                view === 'list'
                  ? 'bg-brand-primary text-white'
                  : 'bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300'
              }`}
            >
              <ListIcon className="w-4 h-4" /> List
            </button>
          </div>
        )}
      </div>

      {/* Body */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <LoadingSpinner />
        </div>
      ) : error ? (
        <div className="text-center py-16 text-red-600 dark:text-red-400">{error}</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-gray-800 rounded-2xl border border-dashed border-gray-200 dark:border-gray-700">
          <Inbox className="w-10 h-10 mx-auto text-gray-300 dark:text-gray-600" />
          <p className="mt-3 text-gray-500 dark:text-gray-400">No tickets yet</p>
          <Button onClick={() => setCreateOpen(true)} className="mt-4" variant="primary">
            <Plus className="w-4 h-4 mr-2" /> Create the first one
          </Button>
        </div>
      ) : view === 'kanban' && isManager && !isMobile ? (
        <TicketKanban
          tickets={filtered}
          onCardClick={id => setActiveTicketId(id)}
          onStatusChange={handleStatusChange}
        />
      ) : (
        <TicketList tickets={filtered} onRowClick={id => setActiveTicketId(id)} />
      )}

      {/* Create modal */}
      {createOpen && userId && (
        <NewTicketModal
          isOpen={createOpen}
          onClose={() => setCreateOpen(false)}
          authorId={userId}
          onCreated={() => {
            setCreateOpen(false);
            refetch();
          }}
        />
      )}

      {/* Detail drawer */}
      {activeTicketId && userId && (
        <TicketDetailDrawer
          ticketId={activeTicketId}
          onClose={() => setActiveTicketId(null)}
          currentUserId={userId}
          isManager={isManager}
          onMutate={refetch}
        />
      )}
    </div>
  );
};
