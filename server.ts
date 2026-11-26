import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel, Type, type Schema } from '@google/genai';
import { detectTextLanguage, isStoredTranslationEntryValid } from './src/i18n/textLanguageDetect.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3000;

const ALLOWED_LANGUAGES = ['id', 'en', 'es', 'fr', 'ja', 'ar', 'ru', 'ko'] as const;
type AllowedLang = (typeof ALLOWED_LANGUAGES)[number];

const LANGUAGE_DESCRIPTIONS: Record<AllowedLang, string> = {
  id: 'Indonesian (Bahasa Indonesia)',
  en: 'English (International)',
  es: 'Spanish (Español)',
  fr: 'French (Français)',
  ja: 'Japanese (日本語)',
  ar: 'Arabic (العربية - Modern Standard Arabic)',
  ru: 'Russian (Русский)',
  ko: 'Korean (한국어)',
};

// Active @google/genai text models with automatic high-availability fallback
const TRANSLATION_MODELS = [
  'gemini-4-hydrogen',
  'gemini-3.1-flash-lite',
] as const;

interface LocalizedEntry {
  title: string;
  summary: string;
}

type TranslationsPayload = Partial<Record<AllowedLang, LocalizedEntry>>;
type DetectedSourceLang = AllowedLang | 'other';

interface TranslationCacheEntry {
  translations: TranslationsPayload;
  detectedSourceLang: DetectedSourceLang;
}

// In-memory LRU cache to avoid redundant model calls for identical source text + language sets
const translationCache = new Map<string, TranslationCacheEntry>();
const MAX_CACHE_ENTRIES = 200;

function setCachedTranslation(key: string, value: TranslationCacheEntry): void {
  if (translationCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = translationCache.keys().next().value;
    if (oldestKey) {
      translationCache.delete(oldestKey);
    }
  }
  translationCache.set(key, value);
}

function clampLocalizedEntry(
  raw: unknown,
  fallbackTitle: string,
  fallbackSummary: string
): LocalizedEntry {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  let title = typeof obj.title === 'string' ? obj.title.trim() : '';
  let summary = typeof obj.summary === 'string' ? obj.summary.trim() : '';

  if (title.length === 0) {
    title = fallbackTitle;
  } else if (title.length < 3) {
    // Preserve compact CJK translations (e.g. 2-char Japanese/Korean nouns) while satisfying Firestore >= 3 chars
    title = `${title} — Complete Notebook`;
  }
  if (title.length > 140) {
    title = title.slice(0, 140).trim();
  }
  if (title.length < 3) {
    title = fallbackTitle.slice(0, 140);
  }

  if (summary.length === 0) {
    summary = fallbackSummary;
  } else if (summary.length < 10) {
    // Preserve compact CJK summaries while satisfying Firestore >= 10 chars
    summary = `${summary} (Complete Notebook)`;
  }
  if (summary.length > 3000) {
    summary = summary.slice(0, 3000).trim();
  }
  if (summary.length < 10) {
    summary = fallbackSummary.slice(0, 3000);
  }

  return { title, summary };
}

function isAllowedLang(val: unknown): val is AllowedLang {
  return typeof val === 'string' && (ALLOWED_LANGUAGES as readonly string[]).includes(val);
}

function isTransientCapacityError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('503') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('429') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('high demand') ||
    msg.includes('TimeoutError') ||
    msg.includes('aborted') ||
    msg.includes('timed out')
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getGenAIClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Server translation service is missing GEMINI_API_KEY configuration.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: { 'User-Agent': 'aistudio-build' },
    },
  });
}

function formatUpstreamError(err: unknown): { status: number; message: string } {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes('PERMISSION_DENIED') || raw.includes('API_KEY_INVALID') || raw.includes('403')) {
    return {
      status: 403,
      message: 'Translation API key error. Please check GEMINI_API_KEY in Settings > Secrets.',
    };
  }
  if (isTransientCapacityError(err)) {
    return {
      status: 503,
      message:
        'The translation service is experiencing temporary high demand. Please try again in a few seconds.',
    };
  }
  try {
    const parsed = JSON.parse(raw) as { error?: { code?: number; message?: string } };
    if (parsed?.error?.message) {
      return {
        status: typeof parsed.error.code === 'number' ? parsed.error.code : 500,
        message: parsed.error.message,
      };
    }
  } catch {
    // Plain string message
  }
  return { status: 500, message: raw || 'Failed to translate release update.' };
}

