import type { ReactNode } from 'react';
import { AdminSidebar } from './AdminSidebar';
import { Topbar } from './Topbar';
import { useUIStore } from '@/store/uiStore';

interface PageWrapperProps {
  children: ReactNode;
  title?: string;
}

export function PageWrapper({ children, title }: PageWrapperProps) {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);

  return (
    <div className="page-wrapper">
      <AdminSidebar />
      <div 
        className={`sidebar-overlay ${sidebarOpen ? 'open' : ''}`} 
        onClick={() => setSidebarOpen(false)} 
      />
      <div className="page-main">
        <Topbar />
        <main className="page-content">
          {title && (
            <h1 className="page-title">
              {title}
            </h1>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
