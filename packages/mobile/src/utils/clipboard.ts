import { NativeModules, Share } from 'react-native';

type ClipboardModuleShape = {
  setString?: (text: string) => void;
};

function resolveClipboardModule(): ClipboardModuleShape | null {
  const nativeModules = NativeModules as Record<string, ClipboardModuleShape | undefined>;
  return nativeModules.Clipboard ?? nativeModules.RNCClipboard ?? null;
}

export async function copyText(text: string): Promise<boolean> {
  const clipboard = resolveClipboardModule();
  if (clipboard?.setString) {
    clipboard.setString(text);
    return true;
  }

  await Share.share({ message: text });
  return false;
}
