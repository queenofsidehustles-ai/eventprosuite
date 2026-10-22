// Community engagement calendar: three posts a week (Mon goal, Wed tip +
// question, Fri wins), published automatically by the daily cron in
// api/send-reminders.js under Monica's account. Dates are Eastern (America/New_York).
// To change a post, edit it here; a post already published is never re-posted.

const POSTS = [
  // ── Week 1 ──
  { date: '2026-10-26', space: 'checkins', body: `🎯 One Goal Monday

New week, new step. What's your ONE goal for your party business this week?

Keep it small enough to finish: pick your party, name your package, post one video. Drop it below and we'll hold you to it. 👇` },
  { date: '2026-10-28', space: 'questions', body: `💡 Tip + Question

Show a price range on your page, not just "DM for pricing." Parents who can see a number feel safe reaching out, and the ones who message you are already a fit.

Your turn: do you show prices yet? If not, what's holding you back? 👇` },
  { date: '2026-10-30', space: 'wins', body: `🏆 Win Friday!

Finished a day of your launch? Posted a video? Got your first inquiry? Every win counts here, big or small.

Drop yours below so we can celebrate you. 🎉` },

  // ── Week 2 ──
  { date: '2026-11-02', space: 'checkins', body: `🎯 One Goal Monday

November is here, and holiday parties are right around the corner. What's ONE thing you'll finish this week to be ready for them?

Tell us below. 👇` },
  { date: '2026-11-04', space: 'questions', body: `💡 Tip + Question

Speed wins parties. Most moms ask two or three businesses at once, and the first clear answer usually gets the booking. Try to reply within a few hours, even if it's just "Got it! Sending your quote tonight."

(Your Hub also follows up on quotes for you after 1, 3 and 7 days.)

How fast do you usually reply to inquiries right now? 👇` },
  { date: '2026-11-06', space: 'wins', body: `🏆 Win Friday!

What moved forward this week? A finished package, a new follower who asked a question, a friend who said "I'd book that"?

Share it below. You never know who needs to see your progress today. 💜` },

  // ── Week 3 ──
  { date: '2026-11-09', space: 'checkins', body: `🎯 One Goal Monday

Which day of your 14-Day Launch are you on? Tell us your day and your ONE goal for this week.

Stuck on a day? Say which one, and we'll help you get moving. 👇` },
  { date: '2026-11-11', space: 'questions', body: `💡 Tip + Question

A date isn't booked until the deposit is paid. Saying "I'll hold it for you" without one is how you lose a Saturday to a no-show. Day 7 walks you through setting this up the simple way.

Do you take deposits yet? What percent feels right to you? 👇` },
  { date: '2026-11-13', space: 'wins', body: `🏆 Win Friday!

Tiny wins count too: you set up your business email, posted your first reel, or finally picked a name.

What's yours this week? 👇` },

  // ── Week 4 ──
  { date: '2026-11-16', space: 'checkins', body: `🎯 One Goal Monday

Holiday season idea: a small "holiday mini party" package for class parties, Friendsgivings or office family events.

What's your ONE goal this week? Bonus if it gets you ready for December. 👇` },
  { date: '2026-11-18', space: 'questions', body: `💡 Tip + Question

Your first package should be easy to say yes to: one price, a clear guest count and three or four things included. You can add more options after your first bookings.

Share your package name and what's in it, and we'll cheer you on (and give kind feedback if you want it). 👇` },
  { date: '2026-11-20', space: 'wins', body: `🏆 Win Friday!

What are you proud of this week? Drop a win, a photo of your setup or a screenshot of a sweet message from a parent. 📸

(Using an AI photo? Label it "AI-inspired.")` },

  // ── Week 5 (Thanksgiving) ──
  { date: '2026-11-23', space: 'checkins', body: `🎯 One Goal Monday

Short week for many of us. Pick ONE small goal you can finish before Thanksgiving, and give yourself grace for the rest.

What is it? 👇` },
  { date: '2026-11-25', space: 'questions', body: `💡 Tip + Question

Thanksgiving week is a perfect time to say thank you. Text a past client or a practice-party family, thank them, and ask if they'd leave you a short Google review. Reviews bring in more bookings than almost anything else.

Who's one person you could thank this week? 👇` },
  { date: '2026-11-27', space: 'wins', body: `🏆 Grateful Friday 🍂

Instead of a win, share one thing you're grateful for in your business journey so far. It can be a person, a lesson or just the fact that you started.

I'm grateful for every one of you. 💜` },

  // ── Week 6 ──
  { date: '2026-11-30', space: 'checkins', body: `🎯 One Goal Monday

Last month of the year! What's ONE thing you want done in your party business before December ends?

Write it below, and come back Friday to tell us how it's going. 👇` },
  { date: '2026-12-02', space: 'questions', body: `💡 Tip + Question

Put your Birthday List QR code on goodie bags, your table sign and your thank-you texts. Every family who joins gets a friendly reminder before their child's next birthday, so one party can turn into next year's party.

Have you set up your Birthday List yet? (Grow → Birthday List in your Hub.) 👇` },
  { date: '2026-12-04', space: 'wins', body: `🏆 Win Friday!

Did anyone book a holiday party, finish their website or get a new review this week? Tell us everything. 🎉` },

  // ── Week 7 ──
  { date: '2026-12-07', space: 'checkins', body: `🎯 One Goal Monday

What's your ONE goal this week? If you're not sure, try this: post one short video showing a piece of your setup.

Drop your goal below. 👇` },
  { date: '2026-12-09', space: 'questions', body: `💡 Tip + Question

At every party, take three photos: the full setup before guests arrive, a close-up detail and (with permission) the kids enjoying it. Those three shots become a week of posts.

What's the one setup detail you're most proud of? 👇` },
  { date: '2026-12-11', space: 'wins', body: `🏆 Win Friday!

Share a win from this week, and tag a classmate who's been encouraging you. Let's lift each other up. 💜` },

  // ── Week 8 ──
  { date: '2026-12-14', space: 'checkins', body: `🎯 One Goal Monday

January birthdays book in December. What's ONE thing you'll do this week to get in front of January parents?

Share it below. 👇` },
  { date: '2026-12-16', space: 'questions', body: `💡 Tip + Question

Slow weeks are planning weeks. Write down five video ideas now, so January doesn't start with a blank page. Ideas: your setup time-lapse, "what's in my party bag," a parent FAQ, your favorite add-on and a day-in-the-life.

What's one video idea you're excited to try? 👇` },
  { date: '2026-12-18', space: 'wins', body: `🏆 Win Friday!

Before the holidays, let's celebrate! What's the biggest step you've taken in your business this year? 🎉` },

  // ── Week 9 (Christmas) ──
  { date: '2026-12-21', space: 'checkins', body: `🎯 One Goal Monday

Holiday week! Your only goal can be rest, and that counts. If you want one small business task, what is it?

Tell us below. 👇` },
  { date: '2026-12-23', space: 'questions', body: `💬 Just for fun

What's your favorite party memory, from your own business or from a party you went to as a kid?

Let's hear them! 👇` },
  { date: '2026-12-25', space: 'wins', body: `🎄 Merry Christmas, family!

Thank you for building alongside me this year. Enjoy today with the people you love. We'll be right here when you're ready.

With love and gratitude to God for each of you,
Monica 💜` },

  // ── Week 10 (New Year) ──
  { date: '2026-12-28', space: 'checkins', body: `🎯 One Goal Monday

Let's finish the year strong. What's ONE thing you'll wrap up before January 1st?

Drop it below. 👇` },
  { date: '2026-12-30', space: 'questions', body: `💡 Tip + Question

New year, fresh look at your prices. A simple check: if you're turning parties away or booked most weekends, it may be time to raise your price. If you're not booking yet, work on being seen before you lower anything.

Are you keeping or changing your prices for the new year? 👇` },
  { date: '2027-01-01', space: 'wins', body: `🎉 Happy New Year!

What's your big goal for your party business this year? Write it here so we can cheer you on all year long.

This is your year. Let's build it together. 💜` },

  // ── Week 11 ──
  { date: '2027-01-04', space: 'checkins', body: `🎯 One Goal Monday

First full week of the year! What's your ONE goal this week?

New here? Introduce yourself in Introduce Yourself, then tell us your goal. 👇` },
  { date: '2027-01-06', space: 'questions', body: `💡 Tip + Question

Go where parents already are: daycares, dance studios, churches, kids' gyms and school PTAs. Bring a simple flyer with your QR code and ask if you can leave a few. Day 13 walks you through it.

Which local spot could you visit this month? 👇` },
  { date: '2027-01-08', space: 'wins', body: `🏆 Win Friday!

First Win Friday of the year! What did you get done this week? 🎉` },

  // ── Week 12 ──
  { date: '2027-01-11', space: 'checkins', body: `🎯 One Goal Monday

What's ONE thing that would make the biggest difference in your business this week? Do that first.

Share it below. 👇` },
  { date: '2027-01-13', space: 'questions', body: `💡 Tip + Question

One party, done really well, beats five parties done halfway. If you feel scattered, go back to your one party and your one package for now.

What's the one party you're focused on right now? 👇` },
  { date: '2027-01-15', space: 'wins', body: `🏆 Win Friday!

Look how far you've come since you started. Share one before-and-after: where you were then, and where you are now. 💜` },
];

// Today's date in Eastern time, as YYYY-MM-DD.
function easternDate(now) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now || new Date());
}

function postsFor(dateStr) {
  return POSTS.filter(p => p.date === dateStr);
}

module.exports = { POSTS, easternDate, postsFor };
