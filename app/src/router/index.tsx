import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { hasModuleAccess, getDefaultRouteForRole } from '@/utils/rolePermissions';
import AdminLogin from '@/pages/auth/AdminLogin';
import Overview from '@/pages/admin/Overview';
import Customers from '@/pages/admin/Customers';
import CustomerDetail from '@/pages/admin/Customers/CustomerDetail';
import Shipments from '@/pages/admin/Shipments';
import ShipmentDetail from '@/pages/admin/Shipments/ShipmentDetail';
import ComposeShipment from '@/pages/admin/Shipments/Compose';
import Tracking from '@/pages/admin/Tracking';
import Invoices from '@/pages/admin/Invoices';
import InvoiceDetail from '@/pages/admin/Invoices/InvoiceDetail';
import Communications from '@/pages/admin/Communications';
import Newsletter from '@/pages/admin/Newsletter';
import ComposeNewsletter from '@/pages/admin/Newsletter/Compose';
import AudienceSegmentation from '@/pages/admin/AudienceSegmentation';
import Reports from '@/pages/admin/Reports';
import Settings from '@/pages/admin/Settings';
import Feedback from '@/pages/admin/Feedback';

function AdminRoute({ children, module }: { children: React.ReactNode, module: string }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const admin = useAuthStore((s) => s.admin);

  if (!isAuthenticated) return <Navigate to="/admin/login" replace />;

  if (module && admin?.activeRole && !hasModuleAccess(admin.activeRole, module)) {
    const fallbackPath = getDefaultRouteForRole(admin.activeRole);
    return <Navigate to={fallbackPath} replace />;
  }

  return <>{children}</>;
}

export function AppRouter() {
  return (
    <Routes>
      <Route path="/admin/login" element={<AdminLogin />} />
      <Route path="/admin" element={<AdminRoute module="overview"><Overview /></AdminRoute>} />
      <Route path="/admin/customers" element={<AdminRoute module="customers"><Customers /></AdminRoute>} />
      <Route path="/admin/customers/:id" element={<AdminRoute module="customers"><CustomerDetail /></AdminRoute>} />
      <Route path="/admin/shipments" element={<AdminRoute module="shipments"><Shipments /></AdminRoute>} />
      <Route path="/admin/shipments/new" element={<AdminRoute module="shipments"><ComposeShipment /></AdminRoute>} />
      <Route path="/admin/shipments/:id" element={<AdminRoute module="shipments"><ShipmentDetail /></AdminRoute>} />
      <Route path="/admin/tracking" element={<AdminRoute module="tracking"><Tracking /></AdminRoute>} />
      <Route path="/admin/invoices" element={<AdminRoute module="invoices"><Invoices /></AdminRoute>} />
      <Route path="/admin/invoices/:id" element={<AdminRoute module="invoices"><InvoiceDetail /></AdminRoute>} />
      <Route path="/admin/communications" element={<AdminRoute module="communications"><Communications /></AdminRoute>} />
      <Route path="/admin/newsletter" element={<AdminRoute module="newsletter"><Newsletter /></AdminRoute>} />
      <Route path="/admin/newsletter/compose" element={<AdminRoute module="newsletter"><ComposeNewsletter /></AdminRoute>} />
      <Route path="/admin/audience-segmentation" element={<AdminRoute module="audience_segmentation"><AudienceSegmentation /></AdminRoute>} />
      <Route path="/admin/reports" element={<AdminRoute module="reports"><Reports /></AdminRoute>} />
      <Route path="/admin/feedback" element={<AdminRoute module="reports"><Feedback /></AdminRoute>} />
      <Route path="/admin/settings" element={<AdminRoute module="settings"><Settings /></AdminRoute>} />
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  );
}
