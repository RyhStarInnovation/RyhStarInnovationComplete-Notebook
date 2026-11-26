import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowUpRight,
  Edit3,
  Eye,
  EyeOff,
  Film,
  Globe,
  ImagePlus,
  Link2,
  LogIn,
  Pin,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';
import { SUPPORTED_LANGUAGES, SupportedLanguage } from '../i18n/types';
import {
  detectTextLanguage,
  detectTextLanguageStrict,
  isStoredTranslationEntryValid,
} from '../i18n/textLanguageDetect';
import { UPDATES_AUTO_TRANSLATE_COPY } from '../i18n/updatesMultilangTranslations';
import { useAuth } from '../context/AuthContext';
import { SITE_CONFIG, UpdateCategory } from '../config/siteConfig';
import {
  AppUpdateInput,
  AppUpdateRecord,
  LocalizedUpdateText,
  MediaAttachmentKind,
  UpdateMediaAttachment,
  createAppUpdate,
  deleteAppUpdateById,
  generateSafeDocumentId,
  resolveLocalizedUpdate,
  subscribeToAppUpdates,
  togglePinAppUpdate,
  togglePublishAppUpdate,
  updateExistingAppUpdate,
  validateAppUpdateInput,
} from '../services/firebase';
import {
  PendingLocalMedia,
  deleteMediaAssetFromFirestore,
  fetchMediaAssetBlobUrl,
  formatBytesCompact,
  parseExternalMediaAttachment,
  uploadMediaAssetToFirestore,
  validatePickedMediaFile,
} from '../services/mediaStorage';
import {
  TranslationServiceUnavailableError,
  getCachedRuntimeTranslation,
  translateMissingRecordLanguages,
  translateUpdateToAllLanguages,
} from '../services/translationClient';
import { EASE_OUT_EXPO, RevealInView } from './motionPrimitives';
import { UpdateMediaGallery } from './UpdateMediaGallery';

function evaluateRecordLanguageCoverage(record: AppUpdateRecord): {
  validMap: Partial<Record<SupportedLanguage, boolean>>;
  missingLangs: SupportedLanguage[];
  syncedCount: number;
  isAllLangsSynced: boolean;
  sourceTitle: string;
  sourceSummary: string;
  effectiveSourceLang: SupportedLanguage;
} {
  const sourceTitle = (
    record.title ||
    record.translations?.[record.defaultLang]?.title ||
    ''
  ).trim();
  const sourceSummary = (
    record.summary ||
    record.translations?.[record.defaultLang]?.summary ||
    ''
  ).trim();
  const effectiveSourceLang = detectTextLanguage(
    `${sourceTitle}\n${sourceSummary}`,
    record.defaultLang
  );
  const enEntry = record.translations?.en;
  const validMap: Partial<Record<SupportedLanguage, boolean>> = {};
  const missingLangs: SupportedLanguage[] = [];
  let syncedCount = 0;

  for (const langMeta of SUPPORTED_LANGUAGES) {
    const entry = record.translations?.[langMeta.code];
    const ok = isStoredTranslationEntryValid(
      entry?.title,
      entry?.summary,
      langMeta.code,
      effectiveSourceLang,
      sourceTitle,
      sourceSummary,
      enEntry?.title,
      enEntry?.summary
    );
    validMap[langMeta.code] = ok;
    if (ok) {
      syncedCount++;
    } else {
      missingLangs.push(langMeta.code);
    }
  }

  return {
    validMap,
    missingLangs,
    syncedCount,
    isAllLangsSynced: syncedCount === SUPPORTED_LANGUAGES.length,
    sourceTitle,
    sourceSummary,
    effectiveSourceLang,
  };
}

function createEmptyForm(defaultLang: SupportedLanguage = 'id'): AppUpdateInput {
  return {
    title: '',
    version: '1.0.1+1',
    category: 'release',
    summary: '',
    defaultLang,
    translations: {},
    playStoreUrl: SITE_CONFIG.playStoreUrl,
    media: [],
    pinned: false,
    published: true,
  };
}

function SavedMediaThumbnail({ item }: { item: UpdateMediaAttachment }) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(
    item.source === 'url' ? item.externalUrl : null
  );

  useEffect(() => {
    let active = true;
    if (item.source === 'url') {
      setThumbUrl(item.externalUrl);
      return;
    }
    void fetchMediaAssetBlobUrl(item)
      .then((url) => {
        if (active) setThumbUrl(url);
      })
      .catch(() => {
        // Keep icon fallback
      });
    return () => {
      active = false;
    };
  }, [item]);

  if (thumbUrl && item.kind === 'image') {
    return <img src={thumbUrl} alt={item.name} className="w-full h-full object-cover" />;
  }
  if (thumbUrl && item.kind === 'video' && item.source === 'firestore') {
    return <video src={thumbUrl} muted playsInline className="w-full h-full object-cover" />;
  }
  if (item.kind === 'video') {
    return <Film className="w-4 h-4 text-blue-600 dark:text-sky-400" />;
  }
  return <ImagePlus className="w-4 h-4 text-blue-600 dark:text-sky-400" />;
}

