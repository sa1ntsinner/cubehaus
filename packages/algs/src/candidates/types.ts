/** One case as written by hand: its label, candidate algorithms, how to recognise it. */
export type CaseSource = {
  /** The case's label in the catalogue: `T`, `OLL 27`, `U 3`. */
  label: string;
  algs: readonly string[];
  /**
   * One or two plain sentences on how to recognise the case, as the main algorithm's
   * picture shows it, and a check of every claim they make on that picture (diagram.ts).
   * Left out where it could not be said plainly and checked.
   */
  recognise?: {
    en: string;
    ru: string;
    check: (picture: string) => boolean;
  };
};
