export function localDate(year: number, month: number, day: number, hour = 9, minute = 0, second = 0): Date {
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(hour, minute, second, 0);
  return date;
}
export function futureLimit(now: Date): Date {
  const end = localDate(now.getFullYear() + 11, now.getMonth() + 1, now.getDate(), 23, 59, 59);
  if (end.getMonth() !== now.getMonth()) end.setDate(0);
  end.setMilliseconds(999);
  return end;
}
export function normalizeUserDate(input: string, now = new Date()): string {
  const today = localDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
  const fallback = today.toISOString();
  const match = /^(?:(\d{4})-)?(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(input.trim());
  const monthOnly = /^(\d{4})-(\d{1,2})$/.exec(input.trim());
  if (!match && !monthOnly) return fallback;
  const missingYear = Boolean(match && !match[1]);
  const year = monthOnly ? Number(monthOnly[1]) : match![1] ? Number(match![1]) : now.getFullYear();
  const month = Number(monthOnly ? monthOnly[2] : match![2]);
  const day = monthOnly ? 1 : Number(match![3]);
  const hour = match?.[4] === undefined ? 9 : Number(match[4]);
  const minute = Number(match?.[5] ?? 0), second = Number(match?.[6] ?? 0);
  if (year < 100 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 99 || hour > 23 || minute > 59 || second > 59) return fallback;
  const make = (year: number) => {
    const daysInMonth = localDate(year, month + 1, 0).getDate();
    return day > daysInMonth ? localDate(year, month + 1, 1, hour, minute, second) : localDate(year, month, day, hour, minute, second);
  };
  let result = make(year);
  if (missingYear && localDate(result.getFullYear(), result.getMonth() + 1, result.getDate(), 0).getTime() <= localDate(now.getFullYear(), now.getMonth() + 1, now.getDate(), 0).getTime()) result = make(year + 1);
  return !Number.isFinite(result.getTime()) || result > futureLimit(now) ? fallback : result.toISOString();
}
export function calendarDistance(from: string, to: string): number {
  const serial = (key: string) => { const [y,m,d] = key.split('-').map(Number); const date = new Date(0); date.setUTCFullYear(y,m-1,d); date.setUTCHours(0,0,0,0); return date.getTime() / 86400000; };
  return serial(to) - serial(from);
}
