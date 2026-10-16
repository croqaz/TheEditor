// Drag and drop of files onto any part of the window. Without this WebKit
// navigates the whole page to the dropped file (everything goes black) or
// ProseMirror pastes the file URL as text.

export interface DropTargets {
	/** Absolute paths the main process can read. */
	openPaths(paths: string[]): void;
	/** Content of a dropped file whose path is not known (File objects only). */
	openText(name: string, text: string): void;
}

export const MARKDOWN_FILE = /\.(md|markdown|txt)$/i;

/** `text/uri-list` → local paths; non-file URIs and comments are dropped. */
export function pathsFromUriList(uriList: string | null | undefined): string[] {
	if (!uriList) return [];
	const paths: string[] = [];
	for (const raw of uriList.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line || line.startsWith("#") || !line.startsWith("file://")) continue;
		const withoutScheme = line.slice("file://".length).replace(/^localhost(?=\/)/, "");
		try {
			paths.push(decodeURIComponent(withoutScheme));
		} catch {
			paths.push(withoutScheme);
		}
	}
	return paths;
}

type TransferLike = {
	types?: ArrayLike<string> | readonly string[];
	files?: ArrayLike<{ name: string; text(): Promise<string> }>;
	getData?(type: string): string;
	dropEffect?: string;
};

function transferOf(event: Event): TransferLike | null {
	return ((event as DragEvent).dataTransfer as TransferLike | null) ?? null;
}

/** True for drags that WebKit would otherwise turn into a navigation: files or URL lists. */
export function carriesFiles(transfer: TransferLike | null): boolean {
	if (!transfer) return false;
	const types = Array.from(transfer.types ?? []);
	return types.includes("Files") || types.includes("text/uri-list");
}

export function installDropHandler(target: EventTarget, handlers: DropTargets): () => void {
	const onDragOver = (event: Event) => {
		const transfer = transferOf(event);
		if (!carriesFiles(transfer)) return;
		event.preventDefault();
		if (transfer) transfer.dropEffect = "copy";
	};
	const onDrop = (event: Event) => {
		const transfer = transferOf(event);
		if (!carriesFiles(transfer)) return;
		event.preventDefault();
		event.stopPropagation();
		const paths = pathsFromUriList(transfer?.getData?.("text/uri-list")).filter((p) => MARKDOWN_FILE.test(p));
		if (paths.length) {
			handlers.openPaths(paths);
			return;
		}
		for (const file of Array.from(transfer?.files ?? [])) {
			if (!MARKDOWN_FILE.test(file.name)) continue;
			void file.text().then((text) => handlers.openText(file.name, text));
		}
	};
	const options = { capture: true } as const;
	target.addEventListener("dragenter", onDragOver, options);
	target.addEventListener("dragover", onDragOver, options);
	target.addEventListener("drop", onDrop, options);
	return () => {
		target.removeEventListener("dragenter", onDragOver, options);
		target.removeEventListener("dragover", onDragOver, options);
		target.removeEventListener("drop", onDrop, options);
	};
}
