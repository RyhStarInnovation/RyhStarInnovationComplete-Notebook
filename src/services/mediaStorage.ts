import { User } from 'firebase/auth';
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { SITE_CONFIG } from '../config/siteConfig';
import {
  MediaAttachmentKind,
  OperationType,
  UpdateMediaAttachment,
  db,
  handleFirestoreError,
} from './firebase';

const RAW_CHUNK_BYTES = 360_000; // ~480,000 base64 chars per chunk (< 550,000 limit & well under 1MB Firestore limit)
const ALLOWED_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const ALLOWED_VIDEO_MIMES = new Set(['video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v']);

const sessionBlobUrlCache = new Map<string, string>();
const inflightDownloads = new Map<string, Promise<string>>();

export interface PendingLocalMedia {
  tempId: string;
  kind: MediaAttachmentKind;
  file: File;
  previewUrl: string;
}

export function formatBytesCompact(bytes: number): string {
  if (bytes <= 0) return 'Link';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function generateMediaId(): string {
  const rand = Math.random().toString(36).slice(2, 10).replace(/[^a-zA-Z0-9]/g, 'x');
  return `med_${Date.now()}_${rand}`.slice(0, SITE_CONFIG.validation.mediaIdMax);
}

export function validatePickedMediaFile(
  file: File,
  expectedKind?: MediaAttachmentKind
): { ok: true; kind: MediaAttachmentKind } | { ok: false; reason: 'unsupported' | 'tooLarge' } {
  const mime = (file.type || '').toLowerCase();
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';

  const isImage =
    ALLOWED_IMAGE_MIMES.has(mime) ||
    (!mime && ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext));
  const isVideo =
    ALLOWED_VIDEO_MIMES.has(mime) ||
    (!mime && ['mp4', 'webm', 'mov', 'm4v'].includes(ext));

  let resolvedKind: MediaAttachmentKind | null = null;
  if (expectedKind === 'image' && isImage) resolvedKind = 'image';
  else if (expectedKind === 'video' && isVideo) resolvedKind = 'video';
  else if (!expectedKind && isImage) resolvedKind = 'image';
  else if (!expectedKind && isVideo) resolvedKind = 'video';

  if (!resolvedKind) {
    return { ok: false, reason: 'unsupported' };
  }

  // Raw photos > 15MB before compression might still be fine if canvas shrinks them,
  // but cap ultra-massive inputs (> 30MB for images, > 15MB for videos / animated GIFs)
  if (resolvedKind === 'video' || mime === 'image/gif') {
    if (file.size > SITE_CONFIG.validation.mediaMaxSizeBytes) {
      return { ok: false, reason: 'tooLarge' };
    }
  } else if (file.size > 30 * 1024 * 1024) {
    return { ok: false, reason: 'tooLarge' };
  }

  return { ok: true, kind: resolvedKind };
}

function uint8ToBase64(bytes: Uint8Array): string {
  const sliceSize = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += sliceSize) {
    const sub = bytes.subarray(i, i + sliceSize);
    parts.push(String.fromCharCode.apply(null, Array.from(sub)));
  }
  return btoa(parts.join(''));
}

function base64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

async function compressImageFileIfHelpful(
  file: File
): Promise<{ blob: Blob; mimeType: string; name: string }> {
  const rawMime = (file.type || 'image/jpeg').toLowerCase();
  const safeName = file.name.trim().slice(0, SITE_CONFIG.validation.mediaNameMax) || 'photo.webp';

  // Keep animated GIFs intact without flattening frames
  if (rawMime === 'image/gif') {
    return { blob: file, mimeType: 'image/gif', name: safeName };
  }

  try {
    const objectUrl = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('Image decode failed'));
        el.src = objectUrl;
      });

      const maxDim = 1440;
      const scale = Math.min(1, maxDim / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
      const targetW = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
      const targetH = Math.max(1, Math.round((img.naturalHeight || 1) * scale));

      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        return { blob: file, mimeType: rawMime, name: safeName };
      }

      ctx.drawImage(img, 0, 0, targetW, targetH);

      const webpBlob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/webp', 0.84)
      );
      if (webpBlob && (webpBlob.size < file.size || file.size > 800_000)) {
        const webpName = safeName.replace(/\.[^.]+$/, '') + '.webp';
        return {
          blob: webpBlob,
          mimeType: 'image/webp',
          name: webpName.slice(0, SITE_CONFIG.validation.mediaNameMax),
        };
      }

      const jpegBlob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', 0.84)
      );
      if (jpegBlob && (jpegBlob.size < file.size || file.size > 800_000)) {
        return {
          blob: jpegBlob,
          mimeType: 'image/jpeg',
          name: safeName,
        };
      }
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch {
    // Fallback to raw image file if canvas compression is unavailable
  }

  return { blob: file, mimeType: rawMime || 'image/jpeg', name: safeName };
}

