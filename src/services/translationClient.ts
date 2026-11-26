import { SITE_CONFIG } from '../config/siteConfig';
import { SUPPORTED_LANGUAGES, SupportedLanguage } from '../i18n/types';
import {
  detectTextLanguage,
  detectTextLanguageStrict,
  isStoredTranslationEntryValid,
} from '../i18n/textLanguageDetect';
import { LocalizedUpdateText, UpdateTranslationsMap } from './firebase';

interface TranslateApiResponse {
  translations?: UpdateTranslationsMap;
  detectedSourceLang?: string;
  error?: string;
}

export interface FullTranslationResult {
  translations: UpdateTranslationsMap;
  detectedSourceLang?: SupportedLanguage;
  isComplete?: boolean;
}

function isSupportedLanguageCode(val: unknown): val is SupportedLanguage {
  return (
    typeof val === 'string' && SUPPORTED_LANGUAGES.some((langMeta) => langMeta.code === val)
  );
}

const RUNTIME_CACHE_PREFIX = 'cn_auto_tx_v3_';
const MAX_LOCAL_CACHE_KEYS = 80;
const memoryTranslationCache = new Map<string, LocalizedUpdateText>();
const inflightRequests = new Map<string, Promise<UpdateTranslationsMap>>();

let serverUnavailablePermanent = false;
let serverCooldownUntilMs = 0;

function isServerApiEligible(): boolean {
  if (serverUnavailablePermanent) return false;
  return Date.now() >= serverCooldownUntilMs;
}

function makeRuntimeCacheKey(
  recordId: string,
  updatedAtMs: number,
  targetLang: SupportedLanguage
): string {
  return `${RUNTIME_CACHE_PREFIX}${recordId}_${updatedAtMs}_${targetLang}`;
}

export function getCachedRuntimeTranslation(
  recordId: string,
  updatedAtMs: number,
  targetLang: SupportedLanguage,
  sourceLang?: SupportedLanguage,
  sourceTitle?: string,
  sourceSummary?: string
): LocalizedUpdateText | null {
  const key = makeRuntimeCacheKey(recordId, updatedAtMs, targetLang);
  const mem = memoryTranslationCache.get(key);
  if (
    mem &&
    isStoredTranslationEntryValid(
      mem.title,
      mem.summary,
      targetLang,
      sourceLang,
      sourceTitle,
      sourceSummary
    )
  ) {
    return mem;
  }

  for (const storage of [
    () => (typeof sessionStorage !== 'undefined' ? sessionStorage : null),
    () => (typeof localStorage !== 'undefined' ? localStorage : null),
  ]) {
    try {
      const store = storage();
      const raw = store?.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw) as LocalizedUpdateText;
        if (
          parsed?.title &&
          parsed?.summary &&
          isStoredTranslationEntryValid(
            parsed.title,
            parsed.summary,
            targetLang,
            sourceLang,
            sourceTitle,
            sourceSummary
          )
        ) {
          memoryTranslationCache.set(key, parsed);
          return parsed;
        }
      }
    } catch {
      // Ignore storage read restrictions
    }
  }
  return null;
}

function pruneOldLocalCacheEntries(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(RUNTIME_CACHE_PREFIX)) {
        keys.push(k);
      }
    }
    if (keys.length >= MAX_LOCAL_CACHE_KEYS) {
      const removeCount = keys.length - MAX_LOCAL_CACHE_KEYS + 10;
      for (let i = 0; i < removeCount; i++) {
        localStorage.removeItem(keys[i]);
      }
    }
  } catch {
    // Ignore storage cleanup errors
  }
}

function storeCachedRuntimeTranslation(
  recordId: string,
  updatedAtMs: number,
  targetLang: SupportedLanguage,
  entry: LocalizedUpdateText
): void {
  const key = makeRuntimeCacheKey(recordId, updatedAtMs, targetLang);
  memoryTranslationCache.set(key, entry);
  const serialized = JSON.stringify(entry);
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(key, serialized);
    }
  } catch {
    // Ignore sessionStorage quota limits
  }
  try {
    if (typeof localStorage !== 'undefined') {
      pruneOldLocalCacheEntries();
      localStorage.setItem(key, serialized);
    }
  } catch {
    // Ignore localStorage quota limits
  }
}

export class TranslationServiceUnavailableError extends Error {
  public readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'TranslationServiceUnavailableError';
    this.status = status;
  }
}

class TranslationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TranslationValidationError';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampClientLocalizedEntry(
  rawTitle: string,
  rawSummary: string,
  fallbackTitle: string,
  fallbackSummary: string
): LocalizedUpdateText {
  const { titleMin, titleMax, summaryMin, summaryMax } = SITE_CONFIG.validation;
  let title = rawTitle.trim();
  let summary = rawSummary.trim();

  if (title.length === 0) {
    title = fallbackTitle.trim();
  } else if (title.length < titleMin) {
    title = `${title} — Complete Notebook`;
  }
  if (title.length > titleMax) {
    title = title.slice(0, titleMax).trim();
  }
  if (title.length < titleMin) {
    title = fallbackTitle.trim().slice(0, titleMax);
  }

  if (summary.length === 0) {
    summary = fallbackSummary.trim();
  } else if (summary.length < summaryMin) {
    summary = `${summary} (Complete Notebook)`;
  }
  if (summary.length > summaryMax) {
    summary = summary.slice(0, summaryMax).trim();
  }
  if (summary.length < summaryMin) {
    summary = fallbackSummary.trim().slice(0, summaryMax);
  }

  return { title, summary };
}

function splitClientChunks(text: string, maxChunkLen = 400): string[] {
  const lines = text.split('\n');
  const chunks: string[] = [];

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) {
      chunks.push('');
      continue;
    }
    if (trimmedLine.length <= maxChunkLen) {
      chunks.push(trimmedLine);
      continue;
    }

    const words = trimmedLine.split(/\s+/);
    let current = '';
    for (const word of words) {
      if ((current + ' ' + word).trim().length > maxChunkLen) {
        if (current) chunks.push(current.trim());
        current = word.slice(0, maxChunkLen);
      } else {
        current = current ? `${current} ${word}` : word;
      }
    }
    if (current) chunks.push(current.trim());
  }

  return chunks;
}

