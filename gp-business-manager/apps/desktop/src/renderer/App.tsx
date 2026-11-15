import type { ReactElement } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { LoginPage, SetupPage } from './pages/Auth';
import { Dashboard } from './pages/Dashboard';
import { PosPage } from './pages/Pos';
import { SalesPage } from './pages/Sales';
import { CashPage } from './pages/Cash';
import { CustomersPage } from './pages/Customers';
import { ProductsPage } from './pages/Products';
import { StockPage } from './pages/Stock';
import { PurchasingPage } from './pages/Purchasing';
import { FinancePage } from './pages/Finance';
import { ReportsPage } from './pages/Reports';
import { AdminPage } from './pages/Admin';
import { SettingsPage } from './pages/Settings';

export function App() {
  const { loading, configured, me, can } = useAuth();
  if (loading) return <div className="grid h-full place-items-center"><Spinner className="size-8" /></div>;
  if (!configured) return <SetupPage />;
  if (!me) return <LoginPage />;
  const home = can('dashboard.view') ? '/' : can('sale.create') ? '/pos' : '/products';
  const guard = (perm: string | string[], el: ReactElement) => (can(perm) ? el : <Navigate to={home} replace />);
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={guard('dashboard.view', <Dashboard />)} />
        <Route path="pos" element={guard('sale.create', <PosPage />)} />
        <Route path="sales" element={guard('sale.view', <SalesPage />)} />
        <Route path="cash" element={guard('cash.session', <CashPage />)} />
        <Route path="customers" element={guard('customer.view', <CustomersPage />)} />
        <Route path="products" element={guard('product.view', <ProductsPage />)} />
        <Route path="stock" element={guard('stock.view', <StockPage />)} />
        <Route path="purchasing" element={guard(['supplier.view', 'purchase.view'], <PurchasingPage />)} />
        <Route path="finance" element={guard('finance.view', <FinancePage />)} />
        <Route path="reports" element={guard(['report.view', 'finance.view'], <ReportsPage />)} />
        <Route path="admin" element={guard(['user.manage', 'audit.view', 'organization.manage', 'backup.manage', 'role.manage'], <AdminPage />)} />
        <Route path="settings" element={guard('settings.manage', <SettingsPage />)} />
        <Route path="*" element={<Navigate to={home} replace />} />
      </Route>
    </Routes>
  );
}
