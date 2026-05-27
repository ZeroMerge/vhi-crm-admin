import React from 'react';

interface AvatarProps {
  name: string;
  size?: 'sm' | 'md' | 'lg';
  imageUrl?: string;
}

const avatarColors = [
  '#7B2D8B', // primary purple
  '#E91E8C', // accent pink
  '#1565C0', // blue
  '#2E7D32', // green
  '#E65100', // orange
  '#4527A0', // deep purple
  '#00838F', // teal
  '#AD1457', // pink
];

// Hash function: sum of char codes % avatarColors.length
function getAvatarColor(name: string): string {
  if (!name) return avatarColors[0];
  let sum = 0;
  for (let i = 0; i < name.length; i++) {
    sum += name.charCodeAt(i);
  }
  return avatarColors[sum % avatarColors.length];
}

function getInitials(name: string): string {
  if (!name) return '??';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '??';
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

export const Avatar: React.FC<AvatarProps> = ({ name, size = 'md', imageUrl }) => {
  const initials = getInitials(name);
  const bgColor = getAvatarColor(name);

  let sizePx = 36;
  let fontSize = 13;
  
  if (size === 'sm') {
    sizePx = 28;
    fontSize = 11;
  } else if (size === 'lg') {
    sizePx = 48;
    fontSize = 16;
  }

  const style: React.CSSProperties = {
    width: sizePx,
    height: sizePx,
    borderRadius: '50%',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 600,
    color: 'white',
    fontFamily: 'var(--font-family)',
    flexShrink: 0,
    fontSize,
    backgroundColor: bgColor,
    userSelect: 'none',
  };

  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={name}
        style={{
          width: sizePx,
          height: sizePx,
          borderRadius: '50%',
          objectFit: 'cover',
          flexShrink: 0,
        }}
      />
    );
  }

  return (
    <div className={`avatar ${size}`} style={style}>
      {initials}
    </div>
  );
};
