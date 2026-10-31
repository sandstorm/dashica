// Types for imported .wasm files: esbuild's `file` loader (frontendBuild.mjs) makes each the URL it publishes it at.
declare module '*.wasm' {
  const url: string;
  export default url;
}
