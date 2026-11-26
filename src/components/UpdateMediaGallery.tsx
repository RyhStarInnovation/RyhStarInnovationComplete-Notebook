import React, { useEffect, useState } from 'react';
import { Expand, Film, X } from 'lucide-react';
import { UpdateMediaAttachment } from '../services/firebase';
import {
  extractYouTubeEmbedUrl,
  fetchMediaAssetBlobUrl,
} from '../services/mediaStorage';
import { UpdatesAutoTranslateCopy } from '../i18n/updatesMultilangTranslations';

interface UpdateMediaGalleryProps {
  media: UpdateMediaAttachment[];
  copy: UpdatesAutoTranslateCopy;
}

interface MediaCardItemProps {
  attachment: UpdateMediaAttachment;
  copy: UpdatesAutoTranslateCopy;
  isSingle: boolean;
  spanFullRow: boolean;
  onOpenLightbox: (url: string, name: string) => void;
}

function MediaCardItem({
  attachment,
  copy,
  isSingle,
  spanFullRow,
  onOpenLightbox,
}: MediaCardItemProps) {
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(
    attachment.source === 'url' ? attachment.externalUrl : null
  );
  const [loading, setLoading] = useState<boolean>(attachment.source === 'firestore');
  const [hasError, setHasError] = useState<boolean>(false);

  useEffect(() => {
    let active = true;
    if (attachment.source === 'url') {
      setResolvedUrl(attachment.externalUrl);
      setLoading(false);
      setHasError(false);
      return;
    }

    setLoading(true);
    setHasError(false);
    void fetchMediaAssetBlobUrl(attachment)
      .then((blobUrl) => {
        if (active) {
          setResolvedUrl(blobUrl);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setHasError(true);
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [attachment]);

  const spanClass = spanFullRow ? 'sm:col-span-2' : '';

  if (loading) {
    return (
      <div
        className={`rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-[#070D1A] flex items-center justify-center animate-pulse ${
          isSingle ? 'h-60 sm:h-72 max-w-2xl' : `aspect-video ${spanClass}`
        }`}
      >
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {copy.mediaLoadingPreview}
        </span>
      </div>
    );
  }

  if (hasError || !resolvedUrl) {
    return (
      <div
        className={`rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1A] p-4 text-xs text-slate-500 dark:text-slate-400 ${spanClass}`}
      >
        {copy.mediaLoadError}
      </div>
    );
  }

  if (attachment.kind === 'video') {
    const youtubeEmbed =
      attachment.source === 'url' ? extractYouTubeEmbedUrl(resolvedUrl) : null;

    if (youtubeEmbed) {
      return (
        <div
          className={`overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 bg-black aspect-video ${
            isSingle ? 'max-w-2xl' : spanClass
          }`}
        >
          <iframe
            src={youtubeEmbed}
            title={attachment.name}
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="w-full h-full border-0"
          />
        </div>
      );
    }

    return (
      <div
        className={`relative overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 bg-black ${
          isSingle ? 'max-w-2xl' : `aspect-video ${spanClass}`
        }`}
      >
        <video
          src={resolvedUrl}
          controls
          playsInline
          preload="metadata"
          aria-label={attachment.name}
          className={
            isSingle
              ? 'w-full max-h-[460px] object-contain bg-black'
              : 'w-full h-full object-contain bg-black'
          }
        />
        <div className="pointer-events-none absolute top-2.5 left-2.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-950/75 text-white text-[11px] font-medium">
          <Film className="w-3 h-3" />
          <span>{copy.mediaVideoBadge}</span>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onOpenLightbox(resolvedUrl, attachment.name)}
      className={`group relative flex items-center justify-center w-full overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100/90 dark:bg-[#070D1A] text-left cursor-zoom-in ${
        isSingle
          ? 'max-w-2xl max-h-[480px]'
          : `aspect-video ${spanClass}`
      }`}
    >
      <img
        src={resolvedUrl}
        alt={attachment.name}
        loading="lazy"
        onError={() => setHasError(true)}
        className={`transition-transform duration-300 group-hover:scale-[1.02] ${
          isSingle
            ? 'w-full max-h-[480px] object-contain'
            : 'w-full h-full object-contain'
        }`}
      />
      <span className="pointer-events-none absolute bottom-2.5 right-2.5 inline-flex items-center justify-center w-8 h-8 rounded-lg bg-slate-950/75 text-white opacity-90 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
        <Expand className="w-4 h-4" />
      </span>
    </button>
  );
}

export function UpdateMediaGallery({ media, copy }: UpdateMediaGalleryProps) {
  const [lightbox, setLightbox] = useState<{ url: string; name: string } | null>(null);

  useEffect(() => {
    if (!lightbox) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setLightbox(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [lightbox]);

  if (!media || media.length === 0) return null;

  const isSingle = media.length === 1;

  return (
    <>
      <div
        className={
          isSingle ? 'pt-1' : 'pt-1 grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-4xl'
        }
      >
        {media.map((item, idx) => (
          <MediaCardItem
            key={item.id}
            attachment={item}
            copy={copy}
            isSingle={isSingle}
            spanFullRow={media.length === 3 && idx === 0}
            onOpenLightbox={(url, name) => setLightbox({ url, name })}
          />
        ))}
      </div>

      {lightbox && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={lightbox.name}
          onClick={() => setLightbox(null)}
          className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-xs flex items-center justify-center p-4 sm:p-8"
        >
          <button
            type="button"
            onClick={() => setLightbox(null)}
            aria-label={copy.mediaCloseLightbox}
            className="absolute top-4 right-4 z-10 p-2.5 rounded-full bg-white/15 hover:bg-white/25 text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
          <img
            src={lightbox.url}
            alt={lightbox.name}
            onClick={(e) => e.stopPropagation()}
            className="max-w-full max-h-[88vh] rounded-xl object-contain shadow-2xl"
          />
        </div>
      )}
    </>
  );
}
