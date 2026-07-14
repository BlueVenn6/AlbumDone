const I18nManager = {
  allowRTL() {
    return undefined;
  },
  forceRTL() {
    return undefined;
  },
  getConstants() {
    return {
      isRTL: false,
      localeIdentifier: navigator.language ?? 'en',
    };
  },
};

export default I18nManager;
