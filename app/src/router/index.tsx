import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import AdminLogin from '@/pages/auth/AdminLogin';
import Overview from '@/pages/admin/Overview';
import Customers from '@/pages/admin/Customers';
import CustomerDetail from '@/pages/admin/Customers/CustomerDetail';
import Shipments from '@/pages/admin/Shipments';
import ShipmentDetail from '@/pages/admin/Shipments/ShipmentDetail';
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

function AdminRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return isAuthenticated ? <>{children}</> : <Navigate to="/admin/login" replace />;
}

export function AppRouter() {
  return (
    <Routes>
      <Route path="/admin/login" element={<AdminLogin />} />
      <Route path="/admin" element={<AdminRoute><Overview /></AdminRoute>} />
      <Route path="/admin/customers" element={<AdminRoute><Customers /></AdminRoute>} />
      <Route path="/admin/customers/:id" element={<AdminRoute><CustomerDetail /></AdminRoute>} />
      <Route path="/admin/shipments" element={<AdminRoute><Shipments /></AdminRoute>} />
      <Route path="/admin/shipments/:id" element={<AdminRoute><ShipmentDetail /></AdminRoute>} />
      <Route path="/admin/tracking" element={<AdminRoute><Tracking /></AdminRoute>} />
      <Route path="/admin/invoices" element={<AdminRoute><Invoices /></AdminRoute>} />
      <Route path="/admin/invoices/:id" element={<AdminRoute><InvoiceDetail /></AdminRoute>} />
      <Route path="/admin/communications" element={<AdminRoute><Communications /></AdminRoute>} />
      <Route path="/admin/newsletter" element={<AdminRoute><Newsletter /></AdminRoute>} />
      <Route path="/admin/newsletter/compose" element={<AdminRoute><ComposeNewsletter /></AdminRoute>} />
      <Route path="/admin/audience-segmentation" element={<AdminRoute><AudienceSegmentation /></AdminRoute>} />
      <Route path="/admin/reports" element={<AdminRoute><Reports /></AdminRoute>} />
      <Route path="/admin/feedback" element={<AdminRoute><Feedback /></AdminRoute>} />
      <Route path="/admin/settings" element={<AdminRoute><Settings /></AdminRoute>} />
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  );
}
