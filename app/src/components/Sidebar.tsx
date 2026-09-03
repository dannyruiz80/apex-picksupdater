import React from 'react';
import { NavTabId } from '../types';
import { NAVIGATION_ITEMS, getNavIcon } from '../navigation';
import { ShieldCheck, Activity, Terminal } from 'lucide-react';

interface SidebarProps {
  activeTab: NavTabId;
  setActiveTab: (tab: NavTabId) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab }) => {
  const categories = ['Core', 'Engine', 'Account', 'System'] as const;

  return (
    <aside
      id="desktop-sidebar"
      className="hidden lg:flex w-64 flex-col justify-between border-r border-slate-800/80 bg-[#090d16]/70 p-4 shrink-0 min-h-[calc(100vh-61px)]"
    >
      <div className="space-y-6">
        {/* Navigation Categories */}
        {categories.map((cat) => {
          const items = NAVIGATION_ITEMS.filter((item) => item.category === cat);
          if (items.length === 0) return null;

          return (
            <div key={cat} className="space-y-1.5">
              <div className="px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                {cat} Modules
              </div>
              <div className="space-y-1">
                {items.map((item) => {
                  const Icon = getNavIcon(item.id);
                  const isActive = activeTab === item.id;

                  return (
                    <button
                      key={item.id}
                      id={`nav-item-${item.id}`}
                      type="button"
                      onClick={() => setActiveTab(item.id)}
                      className={`group flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                        isActive
                          ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 shadow-sm'
                          : 'border border-transparent text-slate-400 hover:border-slate-800 hover:bg-slate-900/60 hover:text-slate-200'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <Icon
                          className={`h-4 w-4 transition-colors ${
                            isActive
                              ? 'text-emerald-400'
                              : 'text-slate-400 group-hover:text-slate-300'
                          }`}
                        />
                        <span>{item.label}</span>
                      </div>
                      {isActive && (
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Baseline Footnote & Directive Safeguard */}
      <div className="rounded-xl border border-slate-800/80 bg-slate-900/40 p-3 text-xs text-slate-400">
        <div className="flex items-center gap-1.5 font-medium text-slate-300 mb-1">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
          <span>Baseline Directive</span>
        </div>
        <p className="text-[11px] leading-relaxed text-slate-400 font-mono">
          Unknown is better than wrong. Zero mock/fake feeds active.
        </p>
      </div>
    </aside>
  );
};