function preserveBrandTokens(text: string): { masked: string; restore: (s: string) => string } {
  const brands = [
    'Complete Notebook',
    'RyhStar Innovation',
    'Google Play Store',
    'Google Play',
    'Google Drive',
    'App Store',
  ];
  let masked = text;
  const tokens: Array<{ token: string; value: string }> = [];

  brands.forEach((brand, index) => {
    const regex = new RegExp(brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    if (regex.test(masked)) {
      const token = `CNBRAND${index}X`;
      masked = masked.replace(regex, token);
      tokens.push({ token, value: brand });
    }
  });

  const restore = (output: string): string => {
    let restored = output;
    for (const item of tokens) {
      const tokenRegex = new RegExp(item.token, 'gi');
      restored = restored.replace(tokenRegex, item.value);
    }
    return restored;
  };

  return { masked, restore };
}

async function translateClientSegment(
  segment: string,
  sourceLang: SupportedLanguage,
  targetLang: SupportedLanguage
): Promise<string> {
  if (!segment.trim() || sourceLang === targetLang) return segment;

  const { masked, restore } = preserveBrandTokens(segment);
  const url =
    `https://api.mymemory.translated.net/get?q=${encodeURIComponent(masked)}` +
    `&langpair=${encodeURIComponent(`${sourceLang}|${targetLang}`)}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
    if (res.status === 429 && attempt === 0) {
      await sleep(450);
      continue;
    }
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = (await res.json()) as {
      responseStatus?: number;
      responseData?: { translatedText?: string };
    };
    const translated = data?.responseData?.translatedText;
    if (data?.responseStatus === 429 && attempt === 0) {
      await sleep(450);
      continue;
    }
    if (
      typeof translated !== 'string' ||
      !translated.trim() ||
      data?.responseStatus === 429 ||
      translated.toUpperCase().includes('MYMEMORY WARNING')
    ) {
      throw new Error('Fallback translation unavailable');
    }

    const unescaped = translated
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");

    return restore(unescaped).trim();
  }

  throw new Error('Fallback translation unavailable');
}

async function translateTextViaClientFallback(
  text: string,
  sourceLang: SupportedLanguage,
  targetLang: SupportedLanguage
): Promise<string> {
  if (sourceLang === targetLang) return text;
  const chunks = splitClientChunks(text, 400);
  const results: string[] = [];
  for (const chunk of chunks) {
    if (chunk === '') {
      results.push('');
    } else {
      results.push(await translateClientSegment(chunk, sourceLang, targetLang));
    }
  }
  return results.join('\n').trim();
}

/**
 * Browser-side fallback: translates requested target languages with controlled concurrency
 * (2 languages at a time) so static-hosted or rate-limited environments do not trigger 429 bursts.
 */
async function translateViaClientFallback(
  title: string,
  summary: string,
  targetLangs: SupportedLanguage[],
  sourceHint: SupportedLanguage = 'en'
): Promise<FullTranslationResult> {
  const detectedSourceLang = detectTextLanguage(`${title}\n${summary}`, sourceHint);
  const translations: UpdateTranslationsMap = {};
  let succeededCount = 0;

  const nonSourceTargets: SupportedLanguage[] = [];
  for (const code of targetLangs) {
    if (code === detectedSourceLang) {
      translations[code] = clampClientLocalizedEntry(title, summary, title, summary);
      succeededCount++;
    } else {
      nonSourceTargets.push(code);
    }
  }

  for (let i = 0; i < nonSourceTargets.length; i += 2) {
    const batch = nonSourceTargets.slice(i, i + 2);
    await Promise.all(
      batch.map(async (code) => {
        try {
          const [txTitle, txSummary] = await Promise.all([
            translateTextViaClientFallback(title, detectedSourceLang, code),
            translateTextViaClientFallback(summary, detectedSourceLang, code),
          ]);
          const entry = clampClientLocalizedEntry(txTitle, txSummary, title, summary);
          if (
            isStoredTranslationEntryValid(
              entry.title,
              entry.summary,
              code,
              detectedSourceLang,
              title,
              summary
            )
          ) {
            translations[code] = entry;
            succeededCount++;
          }
        } catch {
          // Skip failed target language rather than storing untranslated text under wrong locale
        }
      })
    );
    if (i + 2 < nonSourceTargets.length) {
      await sleep(180);
    }
  }

  if (succeededCount === 0) {
    throw new TranslationServiceUnavailableError('Client fallback translation failed.', 503);
  }

  return {
    translations,
    detectedSourceLang,
    isComplete: targetLangs.every((c) => Boolean(translations[c]?.title)),
  };
}

async function callServerTranslateApi(
  trimmedTitle: string,
  trimmedSummary: string,
  targetLangs: SupportedLanguage[],
  sourceLangHint?: SupportedLanguage
): Promise<{
  translations: UpdateTranslationsMap;
  detectedSourceLang?: SupportedLanguage;
} | null> {
  if (!isServerApiEligible() || targetLangs.length === 0) {
    return null;
  }

  try {
    const response = await fetch('/api/translate-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: trimmedTitle,
        summary: trimmedSummary,
        targetLangs,
        sourceLangHint,
      }),
    });

    if (response.status === 400) {
      const errData = (await response.json().catch(() => ({}))) as TranslateApiResponse;
      throw new TranslationValidationError(
        errData.error || `Translation request failed (${response.status}).`
      );
    }

    if (response.status === 404) {
      // Static-only hosting (e.g., GitHub Pages) has no Express API routes
      serverUnavailablePermanent = true;
      return null;
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      serverUnavailablePermanent = true;
      return null;
    }

    if (!response.ok) {
      if (response.status === 429 || response.status === 503) {
        serverCooldownUntilMs = Date.now() + 60_000;
      }
      return null;
    }

    const payload = (await response.json()) as TranslateApiResponse;
    if (!payload.translations) {
      return null;
    }

    const detected = isSupportedLanguageCode(payload.detectedSourceLang)
      ? payload.detectedSourceLang
      : detectTextLanguage(`${trimmedTitle}\n${trimmedSummary}`, sourceLangHint ?? 'en');

    const validated: UpdateTranslationsMap = {};
    for (const code of targetLangs) {
      const candidate = payload.translations[code];
      if (!candidate?.title || !candidate?.summary) continue;
      if (
        code === detected ||
        isStoredTranslationEntryValid(
          candidate.title,
          candidate.summary,
          code,
          detected,
          trimmedTitle,
          trimmedSummary
        )
      ) {
        validated[code] = {
          title: candidate.title.trim(),
          summary: candidate.summary.trim(),
        };
      }
    }

    return {
      translations: validated,
      detectedSourceLang: detected,
    };
  } catch (err) {
    if (err instanceof TranslationValidationError) {
      throw err;
    }
    return null;
  }
}

/**
 * Translates an Admin release update into all 8 supported website languages at once
 * so visitors switching the language selector see instant localized text from Firestore.
 */
export async function translateUpdateToAllLanguages(
  title: string,
  summary: string,
  sourceHint: SupportedLanguage = 'en'
): Promise<FullTranslationResult> {
  const trimmedTitle = title.trim();
  const trimmedSummary = summary.trim();
  const allCodes = SUPPORTED_LANGUAGES.map((l) => l.code);
  const detectedHint = detectTextLanguage(`${trimmedTitle}\n${trimmedSummary}`, sourceHint);

  const combined: UpdateTranslationsMap = {
    [detectedHint]: clampClientLocalizedEntry(
      trimmedTitle,
      trimmedSummary,
      trimmedTitle,
      trimmedSummary
    ),
  };
  let resolvedSource: SupportedLanguage = detectedHint;

  const serverRes = await callServerTranslateApi(
    trimmedTitle,
    trimmedSummary,
    allCodes,
    detectedHint
  );

  if (serverRes) {
    if (serverRes.detectedSourceLang) {
      resolvedSource = serverRes.detectedSourceLang;
      combined[resolvedSource] = clampClientLocalizedEntry(
        trimmedTitle,
        trimmedSummary,
        trimmedTitle,
        trimmedSummary
      );
    }
    for (const code of allCodes) {
      const entry = serverRes.translations[code];
      if (entry) {
        combined[code] = entry;
      }
    }
  }

  const missingCodes = allCodes.filter((code) => !combined[code]);
  if (missingCodes.length > 0) {
    try {
      const clientRes = await translateViaClientFallback(
        trimmedTitle,
        trimmedSummary,
        missingCodes,
        resolvedSource
      );
      for (const code of missingCodes) {
        const entry = clientRes.translations[code];
        if (entry) {
          combined[code] = entry;
        }
      }
    } catch {
      // If server translated some languages, return partial valid entries;
      // if zero non-source languages were translated at all, signal unavailable.
      const nonSourceTranslated = allCodes.filter(
        (code) => code !== resolvedSource && Boolean(combined[code])
      ).length;
      if (nonSourceTranslated === 0) {
        throw new TranslationServiceUnavailableError('Translation service unavailable.', 503);
      }
    }
  }

  return {
    translations: combined,
    detectedSourceLang: resolvedSource,
    isComplete: allCodes.every((c) => Boolean(combined[c]?.title)),
  };
}

/**
 * Dynamically translates missing or corrupted languages for a Firestore update record.
 * When the Express server is available, requests all missing languages in a single call
 * to conserve API quota; on static hosts or quota fallback, translates `activeLang` via browser.
 */
export async function translateMissingRecordLanguages(
  recordId: string,
  updatedAtMs: number,
  title: string,
  summary: string,
  missingLangs: SupportedLanguage[],
  activeLang: SupportedLanguage,
  sourceLangHint?: SupportedLanguage
): Promise<UpdateTranslationsMap> {
  const trimmedTitle = title.trim();
  const trimmedSummary = summary.trim();
  const strictDetected = detectTextLanguageStrict(`${trimmedTitle}\n${trimmedSummary}`);
  const effectiveSource = strictDetected ?? sourceLangHint ?? 'en';

  const resolvedMap: UpdateTranslationsMap = {};
  const uncachedTargets: SupportedLanguage[] = [];

  for (const code of missingLangs) {
    if (strictDetected && code === strictDetected) {
      resolvedMap[code] = { title: trimmedTitle, summary: trimmedSummary };
      continue;
    }
    const cached = getCachedRuntimeTranslation(
      recordId,
      updatedAtMs,
      code,
      effectiveSource,
      trimmedTitle,
      trimmedSummary
    );
    if (cached) {
      resolvedMap[code] = cached;
    } else {
      uncachedTargets.push(code);
    }
  }

  if (uncachedTargets.length === 0) {
    return resolvedMap;
  }

  const inflightKey = `${recordId}_${updatedAtMs}_${activeLang}`;
  const existing = inflightRequests.get(inflightKey);
  if (existing) return existing;

  const requestPromise = (async (): Promise<UpdateTranslationsMap> => {
    try {
      const serverRes = await callServerTranslateApi(
        trimmedTitle,
        trimmedSummary,
        uncachedTargets,
        effectiveSource
      );

      if (serverRes) {
        const detected = serverRes.detectedSourceLang ?? effectiveSource;
        for (const [langKey, entry] of Object.entries(serverRes.translations) as Array<
          [SupportedLanguage, LocalizedUpdateText]
        >) {
          if (
            entry &&
            (langKey === detected ||
              isStoredTranslationEntryValid(
                entry.title,
                entry.summary,
                langKey,
                detected,
                trimmedTitle,
                trimmedSummary
              ))
          ) {
            resolvedMap[langKey] = entry;
            storeCachedRuntimeTranslation(recordId, updatedAtMs, langKey, entry);
          }
        }
      }

      // If activeLang still has no valid translation, fall back in browser for activeLang specifically
      if (!resolvedMap[activeLang] && uncachedTargets.includes(activeLang)) {
        try {
          const clientRes = await translateViaClientFallback(
            trimmedTitle,
            trimmedSummary,
            [activeLang],
            effectiveSource
          );
          const entry = clientRes.translations[activeLang];
          if (
            entry &&
            isStoredTranslationEntryValid(
              entry.title,
              entry.summary,
              activeLang,
              effectiveSource,
              trimmedTitle,
              trimmedSummary
            )
          ) {
            resolvedMap[activeLang] = entry;
            storeCachedRuntimeTranslation(recordId, updatedAtMs, activeLang, entry);
          }
        } catch {
          // Return whatever succeeded
        }
      }

      return resolvedMap;
    } finally {
      inflightRequests.delete(inflightKey);
    }
  })();

  inflightRequests.set(inflightKey, requestPromise);
  return requestPromise;
}
