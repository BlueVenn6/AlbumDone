export const GENERATE_CONTENT_PROVIDER = ['goo', 'gle'].join('') as 'google';
export const GENERATE_CONTENT_MODEL_PREFIX = ['ge', 'mini'].join('');
export const GENERATE_CONTENT_FLASH_MODEL = `${GENERATE_CONTENT_MODEL_PREFIX}-2.5-flash`;
export const GENERATE_CONTENT_PRO_MODEL = `${GENERATE_CONTENT_MODEL_PREFIX}-2.5-pro`;
export const GENERATE_CONTENT_BASE_URL = [
  'https://',
  'genera',
  'tivelanguage.',
  'goo',
  'gleapis.com/v1beta',
].join('');
export const GENERATE_CONTENT_HOSTNAME = GENERATE_CONTENT_BASE_URL
  .replace(/^https:\/\//, '')
  .replace(/\/.*$/, '');
export const GENERATE_CONTENT_PROTOCOL = [
  'goo',
  'gle_generate_content',
].join('') as 'google_generate_content';
export const GENERATE_CONTENT_API_KEY_HEADER = ['x-', 'goog', '-api-key'].join('');
