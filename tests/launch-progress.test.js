const assert = require('node:assert/strict');
const { evaluateLaunchProgress } = require('../launch-progress');

function ids(result) {
  return Object.fromEntries(result.steps.map(step => [step.id, step.done]));
}

{
  const result = evaluateLaunchProgress({ userId: 'new-student' });
  assert.equal(result.completed, 0);
  assert.equal(result.nextStep.id, 'service');
  assert.equal(result.steps.at(-1).href, 'book.html?uid=new-student');
}

{
  const profileData = {
    businessName: 'Bella Events',
    contactPhone: '555-0100',
    bookingServices: [{ name: 'Sleepover for Six', price: '650' }],
    stripe250: 'https://buy.stripe.com/example'
  };
  const snapshot = JSON.stringify(profileData);
  const result = evaluateLaunchProgress({
    profileData,
    userId: 'legacy-account',
    quotes: [{ id: 'test-quote' }]
  });
  assert.deepEqual(ids(result), {
    service: true,
    basics: true,
    package: true,
    payments: true,
    publish: false,
    test: true
  });
  assert.equal(result.nextStep.id, 'publish');
  assert.equal(JSON.stringify(profileData), snapshot, 'progress checks must never alter student data');
}

{
  const result = evaluateLaunchProgress({
    profileData: {},
    websiteBuild: {
      niche_type: 'slumber',
      business_name: 'Dream Night Parties',
      brand_data: { email: 'hello@example.com' },
      packages_data: [{ name: 'Starlight Six', price: '$625' }],
      last_published_at: '2026-09-11T12:00:00.000Z'
    }
  });
  assert.deepEqual(ids(result), {
    service: true,
    basics: true,
    package: true,
    payments: false,
    publish: true,
    test: false
  });
  assert.equal(result.nextStep.id, 'payments');
}

{
  const result = evaluateLaunchProgress({
    profileData: {
      businessName: 'Complete Parties',
      contactPhone: '555-0101',
      stripeLinks: { deposit: 'https://buy.stripe.com/complete' }
    },
    websiteBuild: {
      niche_type: 'craft',
      packages_data: [{ name: 'Maker Party', price: 395 }],
      last_published_at: '2026-09-11T12:00:00.000Z'
    },
    bookings: [{ id: 'booking-1' }]
  });
  assert.equal(result.complete, true);
  assert.equal(result.completed, 6);
  assert.equal(result.nextStep, null);
}

{
  const result = evaluateLaunchProgress({
    profileData: {
      packages: [
        { id: 'basic', name: 'Starter Party Package', items: [] },
        { id: 'mid', name: 'Signature Party Package', items: [] },
        { id: 'premium', name: 'Premium Party Package', items: [] }
      ]
    }
  });
  assert.equal(ids(result).service, false, 'untouched quote defaults are not a chosen service');
  assert.equal(ids(result).package, false, 'untouched quote defaults are not a finished package');
}

console.log('launch progress tests passed');
