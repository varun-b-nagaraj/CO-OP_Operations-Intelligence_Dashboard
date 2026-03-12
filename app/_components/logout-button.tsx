'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { resetCurrentUserCache } from '@/lib/permissions';

interface LogoutButtonProps {
  className?: string;
  label?: string;
}

export function LogoutButton({ className, label = 'Log out' }: LogoutButtonProps) {
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
      className={className ?? 'min-h-[34px] border border-neutral-300 bg-white px-3 text-xs hover:bg-neutral-100'}
      disabled={loading}
      onClick={onLogout}
      type="button"
    >
      {loading ? 'Signing out...' : label}
    </button>
  );
}
