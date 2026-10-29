import { createRouter, createWebHashHistory, createWebHistory, type Router } from 'vue-router';
import type { LearningContext } from '#learning-client/context';
import AppShell from '#learning-client/components/AppShell.vue';
import ConnectPage from '#learning-client/pages/ConnectPage.vue';
import LoginPage from '#learning-client/pages/LoginPage.vue';
import ChangePasswordPage from '#learning-client/pages/ChangePasswordPage.vue';
import HomePage from '#learning-client/pages/HomePage.vue';
import TopicsPage from '#learning-client/pages/TopicsPage.vue';
import TopicDetailPage from '#learning-client/pages/TopicDetailPage.vue';
import PlanPage from '#learning-client/pages/PlanPage.vue';
import ContentPage from '#learning-client/pages/ContentPage.vue';
import AssessmentPage from '#learning-client/pages/AssessmentPage.vue';
import AttemptPage from '#learning-client/pages/AttemptPage.vue';
import ReportPage from '#learning-client/pages/ReportPage.vue';
import WrongQuestionsPage from '#learning-client/pages/WrongQuestionsPage.vue';
import WrongQuestionDetailPage from '#learning-client/pages/WrongQuestionDetailPage.vue';
import HistoryPage from '#learning-client/pages/HistoryPage.vue';
import ArchivePage from '#learning-client/pages/ArchivePage.vue';
import SearchPage from '#learning-client/pages/SearchPage.vue';
import SettingsPage from '#learning-client/pages/SettingsPage.vue';
import TokenUsagePage from '#learning-client/pages/TokenUsagePage.vue';
import AgentTokensPage from '#learning-client/pages/AgentTokensPage.vue';
import AdminUsersPage from '#learning-client/pages/AdminUsersPage.vue';
import AdminModelsPage from '#learning-client/pages/AdminModelsPage.vue';
import AdminGradingPage from '#learning-client/pages/AdminGradingPage.vue';
import AdminAuditPage from '#learning-client/pages/AdminAuditPage.vue';
import AdminAssistantPage from '#learning-client/pages/AdminAssistantPage.vue';
import AssistantPage from '#learning-client/pages/AssistantPage.vue';
import AssistantArchivePage from '#learning-client/pages/AssistantArchivePage.vue';

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
          { path: '', name: 'home', component: HomePage, meta: { assistantPanel: true } },
          {
            path: 'assistant',
            name: 'assistant',
            component: AssistantPage,
            meta: { assistantPanel: true },
          },
          { path: 'topics', name: 'topics', component: TopicsPage, meta: { assistantPanel: true } },
          {
            path: 'topics/:topicId',
            name: 'topic-detail',
            component: TopicDetailPage,
            meta: { assistantPanel: true },
          },
          {
            path: 'topics/:topicId/plans/:planId',
            name: 'plan',
            component: PlanPage,
            meta: { assistantPanel: true },
          },
          {
            path: 'contents/:contentId',
            name: 'content',
            component: ContentPage,
            meta: { focus: true, assistantPanel: true },
          },
          {
            path: 'assessments/:assessmentId',
            name: 'assessment',
            component: AssessmentPage,
            meta: { focus: true, assistantPanel: true },
          },
          {
            path: 'attempts/:attemptId',
            name: 'attempt',
            component: AttemptPage,
            meta: { immersive: true, assistantPanel: true },
          },
          {
            path: 'attempts/:attemptId/report',
            name: 'report',
            component: ReportPage,
            meta: { immersive: true, assistantPanel: true },
          },
          {
            path: 'wrong-questions',
            name: 'wrong-questions',
            component: WrongQuestionsPage,
            meta: { assistantPanel: true },
          },
          {
            path: 'wrong-questions/:questionId',
            name: 'wrong-question-detail',
            component: WrongQuestionDetailPage,
            meta: { assistantPanel: true },
          },
          {
            path: 'history',
            name: 'history',
            component: HistoryPage,
            meta: { assistantPanel: true },
          },
          { path: 'archive', name: 'archive', component: ArchivePage },
          {
            path: 'assistant/archive',
            name: 'assistant-archive',
            component: AssistantArchivePage,
          },
          { path: 'search', name: 'search', component: SearchPage, meta: { assistantPanel: true } },
          { path: 'settings', name: 'settings', component: SettingsPage },
          { path: 'token-usage', name: 'token-usage', component: TokenUsagePage },
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
            path: 'admin/settings/assistant',
            name: 'admin-assistant',
            component: AdminAssistantPage,
            meta: { admin: true },
          },
          {
            path: 'admin/audit',
            name: 'admin-audit',
            component: AdminAuditPage,
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
