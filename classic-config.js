/**
 * classic-config.js — builds the "Classic" website (template.html) from a
 * student's saved website + profile, so the same design works for the live
 * preview in the builder AND for one-click published sites (site.html).
 *
 * Honest by default: no made-up stats, placeholder phone numbers or
 * "trusted name in the city" claims — a section only shows what she entered.
 */
(function (root) {
  'use strict';

  // The Classic template writes these values as HTML, so markup characters are
  // neutralized here: no tags, and quotes can't break out of an attribute.
  const text = v => String(v == null ? '' : v)
    .replace(/[<>]/g, '').replace(/"/g, '”').replace(/`/g, "'").trim();
  const list = v => (Array.isArray(v) ? v : []);
  // Images only from data:image or https URLs, with nothing that can end the attribute.
  const img = v => { const s = String(v || ''); return /^(data:image\/|https:\/\/)/i.test(s) && !/["'<>\s]/.test(s) ? s : null; };
  const first = (...vals) => { for (const v of vals) { const t = text(v); if (t) return t; } return ''; };

  function softTint(hex, strength) {
    if (!hex || !hex.startsWith('#') || hex.length < 7) return '#ffe6f0';
    const s = strength || 0.85;
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    const mix = c => Math.round(c * (1 - s) + 255 * s);
    return '#' + [mix(r), mix(g), mix(b)].map(c => c.toString(16).padStart(2, '0')).join('');
  }

  function shadeColor(hex, percent) {
    if (!hex || !hex.startsWith('#') || hex.length < 7) return hex;
    const f = 1 + (percent / 100);
    const ch = i => Math.min(255, Math.max(0, Math.round(parseInt(hex.slice(i, i + 2), 16) * f)));
    return '#' + [ch(1), ch(3), ch(5)].map(c => c.toString(16).padStart(2, '0')).join('');
  }

  /**
   * pd: profile_data (Business Profile). wb: website_builds row or snapshot
   * (brand_data, niche_data, packages_data, ...). opts: { ownerId, bookUrl }.
   */
  function configFromData(pd, wb, opts) {
    pd = pd || {}; wb = wb || {}; opts = opts || {};
    const brand = wb.brand_data || {};
    const niche = wb.niche_data || {};
    const about = wb.about_data || {};
    const booking = wb.booking_data || {};
    const founding = wb.founding_data || {};
    const gallery = wb.gallery_data || {};

    const businessName = first(brand.businessName, pd.businessName, 'Your Party Business');
    const tagline = first(brand.tagline, pd.tagline, niche.tagline);
    const phone = first(pd.contactPhone, brand.phone);
    const email = first(pd.contactEmail, brand.email, pd.bizEmail);
    const city = first(pd.city, brand.city);

    const packages = list(wb.packages_data).filter(p => p && text(p.name)).map((p, idx, all) => {
      const note = [p.kids ? p.kids + ' kids' : '', text(p.duration)].filter(Boolean).join(' · ');
      return {
        id: 'pkg-' + idx,
        name: text(p.name),
        price: String(p.price || '0').replace(/[^0-9.]/g, ''),
        note: note || 'Per event',
        includes: text(p.included).split('\n').map(l => l.trim()).filter(Boolean),
        footer: 'Tap to add to your package',
        // With three packages, the middle one is featured; with fewer, none is.
        popular: all.length >= 3 && idx === 1
      };
    });

    const addons = list(wb.addons_data).filter(a => a && text(a.name)).map(a => {
      const raw = text(a.price);
      return { name: text(a.name), price: raw === '' ? '' : (/^[0-9]+(\.[0-9]+)?$/.test(raw) ? '$' + raw : raw) };
    });

    const reviews = list(wb.reviews_data).filter(r => r && text(r.text)).map(r => ({
      stars: Math.min(5, Math.max(1, parseInt(r.rating, 10) || 5)),
      text: text(r.text),
      name: first(r.name, 'Happy client'),
      meta: first(r.event, 'Client review'),
      initials: first(r.name, 'C').split(' ').map(x => x.charAt(0)).join('').slice(0, 2).toUpperCase()
    }));

    const ownerName = text(about.ownerName);
    const yearStarted = text(about.yearStarted);
    const paragraphs = text(about.bio).split(/\n\s*\n/).map(x => x.trim()).filter(Boolean);
    const stats = [];
    const yr = parseInt(yearStarted, 10);
    if (yr && yr <= new Date().getFullYear()) {
      const years = Math.max(1, new Date().getFullYear() - yr);
      stats.push({ number: years + '+', label: years === 1 ? 'Year of parties' : 'Years of parties' });
    }
    if (reviews.length) stats.push({ number: String(reviews.length), label: reviews.length === 1 ? 'Family review' : 'Family reviews' });
    if (city) stats.push({ number: '📍', label: 'Proudly serving ' + city });

    const prices = packages.map(p => parseFloat(p.price) || 0).filter(n => n > 0);
    const startingPrice = prices.length ? Math.min(...prices) : '';

    const tag = first(tagline, 'Memorable parties for unforgettable kids');
    let heroHeadline = tag, heroAccent = '';
    const m = tag.match(/^(.+?)[,.]\s*(.+)$/);
    if (m) { heroHeadline = m[1].trim(); heroAccent = m[2].trim(); }
    else { const w = tag.split(' '); if (w.length >= 2) { heroAccent = w.pop(); heroHeadline = w.join(' '); } }

    const primary = first(brand.customPrimary, pd.brandColor, '#ff7faf');
    const accent = first(brand.customAccent, '#d4a840');

    return {
      business: {
        name: businessName,
        initial: (businessName || 'P').charAt(0).toUpperCase(),
        tagline: tagline,
        city: city,
        serviceArea: first(booking.area, pd.bookingArea, city, 'your area'),
        phone: phone,
        email: email,
        heroScript: '✨ where',
        heroHeadline: heroHeadline,
        heroAccent: heroAccent,
        heroLead: first(niche.description, 'Tap a package below to start planning your celebration.'),
        startingPrice: startingPrice
      },
      orgId: opts.ownerId || '',
      // Published Hub sites send booking requests straight to the owner's dashboard.
      hubOwnerId: opts.ownerId || '',
      bookUrl: opts.bookUrl || '',
      formEndpoint: email ? 'mailto:' + email : '',
      booking: { email: first(booking.email, email), area: first(booking.area, city) },
      policies: {
        depositPercent: Number(pd.depositPct) > 0 ? Number(pd.depositPct) : (Number(booking.depositPct) > 0 ? Number(booking.depositPct) : 50),
        balanceDays: pd.balanceDueDays != null && pd.balanceDueDays !== '' ? Number(pd.balanceDueDays) : (Number(booking.balanceDays) || 7),
        rushFee: Number(pd.rushFee) > 0 ? Number(pd.rushFee) : 0, rushDays: 7, bundleDiscountPercent: 0, policyUrl: '#'
      },
      niches: [{
        id: 'main',
        type: wb.niche_type || 'custom',
        icon: first(niche.icon, '✨'),
        name: first(niche.name, 'Our parties'),
        tagline: text(niche.tagline),
        description: text(niche.description),
        packages: packages.length ? packages : [{ id: 'pkg-0', name: 'Custom party', price: '', note: 'Ask for a quote', includes: [], footer: '', popular: false }],
        activities: []
      }],
      addons: addons,
      reviews: reviews,
      about: {
        eyebrow: 'Meet your host',
        headline: ownerName ? `Hi, I'm ${ownerName}.` : `Hi, welcome to ${businessName}.`,
        quote: "You relax. We've got this.",
        paragraphs: paragraphs.length ? paragraphs : [
          `${businessName} creates stress-free kids parties${city ? ' in ' + city : ''}, so you can enjoy the day with your child.`
        ],
        stats: stats,
        ownerName: ownerName,
        yearStarted: yearStarted,
        photoDataURL: img(about.photoDataURL)
      },
      founding: {
        enabled: founding.enabled === true,
        discount: text(founding.discount),
        spots: text(founding.spots) || '5',
        headline: text(founding.headline)
      },
      brand: { primary: primary, accent: accent, logoDataURL: img(brand.logoDataURL) || img(pd.logoDataURL) },
      socials: {
        instagram: first(brand.socialInstagram, pd.instagram),
        tiktok: first(brand.socialTiktok, pd.tiktok),
        facebook: first(brand.socialFacebook, pd.facebook),
        youtube: text(brand.socialYoutube),
        custom: text(brand.socialCustom)
      },
      faqs: list((wb.faq_data || {}).items).filter(f => f && text(f.question))
        .map(f => ({ question: text(f.question), answer: text(f.answer) })),
      gallery: { heroPhotoDataURL: img(gallery.heroPhotoDataURL), photos: list(gallery.photos).map(img).filter(Boolean) }
    };
  }

  function merge(templateHTML, cfg) {
    const configRegex = /\/\/ __CUSTOMIZER_CONFIG_START__[\s\S]*?\/\/ __CUSTOMIZER_CONFIG_END__/;
    if (!configRegex.test(templateHTML)) throw new Error('The preview could not load. Refresh the page and try again.');
    // Escape "</" so a value can never close the <script> it lives in.
    const json = JSON.stringify(cfg, null, 2).replace(/<\//g, '<\\/');
    let out = templateHTML.replace(configRegex, () => '// __CUSTOMIZER_CONFIG_START__\nconst CONFIG = ' + json + ';\n// __CUSTOMIZER_CONFIG_END__');
    const p = cfg.brand.primary, a = cfg.brand.accent;
    const colors = `/* __CUSTOMIZER_COLORS_START__ */
      --primary: ${p};
      --primary-soft: ${softTint(p)};
      --accent: ${a};
      --soft: ${softTint(p, .92)};
      --gold: ${a};
      --gold-bright: ${shadeColor(a, 15)};
      /* __CUSTOMIZER_COLORS_END__ */`;
    out = out.replace(/\/\* __CUSTOMIZER_COLORS_START__ \*\/[\s\S]*?\/\* __CUSTOMIZER_COLORS_END__ \*\//, () => colors);
    return out;
  }

  const api = { configFromData, merge, softTint, shadeColor };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PBHClassic = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
