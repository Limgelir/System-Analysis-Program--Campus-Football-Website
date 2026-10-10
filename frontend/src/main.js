import '../../shared-ui/theme.css'
import PageState from '../../shared-ui/PageState.vue'
import { installInteraction } from '../../shared-ui/interaction.js'
import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import './style.css'
import './styles/common.css'
import { installAppearance } from '../../shared-ui/appearance.js'
import { getValidTokenByRole } from './utils/auth'

const app = createApp(App)
app.component('PageState', PageState)
installInteraction(app, router)
installAppearance(app, router, route => {
  const role = route.meta?.role
  if (!route.meta?.requiresAuth || !['admin', 'referee'].includes(role)) return null
  const token = getValidTokenByRole(role)
  return token ? { role, token } : null
})
app.use(router)
await router.isReady()
app.mount('#app')
