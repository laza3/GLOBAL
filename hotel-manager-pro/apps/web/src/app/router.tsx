import { Navigate, createBrowserRouter, type RouteObject } from 'react-router';
import { SOON } from '../app-modules';
import { RequirePlatformAuth } from '../auth/platform-session';
import { RequireHotelAuth } from '../auth/session';
import { HotelLayout } from '../layouts/hotel-layout';
import { PlatformLayout } from '../layouts/platform-layout';
import { NotFoundPage, RouteErrorPage } from '../pages/not-found';

/** Chaque écran est chargé à la demande : la page de connexion n'embarque ni le tableau de bord ni les graphiques. */
const page = <T,>(load: () => Promise<T>, pick: (m: T) => React.ComponentType): RouteObject['lazy'] => async () => ({ Component: pick(await load()) });

const soonRoutes: RouteObject[] = [...SOON].map((id) => ({
  path: id,
  lazy: async () => {
    const { default: ComingSoonPage } = await import('../pages/modules/coming-soon');
    return { Component: () => <ComingSoonPage moduleId={id} /> };
  },
}));

export const routes: RouteObject[] = [
  {
    errorElement: <RouteErrorPage />,
    children: [
      { path: '/connexion', lazy: page(() => import('../pages/auth/login'), (m) => m.LoginPage) },
      { path: '/inscription', lazy: page(() => import('../pages/auth/register'), (m) => m.RegisterPage) },
      { path: '/conditions', lazy: page(() => import('../pages/legal/terms'), (m) => m.default) },
      { path: '/confidentialite', lazy: page(() => import('../pages/legal/privacy'), (m) => m.default) },
      { path: '/design', lazy: page(() => import('../pages/design-system'), (m) => m.DesignSystemPage) },
      {
        element: <RequireHotelAuth />,
        children: [
          {
            element: <HotelLayout />,
            children: [
              { index: true, element: <Navigate to="/overview" replace /> },
              { path: 'overview', lazy: page(() => import('../pages/overview'), (m) => m.default) },
              {
                path: 'settings',
                lazy: page(() => import('../pages/settings/layout'), (m) => m.default),
                children: [
                  { index: true, element: <Navigate to="hotel" replace /> },
                  { path: 'hotel', lazy: page(() => import('../pages/settings/hotel'), (m) => m.default) },
                  { path: 'subscription', lazy: page(() => import('../pages/settings/subscription'), (m) => m.default) },
                  { path: 'invoices', lazy: page(() => import('../pages/settings/invoices'), (m) => m.default) },
                  { path: 'support', lazy: page(() => import('../pages/settings/support'), (m) => m.default) },
                  { path: 'account', lazy: page(() => import('../pages/settings/account'), (m) => m.default) },
                ],
              },
              {
                path: 'rooms',
                lazy: page(() => import('../pages/rooms/layout'), (m) => m.default),
                children: [
                  { index: true, lazy: page(() => import('../pages/rooms/rooms'), (m) => m.default) },
                  { path: 'categories', lazy: page(() => import('../pages/rooms/categories'), (m) => m.default) },
                  { path: 'rates', lazy: page(() => import('../pages/rooms/rates'), (m) => m.default) },
                ],
              },
              { path: 'reservations', lazy: page(() => import('../pages/reservations/reservations'), (m) => m.default) },
              { path: 'reservations/new', lazy: page(() => import('../pages/reservations/new'), (m) => m.default) },
              { path: 'reservations/:id', lazy: page(() => import('../pages/reservations/detail'), (m) => m.default) },
              { path: 'calendar', lazy: page(() => import('../pages/calendar/calendar'), (m) => m.default) },
              { path: 'guests', lazy: page(() => import('../pages/guests/guests'), (m) => m.default) },
              { path: 'guests/:id', lazy: page(() => import('../pages/guests/detail'), (m) => m.default) },
              ...soonRoutes,
            ],
          },
        ],
      },
      { path: '/platform/connexion', lazy: page(() => import('../pages/platform/login'), (m) => m.PlatformLoginPage) },
      {
        path: '/platform',
        element: <RequirePlatformAuth />,
        children: [
          {
            element: <PlatformLayout />,
            children: [
              { index: true, element: <Navigate to="dashboard" replace /> },
              { path: 'dashboard', lazy: page(() => import('../pages/platform/dashboard'), (m) => m.default) },
              { path: 'hotels', lazy: page(() => import('../pages/platform/hotels'), (m) => m.default) },
              { path: 'hotels/:id', lazy: page(() => import('../pages/platform/hotel-detail'), (m) => m.default) },
              { path: 'subscriptions', lazy: page(() => import('../pages/platform/subscriptions'), (m) => m.default) },
              { path: 'payments', lazy: page(() => import('../pages/platform/payments'), (m) => m.default) },
              { path: 'invoices', lazy: page(() => import('../pages/platform/invoices'), (m) => m.default) },
              { path: 'plans', lazy: page(() => import('../pages/platform/plans'), (m) => m.default) },
              { path: 'licenses', lazy: page(() => import('../pages/platform/licenses'), (m) => m.default) },
              { path: 'support', lazy: page(() => import('../pages/platform/support'), (m) => m.default) },
              { path: 'settings', lazy: page(() => import('../pages/platform/settings'), (m) => m.default) },
              { path: 'audit', lazy: page(() => import('../pages/platform/audit'), (m) => m.default) },
              { path: '*', element: <NotFoundPage /> },
            ],
          },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export const router = createBrowserRouter(routes);
