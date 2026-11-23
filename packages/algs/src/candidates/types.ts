/** One case as written by hand: its label, candidate algorithms, how to recognise it. */
export type CaseSource = {
  /** The case's label in the catalogue: `T`, `OLL 27`, `U 3`. */
  label: string;
  algs: readonly string[];
  /**
   * Hand-written words on how to recognise the case with a check of every claim on its
   * picture (diagram.ts). PLL and OLL no longer use it: their notes are made from the
   * sticker model (notes.ts).
   */
  recognise?: {
    en: string;
    ru: string;
    check: (picture: string) => boolean;
  };
};
