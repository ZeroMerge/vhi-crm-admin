export function generateOrderId(source: 'admin' | 'client'): string {
  const digits  = Math.floor(1000 + Math.random() * 9000);
  const suffix  = Math.floor(10   + Math.random() * 90);
  const letters = String.fromCharCode(97 + Math.floor(Math.random() * 26))
                + String.fromCharCode(97 + Math.floor(Math.random() * 26));
  const prefix  = source === 'client' ? 'CL' : '#';
  return `${prefix}${digits}-${suffix}-${letters}`;
}
