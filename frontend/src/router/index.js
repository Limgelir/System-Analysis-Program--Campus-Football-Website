import { createRouter, createWebHistory } from 'vue-router'
import Home from '../pages/Home.vue'
import RefereeLogin from '../pages/RefereeLogin.vue'
const RefereeRegister = () => import('../pages/RefereeRegister.vue')
const RefereeDashboard = () => import('../pages/RefereeDashboard.vue')
const RefereeReportDetail = () => import('../pages/RefereeReportDetail.vue')
const RefereeStats = () => import('../pages/RefereeStats.vue')
import AdminLogin from '../pages/AdminLogin.vue'
import { studioEnabled } from '../../../shared-ui/appearance.js'
const AdminDashboard = () => import('../pages/AdminDashboard.vue')
const AdminRefereeManagement = () => import('../pages/AdminRefereeManagement.vue')
const AdminSeasonRegistrationManagement = () => import('../pages/AdminSeasonRegistrationManagement.vue')
const AdminRefereeDetail = () => import('../pages/AdminRefereeDetail.vue')
const AdminSchedule = () => import('../pages/AdminSchedule.vue')
const AdminScheduleDetail = () => import('../pages/AdminScheduleDetail.vue')
const AdminSeasonManagement = () => import('../pages/AdminSeasonManagement.vue')
const AdminTeamManagement = () => import('../pages/AdminTeamManagement.vue')
const AdminExternalReferees = () => import('../pages/AdminExternalReferees.vue')
const AdminPlayerManagement = () => import('../pages/AdminPlayerManagement.vue')
const AdminPlayerRegistrations = () => import('../pages/AdminPlayerRegistrations.vue')
const AdminTeamApplications = () => import('../pages/AdminTeamApplications.vue')
import {
  ADMIN_ROLE,
  REFEREE_ROLE,
  getAuthState
} from '../utils/auth'

