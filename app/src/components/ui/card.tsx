import * as React from 'react';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  elevated?: boolean;
}

export function Card({ className, elevated = false, ...props }: CardProps) {
  return (
    <div
      className={`card ${elevated ? 'card-elevated' : ''} ${className || ''}`}
      {...props}
    />
  );
}
