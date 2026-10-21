'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const sql = read('migrations/20261022_community.sql');
const page = read('community.html');
const nav = read('nav.js');
const course = read('course.html');
// SQL with comments stripped, so the verify block can't satisfy a check.
const code = sql.replace(/--.*$/gm, '');

const TABLES = ['community_posts', 'community_comments', 'community_reactions'];

test('migration enables RLS on all three community tables', () => {
  for (const t of TABLES) {
    assert.match(code, new RegExp(`alter table public\\.${t}\\s+enable row level security`), t);
    assert.match(code, new RegExp(`revoke all on public\\.${t}\\s+from anon`), t);
  }
});

test('migration never grants anything to anon', () => {
  assert.doesNotMatch(code, /grant[^;]*\bto\s+anon\b/i);
  assert.doesNotMatch(code, /\bto\s+anon\b/i);
  assert.doesNotMatch(code, /to\s+public\s*(;|using|with)/i);
});

test('announcements and pins are admin-only', () => {
  const insert = code.match(/create policy "community_posts: members post"[\s\S]*?;/);
  assert.ok(insert, 'post insert policy exists');
  assert.match(insert[0], /space <> 'announcements' or public\.is_community_admin\(\)/);
  assert.match(insert[0], /pinned = false or public\.is_community_admin\(\)/);
  assert.match(insert[0], /author_id = auth\.uid\(\)/);
  // The trigger also blocks members from pinning or moving a post into Announcements on update.
  assert.match(code, /before insert or update on public\.community_posts/);
  assert.match(code, /new\.pinned is distinct from old\.pinned/);
  assert.match(code, /'ggkidsspa@gmail\.com', 'hello@bearhug\.events'/);
});

test('member and author functions are security definer with a fixed search_path', () => {
  for (const fn of ['is_community_member', 'is_community_admin', 'community_authors']) {
    const body = code.match(new RegExp(`create or replace function public\\.${fn}\\([\\s\\S]*?\\$\\$;`));
    assert.ok(body, fn);
    assert.match(body[0], /security definer/);
    assert.match(body[0], /set search_path = public/);
    assert.match(code, new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\)\\s+to authenticated`));
  }
  const authors = code.match(/function public\.community_authors[\s\S]*?\$\$;/)[0];
  assert.match(authors, /is_community_member\(\)/);
  assert.doesNotMatch(authors, /p\.email|phone|stripe|has_/i);
});

test('photo uploads are limited to the member\'s own folder', () => {
  assert.match(code, /insert into storage\.buckets[\s\S]*'community', 'community', true/);
  assert.match(code, /\(storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text/);
});

test('community page escapes everything it renders from the database', () => {
  // Post and comment bodies only ever pass through linkify(), which escapes first.
  assert.match(page, /function linkify\(text\)\{\s*return esc\(text\)/);
  assert.match(page, /\$\{linkify\(p\.body\)\}/);
  assert.match(page, /\$\{linkify\(c\.body\)\}/);
  assert.doesNotMatch(page, /\$\{p\.body\}|\$\{c\.body\}|innerHTML\s*=\s*[^;]*\.body\b/);
  assert.match(page, /rel="noopener noreferrer nofollow"/);
  // Only photos from the community bucket are shown.
  assert.match(page, /function safeImg/);
  // No browser confirm() for deletes.
  assert.doesNotMatch(page, /window\.confirm|[^.\w]confirm\(/);
});

test('nav has Community as a students-only item right after the 14-Day Launch', () => {
  assert.match(nav, /\{ id: 'community', href: 'community\.html', icon: '💬', label: 'Community', kppsOnly: true \}/);
  const order = ['course', 'community', 'dashboard'].map(id => nav.indexOf(`id: '${id}'`));
  assert.ok(order[0] < order[1] && order[1] < order[2], 'course → community → dashboard');
});

test('course links to the Hub community, not Skool', () => {
  assert.doesNotMatch(course, /skool/i);
  assert.match(course, /community\.html\?space=checkins&compose=1&day=/);
  assert.match(course, /community\.html\?space=introductions&compose=1/);
});

test('copy rules: no "go live" for launching', () => {
  // "go live" is only allowed for her TikTok livestreams.
  for (const m of page.matchAll(/go live[^<.]*/gi)) assert.match(m[0], /TikTok/);
});

test('inline scripts parse', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pbh-community-'));
  for (const [name, html] of [['community.html', page], ['course.html', course]]) {
    const blocks = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m => m[1]).filter(s => s.trim());
    blocks.forEach((src, i) => {
      const f = path.join(dir, `${name}.${i}.js`);
      fs.writeFileSync(f, src);
      execFileSync(process.execPath, ['--check', f]);
    });
  }
  execFileSync(process.execPath, ['--check', path.join(__dirname, '..', 'nav.js')]);
});
