import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreVertical, Pencil, Copy, Trash2, Clock, Gift } from 'lucide-react';

type Props = {
  isRtl: boolean;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onSchedule?: () => void;
  onOffer?: () => void;
  showSchedule: boolean;
  showOffer: boolean;
};

function menuBtnClass(destructive?: boolean) {
  return `flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors duration-200 ${
    destructive
      ? 'text-red-700 hover:bg-red-50'
      : 'text-slate-700 hover:bg-slate-50'
  }`;
}

export function ServiceActionsMenu({
  isRtl,
  onEdit,
  onDuplicate,
  onDelete,
  onSchedule,
  onOffer,
  showSchedule,
  showOffer,
}: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-xl p-2 text-slate-500 transition-all duration-200 hover:bg-slate-100 hover:text-slate-800 active:scale-95"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t('service.actionsMenu', 'Service actions')}
      >
        <MoreVertical className="h-5 w-5" strokeWidth={2} />
      </button>
      {open ? (
        <div
          role="menu"
          className={`absolute z-50 mt-1 min-w-[13rem] rounded-2xl border border-gray-100 bg-white py-1 shadow-lg ring-1 ring-black/5 ${
            isRtl ? 'left-0' : 'right-0'
          }`}
          dir={isRtl ? 'rtl' : 'ltr'}
        >
          <button type="button" role="menuitem" className={menuBtnClass()} onClick={() => { onEdit(); setOpen(false); }}>
            <Pencil className="h-4 w-4 shrink-0 opacity-70" />
            {t('common.edit')}
          </button>
          <button type="button" role="menuitem" className={menuBtnClass()} onClick={() => { onDuplicate(); setOpen(false); }}>
            <Copy className="h-4 w-4 shrink-0 opacity-70" />
            {t('service.duplicate', 'Duplicate')}
          </button>
          {showSchedule && onSchedule ? (
            <button type="button" role="menuitem" className={menuBtnClass()} onClick={() => { onSchedule(); setOpen(false); }}>
              <Clock className="h-4 w-4 shrink-0 opacity-70" />
              {t('service.schedule', 'Schedule')}
            </button>
          ) : null}
          {showOffer && onOffer ? (
            <button type="button" role="menuitem" className={menuBtnClass()} onClick={() => { onOffer(); setOpen(false); }}>
              <Gift className="h-4 w-4 shrink-0 opacity-70" />
              {t('offers.createOffer', 'Create Offer')}
            </button>
          ) : null}
          <div className="my-1 h-px bg-slate-100" aria-hidden />
          <button
            type="button"
            role="menuitem"
            className={menuBtnClass(true)}
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          >
            <Trash2 className="h-4 w-4 shrink-0 opacity-80" />
            {t('common.delete')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
