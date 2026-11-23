/**
 * 日本の祝日判定ユーティリティ（振替休日・国民の休日対応）
 * 2020年〜2099年に対応
 */

const holidayCache = new Map();

function formatDate(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function getNthMonday(year, month, nth) {
  const firstDay = new Date(year, month - 1, 1).getDay(); // 0=Sun, 1=Mon
  const offset = (1 - firstDay + 7) % 7;
  return 1 + offset + (nth - 1) * 7;
}

// 春分の日（2000〜2099年）
function getVernalEquinoxDay(year) {
  return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

// 秋分の日（2000〜2099年）
function getAutumnalEquinoxDay(year) {
  return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

function buildYearHolidays(year) {
  if (holidayCache.has(year)) {
    return holidayCache.get(year);
  }

  const map = new Map();
  const add = (m, d, name) => map.set(formatDate(year, m, d), name);

  // 固定祝日
  add(1, 1, '元日');
  add(2, 11, '建国記念の日');
  add(2, 23, '天皇誕生日');
  add(4, 29, '昭和の日');
  add(5, 3, '憲法記念日');
  add(5, 4, 'みどりの日');
  add(5, 5, 'こどもの日');
  add(8, 11, '山の日');
  add(11, 3, '文化の日');
  add(11, 23, '勤労感謝の日');

  // ハッピーマンデー
  add(1, getNthMonday(year, 1, 2), '成人の日');
  add(7, getNthMonday(year, 7, 3), '海の日');
  add(9, getNthMonday(year, 9, 3), '敬老の日');
  add(10, getNthMonday(year, 10, 2), 'スポーツの日');

  // 春分の日・秋分の日
  add(3, getVernalEquinoxDay(year), '春分の日');
  add(9, getAutumnalEquinoxDay(year), '秋分の日');

  // 振替休日（祝日が日曜の場合、翌日以降の最初の平日）
  const baseDates = Array.from(map.keys()).sort();
  for (const dateStr of baseDates) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    if (dt.getDay() === 0) {
      const next = new Date(y, m - 1, d + 1);
      while (map.has(formatDate(next.getFullYear(), next.getMonth() + 1, next.getDate()))) {
        next.setDate(next.getDate() + 1);
      }
      map.set(
        formatDate(next.getFullYear(), next.getMonth() + 1, next.getDate()),
        '振替休日'
      );
    }
  }

  // 国民の休日（前後が祝日に挟まれた平日）
  for (let m = 1; m <= 12; m++) {
    const daysInMonth = new Date(year, m, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
      const cur = formatDate(year, m, d);
      if (map.has(cur)) continue;
      const dt = new Date(year, m - 1, d);
      if (dt.getDay() === 0) continue; // 日曜は除く
      const prev = new Date(year, m - 1, d - 1);
      const next = new Date(year, m - 1, d + 1);
      const prevStr = formatDate(prev.getFullYear(), prev.getMonth() + 1, prev.getDate());
      const nextStr = formatDate(next.getFullYear(), next.getMonth() + 1, next.getDate());
      if (map.has(prevStr) && map.has(nextStr)) {
        map.set(cur, '国民の休日');
      }
    }
  }

  holidayCache.set(year, map);
  return map;
}

/**
 * 指定日（YYYY-MM-DD）の祝日名を返す（祝日でなければ null）
 */
export function getHolidayName(dateStr) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const year = Number(dateStr.slice(0, 4));
  return buildYearHolidays(year).get(dateStr) || null;
}

/**
 * 指定日（YYYY-MM-DD）が祝日かどうか
 */
export function isJapaneseHoliday(dateStr) {
  return getHolidayName(dateStr) !== null;
}

/**
 * 指定日（YYYY-MM-DD）が土日祝日かどうか
 */
export function isWeekendOrHoliday(dateStr) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  return dow === 0 || dow === 6 || isJapaneseHoliday(dateStr);
}
