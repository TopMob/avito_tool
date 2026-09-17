/**
 * Avito Parser: extracts listings from search result pages.
 * Priority: __NEXT_DATA__ JSON + DOM enrichment.
 */

const AvitoParser = (() => {

  const DEFAULT_FIELDS = {
    aiPrompt: true,
    title: true,
    price: true,
    description: true,
    delivery: false,
    location: false,
    date: false,
    seller: false,
    url: false,
    image: false,
  };

  function cleanUrl(url) {
    if (!url) return '';
    try {
      const full = url.startsWith('http') ? url : `https://www.avito.ru${url}`;
      const u = new URL(full, typeof window !== 'undefined' ? window.location.origin : 'https://www.avito.ru');
      return `${u.origin}${u.pathname}`;
    } catch {
      return (url.startsWith('http') ? url : `https://www.avito.ru${url}`).split('?')[0].split('#')[0];
    }
  }

  function extractIdFromUrl(href) {
    if (!href) return null;
    try {
      const full = href.startsWith('http') ? href : `https://www.avito.ru${href}`;
      const { pathname } = new URL(full, typeof window !== 'undefined' ? window.location.origin : 'https://www.avito.ru');
      return pathname.match(/_(\d+)(?=\/|$)/)?.[1] || null;
    } catch {
      return href.match(/_(\d+)(?=\/|$|\?|#)/)?.[1] || null;
    }
  }

  function cleanText(str) {
    return String(str || '').replace(/\s+/g, ' ').trim();
  }

  function cleanTitle(raw) {
    if (!raw) return '';
    let t = cleanText(raw);
    t = t.replace(/^объявление\s*[«"“](.*?)[»"”]$/i, '$1');
    return t.trim();
  }

  function extractNumericPrice(rawPrice) {
    if (rawPrice == null) return null;
    if (typeof rawPrice === 'number') return Math.round(rawPrice);
    let str = String(rawPrice).trim();
    if (!str) return null;

    // Pattern for discounted or concatenated prices e.g. "2 530 ₽4 600 ₽ -45%" or "2 530 ₽ 4 600 ₽"
    const firstPart = str.match(/^([\d\s\u00a0]+)(?:₽|руб\.?|р\.?|$)/i);
    if (firstPart && firstPart[1]) {
      const digits = firstPart[1].replace(/[^\d]/g, '');
      if (digits) return parseInt(digits, 10);
    }

    const digitsOnly = str.replace(/[^\d]/g, '');
    return digitsOnly ? parseInt(digitsOnly, 10) : null;
  }

  function cleanPrice(rawPrice) {
    if (!rawPrice) return '';
    let str = String(rawPrice).trim();

    // Avito discount pattern: "2 530 ₽4 600 ₽ -45%" or "2 530 ₽ 4 600 ₽ -45%"
    const matchCurrency = str.match(/^([\d\s\u00a0]+(?:₽|руб\.?|р\.?))/i);
    if (matchCurrency) {
      return matchCurrency[1].trim().replace(/\s+/g, ' ');
    }

    const matchDigits = str.match(/^([\d\s\u00a0]{2,})/);
    if (matchDigits) {
      const val = matchDigits[1].trim().replace(/\s+/g, ' ');
      if (val) return `${val} ₽`;
    }

    return str.replace(/\s+/g, ' ');
  }

  function extractNextDataDelivery(raw) {
    if (!raw || typeof raw !== 'object') return false;
    if (raw.isDelivery === true || raw.hasDelivery === true) return true;
    if (raw.delivery) {
      if (typeof raw.delivery === 'boolean') return raw.delivery;
      if (typeof raw.delivery === 'object') {
        if (raw.delivery.available === true || raw.delivery.isDelivery === true) return true;
        if (raw.delivery.type || raw.delivery.text) return true;
      }
    }
    if (raw.deliveryItem) return true;

    try {
      const str = JSON.stringify(raw).toLowerCase();
      if (str.includes('"isdelivery":true') || str.includes('"hasdelivery":true') || str.includes('доставка от')) {
        return true;
      }
    } catch {}
    return false;
  }

  function extractNextDataReserved(raw) {
    if (!raw || typeof raw !== 'object') return false;
    if (raw.isReserved === true || raw.reserved === true || raw.isBooked === true || raw.booked === true) return true;
    if (raw.status === 'reserved' || raw.state === 'reserved' || raw.status === 'booked' || raw.state === 'booked') return true;
    if (raw.delivery && (raw.delivery.isReserved === true || raw.delivery.status === 'reserved' || raw.delivery.isBooked === true || raw.delivery.status === 'booked')) return true;

    try {
      const str = JSON.stringify(raw).toLowerCase();
      if (str.includes('"isreserved":true') || str.includes('"isbooked":true') || /забронирован|зарезервирован|заказ\s+оформлен/.test(str)) {
        return true;
      }
    } catch {}
    return false;
  }

  function parseFromNextData() {
    const scriptEl = document.querySelector('script#__NEXT_DATA__');
    if (!scriptEl) return null;

    try {
      const payload = JSON.parse(scriptEl.textContent);
      const items = digItems(payload);
      if (!items || items.length === 0) return null;
      return items.map(normalizeNextDataItem);
    } catch {
      return null;
    }
  }

  function digItems(obj) {
    const paths = [
      ['props', 'pageProps', 'data', 'catalog', 'items'],
      ['props', 'pageProps', 'initialState', 'catalog', 'list', 'items'],
      ['props', 'pageProps', 'serverData', 'catalog', 'items'],
    ];

    for (const path of paths) {
      let cursor = obj;
      let found = true;
      for (const key of path) {
        if (cursor && typeof cursor === 'object' && key in cursor) {
          cursor = cursor[key];
        } else {
          found = false;
          break;
        }
      }
      if (found && Array.isArray(cursor) && cursor.length > 0) return cursor;
    }

    return deepFindItems(obj, 0);
  }

  function deepFindItems(obj, depth) {
    if (depth > 8 || !obj || typeof obj !== 'object') return null;

    if (Array.isArray(obj)) {
      if (obj.length > 2 && obj[0] && typeof obj[0] === 'object') {
        const keys = Object.keys(obj[0]);
        const hasTitle = keys.some(k => /title|name/i.test(k));
        const hasPrice = keys.some(k => /price|cost/i.test(k));
        if (hasTitle && hasPrice) return obj;
      }
      for (const item of obj) {
        const result = deepFindItems(item, depth + 1);
        if (result) return result;
      }
      return null;
    }

    for (const key of Object.keys(obj)) {
      const result = deepFindItems(obj[key], depth + 1);
      if (result) return result;
    }
    return null;
  }

  function normalizeNextDataItem(raw) {
    const rawPrice = extractPrice(raw);
    const price = cleanPrice(rawPrice);
    const priceNum = extractNumericPrice(rawPrice || price);
    const url = extractUrl(raw);
    const id = extractIdFromUrl(url) || (raw.id ? String(raw.id) : null);

    return {
      id,
      title:       cleanTitle(extractField(raw, ['title', 'name'])),
      price:       price,
      priceNum:    priceNum,
      oldPrice:    null,
      oldPriceNum: null,
      discount:    null,
      hasDelivery: extractNextDataDelivery(raw),
      deliveryText: extractNextDataDelivery(raw) ? 'Авито Доставка' : null,
      isReserved:  extractNextDataReserved(raw),
      isPromoted:  false,
      description: extractDescription(raw),
      location:    extractLocation(raw),
      url:         url,
      date:        extractField(raw, ['time', 'date', 'sortTimeStamp', 'publishDate']),
      seller:      extractSeller(raw),
      sellerRating: null,
      sellerReviews: null,
      image:       extractImage(raw),
    };
  }

  function extractField(obj, keys) {
    for (const key of keys) {
      if (obj[key] != null) return String(obj[key]).trim();
    }
    for (const prop of Object.values(obj)) {
      if (prop && typeof prop === 'object' && !Array.isArray(prop)) {
        for (const key of keys) {
          if (prop[key] != null) return String(prop[key]).trim();
        }
      }
    }
    return '';
  }

  function extractDescription(raw) {
    const keys = ['description', 'snippet', 'body', 'shortDescription', 'comment', 'text', 'shortText'];
    for (const key of keys) {
      if (raw[key] && typeof raw[key] === 'string' && raw[key].trim()) {
        return raw[key].trim().replace(/\s+/g, ' ');
      }
      if (raw[key] && typeof raw[key] === 'object' && !Array.isArray(raw[key])) {
        const text = raw[key].text || raw[key].value || raw[key].plainText;
        if (text) return String(text).trim().replace(/\s+/g, ' ');
      }
    }
    for (const prop of Object.values(raw)) {
      if (prop && typeof prop === 'object' && !Array.isArray(prop)) {
        for (const key of keys) {
          if (prop[key] && typeof prop[key] === 'string' && prop[key].trim()) {
            return prop[key].trim().replace(/\s+/g, ' ');
          }
        }
      }
    }
    return '';
  }

  function extractPrice(raw) {
    if (raw.price != null) {
      if (typeof raw.price === 'object') {
        return raw.price.text || raw.price.value || raw.price.formatted || JSON.stringify(raw.price);
      }
      return String(raw.price).trim();
    }
    for (const val of Object.values(raw)) {
      if (val && typeof val === 'object' && !Array.isArray(val) && 'price' in val) {
        return typeof val.price === 'object'
          ? (val.price.text || val.price.value || '')
          : String(val.price).trim();
      }
    }
    return '';
  }

  function extractLocation(raw) {
    for (const key of ['location', 'geo', 'address', 'geoReferences']) {
      if (raw[key]) {
        if (typeof raw[key] === 'string') return raw[key].trim();
        if (typeof raw[key] === 'object') {
          return (raw[key].name || raw[key].formattedAddress || raw[key].title || '').trim();
        }
      }
    }
    return '';
  }

  function extractUrl(raw) {
    let url = '';
    if (raw.url) url = raw.url;
    else if (raw.urlPath) url = raw.urlPath;
    else if (raw.itemUrl) url = raw.itemUrl;
    else if (raw.id) url = `https://www.avito.ru/items/${raw.id}`;
    return cleanUrl(url);
  }

  function extractSeller(raw) {
    if (raw.seller) {
      return typeof raw.seller === 'object' ? (raw.seller.name || raw.seller.title || '') : String(raw.seller).trim();
    }
    if (raw.userInfo) {
      return typeof raw.userInfo === 'object' ? (raw.userInfo.name || '') : String(raw.userInfo).trim();
    }
    return '';
  }

  function extractImage(raw) {
    if (raw.images && Array.isArray(raw.images) && raw.images.length > 0) {
      const img = raw.images[0];
      return typeof img === 'string' ? img : (img.url || img.src || img['640x480'] || '');
    }
    if (raw.image) {
      return typeof raw.image === 'string' ? raw.image : (raw.image.url || raw.image.src || '');
    }
    return '';
  }

  // DOM extraction helpers

  function extractDOMTitle(card) {
    // 1. Search card standard
    const el = card.querySelector('h2 a[data-marker="item-title"], a[data-marker="item-title"], h2 a, [itemprop="name"]');
    if (el) {
      const text = cleanTitle(el.textContent);
      if (text) return text;
      const attrTitle = cleanTitle(el.getAttribute('title'));
      if (attrTitle) return attrTitle;
    }

    // 2. Feed card: a[title]
    const titleLinks = card.querySelectorAll('a[title]');
    for (const a of titleLinks) {
      const href = a.getAttribute('href') || '';
      if (/_(\d+)/.test(href)) {
        const text = cleanTitle(a.getAttribute('title')) || cleanTitle(a.textContent);
        if (text) return text;
      }
    }

    // 3. Any item link
    const itemLinks = card.querySelectorAll('a[href*="_"]');
    for (const a of itemLinks) {
      const text = cleanTitle(a.textContent);
      if (text && text.length > 2 && !/^(подробнее|купить|в корзину|откликнуться)$/i.test(text)) {
        return text;
      }
    }

    // 4. Fallback from URL slug if available
    const url = extractDOMUrl(card);
    const id = extractIdFromUrl(url);
    if (url && id) {
      try {
        const { pathname } = new URL(url, typeof window !== 'undefined' ? window.location.origin : 'https://www.avito.ru');
        const parts = pathname.split('/').filter(Boolean);
        const last = parts[parts.length - 1];
        if (last) {
          const slug = last.replace(new RegExp(`_${id}$`), '').replace(/_/g, ' ');
          if (slug && slug.length > 2) return slug;
        }
      } catch {}
    }

    return id ? `Объявление №${id}` : 'Без названия';
  }

  function extractDOMPriceInfo(card) {
    let price = '';
    let priceNum = null;
    let oldPrice = null;
    let oldPriceNum = null;
    let discount = null;

    // 1. Microdata [itemprop="price"] (span, meta, etc.)
    const itemPriceEl = card.querySelector('[itemprop="price"]');
    if (itemPriceEl) {
      const content = itemPriceEl.getAttribute('content');
      if (content && /^\d+$/.test(content.trim()) && parseInt(content.trim(), 10) > 0) {
        priceNum = parseInt(content.trim(), 10);
        price = priceNum.toLocaleString('ru-RU') + ' ₽';
      } else {
        const txt = itemPriceEl.textContent ? itemPriceEl.textContent.trim() : '';
        const num = extractNumericPrice(txt);
        if (num && num > 0) {
          priceNum = num;
          price = cleanPrice(txt);
        }
      }
    }

    // 2. Specific price container
    if (!price) {
      const priceContainer = card.querySelector('[data-marker="item-price"], [class*="price-price-"], [class*="price-value"], [class*="price-current"]');
      if (priceContainer) {
        const currentPriceEl = priceContainer.querySelector('strong, [class*="price-text"], [itemprop="price"]') || priceContainer;
        const clean = cleanPrice(currentPriceEl.textContent);
        const num = extractNumericPrice(clean);
        if (num && num > 0) {
          price = clean;
          priceNum = num;
        }
      }
    }

    // 3. Fallback: Search elements with currency symbol, excluding delivery, installments, and 0 prices
    if (!price) {
      const candidates = card.querySelectorAll('strong, span, p, div');
      for (const el of candidates) {
        if (el.children && el.children.length > 2) continue;
        if (el.closest('del, s, [class*="price-old"], [class*="discount-old"], [style*="line-through"]')) continue;
        const txt = el.textContent ? el.textContent.trim() : '';
        if (/(?:в\s*мес|в\s*месяц|\/мес|рассрочк|первый\s*взнос)/i.test(txt)) continue;
        if (/доставка\s*от/i.test(txt)) continue;
        if (/(?:₽|руб\.?|р\.?)/i.test(txt)) {
          const num = extractNumericPrice(txt);
          if (num && num > 0) {
            price = cleanPrice(txt);
            priceNum = num;
            break;
          }
        }
      }
    }

    // 4. Old / Strikethrough price
    const oldPriceEl = card.querySelector('del, s, [class*="price-old"], [class*="discount-old"], [style*="line-through"]');
    if (oldPriceEl) {
      const oldTxt = oldPriceEl.textContent ? oldPriceEl.textContent.trim() : '';
      const num = extractNumericPrice(oldTxt);
      if (num && num > 0 && (!priceNum || num > priceNum)) {
        oldPriceNum = num;
        oldPrice = cleanPrice(oldTxt);
      }
    }

    // 5. Discount badge (e.g. "-15%", "−30%")
    const allSpans = card.querySelectorAll('span, div');
    for (const el of allSpans) {
      if (el.children && el.children.length > 0) continue;
      const t = el.textContent ? el.textContent.trim() : '';
      const m = t.match(/^[-−–]\s*(\d{1,2})\s*%$/);
      if (m) {
        discount = `-${m[1]}%`;
        break;
      }
    }

    return {
      price: price || 'Цена не указана',
      priceNum,
      oldPrice,
      oldPriceNum,
      discount,
    };
  }

  function extractDOMPrice(card) {
    return extractDOMPriceInfo(card).price;
  }

  function isBadDescriptionText(text) {
    if (!text || text.length < 10) return true;
    const lower = text.toLowerCase().trim();

    // Avito delivery snippet widget badges (e.g. 'Доставка от 2 дней')
    if (/^доставка\s+от\s+\d+/i.test(lower)) return true;
    if (/^доставка\s+(в|по|курьером|силами)/i.test(lower) && text.length < 35) return true;
    if (/^(только\s+доставка|самовывоз)/i.test(lower) && text.length < 35) return true;
    if (lower === 'доставка' || lower.startsWith('доставка от')) return true;

    // Dates & relative time badges
    if (/^(сегодня|вчера|\d+\s*(день|дня|дней|минут|минуты|час|часа|часов|нед|месяц))/i.test(lower) && text.length < 30) return true;

    // Price / currency
    if (/^\d+[\s\u00a0]*([₽р]|руб)/i.test(lower)) return true;

    // Badges / marketing tags
    if (/^(в наличии|рассрочка|скидка|гарантия|новинка|безопасная сделка)/i.test(lower) && text.length < 30) return true;

    // Seller / rating / reviews badges
    if ((/отзыв|рейтинг/i.test(lower) || /документы\s+проверены/i.test(lower)) && text.length < 40) return true;

    // Reserved / out of stock badge
    if (/зарезервирован/i.test(lower) && text.length < 35) return true;

    return false;
  }

  function extractDOMDescription(card, title = '', price = '') {
    const paragraphs = card.querySelectorAll('p');
    let bestP = '';
    for (const p of paragraphs) {
      if (p.closest('[data-marker*="delivery"]') || p.closest('[class*="delivery"]')) continue;
      if (p.closest('[data-marker*="seller"]') || p.closest('[class*="seller"]')) continue;

      const text = cleanText(p.textContent);
      if (isBadDescriptionText(text)) continue;
      if (title && text.includes(title)) continue;
      if (price && text.includes(price)) continue;

      if (text.length > bestP.length) {
        bestP = text;
      }
    }
    if (bestP.length > 15) return bestP;

    const explicitEls = card.querySelectorAll(
      '[data-marker="item-description"], [data-marker="item-view/item-description"], ' +
      '[class*="iva-item-description"], [class*="item-descriptionStep"], [class*="item-description"]'
    );
    for (const el of explicitEls) {
      if (el.closest('[data-marker*="delivery"]') || el.closest('[class*="delivery"]')) continue;
      const text = cleanText(el.textContent);
      if (!isBadDescriptionText(text) && (!title || !text.includes(title)) && (!price || !text.includes(price))) {
        return text;
      }
    }

    const candidates = card.querySelectorAll('div, span');
    let bestText = '';

    for (const el of candidates) {
      if (el.children && el.children.length > 1) continue;
      if (el.closest('[data-marker="item-price"]') || el.closest('[data-marker="item-title"]') || el.closest('a')) continue;
      if (el.closest('[data-marker*="delivery"]') || el.closest('[class*="delivery"]')) continue;
      if (el.closest('[data-marker*="seller"]') || el.closest('[class*="seller"]')) continue;

      const text = cleanText(el.textContent);
      if (isBadDescriptionText(text)) continue;
      if (title && text.includes(title)) continue;
      if (price && text.includes(price)) continue;

      if (text.length > 25 && text.length > bestText.length) {
        bestText = text;
      }
    }

    return bestText;
  }

  function cleanSeller(str) {
    if (!str) return '';
    let s = String(str).trim();
    s = s.replace(/документы\s+проверены.*$/i, '');
    s = s.replace(/надёжный\s+продавец.*$/i, '');
    s = s.replace(/отзыв.*$/i, '');
    s = s.replace(/\d+[.,]\d+.*$/, '');
    s = s.replace(/[\d,.\s–—·-]+$/, '');
    return s.trim();
  }

  function extractDOMSellerInfo(card) {
    let seller = '';
    let sellerRating = null;
    let sellerReviews = null;

    // 1. Direct seller name
    const linkEl = card.querySelector('[data-marker="seller-name"], [class*="seller-name"], [data-marker="item-user-logo"] ~ p, [class*="userInfoStep"] p, a[href*="/user/"], a[href*="/brands/"]');
    if (linkEl && cleanText(linkEl.textContent)) {
      seller = cleanSeller(linkEl.textContent);
    } else {
      const el = card.querySelector('[data-marker*="seller"], [class*="seller"], [class*="iva-item-seller"]');
      if (el) seller = cleanSeller(el.textContent);
    }

    // 2. Rating score: data-marker, itemprop or aria-label
    const scoreEl = card.querySelector('[data-marker="seller-info/score"], [data-marker="seller-rating/score"], meta[itemprop="ratingValue"]');
    if (scoreEl) {
      const val = scoreEl.getAttribute('content') || scoreEl.textContent;
      if (val && /^\d+([.,]\d+)?$/.test(val.trim())) {
        sellerRating = val.trim().replace(',', '.');
      }
    }
    if (!sellerRating) {
      const ratingEl = card.querySelector('[aria-label*="рейтинг" i], [aria-label*="rating" i], [class*="rating"]');
      if (ratingEl) {
        const aria = ratingEl.getAttribute('aria-label') || '';
        const m = (aria + ' ' + ratingEl.textContent).match(/(\d+[.,]\d+)/);
        if (m) {
          sellerRating = m[1].replace(',', '.');
        }
      }
    }

    // 3. Reviews count: data-marker summary or regex fallback
    const summaryEl = card.querySelector('[data-marker="seller-info/summary"]');
    if (summaryEl && cleanText(summaryEl.textContent)) {
      sellerReviews = cleanText(summaryEl.textContent);
    } else {
      const allText = card.textContent || '';
      const revMatch = allText.match(/(\d+[\s\u00a0]*)(?:отзыв|отзыва|отзывов)/i);
      if (revMatch) {
        sellerReviews = revMatch[1].replace(/\s+/g, '') + ' отзывов';
      }
    }

    return { seller, sellerRating, sellerReviews };
  }

  function extractDOMSeller(card) {
    return extractDOMSellerInfo(card).seller;
  }

  function extractDOMDeliveryInfo(card) {
    if (!card) return { hasDelivery: false, deliveryText: null };

    const delMarker = card.querySelector('[data-marker*="delivery"], [class*="delivery"], [class*="iva-item-delivery"]');
    const svgDelivery = card.querySelector('svg[data-icon-name="delivery"], svg[data-marker*="delivery"], svg[class*="delivery"]');
    const fullText = card.textContent || '';

    let hasDelivery = false;
    let deliveryText = null;

    if (delMarker || svgDelivery || /(?:доставка\s+от|купить\s+с\s+доставкой|авито\s+доставка)/i.test(fullText)) {
      hasDelivery = true;
    }

    const m = fullText.match(/(доставка\s+от\s+\d+\s*(?:дн|ден|дня|дней|час))/i);
    if (m) {
      deliveryText = m[1].trim();
      hasDelivery = true;
    } else if (hasDelivery) {
      deliveryText = 'Авито Доставка';
    }

    return { hasDelivery, deliveryText };
  }

  function extractDOMDelivery(card) {
    return extractDOMDeliveryInfo(card).hasDelivery;
  }

  function extractDOMReserved(card) {
    if (!card) return false;
    const elements = card.querySelectorAll('div, span, p, [class*="badge"], [class*="overlay"], [class*="status"]');
    for (const el of elements) {
      if (el.children && el.children.length > 1) continue;
      const txt = el.textContent ? el.textContent.trim().toLowerCase() : '';
      if (txt === 'забронировано' || txt === 'зарезервировано' || txt === 'заказ оформлен' || txt === 'бронь') {
        return true;
      }
    }
    return false;
  }

  function extractDOMPromoted(card) {
    if (!card) return false;
    const elements = card.querySelectorAll('span, div, p');
    for (const el of elements) {
      if (el.children && el.children.length > 0) continue;
      const txt = el.textContent ? el.textContent.trim().toLowerCase() : '';
      if (txt.includes('продвинуто') || txt === 'реклама') {
        return true;
      }
    }
    return false;
  }

  function extractDOMLocation(card) {
    const locEl = card.querySelector('[data-marker="item-address"], [class*="geo"], [class*="location"], [class*="address"]');
    if (locEl) {
      const txt = cleanText(locEl.textContent);
      if (txt && !/^(сегодня|вчера|\d+\s*(?:минут|час|дн))/i.test(txt)) {
        return txt;
      }
    }
    return '';
  }

  function extractDOMImage(card) {
    const imgEl = card.querySelector('img[src*="avito.st"], img[data-src*="avito.st"], img');
    if (!imgEl) return '';
    const src = imgEl.getAttribute('src') || imgEl.getAttribute('data-src') || imgEl.currentSrc || '';
    if (src && !src.startsWith('data:image')) {
      return src;
    }
    return '';
  }

  function extractDOMUrl(card) {
    const titleLink = card.querySelector('h2 a, a[data-marker="item-title"], a[title]');
    if (titleLink) {
      const href = titleLink.getAttribute('href');
      if (href && /_(\d+)/.test(href)) {
        return cleanUrl(href);
      }
    }

    const allLinks = card.querySelectorAll('a[href*="_"]');
    for (const a of allLinks) {
      const href = a.getAttribute('href');
      if (href && /_(\d+)/.test(href) && !href.includes('/user/') && !href.includes('/brands/')) {
        return cleanUrl(href);
      }
    }

    return '';
  }

  function parseDOMCard(card) {
    const title = extractDOMTitle(card);
    const priceInfo = extractDOMPriceInfo(card);
    const deliveryInfo = extractDOMDeliveryInfo(card);
    const isReserved = extractDOMReserved(card);
    const isPromoted = extractDOMPromoted(card);
    const sellerInfo = extractDOMSellerInfo(card);
    const description = extractDOMDescription(card, title, priceInfo.price);
    const location = extractDOMLocation(card);
    const url = extractDOMUrl(card);
    const id = extractIdFromUrl(url);
    const dateEl = card.querySelector('[data-marker="item-date"], [class*="date"], time');
    const date = dateEl ? cleanText(dateEl.textContent) : '';
    const image = extractDOMImage(card);

    return {
      id,
      title,
      price: priceInfo.price,
      priceNum: priceInfo.priceNum,
      oldPrice: priceInfo.oldPrice,
      oldPriceNum: priceInfo.oldPriceNum,
      discount: priceInfo.discount,
      hasDelivery: deliveryInfo.hasDelivery,
      deliveryText: deliveryInfo.deliveryText,
      isReserved,
      isPromoted,
      description,
      location,
      date,
      seller: sellerInfo.seller,
      sellerRating: sellerInfo.sellerRating,
      sellerReviews: sellerInfo.sellerReviews,
      url,
      image,
    };
  }

  function parseFromDOM() {
    // 1. Search catalog & feed recommendation cards
    const searchCards = document.querySelectorAll('[data-marker="item"], [data-marker="bx-recommendations-block-item"], [class*="iva-item-root"]');
    if (searchCards.length > 0) {
      return Array.from(searchCards).map(parseDOMCard);
    }

    // 2. Feed / Recommendations cards (homepage)
    const itemLinks = Array.from(document.querySelectorAll('a[href*="_"]')).filter(a => {
      const href = a.getAttribute('href') || '';
      return /_(\d+)(?:\?|$|\/)/.test(href) && !href.includes('/user/') && !href.includes('/brands/');
    });

    if (itemLinks.length > 0) {
      const visitedIds = new Set();
      const cards = [];
      for (const a of itemLinks) {
        const href = a.getAttribute('href') || '';
        const id = extractIdFromUrl(href);
        if (!id || visitedIds.has(id)) continue;
        visitedIds.add(id);

        let cur = a.parentElement;
        let cardContainer = a.parentElement;

        while (cur && cur !== document.body) {
          if (cur.textContent && cur.textContent.includes('₽')) {
            const linksInside = cur.querySelectorAll('a[href*="_"]');
            const idsInside = new Set(
              Array.from(linksInside)
                .map(l => extractIdFromUrl(l.getAttribute('href')))
                .filter(Boolean)
            );
            if (idsInside.size === 1) {
              cardContainer = cur;
            } else if (idsInside.size > 1) {
              break;
            }
          }
          cur = cur.parentElement;
        }

        if (cardContainer && !cards.includes(cardContainer)) {
          cards.push(cardContainer);
        }
      }
      if (cards.length > 0) {
        return cards.map(parseDOMCard);
      }
    }

    // 3. Fallback
    const fallbackCards = document.querySelectorAll('[itemtype*="Product"]');
    if (fallbackCards.length > 0) {
      return Array.from(fallbackCards).map(parseDOMCard);
    }

    return null;
  }

  function enrichNextDataWithDOM(nextDataItems, domItems) {
    if (!nextDataItems || !domItems) return;

    for (let i = 0; i < nextDataItems.length; i++) {
      const item = nextDataItems[i];
      item.price = cleanPrice(item.price);
      if (item.priceNum == null) {
        item.priceNum = extractNumericPrice(item.price);
      }

      let domMatch = null;
      if (item.url) {
        const cleanItemUrl = cleanUrl(item.url);
        domMatch = domItems.find(d => cleanUrl(d.url) === cleanItemUrl);
      }
      if (!domMatch && item.title) {
        domMatch = domItems.find(d => d.title === item.title);
      }
      if (!domMatch && i < domItems.length) {
        domMatch = domItems[i];
      }

      if (domMatch) {
        if (!item.hasDelivery && domMatch.hasDelivery) item.hasDelivery = true;
        if (!item.deliveryText && domMatch.deliveryText) item.deliveryText = domMatch.deliveryText;
        if (!item.isReserved && domMatch.isReserved) item.isReserved = true;
        if (!item.isPromoted && domMatch.isPromoted) item.isPromoted = true;
        if (item.priceNum == null && domMatch.priceNum != null) item.priceNum = domMatch.priceNum;
        if (!item.oldPrice && domMatch.oldPrice) item.oldPrice = domMatch.oldPrice;
        if (item.oldPriceNum == null && domMatch.oldPriceNum != null) item.oldPriceNum = domMatch.oldPriceNum;
        if (!item.discount && domMatch.discount) item.discount = domMatch.discount;
        if (!item.description && domMatch.description) item.description = domMatch.description;
        if ((!item.price || item.price === 'Цена не указана') && domMatch.price) item.price = domMatch.price;
        if (!item.location && domMatch.location) item.location = domMatch.location;
        if (!item.date && domMatch.date) item.date = domMatch.date;
        if (!item.seller && domMatch.seller) item.seller = domMatch.seller;
        if (!item.sellerRating && domMatch.sellerRating) item.sellerRating = domMatch.sellerRating;
        if (!item.sellerReviews && domMatch.sellerReviews) item.sellerReviews = domMatch.sellerReviews;
        if (!item.id && domMatch.id) item.id = domMatch.id;
      }
    }
  }

  function parse() {
    const nextDataItems = parseFromNextData();
    const domItems = parseFromDOM();

    let resultItems = [];
    let source = 'none';

    if (nextDataItems && nextDataItems.length > 0) {
      if (domItems && domItems.length > 0) {
        enrichNextDataWithDOM(nextDataItems, domItems);
      } else {
        nextDataItems.forEach(it => { it.price = cleanPrice(it.price); });
      }
      resultItems = nextDataItems;
      source = '__NEXT_DATA__';
    } else if (domItems && domItems.length > 0) {
      resultItems = domItems;
      source = 'DOM';
    }

    resultItems.forEach((item, idx) => {
      if (item.itemNum == null) {
        item.itemNum = idx + 1;
      }
    });

    return { items: resultItems, source };
  }

  // Formatters

  function getSearchQuery() {
    const params = new URLSearchParams(window.location.search);
    return params.get('q') || document.title.replace(/ - .*/g, '').trim() || 'Авито';
  }

  function buildAiPrompt(query, count, opts) {
    const fields = [];
    if (opts.title) fields.push('название');
    if (opts.price) fields.push('цена (число)');
    if (opts.delivery) fields.push('доставка');
    if (opts.description) fields.push('описание');
    if (opts.location) fields.push('локация');
    if (opts.seller) fields.push('продавец');

    const fieldsStr = fields.length > 0 ? `В каждом объявлении указаны: ${fields.join(', ')}.\n` : '';

    return (
      `Ниже список объявлений с Авито по запросу "${query}" (${count} шт.).\n` +
      `Каждому объявлению присвоен постоянный номер лота (например: Лот 12 или ### 12).\n` +
      fieldsStr + '\n' +
      `Твоя задача:\n` +
      `1. Сравни варианты и выбери лучший по соотношению цены и состояния.\n` +
      `2. Внимательно изучи описания: выдели дефекты, комплектность, апгрейды и подводные камни.\n` +
      `3. Дай итоговую рекомендацию: какой вариант покупать выгоднее всего и почему. При ответе обязательно указывай точный номер лота (например: Лот 2)!\n\n` +
      `---\n\n`
    );
  }

  function toMarkdown(items, fields = {}) {
    const opts = { ...DEFAULT_FIELDS, ...fields };
    const query = getSearchQuery();

    let md = '';
    if (opts.aiPrompt) {
      md += buildAiPrompt(query, items.length, opts);
    } else {
      md += `Список объявлений с Авито по запросу "${query}" (${items.length} шт.):\n\n`;
    }

    items.forEach((item, i) => {
      const num = item.itemNum != null ? item.itemNum : (i + 1);
      const title = opts.title ? (item.title || 'Без названия') : '';
      const displayPrice = item.priceNum != null ? `${item.priceNum} ₽` : (item.price || 'Цена не указана');
      let priceStr = displayPrice;
      if (item.oldPrice) {
        priceStr += ` (было ~~${item.oldPrice}~~${item.discount ? `, скидка ${item.discount}` : ''})`;
      }
      const price = opts.price ? priceStr : '';

      if (title && price) {
        md += `### ${num}. ${title} : ${price}\n`;
      } else if (title) {
        md += `### ${num}. ${title}\n`;
      } else if (price) {
        md += `### ${num}. Цена: ${price}\n`;
      } else {
        md += `### ${num}.\n`;
      }

      if (item.isPromoted) {
        md += `**Продвижение:** да\n`;
      }
      if (opts.delivery) {
        md += `**Доставка:** ${item.hasDelivery ? (item.deliveryText || 'есть') : 'нет'}\n`;
      }
      if (opts.description && item.description) {
        md += `**Описание:** ${item.description}\n`;
      }
      if (opts.location && item.location) {
        md += `**Локация:** ${item.location}\n`;
      }
      if (opts.date && item.date) {
        md += `**Дата:** ${item.date}\n`;
      }
      if (opts.seller && item.seller) {
        const ratingPart = item.sellerRating ? ` (★ ${item.sellerRating}${item.sellerReviews ? ', ' + item.sellerReviews : ''})` : '';
        md += `**Продавец:** ${item.seller}${ratingPart}\n`;
      }
      if (opts.url && item.url) {
        md += `**Ссылка:** ${cleanUrl(item.url)}\n`;
      }
      if (opts.image && item.image) {
        md += `**Фото:** ${item.image}\n`;
      }

      md += '\n---\n\n';
    });

    return md;
  }

  function toJSON(items, fields = {}) {
    const opts = { ...DEFAULT_FIELDS, ...fields };

    const filteredItems = items.map((item, i) => {
      const obj = {};
      obj.lot = item.itemNum != null ? item.itemNum : (i + 1);
      if (item.id) obj.id = item.id;
      if (opts.title) obj.title = item.title;
      if (opts.price) {
        obj.price = item.priceNum != null ? item.priceNum : item.price;
        if (item.oldPrice) obj.oldPrice = item.oldPriceNum || item.oldPrice;
        if (item.discount) obj.discount = item.discount;
      }
      if (opts.delivery) {
        obj.hasDelivery = !!item.hasDelivery;
        if (item.deliveryText) obj.deliveryText = item.deliveryText;
      }
      if (item.isReserved) obj.isReserved = true;
      if (item.isPromoted) obj.isPromoted = true;
      if (opts.description) obj.description = item.description;
      if (opts.location) obj.location = item.location;
      if (opts.date) obj.date = item.date;
      if (opts.seller) {
        obj.seller = item.seller;
        if (item.sellerRating) obj.sellerRating = item.sellerRating;
        if (item.sellerReviews) obj.sellerReviews = item.sellerReviews;
      }
      if (opts.url) obj.url = cleanUrl(item.url);
      if (opts.image) obj.image = item.image;
      return obj;
    });

    return JSON.stringify({
      query: getSearchQuery(),
      count: items.length,
      parsedAt: new Date().toISOString(),
      items: filteredItems,
    }, null, 2);
  }

  function sanitizeTsvCell(val) {
    if (val == null) return '';
    return String(val).replace(/[\r\n\t]+/g, ' ').trim();
  }

  function toTSV(items, fields = {}) {
    const opts = { ...DEFAULT_FIELDS, ...fields };
    const query = getSearchQuery();

    let prefix = '';
    if (opts.aiPrompt) {
      prefix = buildAiPrompt(query, items.length, opts);
    } else {
      prefix = `Список объявлений с Авито по запросу "${query}" (${items.length} шт.):\n\n`;
    }

    const columns = [
      { key: '#', label: 'Лот №', get: (item, i) => `Лот ${item.itemNum != null ? item.itemNum : (i + 1)}` },
      opts.title && { key: 'title', label: 'Название', get: (item) => item.title },
      opts.price && { key: 'price', label: 'Цена', get: (item) => (item.priceNum != null ? item.priceNum : item.price) },
      opts.delivery && { key: 'delivery', label: 'Доставка', get: (item) => (item.hasDelivery ? (item.deliveryText || 'да') : 'нет') },
      opts.description && { key: 'description', label: 'Описание', get: (item) => item.description },
      opts.location && { key: 'location', label: 'Локация', get: (item) => item.location },
      opts.date && { key: 'date', label: 'Дата', get: (item) => item.date },
      opts.seller && { key: 'seller', label: 'Продавец', get: (item) => `${item.seller}${item.sellerRating ? ' (★ ' + item.sellerRating + ')' : ''}` },
      opts.url && { key: 'url', label: 'Ссылка', get: (item) => cleanUrl(item.url) },
      opts.image && { key: 'image', label: 'Фото', get: (item) => item.image },
    ].filter(Boolean);

    const headers = columns.map(c => c.label);

    const rows = items.map((item, i) =>
      columns.map(col => sanitizeTsvCell(col.get(item, i))).join('\t')
    );

    return prefix + [headers.join('\t'), ...rows].join('\n');
  }

  function toCSV(items, fields = {}) {
    return toTSV(items, fields);
  }

  return {
    parse,
    parseDOMCard,
    toMarkdown,
    toJSON,
    toTSV,
    toCSV,
    getSearchQuery,
    cleanUrl,
    cleanPrice,
    cleanText,
    cleanTitle,
    cleanSeller,
    extractIdFromUrl,
    extractNumericPrice,
    extractDOMPrice,
    extractDOMPriceInfo,
    extractDOMDescription,
    extractDOMSeller,
    extractDOMSellerInfo,
    extractDOMDelivery,
    extractDOMDeliveryInfo,
    extractNextDataDelivery,
    extractDOMReserved,
    extractNextDataReserved,
    DEFAULT_FIELDS,
  };
})();

if (typeof window !== 'undefined') {
  window.AvitoParser = AvitoParser;
}