function splitTextIntoChunks(text: string, maxChunkLen = 400): string[] {
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

async function translateSegmentViaMyMemory(
  segment: string,
  sourceLang: AllowedLang,
  targetLang: AllowedLang
): Promise<string> {
  if (!segment.trim() || sourceLang === targetLang) {
    return segment;
  }

  const { masked, restore } = preserveBrandTokens(segment);
  const url =
    `https://api.mymemory.translated.net/get?q=${encodeURIComponent(masked)}` +
    `&langpair=${encodeURIComponent(`${sourceLang}|${targetLang}`)}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(7000),
  });
  if (!res.ok) {
    throw new Error(`Fallback translation HTTP ${res.status}`);
  }

  const data = (await res.json()) as {
    responseStatus?: number;
    responseData?: { translatedText?: string };
  };

  const rawOut = data?.responseData?.translatedText;
  if (typeof rawOut !== 'string' || !rawOut.trim() || data?.responseStatus === 429) {
    throw new Error('Fallback translation empty or rate-limited');
  }

  // Decode common HTML entities if returned by fallback endpoint
  const unescaped = rawOut
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  return restore(unescaped).trim();
}

async function translateTextViaMyMemory(
  text: string,
  sourceLang: AllowedLang,
  targetLang: AllowedLang
): Promise<string> {
  if (sourceLang === targetLang) return text;
  const chunks = splitTextIntoChunks(text, 400);
  const translatedChunks = await Promise.all(
    chunks.map((chunk) =>
      chunk === '' ? Promise.resolve('') : translateSegmentViaMyMemory(chunk, sourceLang, targetLang)
    )
  );
  return translatedChunks.join('\n').trim();
}

async function translateWithMyMemoryServerFallback(
  rawTitle: string,
  rawSummary: string,
  targetLangs: AllowedLang[],
  sourceHint?: AllowedLang
): Promise<{ entry: TranslationCacheEntry; allTranslated: boolean; translatedCount: number }> {
  const detectedSourceLang = detectTextLanguage(
    `${rawTitle}\n${rawSummary}`,
    sourceHint ?? 'en'
  );
  const translations: TranslationsPayload = {};
  let nonSourceAttempted = 0;
  let nonSourceSucceeded = 0;

  const nonSourceTargets: AllowedLang[] = [];
  for (const code of targetLangs) {
    if (code === detectedSourceLang) {
      translations[code] = clampLocalizedEntry(
        { title: rawTitle, summary: rawSummary },
        rawTitle,
        rawSummary
      );
    } else {
      nonSourceTargets.push(code);
    }
  }

  // Throttle requests (batch size 2) so MyMemory does not rate-limit concurrent bursts
  for (let i = 0; i < nonSourceTargets.length; i += 2) {
    const batch = nonSourceTargets.slice(i, i + 2);
    await Promise.all(
      batch.map(async (code) => {
        nonSourceAttempted++;
        try {
          const [txTitle, txSummary] = await Promise.all([
            translateTextViaMyMemory(rawTitle, detectedSourceLang, code),
            translateTextViaMyMemory(rawSummary, detectedSourceLang, code),
          ]);
          const clamped = clampLocalizedEntry(
            { title: txTitle, summary: txSummary },
            rawTitle,
            rawSummary
          );
          const isValid = isStoredTranslationEntryValid(
            clamped.title,
            clamped.summary,
            code,
            detectedSourceLang,
            rawTitle,
            rawSummary
          );
          if (isValid) {
            translations[code] = clamped;
            nonSourceSucceeded++;
          }
        } catch {
          // Omit failed target language rather than writing untranslated text under a wrong locale
        }
      })
    );
    if (i + 2 < nonSourceTargets.length) {
      await sleep(150);
    }
  }

  return {
    entry: {
      translations,
      detectedSourceLang,
    },
    allTranslated: nonSourceAttempted === 0 || nonSourceSucceeded === nonSourceAttempted,
    translatedCount: nonSourceAttempted === 0 ? 1 : nonSourceSucceeded,
  };
}

async function generateTranslationsWithResilience(
  ai: GoogleGenAI,
  rawTitle: string,
  rawSummary: string,
  requiredFields: string[],
  properties: Record<string, Schema>,
  systemInstruction: string
): Promise<string> {
  let lastError: unknown = null;

  for (let i = 0; i < TRANSLATION_MODELS.length; i++) {
    const modelName = TRANSLATION_MODELS[i];
    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: JSON.stringify({
          title: rawTitle,
          summary: rawSummary,
        }),
        config: {
          abortSignal: AbortSignal.timeout(15000),
          ...(modelName === 'gemini-4-hydrogen'
            ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
            : {}),
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties,
            required: requiredFields,
          },
        },
      });
      const text = (response.text ?? '').trim();
      if (text.length > 2) {
        return text;
      }
      throw new Error(`Empty response from ${modelName}`);
    } catch (err) {
      lastError = err;
      const isLastAttempt = i === TRANSLATION_MODELS.length - 1;
      const isRetryable = isTransientCapacityError(err) || String(err).includes('404');
      if (!isRetryable || isLastAttempt) {
        throw err;
      }
      await sleep(250 * (i + 1));
    }
  }

  throw lastError ?? new Error('Translation service unavailable.');
}

const GEO_COUNTRY_HEADERS = [
  'cf-ipcountry',
  'x-appengine-country',
  'x-vercel-ip-country',
  'cloudfront-viewer-country',
  'x-country-code',
  'x-geo-country',
] as const;

const RESERVED_GEO_CODES = new Set(['XX', 'ZZ', 'T1', 'A1', 'A2', 'O1']);

function extractRequestCountry(req: Request): string | null {
  for (const headerName of GEO_COUNTRY_HEADERS) {
    const raw = req.headers[headerName];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value === 'string') {
      const normalized = value.trim().toUpperCase();
      if (/^[A-Z]{2}$/.test(normalized) && !RESERVED_GEO_CODES.has(normalized)) {
        return normalized;
      }
    }
  }
  return null;
}

function parseAcceptLanguageHeader(headerVal: string | string[] | undefined): string[] {
  const raw = Array.isArray(headerVal) ? headerVal.join(',') : headerVal;
  if (typeof raw !== 'string' || !raw.trim()) {
    return [];
  }

  return raw
    .split(',')
    .map((entry) => {
      const [tagPart, ...params] = entry.trim().split(';');
      const tag = tagPart.trim();
      let q = 1;
      for (const param of params) {
        const [k, v] = param.trim().split('=');
        if (k === 'q' && v) {
          const parsed = Number.parseFloat(v);
          if (!Number.isNaN(parsed)) {
            q = parsed;
          }
        }
      }
      return { tag, q };
    })
    .filter((item) => item.tag.length > 0 && item.tag !== '*' && item.q > 0)
    .sort((a, b) => b.q - a.q)
    .map((item) => item.tag);
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '64kb' }));

  app.get('/api/visitor-locale', (req: Request, res: Response) => {
    const country = extractRequestCountry(req);
    const acceptLanguages = parseAcceptLanguageHeader(req.headers['accept-language']);

    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader(
      'Vary',
      'cf-ipcountry, x-appengine-country, x-vercel-ip-country, cloudfront-viewer-country, x-country-code, Accept-Language'
    );
    res.json({
      country,
      acceptLanguages,
    });
  });

  app.post('/api/translate-update', async (req: Request, res: Response) => {
    try {
      const rawTitle = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
      const rawSummary = typeof req.body?.summary === 'string' ? req.body.summary.trim() : '';
      const requestedLangsRaw: unknown[] = Array.isArray(req.body?.targetLangs)
        ? req.body.targetLangs
        : [...ALLOWED_LANGUAGES];

      if (rawTitle.length < 3 || rawTitle.length > 140) {
        res.status(400).json({ error: 'Title must be between 3 and 140 characters.' });
        return;
      }

      if (rawSummary.length < 10 || rawSummary.length > 3000) {
        res.status(400).json({ error: 'Summary must be between 10 and 3000 characters.' });
        return;
      }

      const targetLangs: AllowedLang[] = Array.from(
        new Set(requestedLangsRaw.filter(isAllowedLang))
      );
      if (targetLangs.length === 0) {
        targetLangs.push(...ALLOWED_LANGUAGES);
      }

      const rawSourceHint = req.body?.sourceLangHint;
      const sourceLangHint: AllowedLang | undefined = isAllowedLang(rawSourceHint)
        ? rawSourceHint
        : undefined;

      const sortedLangKey = [...targetLangs].sort().join(',');
      const cacheKey = `${sortedLangKey}::${rawTitle}::${rawSummary}`;
      const cached = translationCache.get(cacheKey);
      if (cached) {
        res.json(cached);
        return;
      }

      try {
        const ai = getGenAIClient();

        const properties: Record<string, Schema> = {
          detectedSourceLang: {
            type: Type.STRING,
            enum: [...ALLOWED_LANGUAGES, 'other'],
            description:
              'ISO language code of the input title/summary if it matches one of the 8 supported languages (id, en, es, fr, ja, ar, ru, ko), or "other".',
          },
        };

        for (const code of targetLangs) {
          properties[code] = {
            type: Type.OBJECT,
            description: `Localized release note in ${LANGUAGE_DESCRIPTIONS[code]}.`,
            properties: {
              title: {
                type: Type.STRING,
                description: `Release title in ${LANGUAGE_DESCRIPTIONS[code]} (MUST be at least 3 characters and at most 130 characters).`,
              },
              summary: {
                type: Type.STRING,
                description: `Release changelog summary in ${LANGUAGE_DESCRIPTIONS[code]}, preserving line breaks and bullet structure (MUST be at least 10 characters and at most 2800 characters).`,
              },
            },
            required: ['title', 'summary'],
          };
        }

        const targetListDescription = targetLangs
          .map((code) => `- "${code}": ${LANGUAGE_DESCRIPTIONS[code]}`)
          .join('\n');

        const systemInstruction =
          'You are a professional software localization specialist for "Complete Notebook", an Android productivity workspace created by "RyhStar Innovation".\n' +
          'Identify the input language in `detectedSourceLang` (one of: id, en, es, fr, ja, ar, ru, ko, or "other") and translate the provided software update `title` and `summary` accurately, naturally, and professionally into each requested target language:\n' +
          `${targetListDescription}\n\n` +
          'Rules:\n' +
          '1. Preserve exact product and brand names: "Complete Notebook", "RyhStar Innovation", "Google Play", "Google Play Store", "Google Drive".\n' +
          '2. Keep version identifiers (e.g. 1.0.1+2, v1.2.0) and technical acronyms (OCR, PDF, PIN, Offline) accurate.\n' +
          '3. Preserve paragraph breaks and bullet formatting in `summary`.\n' +
          '4. If a target language matches `detectedSourceLang`, keep the original wording polished and faithful.\n' +
          '5. STRICT LENGTH RULE: Every translated `title` MUST be between 3 and 130 characters, and every translated `summary` MUST be between 10 and 2800 characters. For compact scripts such as Japanese (ja) and Korean (ko), use complete natural release-note phrasing so `title` is always >= 3 characters and `summary` is always >= 10 characters.';

        const requiredFields = ['detectedSourceLang', ...targetLangs];
        const jsonText = await generateTranslationsWithResilience(
          ai,
          rawTitle,
          rawSummary,
          requiredFields,
          properties,
          systemInstruction
        );
        const parsed = JSON.parse(jsonText) as Record<string, unknown>;

        const rawDetected = parsed.detectedSourceLang;
        const detectedSourceLang: AllowedLang = isAllowedLang(rawDetected)
          ? rawDetected
          : detectTextLanguage(`${rawTitle}\n${rawSummary}`, sourceLangHint ?? 'en');
        const sourceForValidation: AllowedLang = detectedSourceLang;

        const sanitized: TranslationsPayload = {};
        let missingCount = 0;
        for (const code of targetLangs) {
          const clamped = clampLocalizedEntry(parsed[code], rawTitle, rawSummary);
          if (
            code === sourceForValidation ||
            isStoredTranslationEntryValid(
              clamped.title,
              clamped.summary,
              code,
              sourceForValidation,
              rawTitle,
              rawSummary
            )
          ) {
            sanitized[code] = clamped;
          } else {
            missingCount++;
          }
        }

        const entry: TranslationCacheEntry = {
          translations: sanitized,
          detectedSourceLang,
        };
        if (missingCount === 0) {
          setCachedTranslation(cacheKey, entry);
        }
        res.json(entry);
        return;
      } catch (geminiErr) {
        const formatted = formatUpstreamError(geminiErr);
        const fallback = await translateWithMyMemoryServerFallback(
          rawTitle,
          rawSummary,
          targetLangs,
          sourceLangHint
        );
        if (fallback.translatedCount > 0) {
          if (fallback.allTranslated) {
            setCachedTranslation(cacheKey, fallback.entry);
          }
          res.json(fallback.entry);
          return;
        }

        res.status(formatted.status).json({ error: formatted.message });
        return;
      }
    } catch (error) {
      console.error('Error in /api/translate-update:', error);
      const formatted = formatUpstreamError(error);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      const indexFile = path.join(distPath, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
