type AlertButton = {
  text?: string;
  onPress?: () => void;
  style?: string;
};

const Alert = {
  alert: (
    title?: string,
    message?: string,
    buttons?: AlertButton[],
  ) => {
    const preferredButton =
      buttons?.find((button) => button.style !== 'cancel' && typeof button.onPress === 'function')
      ?? buttons?.find((button) => typeof button.onPress === 'function');

    if (message) {
      window.setTimeout(() => {
        window.alert(`${title ?? ''}\n\n${message}`.trim());
        preferredButton?.onPress?.();
      }, 0);
      return;
    }

    window.setTimeout(() => {
      window.alert(title ?? '');
      preferredButton?.onPress?.();
    }, 0);
  },
};

export default Alert;