const routes = [
  ...(__APPEARANCE_DEV_SERVER__ ? [{
    path: '/glass-preview',
    name: 'GlassPreview',
    component: () => import('../pages/GlassPreview.vue')
  }] : []),
  {path:'/admin-assignments',name:'AdminAssignments',component:()=>import('../pages/AdminAssignments.vue'),meta:{requiresAuth:true,role:ADMIN_ROLE}},
  {path:'/admin-discipline',name:'AdminDiscipline',component:()=>import('../pages/AdminDiscipline.vue'),meta:{requiresAuth:true,role:ADMIN_ROLE}},
  {path:'/referee-signups',name:'RefereeMatchSignups',component:()=>import('../pages/RefereeMatchSignups.vue'),meta:{requiresAuth:true,role:REFEREE_ROLE}},
  { path: '/admin-team-applications', name: 'AdminTeamApplications', component: AdminTeamApplications, meta: { requiresAuth: true, role: ADMIN_ROLE } },
  { path: '/admin-player-registrations', name: 'AdminPlayerRegistrations', component: AdminPlayerRegistrations, meta: { requiresAuth: true, role: ADMIN_ROLE } },
  { path: '/admin-player-college-changes', name: 'AdminPlayerCollegeChanges', component: () => import('../pages/AdminPlayerCollegeChanges.vue'), meta: { requiresAuth: true, role: ADMIN_ROLE } },
  { path: '/admin-players', name: 'AdminPlayerManagement', component: AdminPlayerManagement, meta: { requiresAuth: true, role: ADMIN_ROLE } },
  { path: '/admin-external-referees', name: 'AdminExternalReferees', component: AdminExternalReferees, meta: { requiresAuth:true, role:ADMIN_ROLE } },
  {
    path: '/',
    name: 'Home',
    component: Home
  },
  {
    path: '/referee-login',
    name: 'RefereeLogin',
    component: RefereeLogin,
    meta: { guestOnly: REFEREE_ROLE }
  },
  {
    path: '/referee-register',
    name: 'RefereeRegister',
    component: RefereeRegister,
    meta: { guestOnly: REFEREE_ROLE }
  },
  {
    path: '/referee-dashboard',
    name: 'RefereeDashboard',
    component: RefereeDashboard,
    meta: { requiresAuth: true, role: REFEREE_ROLE }
  },
  {
    path: '/referee-report/:scheduleId',
    name: 'RefereeReportDetail',
    component: RefereeReportDetail,
    meta: { requiresAuth: true, role: REFEREE_ROLE }
  },
  {
    path: '/referee-stats',
    name: 'RefereeStats',
    component: RefereeStats,
    meta: { requiresAuth: true, role: REFEREE_ROLE }
  },
  {
    path: '/admin-login',
    name: 'AdminLogin',
    component: AdminLogin,
    meta: { guestOnly: ADMIN_ROLE }
  },
  {
    path: '/admin-dashboard',
    name: 'AdminDashboard',
    component: AdminDashboard,
    meta: { requiresAuth: true, role: ADMIN_ROLE }
  },
  {
    path: '/admin-referees',
    name: 'AdminRefereeManagement',
    component: AdminRefereeManagement,
    meta: { requiresAuth: true, role: ADMIN_ROLE }
  },
  {
    path: '/admin-schedule/:scheduleId',
    name: 'AdminScheduleDetail',
    component: AdminScheduleDetail,
    meta: { requiresAuth: true, role: ADMIN_ROLE }
  },
  {
    path: '/admin-schedule/:scheduleId/report',
    name: 'AdminScheduleReportDetail',
    component: RefereeReportDetail,
    meta: { requiresAuth: true, role: ADMIN_ROLE }
  },
  {
    path: '/admin-referee/:refereeId',
    name: 'AdminRefereeDetail',
    component: AdminRefereeDetail,
    meta: { requiresAuth: true, role: ADMIN_ROLE }
  },
  {
    path: '/admin-schedule',
    name: 'AdminSchedule',
    component: AdminSchedule,
    meta: { requiresAuth: true, role: ADMIN_ROLE }
  },
  {
    path: '/admin-seasons',
    name: 'AdminSeasonManagement',
    component: AdminSeasonManagement,
    meta: { requiresAuth: true, role: ADMIN_ROLE }
  },
  {
    path: '/admin-teams',
    name: 'AdminTeamManagement',
    component: AdminTeamManagement,
    meta: { requiresAuth: true, role: ADMIN_ROLE }
  },
  {
    path: '/admin-season-registrations',
    name: 'AdminSeasonRegistrationManagement',
    component: AdminSeasonRegistrationManagement,
    meta: { requiresAuth: true, role: ADMIN_ROLE }
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/'
  }
]

const router = createRouter({
  history: createWebHistory(),
  scrollBehavior(to, from, saved) {
    if (saved) return saved
    if (to.hash) return { el: to.hash, top: studioEnabled.value ? 115 : 24 }
    if (to.path !== from.path || studioEnabled.value && (from.hash || to.fullPath === from.fullPath)) return { top: 0 }
    return false
  },
  routes
})

router.beforeEach((to) => {
  const { hasAdmin, hasReferee, adminPayload } = getAuthState()
  const requiredRole = to.meta?.role
  const guestOnly = to.meta?.guestOnly

  if (guestOnly === ADMIN_ROLE && hasAdmin) {
    return '/admin-dashboard'
  }

  if (guestOnly === REFEREE_ROLE && hasReferee) {
    return '/referee-dashboard'
  }

  if (to.meta?.requiresAuth) {
    if (requiredRole === ADMIN_ROLE) {
      if (!hasAdmin) return '/admin-login'
      if (adminPayload?.mustChangePassword && to.name !== 'AdminDashboard') {
        return '/admin-dashboard'
      }
      return true
    }

    if (requiredRole === REFEREE_ROLE) {
      return hasReferee || '/referee-login'
    }

    if (hasAdmin || hasReferee) {
      return true
    }

    return '/'
  }

  return true
})

export default router
