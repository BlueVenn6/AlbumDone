import React, { forwardRef } from 'react';
import { View } from 'react-native';

const ONE_PIXEL_JPEG =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcyKCIoKSo0NTU1GiQ7QDszPy40NTEBDAwMEA8QHxISHzQrJCQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NP/AABEIAAEAAQMBIgACEQEDEQH/xAAXAAEBAQEAAAAAAAAAAAAAAAAAAQID/8QAFxABAQEBAAAAAAAAAAAAAAAAAAERIf/EABYBAQEBAAAAAAAAAAAAAAAAAAABAv/EABYRAQEBAAAAAAAAAAAAAAAAAAABEf/aAAwDAQACEQMRAD8A9wC1AAf/2Q==';

type ViewShotProps = React.ComponentProps<typeof View>;

const ViewShot = forwardRef<View, ViewShotProps>(({ children, ...props }, ref) => (
  <View ref={ref} {...props}>
    {children}
  </View>
));

ViewShot.displayName = 'WebViewShot';

export async function captureRef(
  _target: unknown,
  options: { result?: 'base64' | 'tmpfile' | 'data-uri'; format?: string } = {},
): Promise<string> {
  if (options.result === 'tmpfile') {
    return `data:image/${options.format ?? 'jpeg'};base64,${ONE_PIXEL_JPEG}`;
  }
  if (options.result === 'data-uri') {
    return `data:image/${options.format ?? 'jpeg'};base64,${ONE_PIXEL_JPEG}`;
  }
  return ONE_PIXEL_JPEG;
}

export default ViewShot;
