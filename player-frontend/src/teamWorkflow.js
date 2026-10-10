export const teamStatuses = { draft: '草稿', pending: '待审核', returned: '已退回', withdrawn: '已撤回', approved: '已通过', revoked: '已撤销通过', auto_failed: '自动审核失败' }
export const qualifications = { approved: '学籍已通过', revoked: '资格已撤销', returned: '学籍已退回', pending: '学籍待审核', withdrawn: '学籍已撤回' }
export const teamOperations = { created: '创建草稿', saved: '保存草稿', submitted: '提交审核', withdrawn: '撤回申请', returned: '管理员退回', approved: '审核通过', revoked: '管理员撤销通过', auto_failed: '自动审核失败', identity_linked: '关联导入身份' }
export const time = value => value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '未设置'
export function requestKey() { const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128; const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join(''); return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}` }
