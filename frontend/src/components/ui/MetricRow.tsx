import React from 'react';

export interface MetricItem {
  label: string;
  value: string | number;
  subtext?: string;
  status?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
}

export interface MetricRowProps {
  metrics: MetricItem[];
  className?: string;
}

export const MetricRow: React.FC<MetricRowProps> = ({ metrics, className = '' }) => {
  const statusColors = {
    neutral: 'text-slate-900',
    success: 'text-emerald-700',
    warning: 'text-amber-700',
    danger: 'text-red-700',
    info: 'text-blue-700'
  };

  return (
    <div className={`bg-white border border-slate-200 rounded-lg p-3 flex flex-wrap items-center divide-x divide-slate-200 ${className}`}>
      {metrics.map((m, idx) => (
        <div key={idx} className={`px-4 first:pl-2 last:pr-2 py-0.5 flex items-baseline gap-2 min-w-0`}>
          <span className="text-xs text-slate-500 font-medium truncate">{m.label}</span>
          <span className={`text-base font-semibold ${statusColors[m.status || 'neutral']}`}>
            {m.value}
          </span>
          {m.subtext && (
            <span className="text-[11px] text-slate-400 font-normal">{m.subtext}</span>
          )}
        </div>
      ))}
    </div>
  );
};
