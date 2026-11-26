import { SupportedLanguage } from './types';

export interface UpdatesAutoTranslateCopy {
  autoTranslateNotice: string;
  translatingAndSavingBtn: string;
  autoSyncedLangsLabel: string;
  mediaSectionLabel: string;
  mediaOptionalHint: string;
  uploadPhotoBtn: string;
  uploadVideoBtn: string;
  addMediaUrlBtn: string;
  mediaUrlPlaceholder: string;
  mediaUrlKindPhoto: string;
  mediaUrlKindVideo: string;
  mediaUrlApplyBtn: string;
  mediaUrlInvalidError: string;
  mediaUploadingProgress: string;
  mediaTooLargeError: string;
  mediaUnsupportedError: string;
  mediaMaxItemsError: string;
  mediaRemoveBtn: string;
  mediaLoadingPreview: string;
  mediaLoadError: string;
  mediaCloseLightbox: string;
  mediaVideoBadge: string;
  mediaPhotoBadge: string;
  syncLangsBtn: string;
  syncingLangsBtn: string;
  partialTranslationNotice: string;
}

export const UPDATES_AUTO_TRANSLATE_COPY: Record<SupportedLanguage, UpdatesAutoTranslateCopy> = {
  id: {
    autoTranslateNotice:
      'Tulis satu kali saja — judul dan ringkasan otomatis diterjemahkan ke 8 bahasa mengikuti pilihan bahasa situs.',
    translatingAndSavingBtn: 'Menerjemahkan & menyimpan...',
    autoSyncedLangsLabel: 'Otomatis 8 bahasa',
    mediaSectionLabel: 'Foto & Video Pembaruan (Opsional)',
    mediaOptionalHint:
      'Tidak wajib. Unggah hingga 4 foto (JPG/PNG/WebP/GIF) atau video (MP4/WebM maks. 15 MB), atau tempel tautan media.',
    uploadPhotoBtn: 'Unggah Foto',
    uploadVideoBtn: 'Unggah Video',
    addMediaUrlBtn: 'Tautan Media',
    mediaUrlPlaceholder: 'https://... (tautan gambar, MP4, atau YouTube)',
    mediaUrlKindPhoto: 'Foto',
    mediaUrlKindVideo: 'Video',
    mediaUrlApplyBtn: 'Tambahkan',
    mediaUrlInvalidError: 'Gunakan tautan HTTPS yang valid (https://...).',
    mediaUploadingProgress: 'Mengunggah media',
    mediaTooLargeError: 'Ukuran file melebihi batas maksimal 15 MB. Untuk video besar, gunakan Tautan Media.',
    mediaUnsupportedError: 'Format tidak didukung. Pilih foto (JPG, PNG, WebP, GIF) atau video (MP4, WebM, MOV).',
    mediaMaxItemsError: 'Maksimal 4 foto/video per pembaruan.',
    mediaRemoveBtn: 'Hapus',
    mediaLoadingPreview: 'Memuat media...',
    mediaLoadError: 'Media tidak dapat dimuat.',
    mediaCloseLightbox: 'Tutup pratinjau',
    mediaVideoBadge: 'Video',
    mediaPhotoBadge: 'Foto',
    syncLangsBtn: 'Sinkronkan 8 Bahasa',
    syncingLangsBtn: 'Menyinkronkan...',
    partialTranslationNotice:
      'Sebagian bahasa belum tersinkron penuh karena batas kuota sementara. Klik "Sinkronkan 8 Bahasa" pada kartu untuk melengkapinya.',
  },
  en: {
    autoTranslateNotice:
      'Write once — title and summary are automatically translated into all 8 languages to match the site language selector.',
    translatingAndSavingBtn: 'Translating & saving...',
    autoSyncedLangsLabel: 'Auto 8 languages',
    mediaSectionLabel: 'Photos & Videos (Optional)',
    mediaOptionalHint:
      'Optional. Upload up to 4 photos (JPG/PNG/WebP/GIF) or videos (MP4/WebM up to 15 MB), or attach a media link.',
    uploadPhotoBtn: 'Upload Photo',
    uploadVideoBtn: 'Upload Video',
    addMediaUrlBtn: 'Media Link',
    mediaUrlPlaceholder: 'https://... (image, MP4, or YouTube URL)',
    mediaUrlKindPhoto: 'Photo',
    mediaUrlKindVideo: 'Video',
    mediaUrlApplyBtn: 'Attach',
    mediaUrlInvalidError: 'Please enter a valid HTTPS URL (https://...).',
    mediaUploadingProgress: 'Uploading media',
    mediaTooLargeError: 'File exceeds the 15 MB upload limit. For larger videos, use Media Link.',
    mediaUnsupportedError: 'Unsupported file format. Please choose a photo (JPG, PNG, WebP, GIF) or video (MP4, WebM, MOV).',
    mediaMaxItemsError: 'Maximum 4 media items per update.',
    mediaRemoveBtn: 'Remove',
    mediaLoadingPreview: 'Loading media...',
    mediaLoadError: 'Unable to load media.',
    mediaCloseLightbox: 'Close preview',
    mediaVideoBadge: 'Video',
    mediaPhotoBadge: 'Photo',
    syncLangsBtn: 'Sync 8 Languages',
    syncingLangsBtn: 'Syncing...',
    partialTranslationNotice:
      'Some languages are still pending due to a temporary translation limit. Click "Sync 8 Languages" on the card to complete all 8.',
  },
  es: {
    autoTranslateNotice:
      'Escriba una sola vez: el título y el resumen se traducen automáticamente a los 8 idiomas según el selector del sitio.',
    translatingAndSavingBtn: 'Traduciendo y guardando...',
    autoSyncedLangsLabel: '8 idiomas automáticos',
    mediaSectionLabel: 'Fotos y Videos (Opcional)',
    mediaOptionalHint:
      'Opcional. Sube hasta 4 fotos (JPG/PNG/WebP/GIF) o videos (MP4/WebM máx. 15 MB), o pega un enlace multimedia.',
    uploadPhotoBtn: 'Subir Foto',
    uploadVideoBtn: 'Subir Video',
    addMediaUrlBtn: 'Enlace Multimedia',
    mediaUrlPlaceholder: 'https://... (enlace de imagen, MP4 o YouTube)',
    mediaUrlKindPhoto: 'Foto',
    mediaUrlKindVideo: 'Video',
    mediaUrlApplyBtn: 'Añadir',
    mediaUrlInvalidError: 'Introduce una URL HTTPS válida (https://...).',
    mediaUploadingProgress: 'Subiendo archivo multimedia',
    mediaTooLargeError: 'El archivo supera el límite de 15 MB. Para videos grandes, usa Enlace Multimedia.',
    mediaUnsupportedError: 'Formato no compatible. Elige una foto (JPG, PNG, WebP, GIF) o video (MP4, WebM, MOV).',
    mediaMaxItemsError: 'Máximo 4 archivos multimedia por actualización.',
    mediaRemoveBtn: 'Eliminar',
    mediaLoadingPreview: 'Cargando multimedia...',
    mediaLoadError: 'No se pudo cargar el archivo multimedia.',
    mediaCloseLightbox: 'Cerrar vista previa',
    mediaVideoBadge: 'Video',
    mediaPhotoBadge: 'Foto',
    syncLangsBtn: 'Sincronizar 8 Idiomas',
    syncingLangsBtn: 'Sincronizando...',
    partialTranslationNotice:
      'Algunos idiomas aún están pendientes por un límite temporal. Haz clic en "Sincronizar 8 Idiomas" en la tarjeta para completarlos.',
  },
  fr: {
    autoTranslateNotice:
      'Rédigez une seule fois — le titre et le résumé sont automatiquement traduits dans les 8 langues selon la langue choisie sur le site.',
    translatingAndSavingBtn: 'Traduction et enregistrement...',
    autoSyncedLangsLabel: '8 langues auto',
    mediaSectionLabel: 'Photos et Vidéos (Optionnel)',
    mediaOptionalHint:
      'Facultatif. Importez jusqu’à 4 photos (JPG/PNG/WebP/GIF) ou vidéos (MP4/WebM max 15 Mo), ou collez un lien média.',
    uploadPhotoBtn: 'Importer Photo',
    uploadVideoBtn: 'Importer Vidéo',
    addMediaUrlBtn: 'Lien Média',
    mediaUrlPlaceholder: 'https://... (lien image, MP4 ou YouTube)',
    mediaUrlKindPhoto: 'Photo',
    mediaUrlKindVideo: 'Vidéo',
    mediaUrlApplyBtn: 'Ajouter',
    mediaUrlInvalidError: 'Veuillez saisir une URL HTTPS valide (https://...).',
    mediaUploadingProgress: 'Envoi du média',
    mediaTooLargeError: 'Le fichier dépasse la limite de 15 Mo. Pour les grandes vidéos, utilisez Lien Média.',
    mediaUnsupportedError: 'Format non pris en charge. Choisissez une photo (JPG, PNG, WebP, GIF) ou vidéo (MP4, WebM, MOV).',
    mediaMaxItemsError: 'Maximum 4 médias par mise à jour.',
    mediaRemoveBtn: 'Supprimer',
    mediaLoadingPreview: 'Chargement du média...',
    mediaLoadError: 'Impossible de charger le média.',
    mediaCloseLightbox: 'Fermer l’aperçu',
    mediaVideoBadge: 'Vidéo',
    mediaPhotoBadge: 'Photo',
    syncLangsBtn: 'Synchroniser 8 langues',
    syncingLangsBtn: 'Synchronisation...',
    partialTranslationNotice:
      'Certaines langues restent en attente suite à une limite temporaire. Cliquez sur « Synchroniser 8 langues » sur la carte pour les compléter.',
  },
  ja: {
    autoTranslateNotice:
      '1回入力するだけで、サイトの言語選択に合わせてタイトルと概要が全8言語へ自動翻訳されます。',
    translatingAndSavingBtn: '翻訳して保存中...',
    autoSyncedLangsLabel: '8言語自動対応',
    mediaSectionLabel: '写真・動画（任意）',
    mediaOptionalHint:
      '任意項目です。最大4件の写真（JPG/PNG/WebP/GIF）や動画（MP4/WebM 最大15MB）をアップロード、またはメディアURLを追加できます。',
    uploadPhotoBtn: '写真をアップロード',
    uploadVideoBtn: '動画をアップロード',
    addMediaUrlBtn: 'メディアURL',
    mediaUrlPlaceholder: 'https://...（画像・MP4・YouTubeのURL）',
    mediaUrlKindPhoto: '写真',
    mediaUrlKindVideo: '動画',
    mediaUrlApplyBtn: '追加',
    mediaUrlInvalidError: '有効なHTTPS URL（https://...）を入力してください。',
    mediaUploadingProgress: 'メディアをアップロード中',
    mediaTooLargeError: 'ファイルサイズが上限（15MB）を超えています。大容量の動画はメディアURLをご利用ください。',
    mediaUnsupportedError: '非対応の形式です。写真（JPG, PNG, WebP, GIF）または動画（MP4, WebM, MOV）を選択してください。',
    mediaMaxItemsError: '1件の更新につき最大4つまで添付できます。',
    mediaRemoveBtn: '削除',
    mediaLoadingPreview: 'メディアを読み込み中...',
    mediaLoadError: 'メディアを読み込めませんでした。',
    mediaCloseLightbox: 'プレビューを閉じる',
    mediaVideoBadge: '動画',
    mediaPhotoBadge: '写真',
    syncLangsBtn: '8言語を同期',
    syncingLangsBtn: '同期中...',
    partialTranslationNotice:
      '一時的な翻訳制限により一部の言語が未完了です。カードの「8言語を同期」をクリックして補完してください。',
  },
  ar: {
    autoTranslateNotice:
      'اكتب مرة واحدة فقط — تتم ترجمة العنوان والملخص تلقائياً إلى اللغات الثماني حسب اختيار لغة الموقع.',
    translatingAndSavingBtn: 'جارٍ الترجمة والحفظ...',
    autoSyncedLangsLabel: '8 لغات تلقائياً',
    mediaSectionLabel: 'الصور والفيديو (اختياري)',
    mediaOptionalHint:
      'اختياري. يمكنك رفع حتى 4 صور (JPG/PNG/WebP/GIF) أو مقاطع فيديو (MP4/WebM بحد أقصى 15 ميجابايت)، أو إضافة رابط وسائط.',
    uploadPhotoBtn: 'رفع صورة',
    uploadVideoBtn: 'رفع فيديو',
    addMediaUrlBtn: 'رابط وسائط',
    mediaUrlPlaceholder: 'https://... (رابط صورة أو MP4 أو YouTube)',
    mediaUrlKindPhoto: 'صورة',
    mediaUrlKindVideo: 'فيديو',
    mediaUrlApplyBtn: 'إضافة',
    mediaUrlInvalidError: 'يرجى إدخال رابط HTTPS صالح (https://...).',
    mediaUploadingProgress: 'جارٍ رفع الوسائط',
    mediaTooLargeError: 'يتجاوز حجم الملف الحد الأقصى (15 ميجابايت). للفيديوهات الكبيرة استخدم رابط وسائط.',
    mediaUnsupportedError: 'صيغة غير مدعومة. اختر صورة (JPG, PNG, WebP, GIF) أو فيديو (MP4, WebM, MOV).',
    mediaMaxItemsError: 'الحد الأقصى 4 ملفات وسائط لكل تحديث.',
    mediaRemoveBtn: 'إزالة',
    mediaLoadingPreview: 'جارٍ تحميل الوسائط...',
    mediaLoadError: 'تعذر تحميل الوسائط.',
    mediaCloseLightbox: 'إغلاق المعاينة',
    mediaVideoBadge: 'فيديو',
    mediaPhotoBadge: 'صورة',
    syncLangsBtn: 'مزامنة 8 لغات',
    syncingLangsBtn: 'جارٍ المزامنة...',
    partialTranslationNotice:
      'بعض اللغات بانتظار المزامنة بسبب حد مؤقت للترجمة. انقر على "مزامنة 8 لغات" لإكمالها.',
  },
  ru: {
    autoTranslateNotice:
      'Напишите один раз — заголовок и описание автоматически переводятся на все 8 языков в соответствии с выбором языка сайта.',
    translatingAndSavingBtn: 'Перевод и сохранение...',
    autoSyncedLangsLabel: 'Автоперевод (8 яз.)',
    mediaSectionLabel: 'Фото и видео (необязательно)',
    mediaOptionalHint:
      'Необязательно. Загрузите до 4 фото (JPG/PNG/WebP/GIF) или видео (MP4/WebM до 15 МБ), либо добавьте ссылку на медиа.',
    uploadPhotoBtn: 'Загрузить фото',
    uploadVideoBtn: 'Загрузить видео',
    addMediaUrlBtn: 'Ссылка на медиа',
    mediaUrlPlaceholder: 'https://... (ссылка на изображение, MP4 или YouTube)',
    mediaUrlKindPhoto: 'Фото',
    mediaUrlKindVideo: 'Видео',
    mediaUrlApplyBtn: 'Добавить',
    mediaUrlInvalidError: 'Введите корректный HTTPS-адрес (https://...).',
    mediaUploadingProgress: 'Загрузка медиафайла',
    mediaTooLargeError: 'Размер файла превышает 15 МБ. Для больших видео используйте «Ссылка на медиа».',
    mediaUnsupportedError: 'Неподдерживаемый формат. Выберите фото (JPG, PNG, WebP, GIF) или видео (MP4, WebM, MOV).',
    mediaMaxItemsError: 'Максимум 4 медиафайла на одно обновление.',
    mediaRemoveBtn: 'Удалить',
    mediaLoadingPreview: 'Загрузка медиа...',
    mediaLoadError: 'Не удалось загрузить медиафайл.',
    mediaCloseLightbox: 'Закрыть просмотр',
    mediaVideoBadge: 'Видео',
    mediaPhotoBadge: 'Фото',
    syncLangsBtn: 'Синхр. 8 языков',
    syncingLangsBtn: 'Синхронизация...',
    partialTranslationNotice:
      'Некоторые языки ожидают перевода из-за временного лимита. Нажмите «Синхр. 8 языков» на карточке, чтобы завершить перевод.',
  },
  ko: {
    autoTranslateNotice:
      '한 번만 작성하세요 — 사이트 언어 선택에 맞춰 제목과 요약이 8개 언어로 자동 번역됩니다.',
    translatingAndSavingBtn: '번역 및 저장 중...',
    autoSyncedLangsLabel: '8개 언어 자동 번역',
    mediaSectionLabel: '사진 및 동영상 (선택 사항)',
    mediaOptionalHint:
      '선택 사항입니다. 최대 4개의 사진(JPG/PNG/WebP/GIF) 또는 동영상(MP4/WebM 최대 15MB)을 업로드하거나 미디어 링크를 첨부할 수 있습니다.',
    uploadPhotoBtn: '사진 업로드',
    uploadVideoBtn: '동영상 업로드',
    addMediaUrlBtn: '미디어 링크',
    mediaUrlPlaceholder: 'https://... (이미지, MP4 또는 YouTube 링크)',
    mediaUrlKindPhoto: '사진',
    mediaUrlKindVideo: '동영상',
    mediaUrlApplyBtn: '추가',
    mediaUrlInvalidError: '유효한 HTTPS URL(https://...)을 입력해 주세요.',
    mediaUploadingProgress: '미디어 업로드 중',
    mediaTooLargeError: '파일 크기가 15MB 제한을 초과했습니다. 대용량 동영상은 미디어 링크를 사용해 주세요.',
    mediaUnsupportedError: '지원되지 않는 형식입니다. 사진(JPG, PNG, WebP, GIF) 또는 동영상(MP4, WebM, MOV)을 선택해 주세요.',
    mediaMaxItemsError: '업데이트당 최대 4개까지 첨부할 수 있습니다.',
    mediaRemoveBtn: '삭제',
    mediaLoadingPreview: '미디어 불러오는 중...',
    mediaLoadError: '미디어를 불러올 수 없습니다.',
    mediaCloseLightbox: '미리보기 닫기',
    mediaVideoBadge: '동영상',
    mediaPhotoBadge: '사진',
    syncLangsBtn: '8개 언어 동기화',
    syncingLangsBtn: '동기화 중...',
    partialTranslationNotice:
      '일시적인 번역 제한으로 일부 언어가 대기 중입니다. 카드의 "8개 언어 동기화"를 눌러 완료하세요.',
  },
};
