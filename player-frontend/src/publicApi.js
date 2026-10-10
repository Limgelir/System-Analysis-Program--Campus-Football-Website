import axios from 'axios'
export const publicApi = axios.create({ baseURL: `${(import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '')}/api/public`, timeout: 30000 })
publicApi.interceptors.response.use(r => r.data.data)
