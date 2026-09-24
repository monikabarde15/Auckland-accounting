import React from 'react';

export interface TableProps extends React.TableHTMLAttributes<HTMLTableElement> {
  children: React.ReactNode;
  className?: string;
  containerClassName?: string;
  noScroll?: boolean;
}

export const Table: React.FC<TableProps> = ({
  children,
  className = '',
  containerClassName = '',
  noScroll = false,
  ...props
}) => (
  <div className={`w-full ${noScroll ? 'overflow-hidden' : 'overflow-x-auto'} border border-slate-200 rounded-lg bg-white ${containerClassName}`}>
    <table className={`w-full text-left text-sm text-slate-700 ${className}`} {...props}>
      {children}
    </table>
  </div>
);

export const TableHeader: React.FC<React.HTMLAttributes<HTMLTableSectionElement>> = ({
  children,
  className = '',
  ...props
}) => (
  <thead className={`bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600 uppercase tracking-wider ${className}`} {...props}>
    {children}
  </thead>
);

export const TableBody: React.FC<React.HTMLAttributes<HTMLTableSectionElement>> = ({
  children,
  className = '',
  ...props
}) => (
  <tbody className={`divide-y divide-slate-100 font-normal ${className}`} {...props}>
    {children}
  </tbody>
);

export const TableRow: React.FC<React.HTMLAttributes<HTMLTableRowElement> & { isSelected?: boolean; isClickable?: boolean }> = ({
  children,
  className = '',
  isSelected = false,
  isClickable = false,
  ...props
}) => (
  <tr
    className={`transition-colors ${
      isSelected
        ? 'bg-blue-50/50'
        : isClickable
        ? 'hover:bg-slate-50/80 cursor-pointer'
        : 'hover:bg-slate-50/50'
    } ${className}`}
    {...props}
  >
    {children}
  </tr>
);

export const TableHeaderCell: React.FC<React.ThHTMLAttributes<HTMLTableCellElement>> = ({
  children,
  className = '',
  ...props
}) => (
  <th className={`px-4 py-3 text-xs font-semibold text-slate-600 ${className}`} {...props}>
    {children}
  </th>
);

export const TableCell: React.FC<React.TdHTMLAttributes<HTMLTableCellElement>> = ({
  children,
  className = '',
  ...props
}) => (
  <td className={`px-4 py-3 text-sm text-slate-700 ${className}`} {...props}>
    {children}
  </td>
);
