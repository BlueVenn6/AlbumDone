const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  i18next,
  initI18n,
  normalizeLocale,
  resolveAppLocale,
  SUPPORTED_LOCALES,
} = require('../dist/i18n');
const { getLocalizedAlbumTitle } = require('../dist/utils/localizedAlbumTitle');

assert.deepStrictEqual(Object.keys(SUPPORTED_LOCALES), ['en', 'zh-Hans', 'zh-Hant']);

const localeCases = {
  'zh': 'zh-Hans',
  'zh-CN': 'zh-Hans',
  'zh_CN': 'zh-Hans',
  'zh_CN.UTF-8': 'zh-Hans',
  'zh_CN_#Hans': 'zh-Hans',
  'zh_CN_#Hant': 'zh-Hant',
  'zh-SG': 'zh-Hans',
  'zh_SG_#Hans': 'zh-Hans',
  'zh-Hans': 'zh-Hans',
  'zh-Hans-CN': 'zh-Hans',
  'zh-Hans-HK': 'zh-Hans',
  'zh-Hans-CN-u-nu-hanidec': 'zh-Hans',
  'zh__#Hans': 'zh-Hans',
  'zh-TW': 'zh-Hant',
  'zh_TW': 'zh-Hant',
  'zh_TW_#Hant': 'zh-Hant',
  'zh-HK': 'zh-Hant',
  'zh_HK_#Hant': 'zh-Hant',
  'zh-MO': 'zh-Hant',
  'zh_MO_#Hant': 'zh-Hant',
  'zh-Hant': 'zh-Hant',
  'zh-Hant-CN': 'zh-Hant',
  'zh-Hant-HK': 'zh-Hant',
  'zh-Hant-TW-u-nu-hanidec': 'zh-Hant',
  'zh_HK_#Hans': 'zh-Hans',
  'zh__#Hant': 'zh-Hant',
  'en-US': 'en',
  'en_US.UTF-8': 'en',
  'en-GB': 'en',
  'ja-JP': 'en',
  'ko-KR': 'en',
  'fr-FR': 'en',
  '': 'en',
};
for (const [locale, expected] of Object.entries(localeCases)) {
  assert.strictEqual(normalizeLocale(locale), expected);
}
assert.strictEqual(normalizeLocale(undefined), 'en');

assert.strictEqual(
  resolveAppLocale({
    followSystemLocale: true,
    systemLocale: 'zh-TW',
  }),
  'zh-Hant',
);
assert.strictEqual(
  resolveAppLocale({
    followSystemLocale: true,
    systemLocale: 'en-US',
  }),
  'en',
);
assert.strictEqual(
  resolveAppLocale({
    followSystemLocale: true,
    systemLocale: 'en-US',
  }),
  'en',
  'English Windows display language must override old Chinese app preference',
);
assert.strictEqual(
  resolveAppLocale({
    forceLocale: undefined,
    followSystemLocale: true,
    systemLocale: 'en-US',
  }),
  'en',
  'Old persisted language fields are ignored because no forceLocale is supplied',
);
assert.strictEqual(
  resolveAppLocale({
    systemLocale: 'zh-TW',
  }),
  'zh-Hant',
);
assert.strictEqual(
  resolveAppLocale({
    forceLocale: 'system',
    followSystemLocale: true,
    systemLocale: 'zh_CN_#Hans',
  }),
  'zh-Hans',
);

const sourceLocaleDir = path.resolve(__dirname, '../src/i18n/locales');
const localeFiles = ['en.json', 'zh-Hans.json', 'zh-Hant.json'];
const localeResources = Object.fromEntries(
  localeFiles.map((file) => [
    file,
    JSON.parse(fs.readFileSync(path.join(sourceLocaleDir, file), 'utf8')),
  ]),
);

function flatten(resource, prefix = '') {
  return Object.entries(resource).flatMap(([key, value]) => {
    const next = prefix ? `${prefix}.${key}` : key;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? flatten(value, next)
      : [[next, value]];
  });
}

const flattened = Object.fromEntries(
  localeFiles.map((file) => [file, new Map(flatten(localeResources[file]))]),
);
const englishKeys = [...flattened['en.json'].keys()].sort();
for (const file of ['zh-Hans.json', 'zh-Hant.json']) {
  assert.deepStrictEqual([...flattened[file].keys()].sort(), englishKeys);
}
for (const file of localeFiles) {
  for (const [key, value] of flattened[file]) {
    assert.strictEqual(typeof value, 'string', `${file}:${key} must be a string`);
    assert.notStrictEqual(value.trim(), '', `${file}:${key} must not be empty`);
  }
}

