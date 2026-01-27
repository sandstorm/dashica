import esbuild from "esbuild";
import tailwindPlugin from "esbuild-plugin-tailwindcss";

esbuild.build({
    entryPoints: ["frontend/index.js"],
    outdir: "public/dist",
    bundle: true,
    plugins: [
        tailwindPlugin({
            /* options */
        }),
    ],
});