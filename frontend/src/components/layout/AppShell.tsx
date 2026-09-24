import React, { useState } from 'react';
import { Menu } from 'lucide-react';
import { Sidebar } from './Sidebar';

export interface AppShellProps {
  children: React.ReactNode;
  currentPath: string;
  onNavigate: (path: string) => void;
  runningCampaignCount?: number;
}

export const AppShell: React.FC<AppShellProps> = ({
  children,
  currentPath,
  onNavigate,
  runningCampaignCount = 0
}) => {
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#f8f9fb] flex w-full overflow-x-hidden">
      {/* Sidebar Navigation */}
      <Sidebar
        currentPath={currentPath}
        onNavigate={onNavigate}
        isMobileOpen={isMobileOpen}
        onCloseMobile={() => setIsMobileOpen(false)}
        runningCampaignCount={runningCampaignCount}
      />

      {/* Main Layout Area */}
      <div className="flex-1 flex flex-col min-w-0 lg:pl-60 overflow-x-hidden">
        {/* Mobile Header Toggle */}
        <div className="lg:hidden h-12 px-4 border-b border-slate-200 bg-white flex items-center justify-between shrink-0">
          <button
            type="button"
            onClick={() => setIsMobileOpen(true)}
            className="p-1 rounded text-slate-600 hover:bg-slate-100"
            aria-label="Open navigation menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <span className="text-xs font-semibold text-slate-800">Auckland Accounting IVR</span>
          <div className="w-5" />
        </div>

        {/* Page Content Container - Full screen width responsive container */}
        <main className="flex-1 p-4 sm:p-6 lg:p-7 w-full min-w-0">
          {children}
        </main>
      </div>
    </div>
  );
};
