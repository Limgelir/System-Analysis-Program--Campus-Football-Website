export const ADMIN_ROLE = 'admin'
export const REFEREE_ROLE = 'referee'

export function getAdminToken() {
  return localStorage.getItem('adminToken')
}

export function getRefereeToken() {
  return localStorage.getItem('refereeToken')
}

export function clearAdminAuth() {
  localStorage.removeItem('adminToken')
  localStorage.removeItem('adminInfo')
  window.dispatchEvent(new Event('appearance-session-changed'))
}

export function clearRefereeAuth() {
  localStorage.removeItem('refereeToken')
  localStorage.removeItem('refereeInfo')
  window.dispatchEvent(new Event('appearance-session-changed'))
}

export function clearAuth() {
  clearAdminAuth()
  clearRefereeAuth()
}

function decodeBase64Url(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
  const binary = window.atob(padded)
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))

  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder().decode(bytes)
  }

  return binary
}

export function parseJwt(token) {
  try {
    if (!token || typeof token !== 'string') return null

    const parts = token.split('.')
    if (parts.length !== 3) return null

    const payloadText = decodeBase64Url(parts[1])
    return JSON.parse(payloadText)
  } catch {
    return null
  }
}

export function isTokenExpired(token, skewSeconds = 10) {
  const payload = parseJwt(token)
  if (!payload || typeof payload.exp !== 'number') {
    return true
  }

  const now = Math.floor(Date.now() / 1000)
  return payload.exp <= now + skewSeconds
}

export function isValidRoleToken(token, expectedRole) {
  const payload = parseJwt(token)
  if (!payload) return false
  if (payload.role !== expectedRole) return false
  if (isTokenExpired(token)) return false
  return true
}

export function getValidTokenByRole(role) {
  const token = role === ADMIN_ROLE ? getAdminToken() : getRefereeToken()
  return isValidRoleToken(token, role) ? token : null
}

export function purgeInvalidAuthTokens() {
  const adminToken = getAdminToken()
  const refereeToken = getRefereeToken()

  if (adminToken && !isValidRoleToken(adminToken, ADMIN_ROLE)) {
    clearAdminAuth()
  }

  if (refereeToken && !isValidRoleToken(refereeToken, REFEREE_ROLE)) {
    clearRefereeAuth()
  }
}

export function getAuthState() {
  purgeInvalidAuthTokens()

  const adminToken = getValidTokenByRole(ADMIN_ROLE)
  const refereeToken = getValidTokenByRole(REFEREE_ROLE)
  const adminPayload = adminToken ? parseJwt(adminToken) : null

  return {
    adminToken,
    adminPayload,
    refereeToken,
    hasAdmin: Boolean(adminToken),
    hasReferee: Boolean(refereeToken)
  }
}
