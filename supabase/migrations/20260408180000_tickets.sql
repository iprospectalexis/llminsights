-- Tickets / Feedback module — v1
--
-- Adds an in-app ticketing system: any authenticated user can file a ticket
-- (bug / to-verify / evolution / other) with one optional attachment, and
-- managers see them on a kanban board (Backlog → In work → Done) with full
-- audit history. RLS isolates clients to their own tickets while letting
-- managers see and move everything.
--
-- Reuses `is_manager()` helper from 20260408120000_api_cost_tracking.sql.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Tables
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tickets (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id        uuid        NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  title            text        NOT NULL CHECK (length(title) BETWEEN 3 AND 200),
  description      text        NOT NULL CHECK (length(description) BETWEEN 1 AND 8000),
  tag              text        NOT NULL CHECK (tag IN ('bug','to_verify','evolution','other')),
  status           text        NOT NULL DEFAULT 'backlog'
                               CHECK (status IN ('backlog','in_work','done','archived')),
  attachment_path  text,
  attachment_name  text,
  attachment_size  integer,
  upvotes_count    integer     NOT NULL DEFAULT 0,
  comments_count   integer     NOT NULL DEFAULT 0,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tickets_author_idx
  ON tickets (author_id, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS tickets_status_idx
  ON tickets (status, last_activity_at DESC)
  WHERE status <> 'archived';
CREATE INDEX IF NOT EXISTS tickets_tag_idx
  ON tickets (tag);

CREATE TABLE IF NOT EXISTS ticket_comments (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   uuid        NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_id   uuid        NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  body        text        NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ticket_comments_ticket_idx
  ON ticket_comments (ticket_id, created_at);

CREATE TABLE IF NOT EXISTS ticket_votes (
  ticket_id   uuid        NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ticket_id, user_id)
);

CREATE TABLE IF NOT EXISTS ticket_history (
  id          bigserial   PRIMARY KEY,
  ticket_id   uuid        NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  actor_id    uuid                 REFERENCES users(id) ON DELETE SET NULL,
  field       text        NOT NULL,
  old_value   text,
  new_value   text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ticket_history_ticket_idx
  ON ticket_history (ticket_id, created_at);

-- Per-user "last seen" pointer used by the unread badge.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS tickets_last_seen_at timestamptz;

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Triggers
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION tickets_touch() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  -- Bump activity on every update except pure last_seen tracking (no-op
  -- here because last_seen lives on users, not tickets).
  NEW.last_activity_at := now();
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tickets_touch_trg ON tickets;
CREATE TRIGGER tickets_touch_trg
  BEFORE UPDATE ON tickets
  FOR EACH ROW EXECUTE FUNCTION tickets_touch();

CREATE OR REPLACE FUNCTION ticket_comments_after_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE tickets
       SET comments_count = comments_count + 1,
           last_activity_at = now()
     WHERE id = NEW.ticket_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE tickets
       SET comments_count = greatest(comments_count - 1, 0)
     WHERE id = OLD.ticket_id;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ticket_comments_after_change_trg ON ticket_comments;
CREATE TRIGGER ticket_comments_after_change_trg
  AFTER INSERT OR DELETE ON ticket_comments
  FOR EACH ROW EXECUTE FUNCTION ticket_comments_after_change();

CREATE OR REPLACE FUNCTION ticket_votes_after_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE tickets
       SET upvotes_count = upvotes_count + 1
     WHERE id = NEW.ticket_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE tickets
       SET upvotes_count = greatest(upvotes_count - 1, 0)
     WHERE id = OLD.ticket_id;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ticket_votes_after_change_trg ON ticket_votes;
CREATE TRIGGER ticket_votes_after_change_trg
  AFTER INSERT OR DELETE ON ticket_votes
  FOR EACH ROW EXECUTE FUNCTION ticket_votes_after_change();

CREATE OR REPLACE FUNCTION tickets_audit() RETURNS trigger AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO ticket_history (ticket_id, actor_id, field, old_value, new_value)
    VALUES (NEW.id, auth.uid(), 'status', OLD.status, NEW.status);
  END IF;
  IF NEW.tag IS DISTINCT FROM OLD.tag THEN
    INSERT INTO ticket_history (ticket_id, actor_id, field, old_value, new_value)
    VALUES (NEW.id, auth.uid(), 'tag', OLD.tag, NEW.tag);
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS tickets_audit_trg ON tickets;
CREATE TRIGGER tickets_audit_trg
  AFTER UPDATE ON tickets
  FOR EACH ROW EXECUTE FUNCTION tickets_audit();

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Row Level Security
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE tickets         ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_votes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_history  ENABLE ROW LEVEL SECURITY;

-- tickets ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS tickets_select_self_or_manager ON tickets;
CREATE POLICY tickets_select_self_or_manager ON tickets
  FOR SELECT TO authenticated
  USING (author_id = auth.uid() OR is_manager());

DROP POLICY IF EXISTS tickets_insert_self ON tickets;
CREATE POLICY tickets_insert_self ON tickets
  FOR INSERT TO authenticated
  WITH CHECK (author_id = auth.uid());

DROP POLICY IF EXISTS tickets_update_author_backlog ON tickets;
CREATE POLICY tickets_update_author_backlog ON tickets
  FOR UPDATE TO authenticated
  USING (author_id = auth.uid() AND status = 'backlog')
  WITH CHECK (author_id = auth.uid() AND status = 'backlog');

DROP POLICY IF EXISTS tickets_update_manager ON tickets;
CREATE POLICY tickets_update_manager ON tickets
  FOR UPDATE TO authenticated
  USING (is_manager())
  WITH CHECK (is_manager());

DROP POLICY IF EXISTS tickets_delete_manager ON tickets;
CREATE POLICY tickets_delete_manager ON tickets
  FOR DELETE TO authenticated
  USING (is_manager());

-- ticket_comments ─────────────────────────────────────────────────
DROP POLICY IF EXISTS tcm_select ON ticket_comments;
CREATE POLICY tcm_select ON ticket_comments
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM tickets t
             WHERE t.id = ticket_comments.ticket_id
               AND (t.author_id = auth.uid() OR is_manager()))
  );

DROP POLICY IF EXISTS tcm_insert_visible ON ticket_comments;
CREATE POLICY tcm_insert_visible ON ticket_comments
  FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND EXISTS (SELECT 1 FROM tickets t
                 WHERE t.id = ticket_comments.ticket_id
                   AND (t.author_id = auth.uid() OR is_manager()))
  );

-- ticket_votes ────────────────────────────────────────────────────
DROP POLICY IF EXISTS tv_select ON ticket_votes;
CREATE POLICY tv_select ON ticket_votes
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS tv_insert_self ON ticket_votes;
CREATE POLICY tv_insert_self ON ticket_votes
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS tv_delete_self ON ticket_votes;
CREATE POLICY tv_delete_self ON ticket_votes
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- ticket_history ──────────────────────────────────────────────────
DROP POLICY IF EXISTS th_select ON ticket_history;
CREATE POLICY th_select ON ticket_history
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM tickets t
             WHERE t.id = ticket_history.ticket_id
               AND (t.author_id = auth.uid() OR is_manager()))
  );

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Realtime publication
-- ─────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'tickets'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE tickets';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'ticket_comments'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE ticket_comments';
  END IF;
END $$;
