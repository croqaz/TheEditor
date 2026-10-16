import type { ElectrobunConfig } from "electrobun";

export default {
	app: {
		name: "TheEditor",
		identifier: "dev.theeditor.app",
		version: "0.1.0",
		description: "A typographic Markdown editor for journals, books and comics.",
	},
	runtime: {
		exitOnLastWindowClosed: true,
	},
	build: {
		mainProcess: "cottontail",
		cottontail: {
			entrypoint: "src/main/index.ts",
			sourcemap: true,
		},
		copy: {
			"dist/index.html": "views/mainview/index.html",
			"dist/assets": "views/mainview/assets",
		},
		watchIgnore: ["dist/**"],
		linux: {
			bundleCEF: false,
		},
		mac: {
			bundleCEF: false,
		},
	},
} satisfies ElectrobunConfig;
