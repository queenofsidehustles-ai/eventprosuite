'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const sql = read('migrations/20261102_coach_inbox.sql');
const code = sql.replace(/--.*$/gm, '');
const page = read('inbox.html');
const nav = read('nav.js');
const chat = read('api/chat.js');
const community = read('community.html');

test('coach_messages has RLS, nothing for anon, and no update/delete from the browser', () => {
  assert.match(code, /alter table public\.coach_messages enable row level security/);
  assert.match(code, /revoke all on public\.coach_messages from anon/);
  assert.match(code, /grant select, insert on public\.coach_messages to authenticated/);
  assert.doesNotMatch(code, /\bto\s+anon\b/i);
  assert.doesNotMatch(code, /grant[^;]*(update|delete)[^;]*coach_messages/i);
});

test('a student only reads and writes her own thread; the coach reads all', () => {
  const read = code.match(/create policy "coach_messages: read own thread"[\s\S]*?;/)[0];
  assert.match(read, /public\.is_community_admin\(\)/);
  assert.match(read, /student_id = auth\.uid\(\) and public\.is_community_member\(\)/);
  const send = code.match(/create policy "coach_messages: send"[\s\S]*?;/)[0];
  assert.match(send, /sender_id = auth\.uid\(\)/);
  assert.match(send, /student_id = auth\.uid\(\) or public\.is_community_admin\(\)/);
  // Trigger backs it up and resets created_at / read_at.
  assert.match(code, /before insert on public\.coach_messages/);
  assert.match(code, /new\.read_at\s+:= null/);
});

test('inbox functions are security definer, fixed search_path, authenticated only', () => {
  for (const fn of ['coach_inbox_mark_read', 'coach_inbox_unread', 'coach_inbox_threads']) {
    const body = code.match(new RegExp(`create or replace function public\\.${fn}\\([\\s\\S]*?\\$\\$;`));
    assert.ok(body, fn);
    assert.match(body[0], /security definer/);
    assert.match(body[0], /set search_path = public/);
    assert.match(code, new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\)\\s+from public, anon`));
  }
  const threads = code.match(/function public\.coach_inbox_threads[\s\S]*?\$\$;/)[0];
  assert.match(threads, /where public\.is_community_admin\(\)/);
});

test('inbox page escapes message bodies and never trusts the URL', () => {
  assert.match(page, /function linkify\(text\)\{\s*return esc\(text\)/);
  assert.match(page, /\$\{linkify\(m\.body\)\}/);
  assert.doesNotMatch(page, /\$\{m\.body\}|\$\{t\.last_body\}/);
  assert.match(page, /\/\^\[0-9a-f-\]\{36\}\$\/i\.test\(want\)/);
});

test('API route, nav item and Community card are wired', () => {
  assert.match(chat, /req\.body\.mode === 'inbox'\) return coachInbox\(req, res\)/);
  assert.match(nav, /\{ id: 'inbox',\s+href: 'inbox\.html',\s+icon: '💌', label: 'Message Monica', kppsOnly: true \}/);
  const order = ['community', 'inbox', 'dashboard'].map(id => nav.indexOf(`id: '${id}'`));
  assert.ok(order[0] < order[1] && order[1] < order[2], 'community → inbox → dashboard');
  assert.match(community, /href="inbox\.html"/);
});

test('email endpoint only fires for the sender of a fresh message', () => {
  const api = read('api/_coach-inbox.js');
  assert.match(api, /msg\.sender_id !== check\.user\.id/);
  assert.match(api, /15 \* 60 \* 1000/);
  assert.match(api, /'Idempotency-Key': 'coach-inbox\/' \+ messageId/);
});
