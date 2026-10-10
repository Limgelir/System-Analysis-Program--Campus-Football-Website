import { reactive } from 'vue'
import axios from 'axios'
export const session = reactive({ player: null, token: localStorage.getItem('playerToken') || '' })
export function clearSession() { session.player = null; session.token = ''; localStorage.removeItem('playerToken'); window.dispatchEvent(new Event('appearance-session-changed')) }
export function setSession(account) { const { token, ...player } = account; session.token = token; session.player = player; localStorage.setItem('playerToken', token) }
export const api = axios.create({ baseURL: `${(import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '')}/api/player`, timeout: 30000 })
api.interceptors.request.use(config => { if (session.token) config.headers.Authorization = `Bearer ${session.token}`; return config })
api.interceptors.response.use(response => response.config.responseType === 'blob' ? response.data : response.data.data, async error => {
  if (error.response?.data instanceof Blob && error.response.data.type.includes('json')) {
    try { error.response.data = JSON.parse(await error.response.data.text()) } catch { /* 保留通用错误提示 */ }
  }
  const isLogin = error.config?.url === '/login'
  if (error.response?.status === 401 && !isLogin) {
    clearSession()
    if (window.location.pathname !== '/login') window.location.assign('/login?notice=expired')
  }
  if (error.response?.data?.code === 'PLAYER_PASSWORD_CHANGE_REQUIRED') window.location.assign('/account')
  return Promise.reject(error)
})
export const messageOf = error => error.response?.data?.message || '连接失败，请检查网络后重试'
export const version = () => ({ headers: { 'If-Match': String(session.player.revision) } })
