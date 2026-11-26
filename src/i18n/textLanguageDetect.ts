export type DetectedLanguageCode = 'id' | 'en' | 'es' | 'fr' | 'ja' | 'ar' | 'ru' | 'ko';

const LATIN_STOPWORDS: Record<'id' | 'en' | 'es' | 'fr', readonly string[]> = {
  id: [
    'yang',
    'dan',
    'untuk',
    'dengan',
    'pada',
    'dari',
    'ke',
    'di',
    'tidak',
    'lebih',
    'baru',
    'fitur',
    'perbaikan',
    'catatan',
    'pembaruan',
    'peningkatan',
    'stabilitas',
    'keamanan',
    'keuangan',
    'tabungan',
    'pengeluaran',
    'pengingat',
    'sekarang',
    'bisa',
    'dapat',
    'aplikasi',
    'versi',
    'rilis',
    'pengguna',
    'atau',
    'serta',
    'tanpa',
    'kini',
    'sudah',
    'tampilan',
    'mode',
    'gelap',
    'terang',
    'cadangan',
    'harian',
    'lengkap',
    'segera',
    'hadir',
    'ditambahkan',
    'diperbaiki',
    'ditingkatkan',
    'mendukung',
  ],
  en: [
    'the',
    'and',
    'for',
    'with',
    'new',
    'update',
    'added',
    'fixed',
    'improved',
    'improve',
    'feature',
    'features',
    'notes',
    'performance',
    'sync',
    'backup',
    'now',
    'all',
    'users',
    'bug',
    'fixes',
    'release',
    'version',
    'better',
    'faster',
    'more',
    'from',
    'to',
    'in',
    'on',
    'your',
    'this',
    'that',
    'is',
    'are',
    'support',
    'dark',
    'calendar',
    'reminder',
    'reminders',
    'scanner',
    'savings',
    'expenses',
    'offline',
    'online',
    'stability',
    'security',
  ],
  es: [
    'el',
    'la',
    'los',
    'las',
    'de',
    'del',
    'con',
    'para',
    'por',
    'una',
    'uno',
    'nuevo',
    'nueva',
    'nuevas',
    'nuevos',
    'actualización',
    'mejoras',
    'corrección',
    'funciones',
    'notas',
    'versión',
    'ahora',
    'más',
    'sin',
    'también',
    'errores',
    'copia',
    'seguridad',
    'calendario',
    'ahorros',
    'gastos',
  ],
  fr: [
    'le',
    'la',
    'les',
    'des',
    'une',
    'avec',
    'pour',
    'dans',
    'sur',
    'nouvelle',
    'nouveau',
    'nouvelles',
    'mise',
    'jour',
    'fonctionnalités',
    'améliorations',
    'corrections',
    'notes',
    'sauvegarde',
    'maintenant',
    'plus',
    'sans',
    'version',
    'sécurité',
    'calendrier',
    'dépenses',
    'épargne',
    'meilleure',
  ],
};

/**
 * Strips known product/technical terms that appear across every language
 * so they do not skew Latin-script language detection toward English.
 */
function stripUniversalProductTokens(input: string): string {
  return input
    .replace(/\bComplete Notebook\b/gi, ' ')
    .replace(/\bRyhStar Innovation\b/gi, ' ')
    .replace(/\bGoogle Play Store\b/gi, ' ')
    .replace(/\bGoogle Play\b/gi, ' ')
    .replace(/\bGoogle Drive\b/gi, ' ')
    .replace(/\bApp Store\b/gi, ' ')
    .replace(/\bDark Mode\b/gi, ' ')
    .replace(/\bLight Mode\b/gi, ' ')
    .replace(/\b(OCR|PDF|MP3|PIN|UI|UX|iOS|Android|cnot)\b/gi, ' ');
}

