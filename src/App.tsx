import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense, type ComponentType } from 'react';
import { GlobalSurface } from './layout/GlobalSurface';
import { GlobalHeader } from './layout/GlobalHeader';
import { AnimatedPortalShell } from './layout/AnimatedPortalShell';
import { GlobalFooter } from './layout/GlobalFooter';
import { BottomNav } from './layout/BottomNav';
import { AdminGate } from './pages/admin/AdminGate';
import { RouteTransitionLoader } from './components/brand/RouteTransitionLoader';
import { DisclaimerGate } from './components/brand/DisclaimerGate';
import { ErrorBoundary } from './components/ErrorBoundary';
import { RouteMeta } from './components/RouteMeta';
import { RouteFallback } from './components/system/RouteFallback';

// Route-level code splitting. Each page (and the heavy admin cluster) becomes
// its own chunk loaded on demand, so the initial bundle is just the router +
// chrome instead of every page + three.js up front.
const lazyPage = <K extends string>(
  loader: () => Promise<Record<K, ComponentType>>,
  key: K,
) => lazy(() => loader().then((m) => ({ default: m[key] })));

const Landing = lazyPage(() => import('./pages/Landing'), 'Landing');
const ResearchSuppliesHub = lazyPage(() => import('./pages/ResearchSuppliesHub'), 'ResearchSuppliesHub');
const BiopeptideResearchSupplies = lazyPage(() => import('./pages/BiopeptideResearchSupplies'), 'BiopeptideResearchSupplies');
const NootropicsResearchSupplies = lazyPage(() => import('./pages/NootropicsResearchSupplies'), 'NootropicsResearchSupplies');
const SkincareResearchSupplies = lazyPage(() => import('./pages/SkincareResearchSupplies'), 'SkincareResearchSupplies');
const LaboratoryEquipment = lazyPage(() => import('./pages/LaboratoryEquipment'), 'LaboratoryEquipment');
const ProductPage = lazyPage(() => import('./pages/ProductPage'), 'ProductPage');
const Catalog = lazyPage(() => import('./pages/Catalog'), 'Catalog');
const Research = lazyPage(() => import('./pages/Research'), 'Research');
const CartPage = lazyPage(() => import('./pages/CartPage'), 'CartPage');
const Contact = lazyPage(() => import('./pages/Contact'), 'Contact');
const TrackOrder = lazyPage(() => import('./pages/TrackOrder'), 'TrackOrder');
const Account = lazyPage(() => import('./pages/Account'), 'Account');
const Documentation = lazyPage(() => import('./pages/Documentation'), 'Documentation');
const DocumentDetail = lazyPage(() => import('./pages/DocumentDetail'), 'DocumentDetail');
const Privacy = lazyPage(() => import('./pages/legal/Privacy'), 'Privacy');
const Terms = lazyPage(() => import('./pages/legal/Terms'), 'Terms');
const Shipping = lazyPage(() => import('./pages/legal/Shipping'), 'Shipping');
const About = lazyPage(() => import('./pages/legal/About'), 'About');
const NotFound = lazyPage(() => import('./pages/NotFound'), 'NotFound');

const AdminEdit = lazyPage(() => import('./pages/admin/AdminEdit'), 'AdminEdit');
const AdminDashboard = lazyPage(() => import('./pages/admin/AdminDashboard'), 'AdminDashboard');
const AdminInventory = lazyPage(() => import('./pages/admin/AdminInventory'), 'AdminInventory');
const AdminImport = lazyPage(() => import('./pages/admin/AdminImport'), 'AdminImport');
const AdminInquiries = lazyPage(() => import('./pages/admin/AdminInquiries'), 'AdminInquiries');
const AdminOrders = lazyPage(() => import('./pages/admin/AdminOrders'), 'AdminOrders');
const AdminOrderDetail = lazyPage(() => import('./pages/admin/AdminOrderDetail'), 'AdminOrderDetail');
const AdminStockHistory = lazyPage(() => import('./pages/admin/AdminStockHistory'), 'AdminStockHistory');
const AdminAuditLog = lazyPage(() => import('./pages/admin/AdminAuditLog'), 'AdminAuditLog');
const AdminCustomers = lazyPage(() => import('./pages/admin/AdminCustomers'), 'AdminCustomers');
const AdminCustomerDetail = lazyPage(() => import('./pages/admin/AdminCustomerDetail'), 'AdminCustomerDetail');
const AdminSystemHealth = lazyPage(() => import('./pages/admin/AdminSystemHealth'), 'AdminSystemHealth');
const AdminReports = lazyPage(() => import('./pages/admin/AdminReports'), 'AdminReports');
const AdminCoupons = lazyPage(() => import('./pages/admin/AdminCoupons'), 'AdminCoupons');

