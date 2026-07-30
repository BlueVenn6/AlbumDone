import { normalizeLocale } from '../i18n';

export const ENCOURAGEMENTS: Record<string, string[]> = {
  en: [
    "A life lived with attention is a life well lived.",
    "Every place you went this year added something to who you are.",
    "The best moments don't announce themselves. You caught some anyway.",
    "Showing up for yourself, for the day, for the small things counts.",
    "This year happened. You were there for it. That matters.",
    "Not every chapter is dramatic. The quiet ones shape you just as much.",
    "You noticed enough to photograph it. That's a form of care.",
    "Life is wide. You covered some ground this year.",
    "The ordinary, done with intention, becomes extraordinary.",
    "Every year teaches you something you didn't know you needed to learn.",
    "Some months are quiet. Quiet is still part of the story.",
    "Rest counts. Waiting counts. Becoming is not always loud.",
    "A blank space can be a breath, not a failure.",
    "You do not have to document everything for it to matter.",
  ],
  'zh-Hans': [
    '认真生活的人，每一帧都值得被记住。',
    '去过的地方、吃过的东西、看过的天空，这些都算数。',
    '人生不是用来被比较的，是用来被经历的。',
    '今年你走过的路，没有人能替你走第二遍。',
    '生活的密度不在于事件多少，而在于你有没有真的在场。',
    '见过好风景的人，眼睛里会有光。你今年一定见过不少。',
    '每一张照片背后都有一个你决定按下快门的瞬间。',
    '普通的一天认真过，就不普通了。',
    '这 12 个月你经历的事，正在悄悄塑造明年的你。',
    '好好生活是一种才能，不是每个人都有的。',
    '有些月份安静一点，也仍然是生活的一部分。',
    '空出来的地方，不是缺席，是给自己留了一口气。',
    '没有照片的日子，也可能正在认真发生。',
    '不是每一段生活都需要被证明，它本来就算数。',
    '慢一点的月份，也在把你带向新的地方。',
  ],
  'zh-Hant': [
    '認真生活的人，每一幀都值得被記住。',
    '去過的地方、吃過的東西、看過的天空，這些都算數。',
    '人生不是用來被比較的，是用來被經歷的。',
    '今年你走過的路，沒有人能替你走第二遍。',
    '生活的密度不在於事件多少，而在於你有沒有真的在場。',
    '見過好風景的人，眼睛裡會有光。你今年一定見過不少。',
    '每一張照片背後都有一個你決定按下快門的瞬間。',
    '普通的一天認真過，就不普通了。',
    '這 12 個月你經歷的事，正在悄悄塑造明年的你。',
    '好好生活是一種才能，不是每個人都有的。',
    '有些月份安靜一點，也仍然是生活的一部分。',
    '空出來的地方，不是缺席，是給自己留了一口氣。',
    '沒有照片的日子，也可能正在認真發生。',
    '不是每一段生活都需要被證明，它本來就算數。',
    '慢一點的月份，也在把你帶向新的地方。',
  ],
};

export function getRandomEncouragement(languageCode: string): string {
  const locale = normalizeLocale(languageCode);
  const fallback = ENCOURAGEMENTS['en'] ?? ['Keep going.'];
  const list = ENCOURAGEMENTS[locale] ?? fallback;
  const safeList = list.length > 0 ? list : fallback;
  const pick = safeList[Math.floor(Math.random() * safeList.length)];
  return pick ?? fallback[0] ?? 'Keep going.';
}

export function getEncouragementByIndex(languageCode: string, index: number): string {
  const locale = normalizeLocale(languageCode);
  const fallback = ENCOURAGEMENTS['en'] ?? ['Keep going.'];
  const list = ENCOURAGEMENTS[locale] ?? fallback;
  const safeList = list.length > 0 ? list : fallback;
  const safeIndex = Math.abs(Math.trunc(index)) % safeList.length;
  return safeList[safeIndex] ?? fallback[0] ?? 'Keep going.';
}
