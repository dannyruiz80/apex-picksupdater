import React from 'react';
import { NavTabId } from '../types';
import { NAVIGATION_ITEMS, getNavIcon } from '../navigation';
import { X, ShieldCheck, Cpu } from 'lucide-react';

interface MobileNavProps {
  activeTab: NavTabId;
  setActiveTab: (tab: NavTabId) => void;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
}

export const MobileNav: React.FC<MobileNavProps> = ({
  activeTab,
  setActiveTab,
  isOpen,
  setIsOpen,
}) => {
  // Key quick tabs for bottom navigation bar on mobile
  const quickTabs: NavTabId[] = ['overview', 'picks', 'live', 'props', 'my-bets'];

  return (
    <>
      {/* 1. Android / Mobile Bottom Bar (sticky) */}
      <nav
        id="mobile-bottom-nav"
        className="fixed bottom-0 left-0 right-0 z-40 flex h-16 items-center justify-around border-t border-slate-800/90 bg-[#090d16]/95 backdrop-blur-lg px-2 lg:hidden"
      >
        {quickTabs.map((tabId) => {
          const item = NAVIGATION_ITEMS.find((n) => n.id === tabId);
          if (!item) return null;
          const Icon = getNavIcon(tabId);
          const isActive = activeTab === tabId;

          return (
            <button
              key={tabId}
              id={`mobile-quick-${tabId}`}
              type="button"
              onClick={() => {
                setActiveTab(tabId);
                setIsOpen(false);
              }}
              className={`flex flex-col items-center justify-center gap-1 px-3 py-1.5 transition-colors ${
                isActive ? 'text-emerald-400' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Icon className="h-4 w-4" />
              <span className="text-[10px] font-medium tracking-tight">
                {item.shortLabel || item.label}
              </span>
            </button>
          );
        })}

        {/* More/All modules button */}
        <button
          id="mobile-quick-more-btn"
          type="button"
          onClick={() => setIsOpen(true)}
          className={`flex flex-col items-center justify-center gap-1 px-3 py-1.5 transition-colors ${
            isOpen ? 'text-emerald-400' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Cpu className="h-4 w-4" />
          <span className="text-[10px] font-medium tracking-tight">More</span>
        </button>
      </nav>

      {/* 2. Mobile Full Drawer / Modal Overlay */}
      {isOpen && (
        <div
          id="mobile-drawer-overlay"
          className="fixed inset-0 z-50 flex bg-black/70 backdrop-blur-sm lg:hidden animate-in fade-in"
        >
          <div
            id="mobile-drawer-content"
            className="flex w-4/5 max-w-sm flex-col justify-between border-r border-slate-800 bg-[#090d16] p-5 shadow-2xl"
          >
            <div className="space-y-5">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400 font-bold text-xs border border-emerald-500/30">
                    AP
                  </div>
                  <span className="font-bold text-white text-sm">Navigation Modules</span>
                </div>
                <button
                  id="close-mobile-drawer-btn"
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 gap-1.5 overflow-y-auto max-h-[calc(100vh-210px)] pr-1">
                {NAVIGATION_ITEMS.map((item) => {
                  const Icon = getNavIcon(item.id);
                  const isActive = activeTab === item.id;

                  return (
                    <button
                      key={item.id}
                      id={`mobile-drawer-item-${item.id}`}
                      type="button"
                      onClick={() => {
                        setActiveTab(item.id);
                        setIsOpen(false);
                      }}
                      className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-all ${
                        isActive
                          ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                          : 'border border-transparent text-slate-300 hover:bg-slate-900'
                      }`}
                    >
                      <Icon
                        className={`h-4 w-4 ${
                          isActive ? 'text-emerald-400' : 'text-slate-400'
                        }`}
                      />
                      <div>
                        <div className="leading-tight font-semibold">{item.label}</div>
                        <div className="text-[11px] text-slate-400 line-clamp-1">
                          {item.description}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3 text-[11px] text-slate-400 font-mono">
              <span className="text-emerald-400 font-semibold">Native Node Server:</span> Bound to port 3000
            </div>
          </div>
          <div
            className="flex-1"
            onClick={() => setIsOpen(false)}
            aria-hidden="true"
          />
        </div>
      )}
    </>
  );
};
