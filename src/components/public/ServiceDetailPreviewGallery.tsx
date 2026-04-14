import React from 'react';
import { useTranslation } from 'react-i18next';
import { Images } from 'lucide-react';

type Props = {
  images: string[];
  /** Opens full-screen gallery; index is which photo to show first */
  onOpenAllPhotos: (initialIndex?: number) => void;
};

/**
 * Compact 1+2 grid for service detail modal: large left, two stacked right, object-cover in cells.
 */
export function ServiceDetailPreviewGallery({ images, onOpenAllPhotos }: Props) {
  const { t } = useTranslation();

  if (images.length === 0) return null;

  if (images.length === 1) {
    return (
      <div className="relative overflow-hidden rounded-xl bg-gray-100 ring-1 ring-black/5">
        <button
          type="button"
          onClick={() => onOpenAllPhotos(0)}
          className="block w-full text-left"
        >
          <div className="aspect-[16/10] w-full min-h-[200px] max-h-[300px]">
            <img
              src={images[0]}
              alt=""
              className="h-full w-full object-cover"
            />
          </div>
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenAllPhotos(0);
          }}
          className="absolute bottom-3 right-3 inline-flex items-center gap-2 rounded-lg bg-black/75 px-3 py-2 text-sm font-semibold text-white shadow-md backdrop-blur-sm hover:bg-black/90"
        >
          <Images className="h-4 w-4 shrink-0" aria-hidden />
          {t('booking.allPhotos')}
        </button>
      </div>
    );
  }

  if (images.length === 2) {
    return (
      <div className="overflow-hidden rounded-xl bg-gray-100 ring-1 ring-black/5">
        <div className="grid h-[min(280px,42vw)] min-h-[200px] grid-cols-1 gap-1.5 sm:min-h-[240px] md:grid-cols-[minmax(0,1fr)_minmax(0,34%)] md:gap-2">
          <button
            type="button"
            className="relative min-h-[140px] overflow-hidden rounded-lg text-left md:min-h-0"
            onClick={() => onOpenAllPhotos(0)}
          >
            <img
              src={images[0]}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
            />
          </button>
          <div className="grid min-h-[120px] grid-rows-[1fr_auto] gap-1.5 md:min-h-0">
            <button
              type="button"
              className="relative min-h-0 overflow-hidden rounded-lg text-left"
              onClick={() => onOpenAllPhotos(1)}
            >
              <img
                src={images[1]}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
              />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenAllPhotos(0);
              }}
              className="flex min-h-[48px] items-center justify-center gap-2 rounded-lg bg-black/75 px-3 py-2.5 text-sm font-semibold text-white backdrop-blur-sm hover:bg-black/85"
            >
              <Images className="h-4 w-4 shrink-0" aria-hidden />
              {t('booking.allPhotos')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const extra = images.length - 3;
  return (
    <div className="overflow-hidden rounded-xl bg-gray-100 ring-1 ring-black/5">
      <div className="grid h-[min(280px,42vw)] min-h-[200px] grid-cols-1 gap-1.5 sm:min-h-[240px] md:grid-cols-[minmax(0,1fr)_minmax(0,34%)] md:gap-2">
        <button
          type="button"
          className="relative min-h-[140px] overflow-hidden rounded-lg text-left md:min-h-0 md:rounded-l-xl md:rounded-r-none"
          onClick={() => onOpenAllPhotos(0)}
        >
          <img
            src={images[0]}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
        </button>
        <div className="grid min-h-[120px] grid-rows-2 gap-1.5 md:min-h-0 md:gap-2">
          <button
            type="button"
            className="relative min-h-0 overflow-hidden rounded-lg text-left md:rounded-none"
            onClick={() => onOpenAllPhotos(1)}
          >
            <img
              src={images[1]}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
            />
          </button>
          <div className="relative min-h-0 overflow-hidden rounded-lg md:rounded-br-xl">
            <button
              type="button"
              className="absolute inset-0 text-left"
              onClick={() => onOpenAllPhotos(2)}
            >
              <img
                src={images[2]}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
              />
            </button>
            {extra > 0 && (
              <span className="pointer-events-none absolute bottom-14 right-2 rounded-md bg-black/70 px-2 py-1 text-xs font-semibold text-white">
                +{extra}
              </span>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenAllPhotos(0);
              }}
              className="absolute bottom-2 right-2 inline-flex items-center gap-2 rounded-lg bg-black/75 px-3 py-2 text-sm font-semibold text-white shadow-md backdrop-blur-sm hover:bg-black/90"
            >
              <Images className="h-4 w-4 shrink-0" aria-hidden />
              {t('booking.allPhotos')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
