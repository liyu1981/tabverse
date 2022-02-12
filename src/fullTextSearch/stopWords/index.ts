import { words as enWords } from './en';
import { words as urlWords } from './url';

const stopWordDicts = {
  en: enWords,
  url: urlWords,
};

export function removeStopWords(terms: string[], lang: string): string[] {
  const dict = stopWordDicts[lang];
  if (dict) {
    const lookup = dict.reduce((acc, word) => {
      acc[word] = 1;
      return acc;
    }, {});
    return terms.filter((term) => !(term in lookup));
  } else {
    return terms;
  }
}
