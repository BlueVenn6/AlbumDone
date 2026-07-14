import type { ImageSourceSelection } from './imagePicker';

export async function selectImageSource(): Promise<ImageSourceSelection> {
  throw new Error(
    'Mobile image picking is handled by the photo library scanner in this app.',
  );
}

export type { ImageSourceSelection, PickedMobileImage } from './imagePicker';
