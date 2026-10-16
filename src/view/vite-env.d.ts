/// <reference types="vite/client" />

declare global {
	interface Window {
		te: Record<string, unknown>;
		__electrobunPlatform?: "macos" | "windows" | "linux";
	}
}

export {};
