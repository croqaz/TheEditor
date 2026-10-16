import { resolve } from "node:path";
import { defineConfig } from "vite";
import { electrobunViteAliases } from "./.hutch/devkit/api/config/electrobun-vite.ts";

export default defineConfig({
	resolve: {
		alias: electrobunViteAliases(resolve(import.meta.dirname, ".hutch/devkit")),
	},
	root: "src/view",
	publicDir: false,
	build: {
		outDir: "../../dist",
		emptyOutDir: true,
		sourcemap: true,
	},
	server: {
		port: 5173,
		strictPort: true,
	},
});
