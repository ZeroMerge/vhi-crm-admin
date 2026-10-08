import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { formatDateTime } from '@/utils/formatDate';
import { notificationLink } from '@/utils/notificationLinks';
import type { AppNotification } from '@/services/notification.service';
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotificationList,
  useUnreadNotificationCount,
} from '@/hooks/useNotifications';

const visuallyHidden: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

const linkButton: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--color-primary)',
  fontSize: 'var(--font-size-xs)',
  cursor: 'pointer',
  padding: 0,
};

// Disclosure pattern: the bell toggles a panel of buttons. Escape closes it and returns focus to the bell.
// Titles and bodies are rendered as plain text (they can contain customer-written message excerpts).
export function NotificationBell() {
  const navigate = useNavigate();
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLButtonElement>(null);

  const loadedCount = useUnreadNotificationCount().data?.count;
  const unreadCount = loadedCount ?? 0;
  const list = useNotificationList(open);
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();
  const notifications = list.data?.pages.flatMap((p) => p.data) ?? [];

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        bellRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const handleOpen = (n: AppNotification) => {
    if (!n.readAt) markRead.mutate(n.id);
    const link = notificationLink(n);
    setOpen(false);
    if (link) navigate(link);
  };

  const badge = unreadCount > 99 ? '99+' : String(unreadCount);

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        ref={bellRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        // Until the count has loaded, do not announce a possibly wrong "0 unread".
        aria-label={
          loadedCount === undefined
            ? 'Notifications'
            : unreadCount === 1
              ? '1 unread notification'
              : `${unreadCount} unread notifications`
        }
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={panelId}
        style={{
          width: 40,
          height: 40,
          borderRadius: '50%',
          border: '1.5px solid var(--color-border)',
          background: 'transparent',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          color: 'var(--color-text-secondary)',
          position: 'relative',
          transition: 'all 0.15s ease',
        }}
      >
        <Bell size={20} aria-hidden="true" />
        {unreadCount > 0 && (
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: -2,
              right: -2,
              minWidth: 18,
              height: 18,
              padding: '0 4px',
              borderRadius: 9,
              background: 'var(--color-accent-pink)',
              color: 'white',
              fontSize: 10,
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '2px solid var(--color-page-bg)',
            }}
          >
            {badge}
          </span>
        )}
      </button>

      {open && (
        <div id={panelId} role="region" aria-label="Notifications" className="topbar-notifications-dropdown">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 16px',
              borderBottom: '1.5px solid var(--color-border)',
            }}
          >
            <h2 style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)', margin: 0 }}>Notifications</h2>
            {unreadCount > 0 && (
              <button type="button" onClick={() => markAllRead.mutate()} disabled={markAllRead.isPending} style={linkButton}>
                Mark all as read
              </button>
            )}
          </div>

          <div style={{ maxHeight: 400, overflowY: 'auto' }}>
            {list.isPending ? (
              <div role="status" style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>
                Loading notifications…
              </div>
            ) : list.isError ? (
              <div role="alert" style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>
                Couldn't load notifications.{' '}
                <button type="button" onClick={() => list.refetch()} style={linkButton}>
                  Try again
                </button>
              </div>
            ) : notifications.length === 0 ? (
              <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>
                You're all caught up.
              </div>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {notifications.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => handleOpen(n)}
                      style={{
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        padding: '12px 16px',
                        border: 'none',
                        borderBottom: '1.5px solid var(--color-border)',
                        cursor: 'pointer',
                        background: n.readAt ? 'var(--color-page-bg)' : 'var(--color-primary-light)',
                        borderLeft: n.readAt ? '3px solid transparent' : '3px solid var(--color-primary)',
                        font: 'inherit',
                      }}
                    >
                      {!n.readAt && <span style={visuallyHidden}>Unread: </span>}
                      <span style={{ display: 'block', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-primary)', marginBottom: 4, fontWeight: n.readAt ? 400 : 600 }}>
                        {n.title}
                      </span>
                      {n.body && (
                        <span style={{ display: 'block', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', marginBottom: 4, overflowWrap: 'anywhere' }}>
                          {n.body}
                        </span>
                      )}
                      <span style={{ display: 'block', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                        {formatDateTime(n.createdAt)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {list.hasNextPage && (
              <div style={{ padding: '8px 16px', textAlign: 'center' }}>
                <button type="button" onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage} style={linkButton}>
                  {list.isFetchingNextPage ? 'Loading…' : 'Load more'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
