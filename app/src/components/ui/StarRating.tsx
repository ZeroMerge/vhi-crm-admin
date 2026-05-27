import { Star } from 'lucide-react';

interface StarRatingProps {
  value: number;
  onChange?: (value: number) => void;
  readOnly?: boolean;
  size?: number;
}

export function StarRating({ value, onChange, readOnly = false, size = 18 }: StarRatingProps) {
  return (
    <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = star <= value;
        return (
          <button
            key={star}
            onClick={() => !readOnly && onChange?.(star)}
            disabled={readOnly}
            style={{
              background: 'none',
              border: 'none',
              padding: 2,
              cursor: readOnly ? 'default' : 'pointer',
              color: filled ? 'var(--color-primary)' : 'var(--color-border)',
              transition: 'color 0.15s ease',
              lineHeight: 1,
            }}
            aria-label={`${star} star${star !== 1 ? 's' : ''}`}
          >
            <Star
              size={size}
              fill={filled ? 'var(--color-primary)' : 'none'}
              strokeWidth={1.5}
            />
          </button>
        );
      })}
    </div>
  );
}
