type ElectronPickerApi = {
  selectFolder?: () => Promise<string | null>;
  fs?: {
    selectFolder?: () => Promise<string | null>;
  };
};

type MobileAsset = {
  uri?: string;
  fileName?: string;
  type?: string;
  fileSize?: number;
  width?: number;
  height?: number;
};

type ImageLibraryOptions = {
  mediaType?: 'photo' | 'video' | 'mixed';
  selectionLimit?: number;
  includeBase64?: boolean;
};

type ImagePickerResponse = {
  didCancel?: boolean;
  assets?: MobileAsset[];
};

type ImagePickerModule = {
  launchImageLibrary: (options: ImageLibraryOptions) => Promise<ImagePickerResponse>;
};

export type PickedMobileImage = {
  uri: string;
  fileName?: string;
  type?: string;
  fileSize?: number;
  width?: number;
  height?: number;
};

export type ImageSourceSelection =
  | { kind: 'desktop-folder'; folderPath: string }
  | { kind: 'mobile-images'; assets: PickedMobileImage[] }
  | null;

function resolveElectronPickerApi(): ElectronPickerApi | null {
  const globalScope = globalThis as {
    electronAPI?: ElectronPickerApi;
    window?: { electronAPI?: ElectronPickerApi };
  };
  return globalScope.electronAPI ?? globalScope.window?.electronAPI ?? null;
}

function isReactNativeRuntime(): boolean {
  const globalScope = globalThis as { navigator?: { product?: string } };
  return globalScope.navigator?.product === 'ReactNative';
}

function toPickedMobileImage(asset: MobileAsset): PickedMobileImage | null {
  if (typeof asset.uri !== 'string' || asset.uri.length === 0) {
    return null;
  }

  return {
    uri: asset.uri,
    ...(typeof asset.fileName === 'string' ? { fileName: asset.fileName } : {}),
    ...(typeof asset.type === 'string' ? { type: asset.type } : {}),
    ...(typeof asset.fileSize === 'number' ? { fileSize: asset.fileSize } : {}),
    ...(typeof asset.width === 'number' ? { width: asset.width } : {}),
    ...(typeof asset.height === 'number' ? { height: asset.height } : {}),
  };
}

export async function selectImageSource(): Promise<ImageSourceSelection> {
  try {
    const electronApi = resolveElectronPickerApi();
    const selectFolder = electronApi?.fs?.selectFolder ?? electronApi?.selectFolder;

    if (typeof selectFolder === 'function') {
      const folderPath = await selectFolder();
      if (!folderPath) {
        return null;
      }
      return { kind: 'desktop-folder', folderPath };
    }

    if (!isReactNativeRuntime()) {
      return null;
    }

    const moduleName = 'react-native-image-picker';
    const { launchImageLibrary } = (await import(moduleName)) as ImagePickerModule;
    const options: ImageLibraryOptions = {
      mediaType: 'photo',
      selectionLimit: 0,
      includeBase64: false,
    };

    const result = (await launchImageLibrary(options)) as ImagePickerResponse;
    if (result.didCancel || !Array.isArray(result.assets)) {
      return null;
    }

    const assets = result.assets
      .map(toPickedMobileImage)
      .filter((asset): asset is PickedMobileImage => asset !== null);

    if (assets.length === 0) {
      return null;
    }

    return {
      kind: 'mobile-images',
      assets,
    };
  } catch (err) {
    throw new Error(
      `Image selection failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
