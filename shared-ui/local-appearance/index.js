import { createApp } from 'vue'
import LocalAppearance from './LocalAppearance.vue'
import './appearance.css'
import './cards.css'

let dispose
export function installLocalAppearance(options = {}) {
  dispose?.()
  const host = document.createElement('div')
  host.id = 'local-appearance-tools'
  document.body.append(host)
  const app = createApp(LocalAppearance, options)
  try { app.mount(host) }
  catch (error) {
    app.unmount()
    host.remove()
    delete document.documentElement.dataset.localAppearance
    delete document.documentElement.dataset.localCards
    document.documentElement.style.removeProperty('--local-glass-blur')
    document.documentElement.style.removeProperty('--local-glass-tint')
    throw error
  }
  let disposed = false
  dispose = () => { if (disposed) return; disposed = true; app.unmount(); host.remove() }
  return dispose
}

if (import.meta.hot) import.meta.hot.dispose(() => dispose?.())
