import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { MessageCircle, ThumbsUp, Paperclip } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Ticket, TAG_LABELS, TAG_COLORS } from '../../lib/tickets';

interface Props {
  ticket: Ticket;
  onClick: (id: string) => void;
}

export const TicketCard: React.FC<Props> = ({ ticket, onClick }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: ticket.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const author = ticket.author?.full_name || ticket.author?.email || 'Unknown';

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => onClick(ticket.id)}
      className="group bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-3 cursor-pointer hover:shadow-md hover:border-brand-primary/50 transition-all"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <span
          className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full ${TAG_COLORS[ticket.tag]}`}
        >
          {TAG_LABELS[ticket.tag]}
        </span>
        {ticket.attachment_path && <Paperclip className="w-3.5 h-3.5 text-gray-400" />}
      </div>
      <h4 className="text-sm font-semibold text-gray-900 dark:text-white line-clamp-2 mb-2">
        {ticket.title}
      </h4>
      <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
        <span className="truncate max-w-[60%]" title={author}>
          {author}
        </span>
        <span>
          {formatDistanceToNow(new Date(ticket.last_activity_at), { addSuffix: true })}
        </span>
      </div>
      <div className="flex items-center gap-3 mt-2 pt-2 border-t border-gray-100 dark:border-gray-700/60 text-xs text-gray-500 dark:text-gray-400">
        <span className="inline-flex items-center gap-1">
          <MessageCircle className="w-3.5 h-3.5" />
          {ticket.comments_count}
        </span>
        <span className="inline-flex items-center gap-1">
          <ThumbsUp className="w-3.5 h-3.5" />
          {ticket.upvotes_count}
        </span>
      </div>
    </div>
  );
};
