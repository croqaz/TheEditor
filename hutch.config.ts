// @hutch cli=0.27.1 cottontail=0.7.1
// Hutch runs string scripts through Cottontail's shell, where `bun` means
// Cottontail; use `hutch pm x <bin>` to run project binaries with Bun.
export default {
	packageManager: "bun",
	scripts: {
		install: ["hutch", "install"],
		"dev:view": "hutch pm x vite --port 5173",
		start: "hutch electrobun prepare && hutch pm x vite build && hutch electrobun dev",
		dev: "hutch electrobun prepare && hutch pm x vite build && hutch electrobun dev --watch",
		"build:view": "hutch electrobun prepare && hutch pm x vite build",
		"build:canary": "hutch run build:view && hutch electrobun build --env=canary",
		"build:stable": "hutch run build:view && hutch electrobun build --env=stable",
		typecheck: "hutch pm x tsc --noEmit",
		test: "hutch pm test",
	},
	electrobun: {
		version: "2.0.2",
	},
};
