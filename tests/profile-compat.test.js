'use strict';

const assert = require('node:assert/strict');
const {
  mergePublishedWebsiteIntoProfile,
  websitePackagesToBookingServices
} = require('../api/_profile-compat');

const packages = [
  { name: 'Sleepover for Six', price: '495', duration: '12 hours', included: '6 tents\nBedding\nSetup' },
  { name: '  ', price: '1' }
];

assert.deepEqual(websitePackagesToBookingServices(packages), [{
  name: 'Sleepover for Six',
  price: '495',
  duration: '12 hours',
  description: '6 tents · Bedding · Setup'
}]);

const profile = {
  id: 'student-1',
  profile_data: {
    businessName: 'Existing Student Business',
    automation: { reminders: true },
    bookingServices: [{ name: 'Saved Offer', price: '350' }]
  }
};
const build = {
  brand_data: { businessName: 'Website Name', customPrimary: '#123456', phone: '4075550100' },
  packages_data: packages,
  booking_data: { area: 'Orlando' }
};

const preserved = mergePublishedWebsiteIntoProfile(profile, build);
assert.equal(preserved.profile_data.businessName, 'Existing Student Business');
assert.deepEqual(preserved.profile_data.bookingServices, [{ name: 'Saved Offer', price: '350' }]);
assert.deepEqual(preserved.profile_data.automation, { reminders: true });
assert.equal(preserved.profile_data.brandColor, '#123456');
assert.equal(preserved.profile_data.bookingArea, 'Orlando');
assert.notEqual(preserved.profile_data, profile.profile_data);

const filled = mergePublishedWebsiteIntoProfile({ id: 'student-2', profile_data: {} }, build);
assert.equal(filled.profile_data.businessName, 'Website Name');
assert.equal(filled.profile_data.bookingServices[0].name, 'Sleepover for Six');
assert.equal(filled.profile_data.contactPhone, '4075550100');

console.log('profile compatibility tests passed');
