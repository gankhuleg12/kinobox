import { lazy, Suspense, useEffect } from 'react';
import { createBrowserRouter, RouterProvider, Outlet, useRouteError } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import { useAuth } from './lib/auth';
import { AppLayout, RevokedNotice } from './components/layout/AppLayout';
import { RequireAuth, RequireStaff, GuestOnly } from './components/Guards';
import { PageSpinner, Toaster } from './components/ui';
import Home from './pages/Home';

// Хуудас бүр тусдаа chunk болж, хэрэгтэй үедээ л ачаалагдана (code splitting)
const Browse = lazy(() => import('./pages/Browse'));
const Search = lazy(() => import('./pages/Search'));
const MovieDetail = lazy(() => import('./pages/MovieDetail'));
const Watch = lazy(() => import('./pages/Watch'));
const Pricing = lazy(() => import('./pages/Pricing'));
const Reels = lazy(() => import('./pages/Reels'));
const Checkout = lazy(() => import('./pages/Checkout'));
const PaymentStatus = lazy(() => import('./pages/PaymentStatus'));
const Account = lazy(() => import('./pages/Account'));
const Login = lazy(() => import('./pages/auth/Login'));
const Register = lazy(() => import('./pages/auth/Register'));
const ForgotPassword = lazy(() => import('./pages/auth/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/auth/ResetPassword'));
const AuthCallback = lazy(() => import('./pages/auth/AuthCallback'));
const NotFound = lazy(() => import('./pages/NotFound'));
const AdminApp = lazy(() => import('./pages/admin/AdminApp'));

function Root() {
  return (
    <>
      <Suspense fallback={<PageSpinner />}>
        <Outlet />
      </Suspense>
      <RevokedNotice />
      <Toaster />
    </>
  );
}

function RouteError() {
  const error = useRouteError();
  if (import.meta.env.DEV) console.error(error);
  return (
    <div className="grid min-h-dvh place-items-center px-6 text-center">
      <div>
        <p className="text-gradient text-6xl font-black">Oops</p>
        <p className="mt-4 text-muted">Алдаа гарлаа. Хуудсыг дахин ачаална уу.</p>
        <button onClick={() => window.location.reload()} className="mt-6 rounded-xl bg-gradient-brand px-5 py-2.5 text-sm font-semibold text-white">
          Дахин ачаалах
        </button>
      </div>
    </div>
  );
}

const router = createBrowserRouter([
  {
    element: <Root />,
    errorElement: <RouteError />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <Home /> },
          { path: 'browse', element: <Browse /> },
          { path: 'category/:slug', element: <Browse /> },
          { path: 'search', element: <Search /> },
          { path: 'movie/:slug', element: <MovieDetail /> },
          { path: 'pricing', element: <Pricing /> },
          { path: 'reels', element: <Reels /> },
          { path: 'reels/:id', element: <Reels /> },
          { path: 'checkout/rent/:slug', element: <RequireAuth><Checkout kind="rent" /></RequireAuth> },
          { path: 'checkout/plan/:code', element: <RequireAuth><Checkout kind="plan" /></RequireAuth> },
          { path: 'checkout/status/:id', element: <RequireAuth><PaymentStatus /></RequireAuth> },
          { path: 'account', element: <RequireAuth><Account /></RequireAuth> },
          { path: 'login', element: <GuestOnly><Login /></GuestOnly> },
          { path: 'register', element: <GuestOnly><Register /></GuestOnly> },
          { path: 'forgot-password', element: <GuestOnly><ForgotPassword /></GuestOnly> },
          { path: 'reset-password', element: <ResetPassword /> },
          { path: 'auth/callback', element: <AuthCallback /> },
          { path: '*', element: <NotFound /> },
        ],
      },
      { path: 'watch/:slug', element: <RequireAuth><Watch /></RequireAuth> },
      { path: 'admin/*', element: <RequireStaff><AdminApp /></RequireStaff> },
    ],
  },
]);

export default function App() {
  const bootstrap = useAuth((s) => s.bootstrap);
  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
