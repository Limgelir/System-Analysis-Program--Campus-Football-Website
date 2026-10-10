import '../../shared-ui/theme.css'
import ListPagination from '../../shared-ui/ListPagination.vue'
import PageState from '../../shared-ui/PageState.vue'
import { installInteraction } from '../../shared-ui/interaction.js'
import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import AuthPage from './pages/AuthPage.vue'
import Dashboard from './pages/Dashboard.vue'
import AccountPage from './pages/AccountPage.vue'
import TeamPage from './pages/TeamPage.vue'
import SeasonRegistration from './pages/SeasonRegistration.vue'
import TeamApplications from './pages/TeamApplications.vue'
import TeamApplication from './pages/TeamApplication.vue'
import PublicTeams from './pages/PublicTeams.vue'
import PublicTeam from './pages/PublicTeam.vue'
import { session, api, clearSession } from './session'
import './style.css'
import './teamStyle.css'
import { installAppearance, studioEnabled } from '../../shared-ui/appearance.js'
const router = createRouter({ history: createWebHistory(), scrollBehavior(to,from,saved){return saved || (to.path!==from.path || studioEnabled.value && to.fullPath===from.fullPath ? {top:0}:false)}, routes: [
  { path: '/', redirect: '/dashboard' },
  { path: '/login', component: AuthPage, meta: { guest: true } },
  { path: '/register', component: AuthPage, meta: { guest: true } },
  { path: '/dashboard', component: Dashboard },
  { path: '/public', component: PublicTeams, meta: { public: true } },
  { path: '/public/teams/:id', component: PublicTeam, meta: { public: true } },
  { path: '/account', component: AccountPage },
  { path: '/season-registration', component: SeasonRegistration },
  { path: '/team-applications', component: TeamApplications },
  { path: '/team-applications/:id', component: TeamApplication },
  { path: '/teams/:id', component: TeamPage },
  { path: '/:pathMatch(.*)*', redirect: '/' }
] })
router.beforeEach(async to => {
  if (session.token && !session.player) {
    try { session.player = await api.get('/me') } catch { clearSession() }
  }
  if (to.meta.public) return true
  if (!session.player) return to.meta.guest || '/login'
  if (session.player.must_change_password && to.path !== '/account') return '/account'
  if (to.meta.guest) return '/dashboard'
})
const app = createApp(App)
app.component('PageState', PageState)
app.component('ListPagination', ListPagination)
installInteraction(app, router)
installAppearance(app, router, route => !route.meta.guest && session.token && session.player
  ? { token: session.token, role: 'player' } : null)
app.use(router)
await router.isReady()
app.mount('#app')
