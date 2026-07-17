/**
 * Hard mute for automated browser validation.
 *
 * Chromium's --mute-audio is not sufficient on every macOS/WebAudio path.  Keep
 * the process-level flag, then install this before any application script so an
 * AudioContext can never be resumed and HTML media can never start playback.
 */
export const SILENT_BROWSER_ARGS = Object.freeze([
  '--mute-audio',
  '--disable-audio-output',
]);

export function installSilentAudio() {
  // Announcer callouts use the OS speech service, which can bypass Chromium's
  // normal audio mixer and was the source of leaked "Triple Kill" callouts.
  if (globalThis.speechSynthesis) {
    try {
      globalThis.speechSynthesis.cancel();
      globalThis.speechSynthesis.speak = () => undefined;
      globalThis.speechSynthesis.resume = () => undefined;
    } catch {
      // Continue with the remaining independent mute layers.
    }
  }

  const media = globalThis.HTMLMediaElement?.prototype;
  if (media) {
    media.play = function silentPlay() {
      try {
        this.muted = true;
        this.volume = 0;
        this.pause();
      } catch {
        // A restricted media element is already silent.
      }
      return Promise.resolve();
    };
  }

  const silenceContextConstructor = (key) => {
    const NativeContext = globalThis[key];
    if (typeof NativeContext !== 'function') return;

    try {
      NativeContext.prototype.resume = function silentResume() {
        return this.suspend().then(() => undefined).catch(() => undefined);
      };
    } catch {
      // The launch-level --disable-audio-output flag remains the final guard.
    }

    try {
      const SilentContext = new Proxy(NativeContext, {
        construct(target, args) {
          const context = Reflect.construct(target, args, target);
          void context.suspend().catch(() => undefined);
          return context;
        },
      });
      Object.defineProperty(globalThis, key, {
        configurable: true,
        writable: true,
        value: SilentContext,
      });
    } catch {
      // Some browser builds expose a non-configurable constructor.
    }
  };

  silenceContextConstructor('AudioContext');
  silenceContextConstructor('webkitAudioContext');
}
