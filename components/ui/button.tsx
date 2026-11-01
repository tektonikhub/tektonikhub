import type { ButtonHTMLAttributes } from 'react';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost' };
export function Button({ variant = 'secondary', className = '', type = 'button', ...props }: Props) {
  return <button type={type} className={`btn btn-${variant} ${className}`} {...props} />;
}
