#!/usr/bin/env node
/**
 * Build script for Dashica frontend assets
 *
 * Builds frontend JavaScript and CSS to dashica-src/public/dist/
 * These files are served by the Go server at /public/dist/
 */

const esbuild = require('esbuild');
const { default: tailwindcss } = require('esbuild-plugin-tailwindcss');
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, 'dashica-src', 'public', 'dist');
const DEV_SERVER_OUT_DIR = path.join(__dirname, 'docs', 'dev-server', 'dashica-src', 'public', 'dist');

async function build() {
  console.log('🔨 Building Dashica frontend assets...\n');

  // Ensure output directories exist
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(DEV_SERVER_OUT_DIR, { recursive: true });

  try {
    // Build JavaScript
    console.log('📦 Bundling JavaScript...');
    await esbuild.build({
      entryPoints: ['frontend/index.js'],
      bundle: true,
      outfile: path.join(OUT_DIR, 'index.js'),
      loader: { '.ts': 'ts' },
      format: 'iife',
      target: 'es2020',
      conditions: ['style'],
      logLevel: 'info',
    });
    console.log('✅ JavaScript built\n');

    // Build CSS
    console.log('🎨 Building CSS with Tailwind...');
    await esbuild.build({
      entryPoints: ['frontend/index.css'],
      bundle: true,
      outfile: path.join(OUT_DIR, 'index.css'),
      plugins: [tailwindcss()],
      conditions: ['style'],
      logLevel: 'warning',
    });
    console.log('✅ CSS built\n');

    // Copy assets to dev-server location
    console.log('📋 Copying assets to dev-server location...');
    fs.copyFileSync(
      path.join(OUT_DIR, 'index.js'),
      path.join(DEV_SERVER_OUT_DIR, 'index.js')
    );
    fs.copyFileSync(
      path.join(OUT_DIR, 'index.css'),
      path.join(DEV_SERVER_OUT_DIR, 'index.css')
    );
    console.log('✅ Assets copied to dev-server\n');

    console.log(`✨ Build complete!`);
    console.log(`   Main: ${OUT_DIR}`);
    console.log(`   Dev:  ${DEV_SERVER_OUT_DIR}`);
  } catch (error) {
    console.error('❌ Build failed:', error.message);
    process.exit(1);
  }
}

build();
