export interface Settings {
  sensitivity: number;
  fov: number;
  volMaster: number;
  volSfx: number;
  volUi: number;
  adsToggle: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 1,
  fov: 78,
  volMaster: 0.8,
  volSfx: 0.8,
  volUi: 0.6,
  adsToggle: false,
};

const KEY = 'hibana.settings.v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  localStorage.setItem(KEY, JSON.stringify(settings));
}
