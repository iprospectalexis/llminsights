-- Tickets storage bucket — v1
--
-- Private bucket for ticket attachments. Files are accessed via signed URLs
-- generated client-side. Path convention:
--   tickets/{author_id}/{ticket_id}/{filename}
-- so RLS can use storage.foldername(name)[2] (= author_id) to scope access.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ticket-attachments',
  'ticket-attachments',
  false,
  10 * 1024 * 1024,
  ARRAY[
    'image/png','image/jpeg','image/gif','image/webp',
    'application/pdf','text/plain','text/csv','application/json'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types,
  public = false;

DROP POLICY IF EXISTS ticket_attach_select ON storage.objects;
CREATE POLICY ticket_attach_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'ticket-attachments'
    AND (
      (storage.foldername(name))[2]::uuid = auth.uid()
      OR is_manager()
    )
  );

DROP POLICY IF EXISTS ticket_attach_insert ON storage.objects;
CREATE POLICY ticket_attach_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'ticket-attachments'
    AND (storage.foldername(name))[2]::uuid = auth.uid()
  );

DROP POLICY IF EXISTS ticket_attach_delete ON storage.objects;
CREATE POLICY ticket_attach_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'ticket-attachments'
    AND ((storage.foldername(name))[2]::uuid = auth.uid() OR is_manager())
  );
