import { getHolidayName, isWeekendOrHoliday } from './holidays.js';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const BASE_ORIGIN = 'https://yoyaku.labola.jp';

/**
 * 施設URLまたは施設IDから shopId を抽出
 */
export function extractShopId(shopUrlOrId) {
  if (!shopUrlOrId) {
    throw new Error('施設URLまたは施設IDを指定してください');
  }
  const str = String(shopUrlOrId).trim();
  if (/^\d+$/.test(str)) {
    return str;
  }
  const match = str.match(/\/r\/shop\/(\d+)/);
  if (match) {
    return match[1];
  }
  throw new Error(`LaBOLAの施設URLからショップIDを読み取れませんでした: ${str}`);
}

function decodeHtmlEntities(str) {
  return String(str ?? '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(Number(num)));
}

function stripTags(html) {
  return decodeHtmlEntities(String(html ?? '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * LaBOLA イベント一覧HTMLをパース（外部ライブラリ不要）
 */
export function parseEventsHtml(html, shopId) {
  // 施設名
  const shopTitleMatch = html.match(/<div[^>]+id=["']shop_title["'][^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i);
  const shopName = shopTitleMatch ? stripTags(shopTitleMatch[1]) : `Shop ${shopId}`;

  // <ul id="event_list"> ... </ul> を抽出
  const ulMatch = html.match(/<ul[^>]+id=["']event_list["'][^>]*>([\s\S]*?)<\/ul>/i);
  const listHtml = ulMatch ? ulMatch[1] : '';

  const events = [];
  const liRegex = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
  let liMatch;

  while ((liMatch = liRegex.exec(listHtml)) !== null) {
    const li = liMatch[1];

    const hrefMatch = li.match(/<a[^>]+href=["']([^"']+)["']/i);
    const href = hrefMatch ? hrefMatch[1] : '';
    const idMatch = href.match(/\/event\/show\/(\d+)/);
    const id = idMatch ? idMatch[1] : href;
    const url = href.startsWith('http') ? href : `${BASE_ORIGIN}${href}`;

    const dateDivMatch = li.match(/<div[^>]+class=["'][^"']*\bdate\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    const dateRaw = dateDivMatch ? stripTags(dateDivMatch[1]) : '';

    const h2Match = li.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
    const title = h2Match ? stripTags(h2Match[1]) : '';

    const levelMatch = li.match(/<div[^>]+class=["'][^"']*\blevel\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    const level = levelMatch ? stripTags(levelMatch[1]).replace(/^Event\s*｜?\s*/, '').trim() : '';

    const priceMatch = li.match(/<div[^>]+class=["'][^"']*\bprice\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    const price = priceMatch ? stripTags(priceMatch[1]).replace(/^Event\s*/, '').trim() : '';

    const h3Match = li.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
    const status = h3Match ? stripTags(h3Match[1]) : '';

    const capDivMatch = li.match(/<div[^>]+class=["'][^"']*\bcapacity\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    const capacityText = capDivMatch ? stripTags(capDivMatch[1]) : '';

    const subDivMatch = li.match(/<div[^>]+class=["'][^"']*\bsub\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    const subText = subDivMatch ? stripTags(subDivMatch[1]) : '';

    // 日時パース: "2026/11/28（土）06:00〜08:00 ｜ フットサル個人参加"
    const dtMatch = dateRaw.match(
      /(\d{4})\/(\d{1,2})\/(\d{1,2})[（(](.)[）)]\s*(\d{1,2}:\d{2})[〜～\-](\d{1,2}:\d{2})/
    );

    let date = null;
    let dayOfWeek = '';
    let dayIndex = -1;
    let startTime = '';
    let endTime = '';

    if (dtMatch) {
      const year = dtMatch[1];
      const month = dtMatch[2].padStart(2, '0');
      const day = dtMatch[3].padStart(2, '0');
      date = `${year}-${month}-${day}`;
      dayOfWeek = dtMatch[4];
      dayIndex = new Date(Number(year), Number(month) - 1, Number(day)).getDay();
      startTime = dtMatch[5].padStart(5, '0');
      endTime = dtMatch[6].padStart(5, '0');
    }

    const catParts = dateRaw.split(/[｜|]/);
    const category = catParts.length > 1 ? catParts[1].trim() : '';

    // 募集数パース: "募集数 12／35" -> booked=12, capacity=35
    let booked = null;
    let capacity = null;
    let remaining = null;
    const capMatch = capacityText.match(/(\d+)\s*[／/]\s*(\d+)/);
    if (capMatch) {
      booked = Number(capMatch[1]);
      capacity = Number(capMatch[2]);
      remaining = Math.max(0, capacity - booked);
    } else if (/満員|キャンセル待ち/.test(status)) {
      remaining = 0;
    }

    const holidayName = date ? getHolidayName(date) : null;
    const weekendOrHoliday = date ? isWeekendOrHoliday(date) : false;

    if (href || title) {
      events.push({
        id: `${shopId}_${id}`,
        eventId: id,
        shopId: String(shopId),
        shopName,
        url,
        title,
        date,
        dayOfWeek,
        dayIndex,
        holidayName,
        isHoliday: holidayName !== null,
        isWeekendOrHoliday: weekendOrHoliday,
        startTime,
        endTime,
        category,
        level,
        price,
        status,
        booked,
        capacity,
        remaining,
        capacityText,
        subText,
        fetchedAt: new Date().toISOString(),
      });
    }
  }

  // ページネーションに「次へ」リンクがあるか確認
  const paginationMatch = html.match(/<div[^>]+class=["'][^"']*\bpagination\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  const hasNextPage = paginationMatch
    ? /<a\b[^>]*>[\s\S]*?次へ[\s\S]*?<\/a>/i.test(paginationMatch[1])
    : false;

  return { shopName, events, hasNextPage };
}

/**
 * 指定施設のイベント一覧をLaBOLAから取得
 */
export async function fetchShopEvents(shopUrlOrId, options = {}) {
  const shopId = extractShopId(shopUrlOrId);
  const { kind = 'individual', maxPages = 3 } = options;

  const pathSuffix = kind === 'all' ? 'event/' : `event/${kind}/`;
  const allEvents = [];
  let shopName = `Shop ${shopId}`;

  for (let page = 1; page <= maxPages; page++) {
    const url =
      page === 1
        ? `${BASE_ORIGIN}/r/shop/${shopId}/${pathSuffix}`
        : `${BASE_ORIGIN}/r/shop/${shopId}/${pathSuffix}?page=${page}`;

    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    if (!res.ok) {
      throw new Error(`LaBOLA取得エラー (HTTP ${res.status}): ${url}`);
    }

    const html = await res.text();
    const parsed = parseEventsHtml(html, shopId);
    shopName = parsed.shopName;
    allEvents.push(...parsed.events);

    if (!parsed.hasNextPage) {
      break;
    }

    await new Promise((r) => setTimeout(r, 400));
  }

  return { shopId, shopName, events: allEvents };
}

function timeToMinutes(hhmm) {
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return null;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * JST（日本時間）の今日の日付 YYYY-MM-DD を取得
 */
export function getTodayJst() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

/**
 * ルール条件に一致するイベントを抽出
 */
export function filterEventsByRule(events, rule) {
  const todayStr = getTodayJst();
  const todayMs = new Date(`${todayStr}T00:00:00Z`).getTime();
  const lookaheadDays = Number(rule.lookaheadDays ?? 14);
  const maxDateMs = todayMs + lookaheadDays * 24 * 60 * 60 * 1000;

  const fromMin = timeToMinutes(rule.startTimeFrom);
  const toMin = timeToMinutes(rule.startTimeTo);
  const keyword = (rule.keyword || '').trim().toLowerCase();

  return events.filter((ev) => {
    if (!ev.date) return false;

    const evMs = new Date(`${ev.date}T00:00:00Z`).getTime();
    if (evMs < todayMs || evMs > maxDateMs) return false;

    const dayFilter = rule.dayFilter || 'all';
    if (dayFilter === 'weekend_holiday') {
      if (!ev.isWeekendOrHoliday) return false;
    } else if (dayFilter === 'weekday') {
      if (ev.isWeekendOrHoliday) return false;
    } else if (dayFilter === 'custom') {
      const days = Array.isArray(rule.customDays) ? rule.customDays : [];
      const includeHolidays = Boolean(rule.includeHolidays);
      const matchDay = days.includes(ev.dayIndex);
      const matchHoliday = includeHolidays && ev.isHoliday;
      if (!matchDay && !matchHoliday) return false;
    }

    const evMin = timeToMinutes(ev.startTime);
    if (evMin !== null) {
      if (fromMin !== null && evMin < fromMin) return false;
      if (toMin !== null && evMin > toMin) return false;
    }

    if (keyword) {
      const haystack = `${ev.title} ${ev.level} ${ev.category}`.toLowerCase();
      if (!haystack.includes(keyword)) return false;
    }

    return true;
  });
}
