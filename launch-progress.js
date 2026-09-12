(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PBHLaunchProgress = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_PACKAGE_NAMES = new Set([
    'starter party package',
    'signature party package',
    'premium party package'
  ]);

  function text(value) {
    return String(value == null ? '' : value).trim();
  }

  function list(value) {
    return Array.isArray(value) ? value : [];
  }

  function hasPositivePrice(item) {
    const direct = Number(String(item && item.price != null ? item.price : '').replace(/[^0-9.]/g, ''));
    if (direct > 0) return true;
    return list(item && item.items).some(line => {
      const price = Number(String(line && line.price != null ? line.price : '').replace(/[^0-9.]/g, ''));
      return price > 0;
    });
  }

  function isRealQuotePackage(item) {
    if (!item || !text(item.name)) return false;
    const untouchedDefault = ['basic', 'mid', 'premium'].includes(text(item.id).toLowerCase()) &&
      DEFAULT_PACKAGE_NAMES.has(text(item.name).toLowerCase()) &&
      list(item.items).length === 0;
    return !untouchedDefault;
  }

  function packageSources(profileData, websiteBuild) {
    const pd = profileData || {};
    const build = websiteBuild || {};
    const bookingServices = list(pd.bookingServices).filter(item => item && text(item.name));
    const websitePackages = list(build.packages_data).filter(item => item && text(item.name));
    const quotePackages = list(pd.packages).filter(isRealQuotePackage);
    return { bookingServices, websitePackages, quotePackages };
  }

  function containsPaymentLink(value) {
    if (typeof value === 'string') return /^https?:\/\//i.test(value.trim());
    if (Array.isArray(value)) return value.some(containsPaymentLink);
    if (value && typeof value === 'object') return Object.values(value).some(containsPaymentLink);
    return false;
  }

  function printableProductReady(product, profileData) {
    const pd = profileData || {};
    const payment = text(product && product.stripe_link) || text(pd.paymentLink);
    return Boolean(
      product && product.active === true &&
      hasPositivePrice(product) &&
      text(product.file_url) &&
      containsPaymentLink(payment)
    );
  }

  function evaluateLaunchProgress(input) {
    const data = input || {};
    const pd = data.profileData || {};
    const build = data.websiteBuild || {};
    const brand = build.brand_data || {};
    const booking = build.booking_data || {};
    const sources = packageSources(pd, build);
    const allPackages = sources.bookingServices.concat(sources.websitePackages, sources.quotePackages);
    const products = list(data.products);
    const entitlements = data.entitlements || {};
    const includePrintables = entitlements.hasPrintables === true;

    const hasService = Boolean(
      text(build.niche_type) ||
      sources.bookingServices.length ||
      sources.websitePackages.length ||
      sources.quotePackages.length
    );
    const hasBusinessName = Boolean(text(pd.businessName) || text(build.business_name) || text(brand.businessName));
    const hasContact = Boolean(
      text(pd.contactPhone) || text(pd.contactEmail) || text(pd.email) ||
      text(brand.phone) || text(brand.email) || text(booking.phone) || text(booking.email)
    );
    const hasPricedPackage = allPackages.some(hasPositivePrice);
    const hasPayment = pd.depositProfile === 'manual' ||
      (pd.depositProfile === 'connected' && pd.stripeConnectReady === true && !!pd.stripeConnectAccountId) ||
      ['stripe100', 'stripe250', 'stripe500', 'stripe1000'].some(key => containsPaymentLink(pd[key])) ||
      containsPaymentLink(pd.stripeLinks);
    const hasPublishedSite = Boolean(build.last_published_at);
    const hasCustomerPathTest = list(data.bookings).length > 0 || list(data.quotes).length > 0;
    const uid = encodeURIComponent(text(data.userId));

    const steps = [
      {
        id: 'service',
        title: 'Choose your first service',
        description: 'Start with one clear, bookable party offer.',
        href: 'mywebsite.html',
        action: 'Choose my service',
        done: hasService
      },
      {
        id: 'basics',
        title: 'Add your business basics',
        description: 'Confirm your business name and customer contact details.',
        href: 'profile.html',
        action: 'Add business basics',
        done: hasBusinessName && hasContact
      },
      {
        id: 'package',
        title: 'Review your first package',
        description: 'Make sure your package has a name and a price.',
        href: 'mywebsite.html',
        action: 'Review my package',
        done: hasPricedPackage
      },
      {
        id: 'payments',
        title: 'Connect your payment links',
        description: 'Add Stripe links or choose manual invoicing.',
        href: 'profile.html?focus=payments',
        action: 'Connect payments',
        done: hasPayment
      },
      {
        id: 'publish',
        title: 'Publish your website and booking page',
        description: 'Put your customer-facing experience live.',
        href: 'mywebsite.html',
        action: 'Publish my website',
        done: hasPublishedSite && hasPricedPackage
      },
      {
        id: 'test',
        title: 'Complete a test booking',
        description: 'Walk through the same path your first customer will use.',
        href: uid ? `book.html?uid=${uid}` : 'profile.html',
        action: 'Test my booking page',
        done: hasCustomerPathTest
      }
    ];

    if (includePrintables) {
      steps.push(
        {
          id: 'printable',
          title: 'Choose your first printable',
          description: 'Add one ready-made design to your store as a draft.',
          href: 'store.html?tab=library',
          action: 'Choose a printable',
          done: products.length > 0
        },
        {
          id: 'store',
          title: 'Open your printable store',
          description: 'Review the price, file, payment link, and store handle before going live.',
          href: 'store.html?tab=mystore',
          action: 'Finish my store',
          done: Boolean(text(data.storeSlug)) && products.some(product => printableProductReady(product, pd))
        }
      );
    }

    const completed = steps.filter(step => step.done).length;
    const nextStep = steps.find(step => !step.done) || null;
    return {
      steps,
      completed,
      total: steps.length,
      percent: Math.round((completed / steps.length) * 100),
      nextStep,
      complete: completed === steps.length
    };
  }

  return { evaluateLaunchProgress, packageSources, containsPaymentLink, printableProductReady };
});