function normalizeVideoMime(file: File): string {
  const mime = (file.type || '').toLowerCase();
  if (mime === 'video/x-m4v') return 'video/mp4';
  if (ALLOWED_VIDEO_MIMES.has(mime)) return mime;
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext === 'webm') return 'video/webm';
  if (ext === 'mov') return 'video/quicktime';
  return 'video/mp4';
}

export async function uploadMediaAssetToFirestore(
  user: User,
  updateId: string,
  pending: PendingLocalMedia,
  onProgress?: (fraction: number) => void
): Promise<UpdateMediaAttachment> {
  const prepared =
    pending.kind === 'image'
      ? await compressImageFileIfHelpful(pending.file)
      : {
          blob: pending.file,
          mimeType: normalizeVideoMime(pending.file),
          name:
            pending.file.name.trim().slice(0, SITE_CONFIG.validation.mediaNameMax) || 'video.mp4',
        };

  if (prepared.blob.size > SITE_CONFIG.validation.mediaMaxSizeBytes) {
    throw new Error(`Media "${prepared.name}" exceeds the 15 MB limit.`);
  }
  if (prepared.blob.size <= 0) {
    throw new Error(`Media "${prepared.name}" appears empty.`);
  }

  const buffer = new Uint8Array(await prepared.blob.arrayBuffer());
  const totalBytes = buffer.byteLength;
  const chunkCount = Math.max(1, Math.ceil(totalBytes / RAW_CHUNK_BYTES));

  if (chunkCount > SITE_CONFIG.validation.mediaMaxChunks) {
    throw new Error(`Media "${prepared.name}" exceeds maximum chunk allocation.`);
  }

  const mediaId = generateMediaId();
  const parentPath = `update_media/${mediaId}`;

  try {
    await setDoc(doc(db, 'update_media', mediaId), {
      updateId,
      kind: pending.kind,
      mimeType: prepared.mimeType.slice(0, SITE_CONFIG.validation.mediaMimeTypeMax),
      name: prepared.name.slice(0, SITE_CONFIG.validation.mediaNameMax),
      sizeBytes: totalBytes,
      chunkCount,
      authorUid: user.uid,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, parentPath);
  }

  let completed = 0;
  const concurrency = 3;
  for (let start = 0; start < chunkCount; start += concurrency) {
    const batchIndices: number[] = [];
    for (let idx = start; idx < Math.min(chunkCount, start + concurrency); idx++) {
      batchIndices.push(idx);
    }

    await Promise.all(
      batchIndices.map(async (idx) => {
        const offset = idx * RAW_CHUNK_BYTES;
        const slice = buffer.subarray(offset, Math.min(totalBytes, offset + RAW_CHUNK_BYTES));
        const encoded = uint8ToBase64(slice);
        const chunkPath = `update_media/${mediaId}/chunks/${idx}`;

        try {
          await setDoc(doc(db, 'update_media', mediaId, 'chunks', String(idx)), {
            mediaId,
            updateId,
            index: idx,
            data: encoded,
            authorUid: user.uid,
            createdAt: serverTimestamp(),
          });
        } catch (error) {
          handleFirestoreError(error, OperationType.CREATE, chunkPath);
        }

        completed++;
        onProgress?.(completed / chunkCount);
      })
    );
  }

  // Pre-seed session cache so the author immediately sees the uploaded media without extra reads
  const localBlobUrl = URL.createObjectURL(prepared.blob);
  sessionBlobUrlCache.set(mediaId, localBlobUrl);

  return {
    id: mediaId,
    kind: pending.kind,
    source: 'firestore',
    mimeType: prepared.mimeType.slice(0, SITE_CONFIG.validation.mediaMimeTypeMax),
    name: prepared.name.slice(0, SITE_CONFIG.validation.mediaNameMax),
    sizeBytes: totalBytes,
    chunkCount,
    externalUrl: '',
  };
}

export async function fetchMediaAssetBlobUrl(attachment: UpdateMediaAttachment): Promise<string> {
  if (attachment.source === 'url') {
    return attachment.externalUrl;
  }

  const cached = sessionBlobUrlCache.get(attachment.id);
  if (cached) return cached;

  const existing = inflightDownloads.get(attachment.id);
  if (existing) return existing;

  const downloadPromise = (async (): Promise<string> => {
    try {
      const indices = Array.from({ length: attachment.chunkCount }, (_, i) => i);
      const chunkBuffers = new Array<Uint8Array>(attachment.chunkCount);

      // Fetch chunks in bounded parallel waves
      const waveSize = 4;
      for (let start = 0; start < indices.length; start += waveSize) {
        const wave = indices.slice(start, start + waveSize);
        await Promise.all(
          wave.map(async (idx) => {
            const chunkPath = `update_media/${attachment.id}/chunks/${idx}`;
            let snap;
            try {
              snap = await getDoc(doc(db, 'update_media', attachment.id, 'chunks', String(idx)));
            } catch (error) {
              handleFirestoreError(error, OperationType.GET, chunkPath);
            }
            if (!snap.exists()) {
              throw new Error(`Missing media chunk ${idx}`);
            }
            const rawData = snap.data()?.data;
            if (typeof rawData !== 'string' || !rawData) {
              throw new Error(`Invalid media chunk ${idx}`);
            }
            chunkBuffers[idx] = base64ToUint8(rawData);
          })
        );
      }

      const blob = new Blob(chunkBuffers as BlobPart[], { type: attachment.mimeType });
      const blobUrl = URL.createObjectURL(blob);
      sessionBlobUrlCache.set(attachment.id, blobUrl);
      return blobUrl;
    } finally {
      inflightDownloads.delete(attachment.id);
    }
  })();

  inflightDownloads.set(attachment.id, downloadPromise);
  return downloadPromise;
}

export async function deleteMediaAssetFromFirestore(attachment: UpdateMediaAttachment): Promise<void> {
  if (attachment.source !== 'firestore') return;

  const waveSize = 5;
  for (let start = 0; start < attachment.chunkCount; start += waveSize) {
    const end = Math.min(attachment.chunkCount, start + waveSize);
    const ops: Promise<void>[] = [];
    for (let idx = start; idx < end; idx++) {
      ops.push(
        deleteDoc(doc(db, 'update_media', attachment.id, 'chunks', String(idx))).catch(() => {
          // Best-effort chunk cleanup
        })
      );
    }
    await Promise.all(ops);
  }

  try {
    await deleteDoc(doc(db, 'update_media', attachment.id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `update_media/${attachment.id}`);
  }
}

export function extractYouTubeEmbedUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    let videoId: string | null = null;

    if (host === 'youtu.be') {
      videoId = parsed.pathname.split('/').filter(Boolean)[0] ?? null;
    } else if (host === 'youtube.com' || host === 'm.youtube.com') {
      if (parsed.pathname === '/watch') {
        videoId = parsed.searchParams.get('v');
      } else if (parsed.pathname.startsWith('/shorts/')) {
        videoId = parsed.pathname.split('/')[2] ?? null;
      } else if (parsed.pathname.startsWith('/embed/')) {
        videoId = parsed.pathname.split('/')[2] ?? null;
      }
    }

    if (videoId && /^[a-zA-Z0-9_-]{6,20}$/.test(videoId)) {
      return `https://www.youtube-nocookie.com/embed/${videoId}`;
    }
  } catch {
    return null;
  }
  return null;
}

