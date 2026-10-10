function invalid(message) { return Object.assign(new Error(message),{statusCode:400,isBusinessError:true}); }
function text(value,label,max=100) {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.length > max) throw invalid(`${label}格式不正确`);
  return value.trim();
}
function integer(value,fallback,max,label) {
  if (value === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(String(value)) || typeof value === 'object' || !Number.isSafeInteger(Number(value)) || Number(value)>max) throw invalid(`${label}必须是 1 到 ${max} 的整数`);
  return Number(value);
}
function pagination(q={}) { return {page:integer(q.page,1,100000,'页码'),pageSize:integer(q.page_size,20,100,'每页数量')}; }
function pageMeta(page,pageSize,total) { return {page,page_size:pageSize,total,total_pages:Math.ceil(total/pageSize)}; }
function choice(value,values,label) { const v=text(value,label); if(v&&!values.includes(v))throw invalid(`${label}不合法`); return v; }
function date(value,label) { const v=text(value,label,10); if(v&&(!/^\d{4}-\d{2}-\d{2}$/.test(v)||Number.isNaN(new Date(`${v}T00:00:00Z`).getTime())||new Date(`${v}T00:00:00Z`).toISOString().slice(0,10)!==v))throw invalid(`${label}不合法`);return v; }
function like(value) { return `%${value.replace(/[!%_]/g,'!$&')}%`; }
function csvCell(value) {
  let v=Array.isArray(value)?value.join('、'):String(value??'');
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(v)||/^[\t\r\n]/.test(v))v=`'${v}`;
  return `"${v.replace(/"/g,'""')}"`;
}
function sendCsv(res,headers,rows) {
  res.set('Cache-Control','no-store');
  res.set('Content-Disposition','attachment; filename="refweb-export.csv"');
  res.type('text/csv; charset=utf-8').send('\uFEFF'+[headers,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n'));
}
function guardExport(total) { if(total>5000)throw invalid('导出超过 5000 条，请缩小筛选范围后重试'); }
module.exports={invalid,text,integer,pagination,pageMeta,choice,date,like,csvCell,sendCsv,guardExport};
