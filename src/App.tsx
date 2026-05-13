import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { GlobalSurface } from './layout/GlobalSurface';
import { GlobalHeader } from './layout/GlobalHeader';
import { AnimatedPortalShell } from './layout/AnimatedPortalShell';
import { BottomNav } from './layout/BottomNav';
import { Landing } from './pages/Landing';
import { ResearchSupplies } from './pages/ResearchSupplies';
import { LaboratoryEquipment } from './pages/LaboratoryEquipment';
import { ProductPage } from './pages/ProductPage';
import { CartPage } from './pages/CartPage';
import { Contact } from './pages/Contact';
import { AdminList } from './pages/admin/AdminList';
import { AdminEdit } from './pages/admin/AdminEdit';

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
            <Route path="/product/:id" element={<ProductPage />} />
            <Route path="/cart" element={<CartPage />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="/admin" element={<AdminList />} />
            <Route path="/admin/new" element={<AdminEdit />} />
            <Route path="/admin/:id/edit" element={<AdminEdit />} />
          </Routes>
        </AnimatedPortalShell>
      </GlobalSurface>
      <BottomNav />
    </BrowserRouter>
  );
}
