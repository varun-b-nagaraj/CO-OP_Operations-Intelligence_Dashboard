'use client';

import {
  Archive,
  BarChart3,
  BellDot,
  BookCheck,
  Boxes,
  Calendar,
  CalendarClock,
  ClipboardCheck,
  ClipboardList,
  Contact,
  FileScan,
  FileClock,
  FileSpreadsheet,
  FileText,
  FolderKanban,
  HandCoins,
  Handshake,
  HeartHandshake,
  History,
  Home,
  ListChecks,
  LayoutDashboard,
  LineChart,
  Megaphone,
  Menu,
  X,
  PackageCheck,
  Package,
  ReceiptText,
  ScanSearch,
  Settings2,
  ShieldCheck,
  ScanBarcode,
  Settings,
  ShoppingCart,
  TimerReset,
  UserRoundCog,
  UsersRound,
  Users,
  UserCog
} from 'lucide-react';
import Link from 'next/link';
import { ReactNode, useEffect, useState } from 'react';

import { LogoutButton } from '@/app/_components/logout-button';

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
  departmentIcon?: DepartmentShellNavIcon;
  contentHeading?: string;
  navAriaLabel: string;
  navItems: DepartmentShellNavItem[];
  activeNavId: string;
  onNavSelect: (id: string) => void;
  children: ReactNode;
}

function resolveNavIcon(icon: DepartmentShellNavIcon | undefined) {
  switch (icon) {
    case 'schedule':
      return CalendarClock;
    case 'employees':
      return UsersRound;
    case 'meeting':
      return HeartHandshake;
    case 'shift':
      return ClipboardCheck;
    case 'requests':
      return ReceiptText;
    case 'audit':
      return ShieldCheck;
    case 'daily_log':
      return BookCheck;
    case 'history':
      return History;
    case 'analysis':
      return BarChart3;
    case 'forecast':
      return LineChart;
    case 'menu':
      return Menu;
    case 'orders':
      return ShoppingCart;
    case 'prompts':
      return BellDot;
    case 'products':
      return Package;
    case 'vendors':
      return HandCoins;
    case 'designs':
      return FolderKanban;
    case 'wishlist':
      return Archive;
    case 'settings':
      return Settings2;
    case 'calendar':
      return Calendar;
    case 'events':
      return Megaphone;
    case 'contacts':
      return Contact;
    case 'coordinators':
      return UserRoundCog;
    case 'reports':
      return FileSpreadsheet;
    case 'catalog':
      return Boxes;
    case 'sessions':
      return TimerReset;
    case 'count_view':
      return ScanSearch;
    case 'finalize':
      return PackageCheck;
    case 'dashboard':
    default:
      return LayoutDashboard;
  }
}

