'use strict';

function clean(value) {
  return value == null ? '' : String(value).trim();
}

function websitePackagesToBookingServices(packages) {
  if (!Array.isArray(packages)) return [];

  return packages
    .filter(pkg => pkg && clean(pkg.name))
    .map(pkg => ({
      name: clean(pkg.name),
      price: clean(pkg.price),
      duration: clean(pkg.duration),
      description: clean(pkg.included)
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .join(' · ')
    }));
}

function mergePublishedWebsiteIntoProfile(profileRow, websiteBuild) {
  const original = (profileRow && profileRow.profile_data) || {};
  const profileData = { ...original };
  const brand = (websiteBuild && websiteBuild.brand_data) || {};
  const booking = (websiteBuild && websiteBuild.booking_data) || {};

  // Existing Business Profile choices always win. Website data is a
  // compatibility fallback for students who built their site first.
  if (!clean(profileData.businessName) && clean(brand.businessName)) profileData.businessName = clean(brand.businessName);
  if (!clean(profileData.brandColor) && clean(brand.customPrimary)) profileData.brandColor = clean(brand.customPrimary);
  if (!profileData.logoDataURL && brand.logoDataURL) profileData.logoDataURL = brand.logoDataURL;
  if (!clean(profileData.contactPhone) && clean(brand.phone)) profileData.contactPhone = clean(brand.phone);
  if (!clean(profileData.contactEmail) && clean(brand.email)) profileData.contactEmail = clean(brand.email);
  if (!clean(profileData.city) && clean(brand.city)) profileData.city = clean(brand.city);
  if (!clean(profileData.bookingArea) && clean(booking.area)) profileData.bookingArea = clean(booking.area);

  if (!Array.isArray(profileData.bookingServices) || profileData.bookingServices.length === 0) {
    const services = websitePackagesToBookingServices(websiteBuild && websiteBuild.packages_data);
    if (services.length) profileData.bookingServices = services;
  }

  return {
    ...(profileRow || {}),
    profile_data: profileData
  };
}

module.exports = {
  mergePublishedWebsiteIntoProfile,
  websitePackagesToBookingServices
};
