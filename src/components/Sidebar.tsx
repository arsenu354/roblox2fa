import React from 'react';
import { Mail, Settings, Info, LogOut, Menu, X, ShieldCheck } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onLogout: () => void;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
}

export function Sidebar({ activeTab, setActiveTab, onLogout, isOpen, setIsOpen }: SidebarProps) {
  const menuItems = [
    { id: 'emails', label: 'Письма', icon: Mail },
    { id: 'settings', label: 'Настройки', icon: Settings },
    { id: 'info', label: 'Информация', icon: Info },
  ];

  return (
    <>
      {/* Mobile Overlay */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={cn(
        "fixed top-0 left-0 h-full w-64 bg-white dark:bg-zinc-900 border-r border-zinc-50 dark:border-zinc-800 z-50 transition-transform duration-300 ease-in-out md:translate-x-0 shadow-[4px_0_24px_rgba(0,0,0,0.02)] md:shadow-none",
        isOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="p-6 flex items-center gap-3 border-b border-zinc-50 dark:border-zinc-800">
            <ShieldCheck className="w-8 h-8 text-blue-600" />
            <span className="text-xl font-bold tracking-tight text-zinc-900 dark:text-white">Roblox2FA</span>
            <button 
              className="ml-auto md:hidden"
              onClick={() => setIsOpen(false)}
            >
              <X className="w-6 h-6 text-zinc-900 dark:text-white" />
            </button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 p-4 space-y-1.5">
            {menuItems.map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  setActiveTab(item.id);
                  setIsOpen(false);
                }}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group",
                  activeTab === item.id 
                    ? "bg-blue-600 text-white shadow-[0_8px_20px_rgba(37,99,235,0.2)]" 
                    : "text-zinc-500 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800/50 hover:text-zinc-900 dark:hover:text-zinc-200"
                )}
              >
                <item.icon className={cn("w-5 h-5", activeTab === item.id ? "text-white" : "text-zinc-400 group-hover:text-zinc-600 dark:group-hover:text-zinc-300")} />
                <span className="font-bold text-sm">{item.label}</span>
              </button>
            ))}
          </nav>

          {/* Footer */}
          <div className="p-4 border-t border-zinc-50 dark:border-zinc-800">
            <button
              onClick={onLogout}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-red-600 hover:bg-red-50 dark:hover:bg-red-900/10 transition-all duration-200 font-bold text-sm"
            >
              <LogOut className="w-5 h-5" />
              <span>Выйти</span>
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
