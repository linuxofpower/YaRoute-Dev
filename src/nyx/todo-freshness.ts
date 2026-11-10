/**
 * A tagged Day[0] is a live planning claim, not a historical snapshot.
 * Only the owner may reconcile unfinished tasks; initialization must not
 * infer a completion or silently roll over the source.
 */
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'];

export function staleTodayLabel(text: string, now: Date = new Date(), timeZone = 'Europe/Warsaw'):
  { stale: boolean; observed?: string; expected: string } {
  const dateParts = new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: 'long', day: 'numeric',
  }).formatToParts(now);
  const parts = Object.fromEntries(dateParts.map(part => [part.type, part.value]));
  const day = Number(parts.day);
  const month = MONTHS.indexOf(parts.month.toLowerCase()) + 1;
  const year = Number(parts.year);
  const expected = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const heading = text.split(/\r?\n/).find(line => /^#{1,6}\s+Day\s*\[\s*0\s*\]/i.test(line));
  if (!heading) return { stale: false, expected };

  const match = heading.match(/\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)(?:\s*,?\s*(\d{4}))?\b/i);
  if (!match) return { stale: false, expected };
  const observedDay = Number(match[1]);
  const observedMonth = MONTHS.indexOf(match[2].toLowerCase()) + 1;
  const observedYear = match[3] ? Number(match[3]) : year;
  const observed = `${observedYear}-${String(observedMonth).padStart(2, '0')}-${String(observedDay).padStart(2, '0')}`;
  return { stale: observedDay !== day || observedMonth !== month || observedYear !== year, observed, expected };
}
