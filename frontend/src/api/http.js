import axios from 'axios'
import {
  ADMIN_ROLE,
  REFEREE_ROLE,
  getAuthState,
  clearAdminAuth,
  clearRefereeAuth,
  clearAuth
} from '../utils/auth'

const configuredBackendUrl = String(import.meta.env.VITE_API_BASE_URL || '').trim()
export const BACKEND_BASE_URL = (configuredBackendUrl || window.location.origin).replace(/\/+$/, '')
export const API_BASE_URL = `${BACKEND_BASE_URL}/api`

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json'
  }
})

function isAdminPath(pathname = '') {
  return pathname.startsWith('/admin')
}

function isRefereePath(pathname = '') {
  return pathname.startsWith('/referee')
}

function getTokenForCurrentPage() {
  const pathname = window.location.pathname || ''
  const { adminToken, refereeToken } = getAuthState()

  if (isAdminPath(pathname)) {
    return adminToken
      ? { token: adminToken, role: ADMIN_ROLE }
      : { token: null, role: null }
  }

  if (isRefereePath(pathname)) {
    if (refereeToken) {
      return { token: refereeToken, role: REFEREE_ROLE }
    }

    if (adminToken) {
      return { token: adminToken, role: ADMIN_ROLE }
    }

    return { token: null, role: null }
  }

  if (refereeToken) {
    return { token: refereeToken, role: REFEREE_ROLE }
  }

  if (adminToken) {
    return { token: adminToken, role: ADMIN_ROLE }
  }

  return { token: null, role: null }
}

function handleUnauthorizedByRole(role) {
  if (role === ADMIN_ROLE) {
    clearAdminAuth()
    window.location.href = '/admin-login'
    return
  }

  if (role === REFEREE_ROLE) {
    clearRefereeAuth()
    window.location.href = '/referee-login'
    return
  }

  clearAuth()
  window.location.href = '/'
}

api.interceptors.request.use(
  config => {
    const { token, role } = getTokenForCurrentPage()

    if (token) {
      config.headers = config.headers || {}
      config.headers.Authorization = `Bearer ${token}`
      config._authRole = role
    }

    return config
  },
  error => Promise.reject(error)
)

api.interceptors.response.use(
  response => response.data,
  error => {
    if (error.response?.status === 401 && !/\/(admin|referee)\/login$/.test(error.config?.url || '')) {
      const role = error.config?._authRole || null
      handleUnauthorizedByRole(role)
    }

    return Promise.reject(error)
  }
)

export default api
