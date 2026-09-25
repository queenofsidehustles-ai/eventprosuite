-- ═══════════════════════════════════════════════════════════════
-- "I sent a quote — did it actually go?"
-- ═══════════════════════════════════════════════════════════════
--
-- Sending a quote reported itself in a toast that disappeared in a few
-- seconds and was written down nowhere. An hour later there was no way to
-- tell a quote that emailed cleanly from one that failed, from one that was
-- never sent at all — so the only way to be sure was to send it again and
-- watch the toast, every time.
--
-- send_events is the record. Append-only, one entry per attempt:
--
--   [{ "at": "2026-09-25T16:14:00Z", "channel": "email",
--      "ok": true, "to": "april@example.com", "note": null }]
--
-- channel is 'email', 'text' or 'link' (the owner copying the link to send
-- it herself, which is a real send and the one that works when email does
-- not). Kept as history rather than a single "sent_at" so a failed attempt
-- followed by a successful one still shows both.
--
-- No RLS change: saved_quotes is already owner-only, and the owner's own
-- browser writes this about her own quote.
--
-- Run once in Supabase → SQL Editor → New query → Run.
-- ═══════════════════════════════════════════════════════════════

alter table public.saved_quotes
  add column if not exists send_events jsonb not null default '[]'::jsonb;

-- ── Verify ────────────────────────────────────────────────────
--   select client_name, viewed_at, jsonb_array_length(send_events) as attempts
--     from public.saved_quotes order by created_at desc limit 10;
