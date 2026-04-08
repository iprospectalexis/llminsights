import React, { useState } from 'react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { supabase } from '../../lib/supabase';
import {
  TicketTag,
  TAG_LABELS,
  ALLOWED_MIME_TYPES,
  MAX_ATTACHMENT_BYTES,
  formatBytes,
  uploadAttachment,
} from '../../lib/tickets';
import { Paperclip, X } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  authorId: string;
  onCreated: () => void;
}

export const NewTicketModal: React.FC<Props> = ({ isOpen, onClose, authorId, onCreated }) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tag, setTag] = useState<TicketTag>('bug');
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setTitle('');
    setDescription('');
    setTag('bug');
    setFile(null);
    setError(null);
  }

  function handleClose() {
    if (submitting) return;
    reset();
    onClose();
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const f = e.target.files?.[0] || null;
    if (!f) {
      setFile(null);
      return;
    }
    if (f.size > MAX_ATTACHMENT_BYTES) {
      setError(`File too large (${formatBytes(f.size)}). Max 10 MB.`);
      e.target.value = '';
      return;
    }
    if (f.type && !ALLOWED_MIME_TYPES.includes(f.type)) {
      setError(`Unsupported file type: ${f.type}`);
      e.target.value = '';
      return;
    }
    setFile(f);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (title.trim().length < 3) {
      setError('Title must be at least 3 characters');
      return;
    }
    if (description.trim().length < 1) {
      setError('Description is required');
      return;
    }
    setSubmitting(true);
    try {
      // 1) Insert ticket first to obtain its id (storage path uses it).
      const { data: inserted, error: insErr } = await supabase
        .from('tickets')
        .insert({
          author_id: authorId,
          title: title.trim(),
          description: description.trim(),
          tag,
        })
        .select('id')
        .single();
      if (insErr) throw insErr;
      const newId = (inserted as any).id as string;

      // 2) Upload optional attachment.
      if (file) {
        try {
          const { path, name, size } = await uploadAttachment(file, authorId, newId);
          const { error: updErr } = await supabase
            .from('tickets')
            .update({
              attachment_path: path,
              attachment_name: name,
              attachment_size: size,
            })
            .eq('id', newId);
          if (updErr) throw updErr;
        } catch (uploadErr: any) {
          // Don't lose the ticket itself; surface the upload failure.
          console.error('attachment upload failed', uploadErr);
          setError(
            `Ticket created, but the attachment failed: ${uploadErr?.message || uploadErr}`
          );
          // Still consider the create flow done — caller will refetch.
          onCreated();
          return;
        }
      }

      reset();
      onCreated();
    } catch (e: any) {
      console.error(e);
      setError(e?.message || 'Failed to create ticket');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="New ticket" size="lg">
      <form onSubmit={handleSubmit} className="p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Title
          </label>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            maxLength={200}
            placeholder="Short summary of the bug or idea"
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-brand-primary focus:outline-none"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Description
          </label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={6}
            maxLength={8000}
            placeholder="Explain what happened, what you expected, and how to reproduce."
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-brand-primary focus:outline-none resize-y"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Tag
          </label>
          <div className="flex flex-wrap gap-2">
            {(['bug', 'to_verify', 'evolution', 'other'] as TicketTag[]).map(tg => (
              <button
                type="button"
                key={tg}
                onClick={() => setTag(tg)}
                className={`px-3 py-1.5 text-sm rounded-xl border transition-all ${
                  tag === tg
                    ? 'bg-brand-primary text-white border-brand-primary'
                    : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                }`}
              >
                {TAG_LABELS[tg]}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Attachment <span className="text-gray-400">(optional, max 10 MB)</span>
          </label>
          {file ? (
            <div className="flex items-center justify-between border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-sm">
              <span className="flex items-center gap-2 text-gray-700 dark:text-gray-200 truncate">
                <Paperclip className="w-4 h-4 flex-shrink-0" />
                <span className="truncate">{file.name}</span>
                <span className="text-gray-400 text-xs">({formatBytes(file.size)})</span>
              </span>
              <button
                type="button"
                onClick={() => setFile(null)}
                className="text-gray-400 hover:text-red-500"
                aria-label="Remove file"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <input
              type="file"
              accept={ALLOWED_MIME_TYPES.join(',')}
              onChange={handleFileSelect}
              className="block w-full text-sm text-gray-700 dark:text-gray-300 file:mr-3 file:py-1.5 file:px-3 file:rounded-xl file:border-0 file:bg-gray-100 dark:file:bg-gray-800 file:text-gray-700 dark:file:text-gray-200 hover:file:bg-gray-200 dark:hover:file:bg-gray-700"
            />
          )}
        </div>

        {error && (
          <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-3">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={handleClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" variant="gradient" loading={submitting}>
            Create ticket
          </Button>
        </div>
      </form>
    </Modal>
  );
};
