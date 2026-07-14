import type { LLMProvider } from '@photo-manager/shared';
import * as Keychain from 'react-native-keychain';

const SERVICE_PREFIX = 'photo-manager-api-key';

function getService(provider: LLMProvider): string {
  return `${SERVICE_PREFIX}.${provider}`;
}

export async function getStoredApiKey(provider: LLMProvider): Promise<string | null> {
  const credentials = await Keychain.getGenericPassword({
    service: getService(provider),
  });

  if (!credentials) {
    return null;
  }

  return credentials.password || null;
}

export async function setStoredApiKey(provider: LLMProvider, apiKey: string): Promise<void> {
  const trimmedKey = apiKey.trim();
  if (!trimmedKey) {
    await deleteStoredApiKey(provider);
    return;
  }

  await Keychain.setGenericPassword(provider, trimmedKey, {
    service: getService(provider),
  });
}

export async function deleteStoredApiKey(provider: LLMProvider): Promise<void> {
  await Keychain.resetGenericPassword({
    service: getService(provider),
  });
}
