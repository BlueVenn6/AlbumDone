const Platform = {
  OS: 'web',
  Version: 35,
  select<T>(obj: { web?: T; ios?: T; android?: T; native?: T; default?: T }): T | undefined {
    return obj.web ?? obj.default;
  },
  get isTesting() {
    return process.env.NODE_ENV === 'test';
  },
};

export default Platform;