export default function App() {
  return (
    <BrowserRouter>
      <RouteMeta />
      <GlobalSurface>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[200] focus:rounded-full focus:border focus:border-ink/20 focus:bg-ink focus:px-4 focus:py-2 focus:text-[11px] focus:uppercase focus:tracking-[0.2em] focus:text-base-900"
        >
          Skip to content
        </a>
        <GlobalHeader />
        <AnimatedPortalShell>
          <ErrorBoundary>
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                <Route path="/" element={<Landing />} />
                <Route path="/research-supplies" element={<ResearchSuppliesHub />} />
                <Route path="/research-supplies/biopeptide" element={<BiopeptideResearchSupplies />} />
                <Route path="/research-supplies/nootropics" element={<NootropicsResearchSupplies />} />
                <Route path="/research-supplies/skincare" element={<SkincareResearchSupplies />} />
                <Route path="/laboratory-equipment" element={<LaboratoryEquipment />} />
                <Route path="/catalog" element={<Catalog />} />
                <Route path="/research" element={<Research />} />
                <Route path="/product/:id" element={<ProductPage />} />
                <Route path="/cart" element={<CartPage />} />
                <Route path="/contact" element={<Contact />} />
                <Route path="/track" element={<TrackOrder />} />
                <Route path="/account" element={<Account />} />
                <Route path="/login" element={<Navigate to="/account" replace />} />
                <Route path="/signup" element={<Navigate to="/account" replace />} />
                <Route path="/documentation" element={<Documentation />} />
                <Route path="/documentation/:id" element={<DocumentDetail />} />
                <Route path="/privacy" element={<Privacy />} />
                <Route path="/terms" element={<Terms />} />
                <Route path="/shipping" element={<Shipping />} />
                <Route path="/about" element={<About />} />
                <Route path="/admin" element={<AdminGate><AdminDashboard /></AdminGate>} />
                <Route path="/admin/inventory" element={<AdminGate><AdminInventory /></AdminGate>} />
                <Route path="/admin/import" element={<AdminGate><AdminImport /></AdminGate>} />
                <Route path="/admin/inquiries" element={<AdminGate><AdminInquiries /></AdminGate>} />
                <Route path="/admin/orders" element={<AdminGate><AdminOrders /></AdminGate>} />
                <Route path="/admin/orders/:id" element={<AdminGate><AdminOrderDetail /></AdminGate>} />
                <Route path="/admin/stock-history" element={<AdminGate><AdminStockHistory /></AdminGate>} />
                <Route path="/admin/customers" element={<AdminGate><AdminCustomers /></AdminGate>} />
                <Route path="/admin/customers/:id" element={<AdminGate><AdminCustomerDetail /></AdminGate>} />
                <Route path="/admin/coupons" element={<AdminGate><AdminCoupons /></AdminGate>} />
                <Route path="/admin/audit-log" element={<AdminGate><AdminAuditLog /></AdminGate>} />
                <Route path="/admin/system-health" element={<AdminGate><AdminSystemHealth /></AdminGate>} />
                <Route path="/admin/reports" element={<AdminGate><AdminReports /></AdminGate>} />
                <Route path="/admin/products" element={<Navigate to="/admin/inventory" replace />} />
                <Route path="/admin/new" element={<AdminGate><AdminEdit /></AdminGate>} />
                <Route path="/admin/:id/edit" element={<AdminGate><AdminEdit /></AdminGate>} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </ErrorBoundary>
        </AnimatedPortalShell>
        <GlobalFooter />
      </GlobalSurface>
      <BottomNav />
      <RouteTransitionLoader />
      <DisclaimerGate />
    </BrowserRouter>
  );
}
