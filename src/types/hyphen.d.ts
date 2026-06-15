declare module "hyphen/de-1996" {
  interface HyphenOptions {
    minWordLength?: number;
    hyphenChar?: string;
    debug?: boolean;
  }
  export function hyphenateSync(text: string, options?: HyphenOptions): string;
  export function hyphenate(
    text: string,
    options?: HyphenOptions
  ): Promise<string>;
}
