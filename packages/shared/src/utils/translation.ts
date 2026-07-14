import type { Settings } from '../types';
import type { LLMClient } from '../api/llmClient';

async function callDeepL(text: string, targetLang: string, apiKey: string): Promise<string> {
  // Use free tier if key ends with ':fx', paid otherwise
  const isFree = apiKey.endsWith(':fx');
  const endpoint = isFree
    ? 'https://api-free.deepl.com/v2/translate'
    : 'https://api.deepl.com/v2/translate';

  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `DeepL-Auth-Key ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text: [text], target_lang: targetLang.toUpperCase() }),
  });

  if (!resp.ok) {
    throw new Error(`DeepL error ${resp.status}: ${await resp.text()}`);
  }

  const data = (await resp.json()) as { translations: Array<{ text: string }> };
  return data.translations[0]?.text ?? '';
}

async function callLLMTranslate(
  text: string,
  targetLang: string,
  client: LLMClient,
): Promise<string> {
  const response = await client.chat(
    [
      {
        role: 'user',
        content: `Translate the following text to ${targetLang}. Output only the translation, no explanations.\n\n${text}`,
      },
    ],
    { temperature: 0.2, maxTokens: 2048 },
  );
  return response.content;
}

/**
 * Translate text using DeepL (preferred) or the configured LLM as fallback.
 * Throws if neither is configured.
 */
export async function translateText(
  text: string,
  targetLang: string,
  settings: Settings,
  llmClient?: LLMClient,
): Promise<string> {
  if (settings.deeplApiKey) {
    try {
      return await callDeepL(text, targetLang, settings.deeplApiKey);
    } catch (err) {
      if (!llmClient) throw err;
      console.warn('[translation] DeepL failed, falling back to LLM:', err);
    }
  }

  if (llmClient) {
    return callLLMTranslate(text, targetLang, llmClient);
  }

  throw new Error('No translation service configured — add a DeepL API key or LLM key in Settings.');
}
