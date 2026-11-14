// The slice of PapaParse (5.7.1, pinned exactly) that import uses. A local
// declaration, not @types/papaparse: one fewer package to trust for a
// feature that parses untrusted files, and the surface we call is tiny.
declare module "papaparse" {
  export type ParseError = {
    type: "Quotes" | "Delimiter" | "FieldMismatch";
    code: string;
    message: string;
    row?: number;
  };

  export type ParseResult = {
    data: string[][];
    errors: ParseError[];
    meta: { delimiter: string; linebreak: string; aborted: boolean; truncated: boolean };
  };

  export type ParseConfig = {
    /** false: every record is an array of strings, the header row included. */
    header?: false;
    /** Never "greedy" here: skipping blank lines would shift row numbers. */
    skipEmptyLines?: boolean | "greedy";
    /** "" asks PapaParse to detect it. */
    delimiter?: string;
    dynamicTyping?: false;
  };

  const Papa: {
    parse(input: string, config?: ParseConfig): ParseResult;
  };
  export default Papa;
}
