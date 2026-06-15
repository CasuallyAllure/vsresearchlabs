import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { GlobalSurface } from './layout/GlobalSurface';
import { GlobalHeader } from './layout/GlobalHeader';
import { AnimatedPortalShell } from './layout/AnimatedPortalShell';
import { GlobalFooter } from './layout/GlobalFooter';
import { BottomNav } from './layout/BottomNav';
import { Landing } from './pages/Landing';
import { ResearchSuppliesHub } from './pages/ResearchSuppliesHub';
import { BiopeptideResearchSupplies } from './pages/BiopeptideResearchSupplies';
import { NootropicsResearchSupplies } from './pages/NootropicsResearchSupplies';
import { SkincareResearchSupplies } from './pages/SkincareResearchSupplies';
import { LaboratoryEquipment } from './pages/LaboratoryEquipment';
import { ProductPage } from './pages/ProductPage';
import { Catalog } from './pages/Catalog';
import { Research } from './pages/Research';
import { CartPage } from './pages/CartPage';
import { Contact } from './pages/Contact';
import { Documentation } from './pages/Documentation';
import { DocumentDetail } from './pages/DocumentDetail';
import { AdminList } from './pages/admin/AdminList';
import { AdminEdit } from './pages/admin/AdminEdit';
import { AdminGate } from './pages/admin/AdminGate';
import { AdminDashboard } from './pages/admin/AdminDashboard';
import { AdminInventory } from './pages/admin/AdminInventory';
import { AdminImport } from './pages/admin/AdminImport';
import { AdminInquiries } from './pages/admin/AdminInquiries';
import { AdminOrders } from './pages/admin/AdminOrders';
import { AdminOrderDetail } from './pages/admin/AdminOrderDetail';
import { AdminStockHistory } from './pages/admin/AdminStockHistory';
import { AdminAuditLog } from './pages/admin/AdminAuditLog';
import { AdminCustomers } from './pages/admin/AdminCustomers';
import { AdminCustomerDetail } from './pages/admin/AdminCustomerDetail';
import { AdminSystemHealth } from './pages/admin/AdminSystemHealth';
import { AdminReports } from './pages/admin/AdminReports';

export default function App() {
  return (
    <BrowserRouter>
      <GlobalSurface>
        <GlobalHeader />
        <AnimatedPortalShell>
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
            <Route path="/documentation" element={<Documentation />} />
            <Route path="/documentation/:id" element={<DocumentDetail />} />
            <Route path="/admin" element={<AdminGate><AdminDashboard /></AdminGate>} />
            <Route path="/admin/inventory" element={<AdminGate><AdminInventory /></AdminGate>} />
            <Route path="/admin/import" element={<AdminGate><AdminImport /></AdminGate>} />
            <Route path="/admin/inquiries" element={<AdminGate><AdminInquiries /></AdminGate>} />
            <Route path="/admin/orders" element={<AdminGate><AdminOrders /></AdminGate>} />
            <Route path="/admin/orders/:id" element={<AdminGate><AdminOrderDetail /></AdminGate>} />
            <Route path="/admin/stock-history" element={<AdminGate><AdminStockHistory /></AdminGate>} />
            <Route path="/admin/customers" element={<AdminGate><AdminCustomers /></AdminGate>} />
            <Route path="/admin/customers/:id" element={<AdminGate><AdminCustomerDetail /></AdminGate>} />
            <Route path="/admin/audit-log" element={<AdminGate><AdminAuditLog /></AdminGate>} />
            <Route path="/admin/system-health" element={<AdminGate><AdminSystemHealth /></AdminGate>} />
            <Route path="/admin/reports" element={<AdminGate><AdminReports /></AdminGate>} />
            <Route path="/admin/products" element={<AdminGate><AdminList /></AdminGate>} />
            <Route path="/admin/new" element={<AdminGate><AdminEdit /></AdminGate>} />
            <Route path="/admin/:id/edit" element={<AdminGate><AdminEdit /></AdminGate>} />
          </Routes>
        </AnimatedPortalShell>
        <GlobalFooter />
      </GlobalSurface>
      <BottomNav />
    </BrowserRouter>
  );
}
