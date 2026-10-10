// SQL TIME is a local wall-clock value, never a JavaScript Date or UTC timestamp.
const MINUTE_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
function readMatchTime(value) {
  if (value === null || value === undefined) return null;
  const time = String(value);
  return /^(?:[01]\d|2[0-3]):[0-5]\d(?::00)?$/.test(time) ? time.slice(0, 5) : null;
}
module.exports = { MINUTE_TIME, readMatchTime };
