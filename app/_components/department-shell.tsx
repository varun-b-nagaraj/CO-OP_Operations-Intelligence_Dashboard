'use client';

import {
  BarChart3,
  Boxes,
  Calendar,
  ClipboardList,
  FileClock,
  FileSpreadsheet,
  FileText,
  FolderKanban,
  Handshake,
  LayoutDashboard,
  LineChart,
  Megaphone,
  Menu,
  Package,
  ScanBarcode,
  Settings,
  ShoppingCart,
  Users,
  UserCog
} from 'lucide-react';
import { ReactNode, useEffect, useMemo, useState } from 'react';

export interface DepartmentShellNavItem {
  id: string;
  label: string;
  badge?: number | string;
  icon?: DepartmentShellNavIcon;
}

export type DepartmentShellNavIcon =
  | 'dashboard'
  | 'schedule'
  | 'employees'
  | 'meeting'
  | 'shift'
  | 'requests'
  | 'audit'
  | 'daily_log'
  | 'history'
  | 'analysis'
  | 'forecast'
  | 'menu'
  | 'orders'
  | 'prompts'
  | 'products'
  | 'vendors'
  | 'designs'
  | 'wishlist'
  | 'settings'
  | 'calendar'
  | 'events'
  | 'contacts'
  | 'coordinators'
  | 'reports'
  | 'catalog'
  | 'sessions'
  | 'count_view'
  | 'finalize';

interface DepartmentShellProps {
  title: string;
  subtitle: string;
  navAriaLabel: string;
  navItems: DepartmentShellNavItem[];
  activeNavId: string;
  onNavSelect: (id: string) => void;
  children: ReactNode;
}

function resolveNavIcon(icon: DepartmentShellNavIcon | undefined) {
  switch (icon) {
    case 'schedule':
      return Calendar;
    case 'employees':
      return Users;
    case 'meeting':
      return Handshake;
    case 'shift':
      return ClipboardList;
    case 'requests':
      return FileText;
    case 'audit':
      return FileClock;
    case 'daily_log':
      return ClipboardList;
    case 'history':
      return FileClock;
    case 'analysis':
      return BarChart3;
    case 'forecast':
      return LineChart;
    case 'menu':
      return Menu;
    case 'orders':
      return ShoppingCart;
    case 'prompts':
      return Megaphone;
    case 'products':
      return Package;
    case 'vendors':
      return Handshake;
    case 'designs':
      return FolderKanban;
    case 'wishlist':
      return ClipboardList;
    case 'settings':
      return Settings;
    case 'calendar':
      return Calendar;
    case 'events':
      return Megaphone;
    case 'contacts':
      return Users;
    case 'coordinators':
      return UserCog;
    case 'reports':
      return FileSpreadsheet;
    case 'catalog':
      return Boxes;
    case 'sessions':
      return LayoutDashboard;
    case 'count_view':
      return ScanBarcode;
    case 'finalize':
      return FileText;
    case 'dashboard':
    default:
      return LayoutDashboard;
  }
}

export function DepartmentShell({
  title,
  subtitle,
  navAriaLabel,
  navItems,
  activeNavId,
  onNavSelect,
  children
}: DepartmentShellProps) {
  const [isDesktop, setIsDesktop] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const isCollapsed = isDesktop ? !isHovered : false;
  const activeItem = useMemo(
    () => navItems.find((item) => item.id === activeNavId) ?? null,
    [activeNavId, navItems]
  );

  useEffect(() => {
    const media = window.matchMedia('(min-width: 768px)');
    const apply = () => setIsDesktop(media.matches);
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);

  return (
    <main className="min-h-screen w-full overflow-x-hidden text-neutral-900">
      <div className="relative min-h-screen w-full overflow-hidden border border-neutral-300 bg-white">
        <aside
          className={`z-30 w-full border-b border-neutral-300 bg-white transition-[width,box-shadow] duration-300 ease-out md:absolute md:inset-y-0 md:left-0 md:w-16 md:border-b-0 md:border-r ${
            isCollapsed ? 'md:shadow-none' : 'md:w-60 md:shadow-[10px_0_28px_rgba(0,0,0,0.18)]'
          }`}
          onFocusCapture={() => setIsHovered(true)}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          <div className={`border-b border-neutral-300 ${isCollapsed ? 'px-2 py-3' : 'px-4 py-4'}`}>
            <div className={`flex items-start ${isCollapsed ? 'justify-center' : 'justify-between gap-3'}`}>
              {!isCollapsed ? (
                <div className="min-w-0">
                  <h1 className="truncate text-lg font-semibold">{title}</h1>
                  <p className="mt-1 text-xs text-neutral-600">{subtitle}</p>
                </div>
              ) : (
                <span className="sr-only">{title}</span>
              )}
            </div>
          </div>
          <nav aria-label={navAriaLabel} className="p-0" role="tablist">
            {navItems.map((item) => {
              const isActive = activeNavId === item.id;
              const Icon = resolveNavIcon(item.icon);
              return (
                <button
                  key={item.id}
                  aria-selected={isActive}
                  className={`ui-click flex min-h-[44px] w-full items-center border-b border-neutral-300 py-3 text-left text-sm font-medium ${
                    isCollapsed ? 'justify-center px-2' : 'justify-between px-4'
                  } ${
                    isActive ? 'bg-brand-maroon text-white' : 'bg-white text-neutral-800 hover:bg-neutral-50'
                  }`}
                  onClick={() => onNavSelect(item.id)}
                  role="tab"
                  title={item.label}
                  type="button"
                >
                  <span className={`flex min-w-0 items-center ${isCollapsed ? 'justify-center' : 'gap-2'}`}>
                    <Icon className="h-4 w-4 shrink-0" />
                    {!isCollapsed ? <span className="truncate">{item.label}</span> : null}
                  </span>
                  {!isCollapsed && item.badge ? <span className="text-xs tabular-nums">{item.badge}</span> : null}
                </button>
              );
            })}
          </nav>
        </aside>

        <section className="ui-fade-in min-w-0 w-full flex-1 overflow-x-hidden md:pl-16">
          <header className="border-b border-neutral-300 bg-white px-4 py-3">
            <h2 className="text-sm font-semibold tracking-wide text-neutral-800 md:text-base">
              {activeItem?.label ?? 'Overview'}
            </h2>
          </header>
          {children}
        </section>
      </div>
    </main>
  );
}
