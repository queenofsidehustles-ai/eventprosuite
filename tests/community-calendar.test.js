const test = require('node:test');
const assert = require('node:assert');
const cal = require('../api/_community-calendar.js');
const fs = require('fs');
const path = require('path');

test('36 posts, one per Mon/Wed/Fri, valid spaces', () => {
  assert.equal(cal.POSTS.length, 36);
  assert.equal(new Set(cal.POSTS.map(p => p.date)).size, 36);
  for (const p of cal.POSTS) {
    assert.ok([1, 3, 5].includes(new Date(p.date + 'T12:00:00Z').getUTCDay()), p.date);
    assert.ok(['checkins', 'questions', 'wins'].includes(p.space));
    assert.ok(p.body.length > 20 && p.body.length < 5000);
    assert.ok(!/go live/i.test(p.body));
    assert.ok(!/\bgod\b/.test(p.body), 'capitalize God');
  }
});

test('Eastern date is used for scheduling', () => {
  assert.equal(cal.easternDate(new Date('2026-10-26T03:00:00Z')), '2026-10-25');
  assert.equal(cal.easternDate(new Date('2026-10-26T10:00:00Z')), '2026-10-26');
});

test('cron runs the calendar and never double-posts', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'api', 'send-reminders.js'), 'utf8');
  assert.match(src, /runCommunityCalendar\(now\)/);
  assert.match(src, /recent\.has\(p\.body\)/);
});