export function UpdatesChangelogSection() {
  const { language, t } = useLanguage();
  const autoCopy = UPDATES_AUTO_TRANSLATE_COPY[language];
  const {
    user,
    authReady,
    isDeveloperAdmin,
    showAdminEntry,
    authError,
    clearAuthError,
    signInAsDeveloper,
  } = useAuth();

  const [updates, setUpdates] = useState<AppUpdateRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState<'all' | UpdateCategory>('all');

  // Dynamic fallback translations for any older Firestore records missing `translations[language]`
  const [runtimeTranslations, setRuntimeTranslations] = useState<
    Record<string, LocalizedUpdateText>
  >({});

  // Single-input editor state for verified developer (ryhstarr@gmail.com)
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<AppUpdateInput>(() => createEmptyForm('id'));
  const [pendingMedia, setPendingMedia] = useState<PendingLocalMedia[]>([]);
  const [originalSavedMedia, setOriginalSavedMedia] = useState<UpdateMediaAttachment[]>([]);
  const [showMediaUrlPanel, setShowMediaUrlPanel] = useState(false);
  const [mediaUrlInput, setMediaUrlInput] = useState('');
  const [mediaUrlKind, setMediaUrlKind] = useState<MediaAttachmentKind>('image');
  const [mediaUploadProgress, setMediaUploadProgress] = useState<number | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncingRecordId, setSyncingRecordId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);

  const revokeAllPendingPreviews = (items: PendingLocalMedia[]) => {
    for (const item of items) {
      try {
        URL.revokeObjectURL(item.previewUrl);
      } catch {
        // Ignore cleanup errors
      }
    }
  };

  useEffect(() => {
    if (!authReady) return;
    setLoading(true);
    setStreamError(null);

    const unsubscribe = subscribeToAppUpdates(
      isDeveloperAdmin,
      (records) => {
        setUpdates(records);
        setLoading(false);
      },
      (errMessage) => {
        setStreamError(errMessage);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [authReady, isDeveloperAdmin]);

  // Automatically translate any existing Firestore update record that is missing the visitor's
  // active language OR has an untranslated/mismatched entry from a previous quota/offline save.
  useEffect(() => {
    if (updates.length === 0) return;
    let cancelled = false;

    for (const item of updates) {
      if (item.id === 'official_launch_seed') {
        continue;
      }

      const coverage = evaluateRecordLanguageCoverage(item);
      if (coverage.validMap[language]) {
        continue;
      }

      if (!coverage.sourceTitle || !coverage.sourceSummary) {
        continue;
      }

      const stateKey = `${item.id}_${item.updatedAtMs}_${language}`;
      const cached = getCachedRuntimeTranslation(
        item.id,
        item.updatedAtMs,
        language,
        coverage.effectiveSourceLang,
        coverage.sourceTitle,
        coverage.sourceSummary
      );
      if (cached) {
        setRuntimeTranslations((prev) =>
          prev[stateKey] ? prev : { ...prev, [stateKey]: cached }
        );
        continue;
      }

      const detectedSource = detectTextLanguageStrict(
        `${coverage.sourceTitle}\n${coverage.sourceSummary}`
      );
      const sourceHint =
        detectedSource ?? (item.defaultLang !== language ? item.defaultLang : undefined);

      const missingTargets = coverage.missingLangs.includes(language)
        ? [language, ...coverage.missingLangs.filter((c) => c !== language)]
        : [language, ...coverage.missingLangs];

      void translateMissingRecordLanguages(
        item.id,
        item.updatedAtMs,
        coverage.sourceTitle,
        coverage.sourceSummary,
        missingTargets,
        language,
        sourceHint
      ).then((translatedMap) => {
        if (cancelled) return;
        const additions: Record<string, LocalizedUpdateText> = {};
        for (const [langCode, entry] of Object.entries(translatedMap) as Array<
          [SupportedLanguage, LocalizedUpdateText]
        >) {
          if (entry?.title && entry?.summary) {
            additions[`${item.id}_${item.updatedAtMs}_${langCode}`] = entry;
          }
        }
        if (Object.keys(additions).length > 0) {
          setRuntimeTranslations((prev) => ({
            ...prev,
            ...additions,
          }));
        }
      });
    }

    return () => {
      cancelled = true;
    };
  }, [updates, language]);

  const closeEditorModal = () => {
    revokeAllPendingPreviews(pendingMedia);
    setPendingMedia([]);
    setOriginalSavedMedia([]);
    setShowMediaUrlPanel(false);
    setMediaUrlInput('');
    setMediaUploadProgress(null);
    setEditorOpen(false);
  };

  const openCreateForm = () => {
    const initialLang: SupportedLanguage = language || 'id';
    revokeAllPendingPreviews(pendingMedia);
    setEditingId(null);
    setForm(createEmptyForm(initialLang));
    setPendingMedia([]);
    setOriginalSavedMedia([]);
    setShowMediaUrlPanel(false);
    setMediaUrlInput('');
    setMediaUploadProgress(null);
    setFormError(null);
    setEditorOpen(true);
  };

  const openEditForm = (record: AppUpdateRecord) => {
    // Load the text matching the Admin's currently selected UI language (preferring valid stored or runtime translation)
    const coverage = evaluateRecordLanguageCoverage(record);
    const stored = record.translations?.[language];
    const hasValidStored = Boolean(coverage.validMap[language] && stored);

    const runtimeKey = `${record.id}_${record.updatedAtMs}_${language}`;
    const runtimeEntry = runtimeTranslations[runtimeKey];
    const resolvedForAdmin = hasValidStored
      ? {
          title: stored!.title,
          summary: stored!.summary,
        }
      : runtimeEntry
        ? { title: runtimeEntry.title, summary: runtimeEntry.summary }
        : resolveLocalizedUpdate(record, language);

    revokeAllPendingPreviews(pendingMedia);
    setEditingId(record.id);
    setForm({
      title: resolvedForAdmin.title,
      version: record.version,
      category: record.category,
      summary: resolvedForAdmin.summary,
      defaultLang: language,
      translations: { ...record.translations },
      playStoreUrl: record.playStoreUrl,
      media: record.media ? [...record.media] : [],
      pinned: record.pinned,
      published: record.published,
    });
    setPendingMedia([]);
    setOriginalSavedMedia(record.media ? [...record.media] : []);
    setShowMediaUrlPanel(false);
    setMediaUrlInput('');
    setMediaUploadProgress(null);
    setFormError(null);
    setEditorOpen(true);
  };

  const totalMediaCount = (form.media?.length ?? 0) + pendingMedia.length;

  const handleFilesSelected = (
    e: React.ChangeEvent<HTMLInputElement>,
    expectedKind: MediaAttachmentKind
  ) => {
    const fileList = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (fileList.length === 0) return;

    const remainingSlots = SITE_CONFIG.validation.mediaMaxItems - totalMediaCount;
    if (remainingSlots <= 0) {
      setFormError(autoCopy.mediaMaxItemsError);
      return;
    }

    const accepted: PendingLocalMedia[] = [];
    for (const file of fileList) {
      if (accepted.length >= remainingSlots) {
        setFormError(autoCopy.mediaMaxItemsError);
        break;
      }
      const check = validatePickedMediaFile(file, expectedKind);
      if (!check.ok) {
        setFormError(
          check.reason === 'tooLarge'
            ? autoCopy.mediaTooLargeError
            : autoCopy.mediaUnsupportedError
        );
        continue;
      }
      accepted.push({
        tempId: `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        kind: check.kind,
        file,
        previewUrl: URL.createObjectURL(file),
      });
    }

    if (accepted.length > 0) {
      setFormError(null);
      setPendingMedia((prev) => [...prev, ...accepted]);
    }
  };

  const handleAttachExternalUrl = () => {
    if (totalMediaCount >= SITE_CONFIG.validation.mediaMaxItems) {
      setFormError(autoCopy.mediaMaxItemsError);
      return;
    }
    const parsed = parseExternalMediaAttachment(mediaUrlInput, mediaUrlKind);
    if (!parsed) {
      setFormError(autoCopy.mediaUrlInvalidError);
      return;
    }
    setFormError(null);
    setForm((prev) => ({
      ...prev,
      media: [...(prev.media ?? []), parsed],
    }));
    setMediaUrlInput('');
    setShowMediaUrlPanel(false);
  };

  const handleRemoveSavedMedia = (mediaId: string) => {
    setForm((prev) => ({
      ...prev,
      media: (prev.media ?? []).filter((m) => m.id !== mediaId),
    }));
  };

  const handleRemovePendingMedia = (tempId: string) => {
    setPendingMedia((prev) => {
      const target = prev.find((p) => p.tempId === tempId);
      if (target) {
        try {
          URL.revokeObjectURL(target.previewUrl);
        } catch {
          // Ignore cleanup errors
        }
      }
      return prev.filter((p) => p.tempId !== tempId);
    });
  };

  const handleSaveForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !isDeveloperAdmin) return;

    const activeUiLang: SupportedLanguage = language || 'id';
    const trimmedTitle = form.title.trim();
    const trimmedSummary = form.summary.trim();
    const detectedInputLang = detectTextLanguage(
      `${trimmedTitle}\n${trimmedSummary}`,
      activeUiLang
    );

    const baseDraft: AppUpdateInput = {
      ...form,
      defaultLang: detectedInputLang,
      title: trimmedTitle,
      summary: trimmedSummary,
      translations: {
        [detectedInputLang]: {
          title: trimmedTitle,
          summary: trimmedSummary,
        },
      },
    };

    const validationMessage = validateAppUpdateInput(baseDraft);
    if (validationMessage) {
      setFormError(validationMessage);
      return;
    }

    if (totalMediaCount > SITE_CONFIG.validation.mediaMaxItems) {
      setFormError(autoCopy.mediaMaxItemsError);
      return;
    }

    setSaving(true);
    setFormError(null);
    setMediaUploadProgress(pendingMedia.length > 0 ? 0 : null);

    const uploadedMediaThisSave: UpdateMediaAttachment[] = [];

    try {
      let finalPayload: AppUpdateInput = baseDraft;
      let translationsComplete = true;

      try {
        // Automatically detect input language & translate into all 8 supported languages
        const {
          translations: autoTranslations,
          detectedSourceLang,
          isComplete,
        } = await translateUpdateToAllLanguages(trimmedTitle, trimmedSummary, detectedInputLang);

        const effectiveDefaultLang: SupportedLanguage = detectedSourceLang ?? detectedInputLang;
        const mergedTranslations = {
          ...autoTranslations,
          // Preserve the Admin's exact verbatim phrasing ONLY for the detected source language
          [effectiveDefaultLang]: {
            title: trimmedTitle,
            summary: trimmedSummary,
          },
        };

        const primaryEntry = mergedTranslations[effectiveDefaultLang];
        finalPayload = {
          ...baseDraft,
          defaultLang: effectiveDefaultLang,
          title: primaryEntry?.title ?? trimmedTitle,
          summary: primaryEntry?.summary ?? trimmedSummary,
          translations: mergedTranslations,
        };
        translationsComplete = Boolean(isComplete);
      } catch (txErr) {
        if (!(txErr instanceof TranslationServiceUnavailableError)) {
          throw txErr;
        }
        translationsComplete = false;
        // Offline / rate-limited fallback: save clean detectedInputLang draft without mislabeled locales
      }

      const targetUpdateId = editingId ?? generateSafeDocumentId();

      if (pendingMedia.length > 0) {
        for (let idx = 0; idx < pendingMedia.length; idx++) {
          const item = pendingMedia[idx];
          const uploaded = await uploadMediaAssetToFirestore(
            user,
            targetUpdateId,
            item,
            (fileFrac) => {
              const overall = Math.round(((idx + fileFrac) / pendingMedia.length) * 100);
              setMediaUploadProgress(overall);
            }
          );
          uploadedMediaThisSave.push(uploaded);
        }
      }

      const combinedMedia = [...(form.media ?? []), ...uploadedMediaThisSave];
      finalPayload = {
        ...finalPayload,
        media: combinedMedia,
      };

      if (editingId) {
        await updateExistingAppUpdate(editingId, finalPayload);

        // Clean up any Firestore media attachments that the Admin removed during edit
        const keptIds = new Set(combinedMedia.map((m) => m.id));
        const removedFirestoreMedia = originalSavedMedia.filter(
          (m) => m.source === 'firestore' && !keptIds.has(m.id)
        );
        if (removedFirestoreMedia.length > 0) {
          void Promise.all(
            removedFirestoreMedia.map((m) => deleteMediaAssetFromFirestore(m).catch(() => undefined))
          );
        }

        setActionFeedback(
          translationsComplete
            ? t.updatesSection.feedbackUpdated
            : `${t.updatesSection.feedbackUpdated} — ${autoCopy.partialTranslationNotice}`
        );
      } else {
        await createAppUpdate(user, finalPayload, targetUpdateId);
        setActionFeedback(
          translationsComplete
            ? t.updatesSection.feedbackCreated
            : `${t.updatesSection.feedbackCreated} — ${autoCopy.partialTranslationNotice}`
        );
      }

      revokeAllPendingPreviews(pendingMedia);
      setPendingMedia([]);
      setOriginalSavedMedia([]);
      setShowMediaUrlPanel(false);
      setMediaUrlInput('');
      setMediaUploadProgress(null);
      setEditorOpen(false);
      setEditingId(null);
      setForm(createEmptyForm(language || 'id'));
      setTimeout(() => setActionFeedback(null), 4000);
    } catch (err) {
      // Roll back newly uploaded chunks if the parent update write failed
      if (uploadedMediaThisSave.length > 0) {
        void Promise.all(
          uploadedMediaThisSave.map((m) => deleteMediaAssetFromFirestore(m).catch(() => undefined))
        );
      }
      setMediaUploadProgress(null);
      setFormError(err instanceof Error ? err.message : 'Failed to save update.');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async (id: string) => {
    const targetRecord = updates.find((u) => u.id === id);
    try {
      await deleteAppUpdateById(id);
      if (targetRecord?.media && targetRecord.media.length > 0) {
        const firestoreMedia = targetRecord.media.filter((m) => m.source === 'firestore');
        if (firestoreMedia.length > 0) {
          void Promise.all(
            firestoreMedia.map((m) => deleteMediaAssetFromFirestore(m).catch(() => undefined))
          );
        }
      }
      setConfirmDeleteId(null);
      setActionFeedback(t.updatesSection.feedbackDeleted);
      setTimeout(() => setActionFeedback(null), 3500);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to delete update.');
    }
  };

  const handleTogglePin = async (record: AppUpdateRecord) => {
    try {
      await togglePinAppUpdate(record.id, !record.pinned);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to update pin state.');
    }
  };

  const handleTogglePublish = async (record: AppUpdateRecord) => {
    try {
      await togglePublishAppUpdate(record.id, !record.published);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to update visibility.');
    }
  };

  const handleSyncAllLanguages = async (record: AppUpdateRecord) => {
    if (!isDeveloperAdmin || syncingRecordId) return;
    const coverage = evaluateRecordLanguageCoverage(record);
    if (!coverage.sourceTitle || !coverage.sourceSummary) return;

    setSyncingRecordId(record.id);
    setStreamError(null);
    try {
      const {
        translations: autoTranslations,
        detectedSourceLang,
        isComplete,
      } = await translateUpdateToAllLanguages(
        coverage.sourceTitle,
        coverage.sourceSummary,
        coverage.effectiveSourceLang
      );

      const effectiveDefaultLang: SupportedLanguage =
        detectedSourceLang ?? coverage.effectiveSourceLang;

      // Preserve any existing genuinely valid translations if a target had temporary rate limits
      const mergedTranslations = { ...autoTranslations };
      for (const langMeta of SUPPORTED_LANGUAGES) {
        const existing = record.translations?.[langMeta.code];
        if (!mergedTranslations[langMeta.code] && coverage.validMap[langMeta.code] && existing) {
          mergedTranslations[langMeta.code] = existing;
        }
      }
      mergedTranslations[effectiveDefaultLang] = {
        title: coverage.sourceTitle,
        summary: coverage.sourceSummary,
      };

      await updateExistingAppUpdate(record.id, {
        title: coverage.sourceTitle,
        version: record.version,
        category: record.category,
        summary: coverage.sourceSummary,
        defaultLang: effectiveDefaultLang,
        translations: mergedTranslations,
        playStoreUrl: record.playStoreUrl,
        media: record.media,
        pinned: record.pinned,
        published: record.published,
      });

      setActionFeedback(
        isComplete
          ? t.updatesSection.feedbackUpdated
          : `${t.updatesSection.feedbackUpdated} — ${autoCopy.partialTranslationNotice}`
      );
      setTimeout(() => setActionFeedback(null), 5000);
    } catch (err) {
      setStreamError(
        err instanceof Error ? err.message : autoCopy.partialTranslationNotice
      );
    } finally {
      setSyncingRecordId(null);
    }
  };

  // Fallback official foundational release card when database has zero posts yet
  const fallbackRecord: AppUpdateRecord = {
    id: 'official_launch_seed',
    title: t.updatesSection.defaultSeedTitle,
    version: t.updatesSection.defaultSeedVersion,
    category: 'release',
    summary: t.updatesSection.defaultSeedSummary,
    defaultLang: language,
    translations: {
      [language]: {
        title: t.updatesSection.defaultSeedTitle,
        summary: t.updatesSection.defaultSeedSummary,
      },
    },
    playStoreUrl: SITE_CONFIG.playStoreUrl,
    media: [],
    pinned: true,
    published: true,
    authorUid: 'official',
    authorName: SITE_CONFIG.companyName,
    createdAtMs: new Date('2026-10-01T00:00:00Z').getTime(),
    updatedAtMs: new Date('2026-10-01T00:00:00Z').getTime(),
  };

  const effectiveList = updates.length > 0 ? updates : [fallbackRecord];
  const filteredUpdates =
    filterCategory === 'all'
      ? effectiveList
      : effectiveList.filter((item) => item.category === filterCategory);

  const formatDate = (ms: number) => {
    try {
      return new Intl.DateTimeFormat(language, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }).format(new Date(ms));
    } catch {
      return new Date(ms).toISOString().slice(0, 10);
    }
  };

  return (
    <section
      id="updates"
      className="py-16 sm:py-24 border-b border-slate-200 dark:border-slate-800/80 bg-slate-100/50 dark:bg-[#080F1E]"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-10">
        {/* Header & Developer Action Row */}
        <RevealInView className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
          <div className="max-w-3xl space-y-3">
            <p className="text-xs font-semibold tracking-wide text-blue-600 dark:text-sky-400">
              {t.updatesSection.sectionNumber}
            </p>
            <h2 className="font-display text-xl sm:text-2xl lg:text-[1.75rem] leading-[1.24] font-bold tracking-tight text-slate-950 dark:text-white text-balance">
              {t.updatesSection.heading}
            </h2>
            <p className="text-sm sm:text-base text-slate-600 dark:text-slate-400 leading-relaxed">
              {t.updatesSection.subheading}
            </p>
          </div>

          {/* Admin Sign-In or Create New Update Trigger (Hidden from regular visitors) */}
          {showAdminEntry && (
            <div className="shrink-0">
              {isDeveloperAdmin ? (
                <button
                  type="button"
                  onClick={openCreateForm}
                  className="inline-flex items-center gap-2 min-h-[42px] px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 dark:bg-sky-500 dark:hover:bg-sky-400 text-white dark:text-slate-950 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
                >
                  <Plus className="w-4 h-4 shrink-0" />
                  <span>{t.updatesSection.newUpdateBtn}</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void signInAsDeveloper()}
                  className="inline-flex items-center gap-2 min-h-[42px] px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D1527] hover:bg-slate-100 dark:hover:bg-[#14223E] text-xs font-medium text-slate-700 dark:text-slate-300 transition-colors whitespace-nowrap cursor-pointer"
                >
                  <LogIn className="w-3.5 h-3.5 text-blue-600 dark:text-sky-400 shrink-0" />
                  <span>{t.updatesSection.developerLoginPrompt}</span>
                </button>
              )}
            </div>
          )}
        </RevealInView>

        {/* Status / Auth Alerts */}
        {authError && (
          <div className="p-4 rounded-xl border border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-950/30 text-xs text-amber-900 dark:text-amber-200 flex items-center justify-between gap-4">
            <span>{authError}</span>
            <button
              type="button"
              onClick={clearAuthError}
              className="underline font-semibold shrink-0 cursor-pointer"
            >
              OK
            </button>
          </div>
        )}

        {actionFeedback && (
          <div className="p-3.5 rounded-xl border border-emerald-300 dark:border-emerald-500/40 bg-emerald-50 dark:bg-emerald-950/30 text-xs font-medium text-emerald-900 dark:text-emerald-200">
            {actionFeedback}
          </div>
        )}

        {streamError && (
          <div className="p-3.5 rounded-xl border border-rose-300 dark:border-rose-500/40 bg-rose-50 dark:bg-rose-950/30 text-xs text-rose-900 dark:text-rose-200">
            {streamError}
          </div>
        )}

        {/* Developer Admin Single-Input Create / Edit Form Panel */}
        <AnimatePresence>
          {isDeveloperAdmin && editorOpen && (
            <motion.form
              initial={{ opacity: 0, y: -12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.98 }}
              transition={{ duration: 0.22, ease: EASE_OUT_EXPO }}
              onSubmit={(e) => void handleSaveForm(e)}
              noValidate
              className="rounded-2xl border border-blue-500/40 dark:border-sky-400/40 bg-white dark:bg-[#0D1527] p-6 sm:p-8 space-y-6 shadow-lg"
            >
              <div className="flex items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
                <div className="space-y-1">
                  <h3 className="font-display text-lg font-bold text-slate-900 dark:text-white">
                    {t.updatesSection.adminToolbarTitle}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {editingId
                      ? `${t.updatesSection.editingIdPrefix}: ${editingId}`
                      : t.updatesSection.newUpdateBtn}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeEditorModal}
                  className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                  aria-label={t.updatesSection.cancelBtn}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {formError && (
                <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-500/40 text-xs text-rose-800 dark:text-rose-200">
                  {formError}
                </div>
              )}

              {/* Quiet inline automatic multi-language notice */}
              <div className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-400">
                <Globe className="w-3.5 h-3.5 mt-0.5 text-blue-600 dark:text-sky-400 shrink-0" />
                <span>{autoCopy.autoTranslateNotice}</span>
              </div>

              {/* Single Title + Version, Category & Link */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      {t.updatesSection.formTitleLabel}
                    </label>
                    <span className="font-mono text-xs text-slate-400 tabular-nums">
                      {form.title.length} / {SITE_CONFIG.validation.titleMax}
                    </span>
                  </div>
                  <input
                    type="text"
                    required
                    dir="auto"
                    minLength={SITE_CONFIG.validation.titleMin}
                    maxLength={SITE_CONFIG.validation.titleMax}
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    placeholder={t.updatesSection.formTitlePlaceholder}
                    className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#070D1A] text-sm text-slate-900 dark:text-white focus:outline-none focus:border-blue-600 dark:focus:border-sky-400"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      {t.updatesSection.formVersionLabel}
                    </label>
                    <input
                      type="text"
                      required
                      minLength={SITE_CONFIG.validation.versionMin}
                      maxLength={SITE_CONFIG.validation.versionMax}
                      value={form.version}
                      onChange={(e) => setForm({ ...form, version: e.target.value })}
                      placeholder="1.0.1+2"
                      className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#070D1A] font-mono text-sm text-slate-900 dark:text-white focus:outline-none focus:border-blue-600 dark:focus:border-sky-400"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      {t.updatesSection.formCategoryLabel}
                    </label>
                    <select
                      value={form.category}
                      onChange={(e) =>
                        setForm({ ...form, category: e.target.value as UpdateCategory })
                      }
                      className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#070D1A] text-sm text-slate-900 dark:text-white focus:outline-none focus:border-blue-600 dark:focus:border-sky-400"
                    >
                      <option value="release">{t.updatesSection.categories.release}</option>
                      <option value="feature">{t.updatesSection.categories.feature}</option>
                      <option value="security">{t.updatesSection.categories.security}</option>
                      <option value="announcement">{t.updatesSection.categories.announcement}</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Single Summary Textarea */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    {t.updatesSection.formSummaryLabel}
                  </label>
                  <span className="font-mono text-xs text-slate-400 tabular-nums">
                    {form.summary.length} / {SITE_CONFIG.validation.summaryMax}
                  </span>
                </div>
                <textarea
                  rows={4}
                  required
                  dir="auto"
                  minLength={SITE_CONFIG.validation.summaryMin}
                  maxLength={SITE_CONFIG.validation.summaryMax}
                  value={form.summary}
                  onChange={(e) => setForm({ ...form, summary: e.target.value })}
                  placeholder={t.updatesSection.formSummaryPlaceholder}
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#070D1A] text-sm text-slate-900 dark:text-white focus:outline-none focus:border-blue-600 dark:focus:border-sky-400"
                />
              </div>

              {/* Optional Photo & Video Upload Section */}
              <div className="space-y-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#070D1A]/70 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    {autoCopy.mediaSectionLabel}
                  </span>
                  <span className="font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                    {totalMediaCount} / {SITE_CONFIG.validation.mediaMaxItems}
                  </span>
                </div>

                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {autoCopy.mediaOptionalHint}
                </p>

                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  multiple
                  onChange={(e) => handleFilesSelected(e, 'image')}
                  className="hidden"
                />
                <input
                  ref={videoInputRef}
                  type="file"
                  accept="video/mp4,video/webm,video/quicktime,video/*"
                  onChange={(e) => handleFilesSelected(e, 'video')}
                  className="hidden"
                />

                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    disabled={saving || totalMediaCount >= SITE_CONFIG.validation.mediaMaxItems}
                    onClick={() => photoInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D1527] hover:bg-slate-100 dark:hover:bg-[#14223E] disabled:opacity-50 text-xs font-medium text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
                  >
                    <ImagePlus className="w-3.5 h-3.5 text-blue-600 dark:text-sky-400 shrink-0" />
                    <span>{autoCopy.uploadPhotoBtn}</span>
                  </button>

                  <button
                    type="button"
                    disabled={saving || totalMediaCount >= SITE_CONFIG.validation.mediaMaxItems}
                    onClick={() => videoInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D1527] hover:bg-slate-100 dark:hover:bg-[#14223E] disabled:opacity-50 text-xs font-medium text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
                  >
                    <Film className="w-3.5 h-3.5 text-blue-600 dark:text-sky-400 shrink-0" />
                    <span>{autoCopy.uploadVideoBtn}</span>
                  </button>

                  <button
                    type="button"
                    disabled={saving || totalMediaCount >= SITE_CONFIG.validation.mediaMaxItems}
                    onClick={() => setShowMediaUrlPanel((v) => !v)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D1527] hover:bg-slate-100 dark:hover:bg-[#14223E] disabled:opacity-50 text-xs font-medium text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
                  >
                    <Link2 className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 shrink-0" />
                    <span>{autoCopy.addMediaUrlBtn}</span>
                  </button>
                </div>

                {showMediaUrlPanel && (
                  <div className="flex flex-col sm:flex-row gap-2 pt-1">
                    <select
                      value={mediaUrlKind}
                      onChange={(e) => setMediaUrlKind(e.target.value as MediaAttachmentKind)}
                      className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D1527] text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-blue-600 dark:focus:border-sky-400"
                    >
                      <option value="image">{autoCopy.mediaUrlKindPhoto}</option>
                      <option value="video">{autoCopy.mediaUrlKindVideo}</option>
                    </select>
                    <input
                      type="url"
                      value={mediaUrlInput}
                      onChange={(e) => setMediaUrlInput(e.target.value)}
                      placeholder={autoCopy.mediaUrlPlaceholder}
                      className="flex-1 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D1527] text-xs text-slate-900 dark:text-white focus:outline-none focus:border-blue-600 dark:focus:border-sky-400"
                    />
                    <button
                      type="button"
                      onClick={handleAttachExternalUrl}
                      className="px-3.5 py-2 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-950 text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer whitespace-nowrap"
                    >
                      {autoCopy.mediaUrlApplyBtn}
                    </button>
                  </div>
                )}

                {totalMediaCount > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    {(form.media ?? []).map((savedItem) => (
                      <div
                        key={savedItem.id}
                        className="flex items-center justify-between gap-3 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0D1527]"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-11 h-11 rounded-md bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0 overflow-hidden">
                            <SavedMediaThumbnail item={savedItem} />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate">
                              {savedItem.name}
                            </p>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">
                              {savedItem.kind === 'video'
                                ? autoCopy.mediaVideoBadge
                                : autoCopy.mediaPhotoBadge}{' '}
                              · {formatBytesCompact(savedItem.sizeBytes)}
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => handleRemoveSavedMedia(savedItem.id)}
                          aria-label={autoCopy.mediaRemoveBtn}
                          className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-50 transition-colors cursor-pointer shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}

                    {pendingMedia.map((item) => (
                      <div
                        key={item.tempId}
                        className="flex items-center justify-between gap-3 p-2.5 rounded-lg border border-blue-200 dark:border-sky-800/70 bg-white dark:bg-[#0D1527]"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-11 h-11 rounded-md bg-slate-900 flex items-center justify-center shrink-0 overflow-hidden">
                            {item.kind === 'image' ? (
                              <img
                                src={item.previewUrl}
                                alt={item.file.name}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <video
                                src={item.previewUrl}
                                muted
                                playsInline
                                className="w-full h-full object-cover"
                              />
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate">
                              {item.file.name}
                            </p>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">
                              {item.kind === 'video'
                                ? autoCopy.mediaVideoBadge
                                : autoCopy.mediaPhotoBadge}{' '}
                              · {formatBytesCompact(item.file.size)}
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => handleRemovePendingMedia(item.tempId)}
                          aria-label={autoCopy.mediaRemoveBtn}
                          className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-50 transition-colors cursor-pointer shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {mediaUploadProgress !== null && (
                  <div className="space-y-1.5 pt-1">
                    <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-300">
                      <span>{autoCopy.mediaUploadingProgress}...</span>
                      <span className="font-mono tabular-nums">{mediaUploadProgress}%</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                      <div
                        className="h-full bg-blue-600 dark:bg-sky-400 transition-all duration-150"
                        style={{ width: `${mediaUploadProgress}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Play Store Link */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  {t.updatesSection.formLinkLabel}
                </label>
                <input
                  type="url"
                  maxLength={SITE_CONFIG.validation.playStoreUrlMax}
                  value={form.playStoreUrl}
                  onChange={(e) => setForm({ ...form, playStoreUrl: e.target.value })}
                  placeholder={SITE_CONFIG.playStoreUrl}
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#070D1A] text-sm text-slate-900 dark:text-white focus:outline-none focus:border-blue-600 dark:focus:border-sky-400"
                />
              </div>

              <div className="flex flex-wrap items-center gap-6 pt-1">
                <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.pinned}
                    onChange={(e) => setForm({ ...form, pinned: e.target.checked })}
                    className="rounded border-slate-400 text-blue-600 focus:ring-sky-500"
                  />
                  <span>{t.updatesSection.formPinToggle}</span>
                </label>
                <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.published}
                    onChange={(e) => setForm({ ...form, published: e.target.checked })}
                    className="rounded border-slate-400 text-blue-600 focus:ring-sky-500"
                  />
                  <span>{t.updatesSection.formPublishToggle}</span>
                </label>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  disabled={saving}
                  onClick={closeEditorModal}
                  className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors cursor-pointer"
                >
                  {t.updatesSection.cancelBtn}
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 dark:bg-sky-500 dark:hover:bg-sky-400 disabled:opacity-50 text-white dark:text-slate-950 text-xs font-semibold transition-colors cursor-pointer"
                >
                  {saving
                    ? mediaUploadProgress !== null
                      ? `${autoCopy.mediaUploadingProgress} (${mediaUploadProgress}%)`
                      : autoCopy.translatingAndSavingBtn
                    : t.updatesSection.saveBtn}
                </button>
              </div>
            </motion.form>
          )}
        </AnimatePresence>

        {/* Interactive Category Segmented Filter */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div
            role="group"
            aria-label="Filter updates by category"
            className="inline-flex flex-wrap items-center gap-1 p-1 rounded-lg bg-slate-200/70 dark:bg-[#0D1527] border border-slate-200 dark:border-slate-800"
          >
            {(
              [
                ['all', t.updatesSection.filterAll],
                ['release', t.updatesSection.categories.release],
                ['feature', t.updatesSection.categories.feature],
                ['security', t.updatesSection.categories.security],
                ['announcement', t.updatesSection.categories.announcement],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilterCategory(key)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  filterCategory === key
                    ? 'bg-white dark:bg-[#192848] text-slate-900 dark:text-sky-300 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {isDeveloperAdmin && updates.length === 0 && !loading && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t.updatesSection.emptyLiveHint}
            </p>
          )}
        </div>

        {/* Feed of Release Updates & Announcements */}
        {loading ? (
          <div className="space-y-4">
            {[1, 2].map((skeleton) => (
              <div
                key={skeleton}
                className="h-36 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-[#0D1527]/60 animate-pulse"
              />
            ))}
          </div>
        ) : (
          <div className="space-y-5">
            {filteredUpdates.map((item, idx) => {
              const isSeed = item.id === 'official_launch_seed';
              const categoryText = t.updatesSection.categories[item.category];
              const runtimeKey = `${item.id}_${item.updatedAtMs}_${language}`;
              const runtimeEntry = runtimeTranslations[runtimeKey];
              const coverage = isSeed ? null : evaluateRecordLanguageCoverage(item);
              const isAllLangsSynced = Boolean(coverage?.isAllLangsSynced);
              const syncedCount = coverage?.syncedCount ?? SUPPORTED_LANGUAGES.length;
              const storedEntry = item.translations?.[language];
              const isStoredEntryValid = Boolean(coverage?.validMap[language] && storedEntry);

              const localized = isSeed
                ? {
                    title: item.title,
                    summary: item.summary,
                    resolvedLang: language,
                  }
                : isStoredEntryValid
                  ? {
                      title: storedEntry!.title,
                      summary: storedEntry!.summary,
                      resolvedLang: language,
                    }
                  : runtimeEntry
                    ? {
                        title: runtimeEntry.title,
                        summary: runtimeEntry.summary,
                        resolvedLang: language,
                      }
                    : resolveLocalizedUpdate(item, language);

              const resolvedDir = localized.resolvedLang === 'ar' ? 'rtl' : 'ltr';

              return (
                <motion.article
                  key={item.id}
                  initial={{ opacity: 0, y: 18 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.15 }}
                  whileHover={{ y: -2 }}
                  transition={{
                    duration: 0.4,
                    delay: Math.min(idx * 0.05, 0.25),
                    ease: EASE_OUT_EXPO,
                  }}
                  className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1527] p-6 sm:p-8 space-y-4"
                >
                  {/* Clean Unboxed Metadata Row (Zero-Pill Discipline) */}
                  <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono font-semibold text-blue-600 dark:text-sky-400 tabular-nums">
                        {item.version}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{categoryText}</span>
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums">{formatDate(item.createdAtMs)}</span>
                      {item.pinned && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-semibold text-slate-800 dark:text-slate-200">
                            {t.updatesSection.pinnedLabel}
                          </span>
                        </>
                      )}
                      {!item.published && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-semibold text-amber-600 dark:text-amber-400">
                            {t.updatesSection.draftLabel}
                          </span>
                        </>
                      )}
                      {isDeveloperAdmin && !isSeed && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span
                            className={
                              isAllLangsSynced
                                ? 'text-slate-500 dark:text-slate-400'
                                : 'font-medium text-amber-600 dark:text-amber-400 tabular-nums'
                            }
                          >
                            {isAllLangsSynced
                              ? autoCopy.autoSyncedLangsLabel
                              : `${syncedCount}/${SUPPORTED_LANGUAGES.length}`}
                          </span>
                        </>
                      )}
                    </div>

                    {/* Developer Inline Controls (Only on live Firestore documents) */}
                    {isDeveloperAdmin && !isSeed && (
                      <div className="flex flex-wrap items-center gap-2">
                        {!isAllLangsSynced && (
                          <button
                            type="button"
                            disabled={syncingRecordId === item.id}
                            onClick={() => void handleSyncAllLanguages(item)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-blue-200 dark:border-sky-800/80 bg-blue-50 dark:bg-sky-950/40 text-blue-700 dark:text-sky-300 hover:bg-blue-100 dark:hover:bg-sky-900/50 disabled:opacity-50 font-medium transition-colors cursor-pointer"
                          >
                            <Globe className="w-3 h-3" />
                            <span>
                              {syncingRecordId === item.id
                                ? autoCopy.syncingLangsBtn
                                : autoCopy.syncLangsBtn}
                            </span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void handleTogglePin(item)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-colors cursor-pointer"
                        >
                          <Pin className="w-3 h-3" />
                          <span>
                            {item.pinned ? t.updatesSection.unpinBtn : t.updatesSection.pinBtn}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleTogglePublish(item)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-colors cursor-pointer"
                        >
                          {item.published ? (
                            <>
                              <EyeOff className="w-3 h-3" />
                              <span>{t.updatesSection.unpublishBtn}</span>
                            </>
                          ) : (
                            <>
                              <Eye className="w-3 h-3" />
                              <span>{t.updatesSection.publishBtn}</span>
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditForm(item)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-colors cursor-pointer"
                        >
                          <Edit3 className="w-3 h-3" />
                          <span>{t.updatesSection.editBtn}</span>
                        </button>

                        {confirmDeleteId === item.id ? (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => void handleConfirmDelete(item.id)}
                              className="px-2.5 py-1 rounded-md bg-rose-600 text-white font-semibold hover:bg-rose-700 transition-colors cursor-pointer"
                            >
                              {t.updatesSection.confirmDeleteBtn}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-2 py-1 rounded-md border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 cursor-pointer"
                            >
                              {t.updatesSection.cancelBtn}
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(item.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-rose-200 dark:border-rose-900/60 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>{t.updatesSection.deleteBtn}</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  <div dir={resolvedDir} className="space-y-3">
                    <h3 className="font-display text-lg sm:text-xl font-bold text-slate-900 dark:text-white">
                      {localized.title}
                    </h3>

                    <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-line max-w-4xl">
                      {localized.summary}
                    </p>
                  </div>

                  {!isSeed && item.media && item.media.length > 0 && (
                    <UpdateMediaGallery media={item.media} copy={autoCopy} />
                  )}

                  {item.playStoreUrl && (
                    <div className="pt-2">
                      <a
                        href={item.playStoreUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 dark:text-sky-400 hover:underline underline-offset-4"
                      >
                        <span>{t.updatesSection.viewOnPlayStore}</span>
                        <ArrowUpRight className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  )}
                </motion.article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
