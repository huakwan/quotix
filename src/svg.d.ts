// esbuild imports .svg via the "base64" loader → a base64 string (no data: prefix).
declare module "*.svg" {
  const base64: string;
  export default base64;
}
