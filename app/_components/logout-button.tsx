'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { LogOut } from 'lucide-react';

import { resetCurrentUserCache } from '@/lib/permissions';

interface LogoutButtonProps {
  className?: string;
  label?: string;
  iconOnly?: boolean;
}

export function LogoutButton({ className, label = 'Log out', iconOnly = true }: LogoutButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const onLogout = async () => {
    if (loading) return;
    setLoading(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      resetCurrentUserCache();
      router.replace('/login');
      router.refresh();
      setLoading(false);
    }
  };

  return (
    <button
      aria-label={label}
      className={className ?? 'min-h-[34px] border border-neutral-300 bg-white px-3 text-xs hover:bg-neutral-100'}
      disabled={loading}
      onClick={onLogout}
      title={label}
      type="button"
    >
      {loading ? (
        '...'
      ) : iconOnly ? (
        <span className="inline-flex items-center justify-center">
          <LogOut className="h-4 w-4" />
        </span>
      ) : (
        <span className="inline-flex items-center gap-2">
          <LogOut className="h-4 w-4" />
          <span>{label}</span>
        </span>
      )}
    </button>
  );
}
