import { createRouter, createWebHashHistory, createWebHistory, type Router } from 'vue-router';
import type { LearningContext } from './context';
import AppShell from './components/AppShell.vue';
import ConnectPage from './pages/ConnectPage.vue';
import LoginPage from './pages/LoginPage.vue';
import ChangePasswordPage from './pages/ChangePasswordPage.vue';
import HomePage from './pages/HomePage.vue';
import TopicsPage from './pages/TopicsPage.vue';
import TopicDetailPage from './pages/TopicDetailPage.vue';
import PlanPage from './pages/PlanPage.vue';
import ContentPage from './pages/ContentPage.vue';
import AssessmentPage from './pages/AssessmentPage.vue';
import AttemptPage from './pages/AttemptPage.vue';
import ReportPage from './pages/ReportPage.vue';
import WrongQuestionsPage from './pages/WrongQuestionsPage.vue';
import WrongQuestionDetailPage from './pages/WrongQuestionDetailPage.vue';
import HistoryPage from './pages/HistoryPage.vue';
import ArchivePage from './pages/ArchivePage.vue';
import SettingsPage from './pages/SettingsPage.vue';
import AgentTokensPage from './pages/AgentTokensPage.vue';
import AdminUsersPage from './pages/AdminUsersPage.vue';
import AdminModelsPage from './pages/AdminModelsPage.vue';
import AdminGradingPage from './pages/AdminGradingPage.vue';

export function createLearningRouter(context: LearningContext, ready: Promise<void>): Router {
  const router = createRouter({
    history:
      context.platform.kind === 'web'
        ? createWebHistory(import.meta.env.BASE_URL)
        : createWebHashHistory(),
    scrollBehavior: () => ({ top: 0 }),
    routes: [
      { path: '/connect', name: 'connect', component: ConnectPage, meta: { public: true } },
      { path: '/login', name: 'login', component: LoginPage, meta: { public: true } },
      {
        path: '/answer',
        name: 'public-answer',
        component: AttemptPage,
        props: { publicAccess: true },
        meta: { public: true, publicAccess: true },
      },
      {
        path: '/answer/report',
        name: 'public-report',
        component: ReportPage,
        props: { publicAccess: true },
        meta: { public: true, publicAccess: true },
      },
      {
        path: '/change-password',
        name: 'change-password',
        component: ChangePasswordPage,
        meta: { requiresAuth: true, bare: true },
      },
      {
        path: '/',
        component: AppShell,
        meta: { requiresAuth: true },
        children: [
          { path: '', name: 'home', component: HomePage },
          { path: 'topics', name: 'topics', component: TopicsPage },
          { path: 'topics/:topicId', name: 'topic-detail', component: TopicDetailPage },
          { path: 'topics/:topicId/plans/:planId', name: 'plan', component: PlanPage },
          { path: 'contents/:contentId', name: 'content', component: ContentPage },
          { path: 'assessments/:assessmentId', name: 'assessment', component: AssessmentPage },
          {
            path: 'attempts/:attemptId',
            name: 'attempt',
            component: AttemptPage,
            meta: { immersive: true },
          },
          {
            path: 'attempts/:attemptId/report',
            name: 'report',
            component: ReportPage,
            meta: { immersive: true },
          },
          { path: 'wrong-questions', name: 'wrong-questions', component: WrongQuestionsPage },
          {
            path: 'wrong-questions/:questionId',
            name: 'wrong-question-detail',
            component: WrongQuestionDetailPage,
          },
          { path: 'history', name: 'history', component: HistoryPage },
          { path: 'archive', name: 'archive', component: ArchivePage },
          { path: 'settings', name: 'settings', component: SettingsPage },
          { path: 'settings/agent-tokens', name: 'agent-tokens', component: AgentTokensPage },
          {
            path: 'admin/users',
            name: 'admin-users',
            component: AdminUsersPage,
            meta: { admin: true },
          },
          {
            path: 'admin/settings/models',
            name: 'admin-models',
            component: AdminModelsPage,
            meta: { admin: true },
          },
          {
            path: 'admin/grading',
            name: 'admin-grading',
            component: AdminGradingPage,
            meta: { admin: true },
          },
        ],
      },
      { path: '/:pathMatch(.*)*', redirect: '/' },
    ],
  });

  router.beforeEach(async (to) => {
    await ready;
    const { connection, user } = context.state;
    const isAndroid = context.platform.kind === 'android';

    if (to.name === 'connect' && !isAndroid) return { name: user ? 'home' : 'login' };
    if (!connection) {
      if (isAndroid) return to.name === 'connect' ? true : { name: 'connect' };
      return true;
    }
    if (to.name === 'connect') return { name: user ? 'home' : 'login' };
    if (to.meta.publicAccess) return true;
    if (!user)
      return to.name === 'login' ? true : { name: 'login', query: { redirect: to.fullPath } };
    if (to.name === 'login') return { name: 'home' };
    if (to.meta.admin && user.role !== 'admin') return { name: 'home' };
    return true;
  });

  return router;
}
