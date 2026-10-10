// DATE字段是校内比赛的业务日期；不得依赖Node进程或操作系统本地时区。
const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
});
function businessDate(instant = new Date()) {
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) throw new Error('无效时间');
  const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function nextEffectiveDate(instant = new Date()) {
  const date = new Date(`${businessDate(instant)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
module.exports = { businessDate, nextEffectiveDate };