export function detectTextLanguageStrict(text: string): DetectedLanguageCode | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  if (/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(trimmed)) return 'ar';
  if (/[\u3040-\u309F\u30A0-\u30FF]/.test(trimmed)) return 'ja';
  if (/[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/.test(trimmed)) return 'ko';
  if (/[\u0400-\u04FF]/.test(trimmed)) return 'ru';

  const cleaned = stripUniversalProductTokens(trimmed).toLowerCase();
  const words = cleaned.match(/[a-záéíóúüñçœàèêëîïôûù]+/g) ?? [];

  const scores: Record<'id' | 'en' | 'es' | 'fr', number> = {
    id: 0,
    en: 0,
    es: 0,
    fr: 0,
  };

  if (/[ñ¿¡áíóúü]/.test(cleaned)) scores.es += 2;
  if (/[çœàèêëîïôûù]/.test(cleaned)) scores.fr += 2;

  for (const word of words) {
    for (const lang of ['id', 'en', 'es', 'fr'] as const) {
      if (LATIN_STOPWORDS[lang].includes(word)) {
        scores[lang] += 2;
      }
    }
    // High-signal Indonesian affixes (pe-..-an, di-..-kan, meng-/ber-)
    if (word.length >= 6 && /^(pem|pen|peng|per|di|meng|mem|men|ber)/.test(word)) {
      scores.id += 0.6;
    }
    // High-signal English suffixes (-ing, -tion, -ed, -ly)
    if (word.length >= 5 && /(ing|tion|ment|ized|ised)$/.test(word)) {
      scores.en += 0.5;
    }
  }

  let bestLang: 'id' | 'en' | 'es' | 'fr' | null = null;
  let bestScore = 0;
  let secondScore = 0;

  for (const lang of ['id', 'en', 'es', 'fr'] as const) {
    const score = scores[lang];
    if (score > bestScore) {
      secondScore = bestScore;
      bestScore = score;
      bestLang = lang;
    } else if (score > secondScore) {
      secondScore = score;
    }
  }

  if (!bestLang || bestScore < 1.5 || bestScore === secondScore) {
    return null;
  }

  return bestLang;
}

export function detectTextLanguage(
  text: string,
  fallbackLang: DetectedLanguageCode = 'en'
): DetectedLanguageCode {
  return detectTextLanguageStrict(text) ?? fallbackLang;
}

/**
 * Returns true if a stored localized entry is clearly written in a different language
 * than `declaredLang` (for example, an English post previously saved inside the `id` slot).
 */
export function isEntryMismatchedWithLanguage(
  title: string,
  summary: string,
  declaredLang: DetectedLanguageCode
): boolean {
  const detected = detectTextLanguageStrict(`${title}\n${summary}`);
  return detected !== null && detected !== declaredLang;
}

const REQUIRED_SCRIPT_REGEX: Partial<Record<DetectedLanguageCode, RegExp>> = {
  ja: /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/,
  ar: /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/,
  ru: /[\u0400-\u04FF]/,
  ko: /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/,
};

/**
 * Validates that a stored translation entry genuinely belongs to `declaredLang`
 * rather than being an untranslated copy left over from a failed/rate-limited save.
 */
export function isStoredTranslationEntryValid(
  title: string | undefined,
  summary: string | undefined,
  declaredLang: DetectedLanguageCode,
  sourceLang?: DetectedLanguageCode,
  sourceTitle?: string,
  sourceSummary?: string,
  enTitle?: string,
  enSummary?: string
): boolean {
  const t = (title ?? '').trim();
  const s = (summary ?? '').trim();
  if (!t || !s) return false;

  const combined = `${t}\n${s}`;
  const requiredScript = REQUIRED_SCRIPT_REGEX[declaredLang];
  if (requiredScript && !requiredScript.test(combined)) {
    return false;
  }

  const strictDetected = detectTextLanguageStrict(combined);
  if (strictDetected !== null && strictDetected !== declaredLang) {
    return false;
  }

  if (
    sourceLang &&
    declaredLang !== sourceLang &&
    sourceTitle &&
    sourceSummary &&
    t === sourceTitle.trim() &&
    s === sourceSummary.trim() &&
    strictDetected !== declaredLang
  ) {
    return false;
  }

  if (
    declaredLang !== 'en' &&
    enTitle &&
    enSummary &&
    t === enTitle.trim() &&
    s === enSummary.trim() &&
    strictDetected !== declaredLang
  ) {
    return false;
  }

  return true;
}

