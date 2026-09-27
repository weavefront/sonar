import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../i18n';
import { EditIcon, EyeIcon, EyeOffIcon, MoreIcon, MoveIcon } from './icons';

export type RowAction = 'rename' | 'move' | 'hide';

/** Rough menu height (3 items + padding) — enough to decide whether it fits below the button
    before anything has actually been laid out yet. */
const MENU_HEIGHT_ESTIMATE = 132;
const MENU_WIDTH = 160;
const VIEWPORT_MARGIN = 8;

/**
 * Small "⋮" dropdown shared by file and folder rows — rename, move, hide/unhide.
 *
 * Portalled to `document.body` and positioned in viewport coordinates rather than rendered inline
 * with `position: absolute`. Every caller sits inside a virtualized row: the row list scrolls
 * (`overflow-y-auto`/`overflow-x-hidden` on the scroll container), each row is placed via
 * `transform: translateY(...)` (which creates a new containing block, so even `position: fixed`
 * would be scoped to the row instead of the viewport), and an Icon-view tile additionally clips
 * with its own `overflow-hidden`. An inline dropdown gets clipped or mispositioned by any of these
 * — a portal escapes the whole ancestor chain, so none of it applies.
 */
export function RowMenu({ isHidden, onAction }: { isHidden: boolean; onAction: (action: RowAction) => void }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickAway = (e: MouseEvent) => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    // The button portalled the menu, but it's still the same button that can scroll out from
    // under it — closing on any scroll is simpler and safer than re-measuring continuously.
    // `capture: true` so this fires for scrolling inside the row list, not just the window itself.
    const onScrollOrResize = () => setOpen(false);
    window.addEventListener('mousedown', onClickAway);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.removeEventListener('mousedown', onClickAway);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open]);

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (open) {
      setOpen(false);
      return;
    }
    const rect = buttonRef.current!.getBoundingClientRect();
    const fitsBelow = rect.bottom + MENU_HEIGHT_ESTIMATE + VIEWPORT_MARGIN <= window.innerHeight;
    setPosition({
      top: fitsBelow ? rect.bottom + 4 : Math.max(VIEWPORT_MARGIN, rect.top - MENU_HEIGHT_ESTIMATE - 4),
      // Right-aligned to the button, same as the old `right-0`, but clamped so a button near the
      // left edge of a narrow viewport can't push the menu partly offscreen.
      left: Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - VIEWPORT_MARGIN),
    });
    setOpen(true);
  };

  return (
    <div className="relative shrink-0">
      <button
        ref={buttonRef}
        onClick={toggle}
        aria-label={t('rowMenu.moreActions')}
        aria-haspopup="menu"
        aria-expanded={open}
        className="grid place-items-center w-8 h-8 rounded-lg border border-app surface-2 hover:opacity-80"
      >
        <MoreIcon className="w-4 h-4" />
      </button>

      {open &&
        position &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            onClick={(e) => e.stopPropagation()}
            style={{ position: 'fixed', top: position.top, left: position.left, width: MENU_WIDTH }}
            className="z-50 surface border border-app rounded-lg shadow-lg py-1"
          >
            <MenuItem
              icon={<EditIcon className="w-3.5 h-3.5" />}
              label={t('rowMenu.rename')}
              onClick={() => {
                setOpen(false);
                onAction('rename');
              }}
            />
            <MenuItem
              icon={<MoveIcon className="w-3.5 h-3.5" />}
              label={t('rowMenu.move')}
              onClick={() => {
                setOpen(false);
                onAction('move');
              }}
            />
            <MenuItem
              icon={isHidden ? <EyeIcon className="w-3.5 h-3.5" /> : <EyeOffIcon className="w-3.5 h-3.5" />}
              label={isHidden ? t('rowMenu.unhide') : t('rowMenu.hide')}
              onClick={() => {
                setOpen(false);
                onAction('hide');
              }}
            />
          </div>,
          document.body,
        )}
    </div>
  );
}

function MenuItem({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:opacity-70 text-left"
    >
      {icon}
      {label}
    </button>
  );
}
