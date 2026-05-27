import { useEffect, useCallback } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: string;
}

export function Modal({ isOpen, onClose, title, children, footer, maxWidth = '560px' }: ModalProps) {
  const handleEscape = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [isOpen, handleEscape]);

  if (!isOpen) return null;

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ animation: 'fadeIn 0.2s ease-out' }}
    >
      <div
        className="modal-content"
        style={{ maxWidth, animation: 'scaleIn 0.2s ease-out', position: 'relative' }}
      >
        <button
          onClick={onClose}
          className="modal-close"
          aria-label="Close modal"
          style={{ position: 'absolute', top: 16, right: 16 }}
        >
          <X size={20} />
        </button>
        {title && (
          <h2 style={{ fontSize: '1.75rem', fontWeight: 400, color: 'var(--color-text-primary)', marginBottom: 8, paddingRight: 48 }}>
            {title}
          </h2>
        )}
        {children}
        {footer && (
          <div style={{ marginTop: 32, display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
