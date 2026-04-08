import React from 'react';
import { formatDistanceToNow } from 'date-fns';
import { MessageCircle, ThumbsUp, Paperclip } from 'lucide-react';
import {
  Ticket,
  TAG_LABELS,
  TAG_COLORS,
  STATUS_LABELS,
  STATUS_COLORS,
} from '../../lib/tickets';

interface Props {
  tickets: Ticket[];
  onRowClick: (id: string) => void;
}

export const TicketList: React.FC<Props> = ({ tickets, onRowClick }) => {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      {/* Mobile cards */}
      <div className="md:hidden divide-y divide-gray-100 dark:divide-gray-700">
        {tickets.map(t => {
          const author = t.author?.full_name || t.author?.email || 'Unknown';
          return (
            <button
              key={t.id}
              onClick={() => onRowClick(t.id)}
              className="w-full text-left p-3 hover:bg-gray-50 dark:hover:bg-gray-700/40"
            >
              <div className="flex items-center gap-2 mb-1">
                <span
                  className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full ${TAG_COLORS[t.tag]}`}
                >
                  {TAG_LABELS[t.tag]}
                </span>
                <span
                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[t.status]}`}
                >
                  {STATUS_LABELS[t.status]}
                </span>
                {t.attachment_path && <Paperclip className="w-3 h-3 text-gray-400" />}
              </div>
              <div className="text-sm font-semibold text-gray-900 dark:text-white">
                {t.title}
              </div>
              <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mt-1">
                <span className="truncate">{author}</span>
                <span>
                  {formatDistanceToNow(new Date(t.last_activity_at), { addSuffix: true })}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Desktop table */}
      <table className="hidden md:table min-w-full divide-y divide-gray-200 dark:divide-gray-700">
        <thead className="bg-gray-50 dark:bg-gray-900/40">
          <tr className="text-left text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
            <th className="px-4 py-3">Title</th>
            <th className="px-4 py-3">Tag</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Author</th>
            <th className="px-4 py-3">Updated</th>
            <th className="px-4 py-3 text-center">
              <MessageCircle className="w-4 h-4 inline" />
            </th>
            <th className="px-4 py-3 text-center">
              <ThumbsUp className="w-4 h-4 inline" />
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
          {tickets.map(t => {
            const author = t.author?.full_name || t.author?.email || 'Unknown';
            return (
              <tr
                key={t.id}
                onClick={() => onRowClick(t.id)}
                className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/40 text-sm"
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900 dark:text-white">{t.title}</span>
                    {t.attachment_path && <Paperclip className="w-3.5 h-3.5 text-gray-400" />}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full ${TAG_COLORS[t.tag]}`}
                  >
                    {TAG_LABELS[t.tag]}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[t.status]}`}
                  >
                    {STATUS_LABELS[t.status]}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-700 dark:text-gray-300 truncate max-w-[200px]">
                  {author}
                </td>
                <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                  {formatDistanceToNow(new Date(t.last_activity_at), { addSuffix: true })}
                </td>
                <td className="px-4 py-3 text-center text-gray-600 dark:text-gray-300">
                  {t.comments_count}
                </td>
                <td className="px-4 py-3 text-center text-gray-600 dark:text-gray-300">
                  {t.upvotes_count}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
