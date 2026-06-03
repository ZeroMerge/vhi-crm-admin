import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
  icon?: React.ReactNode;
  count?: number;
}

interface CustomSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
  width?: number | string;
}

export function CustomSelect({
  value,
  onChange,
  options,
  placeholder = 'Select...',
  className = '',
  style,
  width = 160
}: CustomSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((opt) => opt.value === value);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div
      ref={containerRef}
      className={`custom-select-container ${className}`}
      style={{ position: 'relative', width, ...style }}
    >
      {/* Trigger */}
      <button
        type="button"
        className="custom-select-trigger"
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          background: '#ffffff',
          border: isOpen ? '1px solid var(--color-primary)' : '1px solid var(--color-border)',
          borderRadius: 'var(--radius-input)',
          fontSize: '14px',
          color: selectedOption ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
          cursor: 'pointer',
          outline: 'none',
          boxShadow: isOpen ? '0 0 0 2px var(--color-primary-light)' : 'none',
          transition: 'all 0.2s',
          minHeight: '36px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
          {selectedOption?.icon ? (
            <span style={{ color: 'var(--color-text-secondary)', display: 'flex' }}>
              {selectedOption.icon}
            </span>
          ) : options.some(o => o.icon) ? (
             <span style={{ width: 16 }} />
          ) : null}
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {selectedOption ? selectedOption.label : placeholder}
          </span>
        </div>
        <ChevronDown size={16} style={{ color: 'var(--color-text-muted)', flexShrink: 0, transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          className="custom-select-menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            width: 'max-content',
            minWidth: '100%',
            background: 'rgba(255, 255, 255, 0.95)',
            backdropFilter: 'blur(8px)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-card)',
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
            zIndex: 1000,
            padding: '6px',
            animation: 'dropdownFadeIn 0.15s ease-out',
            maxHeight: '300px',
            overflowY: 'auto'
          }}
        >
          <style>
            {`
              @keyframes dropdownFadeIn {
                from { opacity: 0; transform: translateY(-4px) scale(0.98); }
                to { opacity: 1; transform: translateY(0) scale(1); }
              }
              .custom-select-option {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 8px 10px;
                border-radius: 6px;
                cursor: pointer;
                transition: all 0.1s;
                font-size: 14px;
                color: var(--color-text-primary);
              }
              .custom-select-option:hover {
                background: #f1f5f9;
              }
              .custom-select-option.selected {
                background: var(--color-primary-light);
                color: var(--color-primary);
                font-weight: 500;
              }
            `}
          </style>

          {options.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <div
                key={opt.value}
                className={`custom-select-option ${isSelected ? 'selected' : ''}`}
                onClick={() => {
                  onChange(opt.value);
                  setIsOpen(false);
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {opt.icon ? (
                    <span style={{ display: 'flex', color: isSelected ? 'inherit' : 'var(--color-text-secondary)' }}>
                      {opt.icon}
                    </span>
                  ) : options.some(o => o.icon) ? (
                    <span style={{ width: 16 }} /> /* Alignment spacer if mixed icons */
                  ) : null}
                  <span>{opt.label}</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {isSelected && <Check size={16} strokeWidth={2.5} />}
                  {opt.count !== undefined && (
                    <span style={{ fontSize: 12, color: isSelected ? 'inherit' : 'var(--color-text-muted)' }}>
                      {opt.count}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