const technicalEnglish = /\b(?:AI|API|App|Android|Base URL|Credential Manager|Google Drive|iCloud Drive|iOS|JSON|Key|Keychain|Keystore|LLM|MVP|Notion|OCR|OpenAI|Provider|Proxy|URL|Windows|macOS|token)\b/g;
const englishUserCopy = [...flattened['en.json'].values()].join('\n').replace(technicalEnglish, '');
assert.doesNotMatch(englishUserCopy, /[\u3400-\u9fff]/);

const commonTraditionalOnly = /[載儲檔開關錯誤這張進發現為與後會頁還應處複製傳體類預設階]/;
const commonSimplifiedOnly = /[载储档开关错误这张进发现为与后会页还应处复制传体类预设阶]/;
for (const [key, value] of flattened['zh-Hans.json']) {
  assert.doesNotMatch(value, commonTraditionalOnly, `zh-Hans contains likely traditional text at ${key}`);
}
for (const [key, value] of flattened['zh-Hant.json']) {
  assert.doesNotMatch(value, commonSimplifiedOnly, `zh-Hant contains likely simplified text at ${key}`);
}

const mobileSourceDir = path.resolve(__dirname, '../../mobile/src');
const mobileSourceFiles = [];
function collectSourceFiles(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(fullPath);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      mobileSourceFiles.push(fullPath);
    }
  }
}
collectSourceFiles(mobileSourceDir);
for (const file of mobileSourceFiles) {
  const relativePath = path.relative(mobileSourceDir, file);
  const source = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(source, /[\u3400-\u9fff]/, `mobile source has hardcoded Chinese text at ${relativePath}`);

  const userFacingLiteralPatterns = [
    /<Text[^>]*>\s*([A-Za-z][^<{}`]*)\s*<\/Text>/g,
    /placeholder=\{?['"]([A-Za-z][^'"{}]*)['"]\}?/g,
    /Alert\.alert\(\s*['"]([A-Za-z][^'"]*)['"]/g,
  ];
  const technicalOrNonCopy = /^(?:sk-|https?|OpenAI|API|Base URL|Model|Provider|Proxy|JSON|URL|LLM|AI|Notion|iCloud|Google Drive|Credential Manager|Keychain|Keystore|Android|iOS|Windows|macOS|MVP|OCR|Photo Manager|v?\d)/;
  for (const pattern of userFacingLiteralPatterns) {
    let match;
    while ((match = pattern.exec(source)) !== null) {
      const value = match[1].trim();
      if (!value || technicalOrNonCopy.test(value)) continue;
      assert.fail(`mobile source has hardcoded English user copy at ${relativePath}: ${value}`);
    }
  }
}

(async () => {
  await initI18n('zh-Hans');
  assert.strictEqual(i18next.language, 'zh-Hans');
  assert.strictEqual(i18next.t('common.save'), '保存');
  assert.strictEqual(i18next.t('missing.key.for.test'), '');
  assert.strictEqual(getLocalizedAlbumTitle('Camera Roll', i18next.t), '相机胶卷');
  assert.strictEqual(getLocalizedAlbumTitle('Screenshots', i18next.t), '截图');
  assert.strictEqual(getLocalizedAlbumTitle('Downloads', i18next.t), '下载');
  assert.strictEqual(getLocalizedAlbumTitle('My Trip', i18next.t), 'My Trip');

  await initI18n('zh-Hant');
  assert.strictEqual(i18next.t('common.save'), '儲存');
  assert.strictEqual(getLocalizedAlbumTitle('Camera Roll', i18next.t), '相機膠卷');
  assert.strictEqual(getLocalizedAlbumTitle('Screenshots', i18next.t), '截圖');
  assert.strictEqual(getLocalizedAlbumTitle('Screen Recordings', i18next.t), '螢幕錄影');
  assert.strictEqual(getLocalizedAlbumTitle('My Trip', i18next.t), 'My Trip');

  await initI18n('ja-JP');
  assert.strictEqual(i18next.language, 'en');
  assert.strictEqual(i18next.t('common.save'), 'Save');
  assert.strictEqual(getLocalizedAlbumTitle('Camera Roll', i18next.t), 'Camera Roll');
  assert.strictEqual(getLocalizedAlbumTitle('Screenshots', i18next.t), 'Screenshots');

  console.log('i18n tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
