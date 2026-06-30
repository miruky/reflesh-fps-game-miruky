import { emptyProfile, type Profile } from '../game/progression';

const KEY = 'hibana.profile.v1';

// 外部から来たJSONを安全にProfileへ起こす。欠けたフィールドは初期値で埋め、
// 数値はNaNや負数を弾く。クラウドセーブ代替のインポートでも使う
export function parseProfile(raw: string): Profile {
  const base = emptyProfile();
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return base;
  }
  if (typeof data !== 'object' || data === null) return base;
  const source = data as Record<string, unknown>;

  const num = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;

  base.xp = num(source.xp, 0);
  base.rating = num(source.rating, 1000);

  if (typeof source.stats === 'object' && source.stats !== null) {
    const stats = source.stats as Record<string, unknown>;
    for (const key of Object.keys(base.stats) as Array<keyof Profile['stats']>) {
      base.stats[key] = num(stats[key], 0);
    }
  }

  if (typeof source.records === 'object' && source.records !== null) {
    const records = source.records as Record<string, unknown>;
    for (const key of Object.keys(base.records) as Array<keyof Profile['records']>) {
      base.records[key] = num(records[key], 0);
    }
  }

  if (Array.isArray(source.completedChallenges)) {
    base.completedChallenges = source.completedChallenges.filter(
      (id): id is string => typeof id === 'string',
    );
  }

  if (typeof source.weaponKills === 'object' && source.weaponKills !== null) {
    for (const [name, count] of Object.entries(source.weaponKills as Record<string, unknown>)) {
      const value = num(count, 0);
      if (value > 0) base.weaponKills[name] = value;
    }
  }

  if (Array.isArray(source.unlockedMedals)) {
    base.unlockedMedals = source.unlockedMedals.filter((id): id is string => typeof id === 'string');
  }

  if (typeof source.medalCounts === 'object' && source.medalCounts !== null) {
    for (const [id, count] of Object.entries(source.medalCounts as Record<string, unknown>)) {
      const value = num(count, 0);
      if (value > 0) base.medalCounts[id] = value;
    }
  }

  // ── キャンペーン進行(壊れた/旧形式の値が来ても安全に正規化) ──
  if (typeof source.campaign === 'object' && source.campaign !== null) {
    const camp = source.campaign as Record<string, unknown>;
    if (Array.isArray(camp.clearedMissions)) {
      base.campaign.clearedMissions = camp.clearedMissions.filter(
        (id): id is string => typeof id === 'string',
      );
    }
    if (Array.isArray(camp.unlockedChapters)) {
      const chapters = camp.unlockedChapters.filter((id): id is string => typeof id === 'string');
      // 第1章は常に解放(softlock回避)
      if (!chapters.includes('ch1')) chapters.push('ch1');
      base.campaign.unlockedChapters = chapters;
    }
    if (typeof camp.missionBests === 'object' && camp.missionBests !== null) {
      const diffs = ['easy', 'normal', 'hard'];
      for (const [id, raw2] of Object.entries(camp.missionBests as Record<string, unknown>)) {
        if (typeof raw2 !== 'object' || raw2 === null) continue;
        const b = raw2 as Record<string, unknown>;
        const t = b.bestTimeS;
        const st = b.stars;
        const df = b.difficulty;
        if (typeof t !== 'number' || !Number.isFinite(t) || t < 0) continue;
        if (typeof st !== 'number' || !Number.isFinite(st)) continue;
        if (typeof df !== 'string' || !diffs.includes(df)) continue;
        base.campaign.missionBests[id] = {
          bestTimeS: t,
          stars: Math.max(0, Math.min(3, Math.round(st))),
          difficulty: df as 'easy' | 'normal' | 'hard',
        };
      }
    }
  }

  // ── スコアアタック自己ベスト(正の数のみ採用) ──
  if (typeof source.scoreRecords === 'object' && source.scoreRecords !== null) {
    for (const [key, val] of Object.entries(source.scoreRecords as Record<string, unknown>)) {
      const value = num(val, 0);
      if (value > 0) base.scoreRecords[key] = value;
    }
  }

  return base;
}

export function serializeProfile(profile: Profile): string {
  return JSON.stringify(profile, null, 2);
}

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyProfile();
    return parseProfile(raw);
  } catch {
    return emptyProfile();
  }
}

export function saveProfile(profile: Profile): void {
  localStorage.setItem(KEY, JSON.stringify(profile));
}

// クラウドセーブ代替: JSONファイルとしてダウンロードさせる
export function exportProfile(profile: Profile): void {
  const blob = new Blob([serializeProfile(profile)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'hibana-profile.json';
  anchor.click();
  URL.revokeObjectURL(url);
}

// ファイル選択ダイアログを開いてインポートする。成功時のみコールバックする
export function importProfile(onLoaded: (profile: Profile) => void): void {
  const picker = document.createElement('input');
  picker.type = 'file';
  picker.accept = 'application/json';
  picker.addEventListener('change', () => {
    const file = picker.files?.[0];
    if (!file) return;
    void file.text().then((text) => {
      onLoaded(parseProfile(text));
    });
  });
  picker.click();
}
