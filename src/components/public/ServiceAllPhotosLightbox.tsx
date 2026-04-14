import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Images, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type Props = {
  open: boolean;
  onClose: () => void;
  images: string[];
  initialIndex?: number;
};

/**
 * Full-screen gallery over the service detail modal: hero image (object-contain), thumb strip, prev/next.
 */
export function ServiceAllPhotosLightbox({ open, onClose, images, initialIndex = 0 }: Props) {
  const { t, i18n } = useTranslation();
  const isRtl = i18n.language === 'ar';
  const [index, setIndex] = useState(0);
  const thumbRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!open || images.length === 0) return;
    setIndex(Math.min(Math.max(0, initialIndex), images.length - 1));
  }, [open, initialIndex, images.length]);

  const go = useCallback(
    (delta: number) => {
      if (images.length === 0) return;
      setIndex((i) => (i + delta + images.length) % images.length);
    },
    [images.length]
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') go(isRtl ? 1 : -1);
      if (e.key === 'ArrowRight') go(isRtl ? -1 : 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, go, isRtl]);

  useEffect(() => {
    const el = thumbRefs.current[index];
    el?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [index]);

  if (!open || images.length === 0) return null;

  const current = images[index];

  return (
    <div
      className="fixed inset-0 z-[60] flex h-full w-full flex-col"
      role="dialog"
      aria-modal="true"
      aria-label={t('booking.allPhotos')}
    >
      {/* Semi-transparent layer + backdrop blur: page behind stays readable but soft */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-2xl backdrop-saturate-150"
        aria-hidden
      />
      <div className="relative z-10 flex h-full min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center justify-between bg-black/25 px-4 py-3 text-white shadow-sm backdrop-blur-md">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium hover:bg-white/10 transition-colors"
        >
          <ChevronLeft className={`h-5 w-5 ${isRtl ? 'rotate-180' : ''}`} />
          {t('booking.allPhotos')}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full p-2 hover:bg-white/10 transition-colors"
          aria-label={t('common.close')}
        >
          <X className="h-6 w-6" />
        </button>
      </header>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-2">
        <button
          type="button"
          onClick={() => go(isRtl ? 1 : -1)}
          className="absolute left-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/90 p-2.5 text-gray-900 shadow-lg hover:bg-white disabled:opacity-30 md:left-4"
          disabled={images.length < 2}
          aria-label={t('booking.previousPhoto')}
        >
          <ChevronLeft className="h-6 w-6" />
        </button>

        <div className="flex h-full max-h-[min(55vh,520px)] w-full max-w-5xl items-center justify-center px-12 md:px-16">
          <img
            src={current}
            alt=""
            className="max-h-full max-w-full object-contain"
          />
        </div>

        <button
          type="button"
          onClick={() => go(isRtl ? -1 : 1)}
          className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/90 p-2.5 text-gray-900 shadow-lg hover:bg-white disabled:opacity-30 md:right-4"
          disabled={images.length < 2}
          aria-label={t('booking.nextPhoto')}
        >
          <ChevronRight className="h-6 w-6" />
        </button>
      </div>

      <div className="shrink-0 border-t border-white/10 bg-black/35 px-3 py-3 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl gap-2 overflow-x-auto pb-1 scrollbar-thin">
          {images.map((src, i) => (
            <button
              key={`${src}-${i}`}
              type="button"
              ref={(el) => {
                thumbRefs.current[i] = el;
              }}
              onClick={() => setIndex(i)}
              className={`relative h-16 w-24 shrink-0 overflow-hidden rounded-lg md:h-20 md:w-28 ${
                i === index ? 'ring-2 ring-white ring-offset-2 ring-offset-black/40' : 'opacity-80 hover:opacity-100'
              }`}
            >
              <img src={src} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
        <p className="mt-2 text-center text-xs text-white/70">
          <Images className="inline h-3.5 w-3.5 align-text-bottom opacity-80" /> {index + 1} / {images.length}
        </p>
      </div>
      </div>
    </div>
  );
}
