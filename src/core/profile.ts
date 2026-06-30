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
