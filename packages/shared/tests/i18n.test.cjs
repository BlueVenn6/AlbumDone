const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { i18next, initI18n, normalizeLocale, resolveAppLocale, SUPPORTED_LOCALES } = require('../dist/i18n');
const { getLocalizedAlbumTitle } = require('../dist/utils/localizedAlbumTitle');
const languages = Object.keys(SUPPORTED_LOCALES);
assert.equal(languages.length, 15);
for (const lang of languages) assert.equal(normalizeLocale(lang), lang);
for (const [input, expected] of Object.entries({
  zh: 'zh-Hans', 'zh_CN_#Hans': 'zh-Hans', 'zh-TW': 'zh-Hant', 'zh-HK': 'zh-Hant',
  'en-US': 'en', 'ja-JP': 'ja', 'ko-KR': 'ko', 'fr-FR': 'fr', unknown: 'en',
})) assert.equal(normalizeLocale(input), expected);
assert.equal(resolveAppLocale({ forceLocale: 'fr', systemLocale: 'en-US' }), 'fr');
assert.equal(resolveAppLocale({ followSystemLocale: true, systemLocale: 'zh-TW' }), 'zh-Hant');
assert.equal(resolveAppLocale({ systemLocale: 'en-US' }), 'en');
assert.equal(resolveAppLocale({ forceLocale: 'system', systemLocale: 'zh_CN_#Hans' }), 'zh-Hans');
const resources = Object.fromEntries(languages.map(lang => [lang,
  JSON.parse(fs.readFileSync(path.join(__dirname, '../src/i18n/locales', `${lang}.json`), 'utf8')),
]));
const desktop = path.resolve(__dirname, '../../desktop/src');
const sources = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const filename = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(filename);
    else if (/\.tsx?$/.test(entry.name)) sources.push(fs.readFileSync(filename, 'utf8'));
  }
}
walk(desktop);
const required = new Set(['common.save', 'common.error', 'common.retry']);
for (const source of sources) {
  for (const [, key] of source.matchAll(/['"]([^'"\r\n]+)['"]/g)) {
    if (Object.hasOwn(resources.en, key)) required.add(key);
  }
  for (const [, key] of source.matchAll(/\bt\(\s*['"]([^'"]+)['"]/g)) {
    assert(Object.hasOwn(resources.en, key), `Unrecognised desktop translation: ${key}`);
  }
}
const placeholders = text => [...text.matchAll(/{{\s*(\w+)\s*}}/g)].map(m => m[1]).sort();
for (const lang of languages) {
  for (const key of required) {
    const value = resources[lang][key];
    assert.equal(typeof value, 'string', `Missing ${lang}:${key}`);
    assert(value.trim(), `Empty ${lang}:${key}`);
    assert.deepEqual(placeholders(value), placeholders(resources.en[key]), `${lang}:${key} placeholders`);
  }
  assert(!Object.keys(resources[lang]).some(k => /^(settings|ai|llm|ocr|screenshots)\./i.test(k)));
}
assert.doesNotMatch(Object.values(resources.en).join(' '), /[\u3400-\u9fff]/u);
(async () => {
  // Visit every locale twice, in reverse order too, so previous-language residue is visible.
  for (const lang of [...languages, ...[...languages].reverse()]) {
    await initI18n(lang);
    assert.equal(i18next.language, lang);
    for (const key of required) {
      const actual = i18next.t(key, { lng: lang, count: 2, current: 7, total: 20,
        processed: 4, candidates: 10, months: 8, empty: 4, remaining: 3, kept: 2, folder: 'x', month: 'x' });
      assert(actual.trim(), `${lang}:${key} rendered empty`);
      const details = i18next.t(key, { lng: lang, returnDetails: true });
      assert.equal(details.usedLng, lang, `${lang}:${key} fell back to another language`);
    }
  }
  await initI18n('zh-Hant');
  assert.equal(getLocalizedAlbumTitle('Camera Roll', i18next.t), '相機膠卷');
  assert.equal(getLocalizedAlbumTitle('My Trip', i18next.t), 'My Trip');
  assert.equal(i18next.t('missing.key.for.test'), '');
  console.log(`15-language coverage, parameters and repeated switching passed: ${required.size} desktop keys`);
})().catch(error => { console.error(error); process.exitCode = 1; });
