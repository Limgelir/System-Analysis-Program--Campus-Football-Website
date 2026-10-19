// SQL TIME is a local wall-clock value, never a JavaScript Date or UTC timestamp.
const MINUTE_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
function readMatchTime(value) {
  if (value === null || value === undefined) return null;
  const time = String(value);
  return /^(?:[01]\d|2[0-3]):[0-5]\d(?::00)?$/.test(time) ? time.slice(0, 5) : null;
}
function parseMatchTime(value, endTime) {
  if (typeof value !== 'string') return null;
  const parts = value.split('-');
  if (parts.length > 2 || parts.some(part => !MINUTE_TIME.test(part))) return null;
  const end = parts[1] ?? (endTime === '' || endTime == null ? null : endTime);
  if (parts[1] && endTime != null && endTime !== '' && endTime !== parts[1]) return null;
  if (end !== null && (typeof end !== 'string' || !MINUTE_TIME.test(end) || end <= parts[0])) return null;
  return { match_time: parts[0], match_end_time: end };
}
function displayMatchTime(start, end) {
  const time = readMatchTime(start), finish = readMatchTime(end);
  return time ? time + (finish ? '-' + finish : '') : '时间待定';
}
module.exports = { MINUTE_TIME, readMatchTime, parseMatchTime, displayMatchTime };
