import React, { useEffect, useState, useCallback } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import {
  X,
  Paperclip,
  ThumbsUp,
  MessageCircle,
  Archive,
  Send,
  History,
  Download,
} from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { LoadingSpinner } from '../../components/ui/LoadingSpinner';
import { supabase } from '../../lib/supabase';
import {
  Ticket,
  TicketComment,
  TicketHistoryEvent,
  TicketStatus,
  TAG_LABELS,
  TAG_COLORS,
  STATUS_LABELS,
  STATUS_COLORS,
  getAttachmentSignedUrl,
  formatBytes,
} from '../../lib/tickets';

interface Props {
  ticketId: string;
  currentUserId: string;
  isManager: boolean;
  onClose: () => void;
  onMutate: () => void;
}

interface Author {
  id: string;
  email: string | null;
  full_name: string | null;
}

export const TicketDetailDrawer: React.FC<Props> = ({
  ticketId,
  currentUserId,
  isManager,
  onClose,
  onMutate,
}) => {
  const [loading, setLoading] = useState(true);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [comments, setComments] = useState<TicketComment[]>([]);
  const [history, setHistory] = useState<TicketHistoryEvent[]>([]);
  const [hasVoted, setHasVoted] = useState(false);
  const [authors, setAuthors] = useState<Record<string, Author>>({});
  const [reply, setReply] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attachmentUrl, setAttachmentUrl] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [{ data: t, error: tErr }, { data: cs }, { data: hs }, { data: vote }] =
        await Promise.all([
          supabase.from('tickets').select('*').eq('id', ticketId).maybeSingle(),
          supabase
            .from('ticket_comments')
            .select('*')
            .eq('ticket_id', ticketId)
            .order('created_at', { ascending: true }),
          supabase
            .from('ticket_history')
            .select('*')
            .eq('ticket_id', ticketId)
            .order('created_at', { ascending: true }),
          supabase
            .from('ticket_votes')
            .select('user_id')
            .eq('ticket_id', ticketId)
            .eq('user_id', currentUserId)
            .maybeSingle(),
        ]);
      if (tErr) throw tErr;
      if (!t) throw new Error('Ticket not found');
      setTicket(t as Ticket);
      setComments((cs || []) as TicketComment[]);
      setHistory((hs || []) as TicketHistoryEvent[]);
      setHasVoted(!!vote);

      // Fetch involved authors / actors in one round-trip.
      const ids = new Set<string>();
      ids.add((t as any).author_id);
      for (const c of cs || []) ids.add((c as any).author_id);
      for (const h of hs || []) if ((h as any).actor_id) ids.add((h as any).actor_id);
      if (ids.size > 0) {
        const { data: us } = await supabase
          .from('users')
          .select('id, email, full_name')
          .in('id', Array.from(ids));
        const map: Record<string, Author> = {};
        for (const u of us || []) map[(u as any).id] = u as any;
        setAuthors(map);
      }

      // Refresh signed URL for attachment if any.
      if ((t as any).attachment_path) {
        const url = await getAttachmentSignedUrl((t as any).attachment_path);
        setAttachmentUrl(url);
      } else {
        setAttachmentUrl(null);
      }
    } catch (e: any) {
      console.error(e);
      setError(e?.message || 'Failed to load ticket');
    } finally {
      setLoading(false);
    }
  }, [ticketId, currentUserId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Realtime: refetch on changes for this specific ticket
  useEffect(() => {
    const ch = supabase
      .channel(`ticket-${ticketId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ticket_comments', filter: `ticket_id=eq.${ticketId}` },
        () => fetchAll()
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'tickets', filter: `id=eq.${ticketId}` },
        () => fetchAll()
      )
      .subscribe();
    return () => {
      try {
        supabase.removeChannel(ch);
      } catch {
        /* noop */
      }
    };
  }, [ticketId, fetchAll]);

  // ── Actions ────────────────────────────────────────────────────
  async function postComment() {
    if (!reply.trim()) return;
    setPosting(true);
    try {
      const { error: err } = await supabase.from('ticket_comments').insert({
        ticket_id: ticketId,
        author_id: currentUserId,
        body: reply.trim(),
      });
      if (err) throw err;
      setReply('');
      await fetchAll();
      onMutate();
    } catch (e: any) {
      console.error(e);
      setError(e?.message || 'Failed to post comment');
    } finally {
      setPosting(false);
    }
  }

  async function toggleVote() {
    if (hasVoted) {
      const { error: err } = await supabase
        .from('ticket_votes')
        .delete()
        .eq('ticket_id', ticketId)
        .eq('user_id', currentUserId);
      if (err) {
        console.error(err);
        return;
      }
      setHasVoted(false);
    } else {
      const { error: err } = await supabase
        .from('ticket_votes')
        .insert({ ticket_id: ticketId, user_id: currentUserId });
      if (err) {
        console.error(err);
        return;
      }
      setHasVoted(true);
    }
    await fetchAll();
    onMutate();
  }

  async function changeStatus(next: TicketStatus) {
    const { error: err } = await supabase
      .from('tickets')
      .update({ status: next })
      .eq('id', ticketId);
    if (err) {
      console.error(err);
      setError(err.message);
      return;
    }
    await fetchAll();
    onMutate();
  }

  // ── Timeline merge ─────────────────────────────────────────────
  type TimelineEvent =
    | { kind: 'comment'; at: string; data: TicketComment }
    | { kind: 'history'; at: string; data: TicketHistoryEvent };

  const timeline: TimelineEvent[] = React.useMemo(() => {
    const items: TimelineEvent[] = [
      ...comments.map(c => ({ kind: 'comment' as const, at: c.created_at, data: c })),
      ...history.map(h => ({ kind: 'history' as const, at: h.created_at, data: h })),
    ];
    items.sort((a, b) => +new Date(a.at) - +new Date(b.at));
    return items;
  }, [comments, history]);

  // ── Render ─────────────────────────────────────────────────────
  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40" onClick={onClose} />
      {/* Drawer */}
      <div className="fixed top-0 right-0 bottom-0 z-50 w-full md:max-w-2xl bg-white dark:bg-gray-800 shadow-2xl border-l border-gray-200 dark:border-gray-700 flex flex-col">
        {loading || !ticket ? (
          <div className="flex-1 flex items-center justify-center">
            {error ? (
              <div className="text-red-500 px-6 text-center">{error}</div>
            ) : (
              <LoadingSpinner />
            )}
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="p-5 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full ${TAG_COLORS[ticket.tag]}`}
                  >
                    {TAG_LABELS[ticket.tag]}
                  </span>
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[ticket.status]}`}
                  >
                    {STATUS_LABELS[ticket.status]}
                  </span>
                </div>
                <button
                  onClick={onClose}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  aria-label="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">
                {ticket.title}
              </h2>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                Opened by{' '}
                <span className="font-medium text-gray-700 dark:text-gray-300">
                  {authors[ticket.author_id]?.full_name ||
                    authors[ticket.author_id]?.email ||
                    'Unknown'}
                </span>{' '}
                · {format(new Date(ticket.created_at), 'PPp')}
              </div>

              <div className="flex items-center gap-2 mt-3 flex-wrap">
                <button
                  onClick={toggleVote}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-medium border transition-all ${
                    hasVoted
                      ? 'bg-brand-primary/10 border-brand-primary text-brand-primary'
                      : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                  }`}
                >
                  <ThumbsUp className="w-3.5 h-3.5" />
                  {ticket.upvotes_count} upvote{ticket.upvotes_count === 1 ? '' : 's'}
                </button>
                <span className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                  <MessageCircle className="w-3.5 h-3.5" />
                  {ticket.comments_count}
                </span>
                {isManager && (
                  <div className="ml-auto flex items-center gap-2">
                    <select
                      value={ticket.status}
                      onChange={e => changeStatus(e.target.value as TicketStatus)}
                      className="text-xs border border-gray-200 dark:border-gray-700 rounded-xl px-2 py-1 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                    >
                      <option value="backlog">Backlog</option>
                      <option value="in_work">In work</option>
                      <option value="done">Done</option>
                      <option value="archived">Archived</option>
                    </select>
                    {ticket.status !== 'archived' && (
                      <button
                        onClick={() => changeStatus('archived')}
                        className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
                        title="Archive ticket"
                      >
                        <Archive className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              <div className="bg-gray-50 dark:bg-gray-900/40 rounded-2xl p-4 border border-gray-200 dark:border-gray-700">
                <div className="text-sm whitespace-pre-wrap text-gray-800 dark:text-gray-200">
                  {ticket.description}
                </div>
                {ticket.attachment_path && (
                  <a
                    href={attachmentUrl || '#'}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-flex items-center gap-2 text-xs text-brand-primary hover:underline"
                  >
                    <Paperclip className="w-3.5 h-3.5" />
                    {ticket.attachment_name || 'Attachment'}
                    {ticket.attachment_size != null && (
                      <span className="text-gray-400">({formatBytes(ticket.attachment_size)})</span>
                    )}
                    <Download className="w-3 h-3" />
                  </a>
                )}
              </div>

              {/* Timeline */}
              {timeline.length === 0 ? (
                <div className="text-xs text-gray-400 italic text-center py-6">
                  No comments yet
                </div>
              ) : (
                <div className="space-y-3">
                  {timeline.map((ev, idx) =>
                    ev.kind === 'comment' ? (
                      <div
                        key={`c-${ev.data.id}`}
                        className="bg-white dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700 rounded-2xl p-3"
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">
                            {authors[ev.data.author_id]?.full_name ||
                              authors[ev.data.author_id]?.email ||
                              'Unknown'}
                          </span>
                          <span className="text-[10px] text-gray-400">
                            {formatDistanceToNow(new Date(ev.at), { addSuffix: true })}
                          </span>
                        </div>
                        <div className="text-sm whitespace-pre-wrap text-gray-800 dark:text-gray-200">
                          {ev.data.body}
                        </div>
                      </div>
                    ) : (
                      <div
                        key={`h-${ev.data.id}`}
                        className="text-[11px] text-gray-500 dark:text-gray-400 flex items-center gap-2 pl-2"
                      >
                        <History className="w-3 h-3" />
                        <span>
                          {(authors[ev.data.actor_id || '']?.full_name ||
                            authors[ev.data.actor_id || '']?.email ||
                            'Someone')}{' '}
                          changed <strong>{ev.data.field}</strong> from{' '}
                          <em>{ev.data.old_value || '∅'}</em> to{' '}
                          <em>{ev.data.new_value || '∅'}</em>
                        </span>
                        <span className="text-[10px] text-gray-400 ml-auto">
                          {formatDistanceToNow(new Date(ev.at), { addSuffix: true })}
                        </span>
                      </div>
                    )
                  )}
                </div>
              )}

              {error && (
                <div className="text-xs text-red-600 dark:text-red-400">{error}</div>
              )}
            </div>

            {/* Reply input */}
            <div className="border-t border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-800">
              <div className="flex items-end gap-2">
                <textarea
                  value={reply}
                  onChange={e => setReply(e.target.value)}
                  rows={2}
                  placeholder="Write a reply…"
                  className="flex-1 resize-none px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-brand-primary focus:outline-none"
                  maxLength={4000}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      postComment();
                    }
                  }}
                />
                <Button
                  onClick={postComment}
                  loading={posting}
                  disabled={!reply.trim()}
                  variant="primary"
                >
                  <Send className="w-4 h-4" />
                </Button>
              </div>
              <div className="text-[10px] text-gray-400 mt-1">
                Tip: ⌘/Ctrl + Enter to send
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
};
