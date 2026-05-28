import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { GlobalSurface } from './layout/GlobalSurface';
import { GlobalHeader } from './layout/GlobalHeader';
import { AnimatedPortalShell } from './layout/AnimatedPortalShell';
import { GlobalFooter } from './layout/GlobalFooter';
import { BottomNav } from './layout/BottomNav';
import { Landing } from './pages/Landing';
import { ResearchSupplies } from './pages/ResearchSupplies';
import { LaboratoryEquipment } from './pages/LaboratoryEquipment';
import { ProductPage } from './pages/ProductPage';
import { Catalog } from './pages/Catalog';
import { CartPage } from './pages/CartPage';
import { Contact } from './pages/Contact';
import { Documentation } from './pages/Documentation';
import { DocumentDetail } from './pages/DocumentDetail';
import { AdminList } from './pages/admin/AdminList';
import { AdminEdit } from './pages/admin/AdminEdit';
import { AdminGate } from './pages/admin/AdminGate';

export default function App() {
  return (
    <BrowserRouter>
      <GlobalSurface>
        <GlobalHeader />
        <AnimatedPortalShell>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/research-supplies" element={<ResearchSupplies />} />
            <Route path="/laboratory-equipment" element={<LaboratoryEquipment />} />
            <Route path="/catalog" element={<Catalog />} />
            <Route path="/product/:id" element={<ProductPage />} />
            <Route path="/cart" element={<CartPage />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="/documentation" element={<Documentation />} />
            <Route path="/documentation/:id" element={<DocumentDetail />} />
            <Route
              path="/admin"
              element={
                <AdminGate>
                  <AdminList />
                </AdminGate>
              }
            />
            <Route
              path="/admin/new"
              element={
                <AdminGate>
                  <AdminEdit />
                </AdminGate>
              }
            />
            <Route
              path="/admin/:id/edit"
              element={
                <AdminGate>
                  <AdminEdit />
                </AdminGate>
              }
            />
          </Routes>
        </AnimatedPortalShell>
        <GlobalFooter />
      </GlobalSurface>
      <BottomNav />
    </BrowserRouter>
  );
}