export function DepartmentShell({
  title,
  subtitle,
  departmentIcon = 'dashboard',
  contentHeading,
  navAriaLabel,
  navItems,
  activeNavId,
  onNavSelect,
  children
}: DepartmentShellProps) {
  const [isDesktop, setIsDesktop] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const isCollapsed = isDesktop ? !isHovered : false;
  const isMobile = !isDesktop;
  const DepartmentIcon = resolveNavIcon(departmentIcon);

  useEffect(() => {
    const media = window.matchMedia('(min-width: 768px)');
    const apply = () => setIsDesktop(media.matches);
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    if (!isDesktop) return;
    setIsMobileNavOpen(false);
  }, [isDesktop]);

  useEffect(() => {
    if (!isMobile) return;
    document.body.style.overflow = isMobileNavOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [isMobile, isMobileNavOpen]);

  useEffect(() => {
    if (!isMobileNavOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMobileNavOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isMobileNavOpen]);

  return (
    <main className="min-h-screen w-full text-neutral-900">
      <div className="relative min-h-screen w-full border border-neutral-300 bg-white">
        {isMobileNavOpen ? (
          <button
            aria-label="Close menu overlay"
            className="fixed inset-0 z-20 bg-black/35 md:hidden"
            onClick={() => setIsMobileNavOpen(false)}
            type="button"
          />
        ) : null}
        <aside
          className={`z-30 border-neutral-300 bg-white transition-[transform,width,box-shadow] duration-300 ease-out md:absolute md:inset-y-0 md:left-0 md:w-16 md:border-b-0 md:border-r ${
            isMobile
              ? `fixed inset-y-0 left-0 w-[86vw] max-w-[320px] border-r ${isMobileNavOpen ? 'translate-x-0 shadow-[10px_0_28px_rgba(0,0,0,0.18)]' : '-translate-x-full'}`
              : `w-full border-b ${isCollapsed ? 'md:shadow-none' : 'md:w-72 md:shadow-[10px_0_28px_rgba(0,0,0,0.18)]'}`
          }`}
          onFocusCapture={() => setIsHovered(true)}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          <div className="border-b border-neutral-300 py-3 md:min-h-[74px]">
            <div className="grid h-12 grid-cols-[64px_minmax(0,1fr)] items-center">
              <span className="flex items-center justify-center">
                <span className="inline-flex h-9 w-9 items-center justify-center border border-neutral-300 bg-white">
                  <DepartmentIcon className="h-4 w-4" />
                </span>
              </span>
              <div
                className={`pointer-events-none min-w-0 overflow-hidden transition-all duration-300 ease-out ${
                  isCollapsed ? 'max-w-0 opacity-0' : 'max-w-[220px] opacity-100'
                }`}
              >
                <h1 className="truncate text-base font-semibold">{title}</h1>
                <p className="mt-0.5 max-h-[2.4em] overflow-hidden whitespace-normal break-words text-[11px] leading-tight text-neutral-600">
                  {subtitle}
                </p>
              </div>
            </div>
          </div>
          <nav aria-label={navAriaLabel} className="p-0" id="department-mobile-nav" role="tablist">
            {navItems.map((item) => {
              const isActive = activeNavId === item.id;
              const Icon = resolveNavIcon(item.icon);
              return (
                <button
                  key={item.id}
                  aria-selected={isActive}
                  className={`ui-click relative flex min-h-[44px] w-full items-center border-b border-neutral-300 px-3 py-3 text-left text-sm font-medium ${
                    isActive ? 'bg-brand-maroon text-white' : 'bg-white text-neutral-800 hover:bg-neutral-50'
                  }`}
                  onClick={() => {
                    onNavSelect(item.id);
                    if (isMobile) setIsMobileNavOpen(false);
                  }}
                  role="tab"
                  title={item.label}
                  type="button"
                >
                  <span className="absolute left-8 top-1/2 inline-flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center">
                    <Icon className="h-4 w-4 shrink-0" />
                  </span>
                  <span
                    className={`pointer-events-none absolute left-14 top-1/2 -translate-y-1/2 truncate transition-all duration-200 ease-out ${
                      isCollapsed ? 'max-w-0 opacity-0' : 'max-w-[190px] opacity-100'
                    }`}
                  >
                    {item.label}
                  </span>
                  {item.badge ? (
                    <span
                      className={`pointer-events-none absolute right-3 text-xs tabular-nums transition-all duration-200 ease-out ${
                        isCollapsed ? 'max-w-0 opacity-0' : 'max-w-[56px] opacity-100'
                      }`}
                    >
                      {item.badge}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </nav>
          <div className="border-t border-neutral-300 p-2">
            <LogoutButton
              className="ui-click min-h-[40px] w-full border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-800 hover:bg-neutral-50 flex items-center justify-center"
              label="Log out"
            />
          </div>
        </aside>

        <section className="ui-fade-in min-w-0 w-full flex-1 md:pl-16">
          <header className="border-b border-neutral-300 bg-white px-4 py-3 md:hidden">
            <div className="flex items-center justify-between gap-3">
              <button
                aria-controls="department-mobile-nav"
                aria-expanded={isMobileNavOpen}
                aria-label={isMobileNavOpen ? 'Close menu' : 'Open menu'}
                className="inline-flex min-h-[40px] items-center gap-2 border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
                onClick={() => setIsMobileNavOpen((value) => !value)}
                type="button"
              >
                {isMobileNavOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
                <span>Menu</span>
              </button>
              <h2 className="truncate text-base font-semibold">{contentHeading ?? title}</h2>
              <Link
                aria-label="Home"
                className="inline-flex h-9 w-9 items-center justify-center border border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-100"
                href="/"
                title="Home"
              >
                <Home className="h-4 w-4" />
              </Link>
            </div>
          </header>
          {contentHeading ? (
            <header className="hidden border-b border-neutral-300 bg-white px-4 py-4 md:block md:px-6">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">{contentHeading}</h2>
                <div className="flex items-center gap-2">
                  <Link
                    aria-label="Home"
                    className="inline-flex h-9 w-9 items-center justify-center border border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-100"
                    href="/"
                    title="Home"
                  >
                    <Home className="h-4 w-4" />
                  </Link>
                </div>
              </div>
            </header>
          ) : null}
          {children}
        </section>
      </div>
    </main>
  );
}
