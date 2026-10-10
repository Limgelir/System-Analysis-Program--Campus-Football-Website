export function downloadBlob(blob, filename) {
  const url=URL.createObjectURL(blob instanceof Blob?blob:new Blob([blob]));
  const a=document.createElement('a');a.href=url;a.download=filename;
  document.body.appendChild(a);a.click();a.remove();
  window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export async function exportError(error) {
  if(error?.response?.data instanceof Blob) {
    try { return JSON.parse(await error.response.data.text()).message || '导出失败'; } catch {}
  }
  return error?.response?.data?.message || error.message || '导出失败';
}
