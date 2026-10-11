/**
 * Chrome's built-in AI (Gemma/Gemini Nano behind the Prompt API), reduced to
 * one interface the rest of the extension can call.
 *
 * Feature-tested, never version-sniffed (the rule `src/capabilities.ts` is
 * built on): two API shapes have existed - the current `LanguageModel` global
 * and the older `self.ai.languageModel` origin-trial shape - and which one a
 * browser exposes is exactly the kind of question the API surface should
 * answer for us. `detectAiModelApi()` accepts either and adapts both to
 * `AiModelApi`.
 *
 * No ambient globals are declared (`declare var LanguageModel`) on purpose:
 * a future lib.dom that ships its own declaration would collide with ours.
 * Reading the shapes off `globalThis` keeps this file the single place that
 * knows the raw API and the tests free to install a fake.
 *
 * The exact surface each target Chrome exposes to a chrome-extension:// page
 * is a spike finding (doc/tabverse-gemma-nano-plan.md §4.0); everything here
 * degrades to `null` / a failed probe when it is not there.
 */

/** What `prompt()` may be given besides the input itself. */
export interface AiPromptOptions {
  /**
   * A JSON Schema the reply must satisfy - the Prompt API's structured output
   * (`responseConstraint`), and the closest thing the built-in model has to
   * tool calling: there is no function- or tool-calling mode, so a schema is
   * how a caller says "and give it back in a shape I can read" rather than in
   * whatever prose the model felt like.
   *
   * A build that does not know the option ignores it (WebIDL dictionaries drop
   * unknown members), so the caller must still be able to read a plain reply -
   * every user of this has a fallback parser.
   */
  responseConstraint?: object;
}

/** What the model session looks like, normalized to what we call. */
export interface AiRawSession {
  prompt(input: string, options?: AiPromptOptions): Promise<string>;
  /** Some builds never expose it; destroying is best effort. */
  destroy?(): void;
  /** Input token quota of the session, when the API reports one. */
  inputQuota?: number;
}

/** The availability answer both API shapes are mapped onto. */
export type ModelAvailability =
  | 'unavailable'
  | 'downloadable'
  | 'downloading'
  | 'available';

export interface AiCreateOptions {
  systemPrompt: string;
  /** Download progress, if this shape of `create()` supports a monitor. */
  monitor?: (monitor: DownloadMonitor) => void;
}

export interface DownloadMonitor {
  addEventListener(
    type: 'downloadprogress',
    listener: (event: { loaded: number; total: number }) => void,
  ): void;
}

export interface AiModelApi {
  availability(): Promise<ModelAvailability>;
  create(options: AiCreateOptions): Promise<AiRawSession>;
}

interface RawLanguageModel {
  create(options: AiCreateOptions): Promise<AiRawSession>;
  availability?(): Promise<unknown>;
  capabilities?(): Promise<{ available?: string }>;
}

const isModelLike = (value: unknown): value is RawLanguageModel =>
  !!value && typeof (value as RawLanguageModel).create === 'function';

/**
 * The API this browser has, or null when it has none.
 *
 * The legacy `available` vocabulary (`yes` / `after-download` / `no`) is
 * mapped here so every caller only ever sees `ModelAvailability`. A build
 * that answers with something we do not recognize is treated as
 * `downloadable`: offering the control and failing with one honest line beats
 * hiding a feature because the wording changed.
 */
function adapt(raw: RawLanguageModel): AiModelApi {
  return {
    availability: async () => {
      if (typeof raw.availability === 'function') {
        const answer = await raw.availability();
        switch (answer) {
          case 'available':
          case 'downloadable':
          case 'downloading':
          case 'unavailable':
            return answer;
          default:
            return 'downloadable';
        }
      }
      if (typeof raw.capabilities === 'function') {
        const caps = await raw.capabilities();
        switch (caps?.available) {
          case 'yes':
            return 'available';
          case 'after-download':
            return 'downloadable';
          case 'no':
            return 'unavailable';
          default:
            return 'downloadable';
        }
      }
      // create() exists but cannot be asked its state: assume a download on
      // first use, which is what create() would do anyway.
      return 'downloadable';
    },
    create: (options) => raw.create(options),
  };
}

export function detectAiModelApi(): AiModelApi | null {
  const g = globalThis as {
    LanguageModel?: unknown;
    ai?: { languageModel?: unknown };
  };
  // inside a function, per capabilities.ts: a bare `typeof LanguageModel`
  // at module scope would be a reference the node test environment must
  // answer for, and detection belongs where it is used anyway.
  if (isModelLike(g.LanguageModel)) {
    return adapt(g.LanguageModel);
  }
  if (isModelLike(g.ai?.languageModel)) {
    return adapt(g.ai.languageModel);
  }
  return null;
}
