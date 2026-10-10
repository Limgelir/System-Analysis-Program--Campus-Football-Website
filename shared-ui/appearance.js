import { ref } from 'vue'
import { createAppearanceGate, requestAppearance } from './appearanceGate.mjs'

export const studioEnabled = ref(false)

export function installAppearance(app, router, getSession) {
  // The visual lab stays available locally. Production can only use the server decision.
  const preview = __APPEARANCE_DEV_SERVER__ && import.meta.env.VITE_APPEARANCE_PREVIEW !== 'false'
  let modules, loading, disposeTools, activeKey
  Object.defineProperty(app.config.globalProperties, '$studioEnabled', { get: () => studioEnabled.value })
  const gate = createAppearanceGate({
    getSession, preview,
    request: session => requestAppearance(session, { base: String(import.meta.env.VITE_API_BASE_URL || '').trim() }),
    async load() {
      if (modules) return
      if (!loading) loading = Promise.all([
        import('./local-appearance/StudioShell.vue'),
        import('./local-appearance/StudioHero.vue'),
        import('./local-appearance/index.js')
      ]).then(([shell, hero, tools]) => {
        app.component('StudioShell', shell.default)
        app.component('StudioHero', hero.default)
        modules = tools
      }).finally(() => { loading = null })
      await loading
    },
    apply(plan) {
      const nextKey = plan.enabled ? plan.key : undefined
      if (nextKey !== activeKey) {
        disposeTools?.()
        disposeTools = undefined
        activeKey = undefined
        studioEnabled.value = false
        if (plan.enabled && modules) {
          try {
            disposeTools = modules.installLocalAppearance({
              localPreview: plan.localPreview,
              storageKey: plan.localPreview ? undefined : `tj-appearance-v1:${plan.key}`
            })
            activeKey = nextKey
            studioEnabled.value = true
          } catch { /* A failed appearance module must not block the business pages. */ }
        }
      }
    }
  })
  const removeBefore = router.beforeResolve((to, from) => gate.prepare(to, from))
  const removeAfter = router.afterEach((to, _from, failure) => gate.commit(to, failure))
  const checkSession = () => gate.checkSession(router.currentRoute.value)
  window.addEventListener('storage', checkSession)
  window.addEventListener('appearance-session-changed', checkSession)
  const dispose = () => {
    removeBefore(); removeAfter(); gate.reset()
    window.removeEventListener('storage', checkSession)
    window.removeEventListener('appearance-session-changed', checkSession)
  }
  if (import.meta.hot) import.meta.hot.dispose(dispose)
  return dispose
}
