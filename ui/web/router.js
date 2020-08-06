import Vue from 'vue';
import Router from 'vue-router';
import Layout from './views/layout/layout';
import {getToken, setToken, cleanCache} from './utils/cache';

Vue.use(Router);
const router = new Router({
  mode: 'history',
  routes: [
    {
      path: '/',
      component: Layout,
      redirect: '/home',
      children: [
        {
          path: 'home',
          name: 'home',
          component: () => import('./views/home/index')
        },
        {
          path: 'role',
          name: 'role',
          component: () => import('./views/role/index')
        },
        {
          path: 'user',
          name: 'user',
          component: () => import('./views/user/index')
        },
        {
          path: 'appraisal-result-institutions',
          name: 'appraisal-result-institutions',
          component: () => import('./views/appraisal-result/institutions/index')
        },
        {
          path: 'appraisal-result-area',
          name: 'appraisal-result-area',
          meta: {activeMenu: 'appraisal-result-institutions'},
          component: () => import('./views/appraisal-result/area/index')
        },
        {
          path: 'check',
          name: 'check',
          component: () => import('./views/check/index')
        },
        {
          path: 'rule',
          name: 'rule',
          meta: {activeMenu: 'check'},
          component: () => import('./views/check/rule')
        },
        {
          path: 'basic-data',
          name: 'basic-data',
          component: () => import('./views/check/basic-data')
        },
        {
          path: 'basic-data-detail',
          name: 'basic-data-detail',
          meta: {activeMenu: 'basic-data'},
          component: () => import('./views/check/basic-data-detail')
        },
        {
          path: 'hospital',
          name: 'hospital',
          component: () => import('./views/hospital/index')
        },
        {
          path: 'score',
          name: 'score',
          component: () => import('./views/score/index')
        },
        {
          path: 'profile',
          name: 'profile',
          component: () => import('./views/profile/index')
        },
        {
          path: 'patient',
          name: 'patient',
          meta: {activeMenu: 'person'},
          component: () => import('./views/patient/index')
        },
        {
          path: 'record-healthy',
          name: 'record-healthy',
          component: () => import('./views/patient/record-healthy')
        },
        {
          path: 'record-diabetes',
          name: 'record-diabetes',
          component: () => import('./views/patient/record-diabetes')
        },
        {
          path: 'record-hypertension',
          name: 'record-hypertension',
          component: () => import('./views/patient/record-hypertension')
        },
        {
          path: 'record-old-constitution',
          name: 'record-old-constitution',
          component: () => import('./views/patient/record-old-constitution')
        },
        {
          path: 'record-oldManSelfCare',
          name: 'record-oldManSelfCare',
          component: () => import('./views/patient/record-old-man-self-care')
        },
        {
          path: 'person',
          name: 'person',
          component: () => import('./views/person/list')
        },
        {
          path: 'person-detail',
          name: 'person-detail',
          component: () => import('./views/person/detail')
        }
      ]
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('./views/login/index')
    }
  ]
});
router.beforeEach(async (to, from, next) => {
  if (to.name === 'login') {
    cleanCache();
    next();
    return;
  }
  if (!getToken()) {
    cleanCache();
    from.path === '/' || Vue.prototype.$message.info('登录超时,请重新登录~');
    next('/login');
    return;
  }
  //TODO 先解决在刷新时子页面的created周期获取不到$settings缓存的问题
  if (!Vue.prototype.$settings.user || !Vue.prototype.$settings.permissions)
    await Vue.prototype.$settings.load();
  setToken(getToken());
  next();
});
export default router;