export function parseExternalMediaAttachment(
  rawUrl: string,
  fallbackKind: MediaAttachmentKind
): UpdateMediaAttachment | null {
  const trimmed = rawUrl.trim();
  if (!/^https:\/\//i.test(trimmed) || trimmed.length > SITE_CONFIG.validation.mediaExternalUrlMax) {
    return null;
  }

  let kind: MediaAttachmentKind = fallbackKind;
  let mimeType = fallbackKind === 'video' ? 'video/mp4' : 'image/jpeg';
  let displayName = 'External Media';

  try {
    const parsed = new URL(trimmed);
    const lowerPath = parsed.pathname.toLowerCase();
    const lastSegment = parsed.pathname.split('/').filter(Boolean).pop();
    if (lastSegment) {
      displayName = decodeURIComponent(lastSegment).slice(0, SITE_CONFIG.validation.mediaNameMax);
    } else {
      displayName = parsed.hostname;
    }

    if (extractYouTubeEmbedUrl(trimmed)) {
      kind = 'video';
      mimeType = 'text/html';
      displayName = 'YouTube Video';
    } else if (/\.(mp4|m4v)(\?|$)/i.test(lowerPath)) {
      kind = 'video';
      mimeType = 'video/mp4';
    } else if (/\.webm(\?|$)/i.test(lowerPath)) {
      kind = 'video';
      mimeType = 'video/webm';
    } else if (/\.mov(\?|$)/i.test(lowerPath)) {
      kind = 'video';
      mimeType = 'video/quicktime';
    } else if (/\.(webp)(\?|$)/i.test(lowerPath)) {
      kind = 'image';
      mimeType = 'image/webp';
    } else if (/\.(png)(\?|$)/i.test(lowerPath)) {
      kind = 'image';
      mimeType = 'image/png';
    } else if (/\.(gif)(\?|$)/i.test(lowerPath)) {
      kind = 'image';
      mimeType = 'image/gif';
    } else if (/\.(jpe?g)(\?|$)/i.test(lowerPath)) {
      kind = 'image';
      mimeType = 'image/jpeg';
    }
  } catch {
    return null;
  }

  return {
    id: generateMediaId(),
    kind,
    source: 'url',
    mimeType,
    name: displayName.slice(0, SITE_CONFIG.validation.mediaNameMax) || 'Media',
    sizeBytes: 0,
    chunkCount: 0,
    externalUrl: trimmed,
  };
}
