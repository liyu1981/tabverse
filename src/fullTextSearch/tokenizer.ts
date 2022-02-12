import { guessLanguage } from './guessLanguage';

interface TokenizeResults {
  terms: string[];
  lang: string;
}

function getSegmenter(lang: string) {
  // here we are using the Intl.Segmenter available after Chrome 87
  // @ts-ignore
  return new Intl.Segmenter(lang, { granularity: 'word' });
}

export async function tokenize(content: string): Promise<TokenizeResults> {
  const lang = await new Promise<string>((resolve, reject) =>
    guessLanguage.detect(content, resolve),
  );
  const words = new Set<string>();
  const segmenter = getSegmenter(lang);
  for (const { segment, isWordLike } of segmenter.segment(content)) {
    if (isWordLike) {
      const word = segment.toLowerCase();
      words.add(word);
    }
  }
  return {
    terms: Array.from(words),
    lang,
  };
}
