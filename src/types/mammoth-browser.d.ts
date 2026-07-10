declare module "mammoth/mammoth.browser" {
  interface ConvertInput {
    arrayBuffer: ArrayBuffer;
  }
  interface ConvertOptions {
    styleMap?: string[];
  }
  interface ConvertResult {
    value: string;
    messages: unknown[];
  }
  export function convertToHtml(
    input: ConvertInput,
    options?: ConvertOptions
  ): Promise<ConvertResult>;
  const _default: { convertToHtml: typeof convertToHtml };
  export default _default;
}
