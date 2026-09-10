import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { MoreVertical } from 'lucide-react';

export interface DropdownMenuItem {
  label: string;
  onClick: () => void;
  icon?: React.ReactNode;
  variant?: 'default' | 'danger';
  disabled?: boolean;
}

export interface DropdownMenuProps {
  items: DropdownMenuItem[];
  trigger?: React.ReactNode;
  align?: 'left' | 'right';
  className?: string;
}

export const DropdownMenu: React.FC<DropdownMenuProps> = ({
  items,
  trigger,
  align = 'right',
  className = ''
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const menuWidth = 190;
    const estimatedMenuHeight = Math.max(120, items.length * 36 + 12);
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;

    const shouldOpenUpwards = spaceBelow < estimatedMenuHeight && spaceAbove > spaceBelow;

    let top: number;
    if (shouldOpenUpwards) {
      top = Math.max(8, rect.top - estimatedMenuHeight - 4);
    } else {
      top = rect.bottom + 4;
    }

    let left: number;
    if (align === 'right') {
      left = rect.right - menuWidth;
    } else {
      left = rect.left;
    }

    // Boundary containment
    if (left + menuWidth > window.innerWidth - 8) {
      left = window.innerWidth - menuWidth - 8;
    }
    if (left < 8) {
      left = 8;
    }

    setMenuStyle({
      position: 'fixed',
      top: `${top}px`,
      left: `${left}px`,
      width: `${menuWidth}px`,
      zIndex: 99999
    });
  }, [align, items.length]);

  useEffect(() => {
    if (!isOpen) return;

    updatePosition();

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        menuRef.current &&
        !menuRef.current.contains(target) &&
        triggerRef.current &&
        !triggerRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    };

    const handleScrollOrResize = () => {
      setIsOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside, true);
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true);
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, updatePosition]);

  return (
    <div className={`relative inline-block text-left ${className}`}>
      <div
        ref={triggerRef}
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen((prev) => !prev);
        }}
      >
        {trigger || (
          <button
            type="button"
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            aria-label="Actions"
          >
            <MoreVertical className="w-4 h-4" />
          </button>
        )}
      </div>

      {isOpen &&
        createPortal(
          <div
            ref={menuRef}
            style={menuStyle}
            className="rounded-lg bg-white border border-slate-200 shadow-xl py-1 text-xs focus:outline-none animate-in fade-in zoom-in-95 duration-100"
            onClick={(e) => e.stopPropagation()}
          >
            {items.map((item, index) => (
              <button
                key={index}
                disabled={item.disabled}
                onClick={() => {
                  setIsOpen(false);
                  item.onClick();
                }}
                className={`w-full text-left px-3 py-2 flex items-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  item.variant === 'danger'
                    ? 'text-red-600 hover:bg-red-50 active:bg-red-100'
                    : 'text-slate-700 hover:bg-slate-50 active:bg-slate-100'
                }`}
              >
                {item.icon && <span className="w-3.5 h-3.5 shrink-0 text-current">{item.icon}</span>}
                <span className="font-medium truncate">{item.label}</span>
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
};

