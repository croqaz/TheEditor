// Top bar: one cell per open document. Name, dirty marker, nothing else.
import type { Tab, TabManager } from "../documents/tabs";
import { el } from "../state";

export function mountTabBar(host: HTMLElement, tabs: TabManager, dragRegion: boolean) {
	host.classList.toggle("te-bar--drag", dragRegion);

	const render = () => {
		const list = tabs.tabs.get();
		const active = tabs.active.get();
		host.replaceChildren(
			...list.map((tab) => {
				const cell = el("div", "te-tab");
				cell.setAttribute("role", "tab");
				cell.setAttribute("aria-selected", String(tab.id === active?.id));
				cell.dataset.tabId = String(tab.id);
				cell.title = tab.path ?? "unsaved";
				const name = el("span", "te-tab__name", tab.title);
				const dirty = el("span", "te-tab__dirty", tab.dirty ? (tab.conflict ? "!" : "·") : "");
				cell.append(name, dirty);
				cell.addEventListener("mousedown", (event) => {
					event.preventDefault(); // keep the caret in the text
					if (event.button === 1) void tabs.close(tab.id);
					else if (event.button === 0) tabs.activate(tab.id);
				});
				return cell;
			}),
		);
		const activeCell = host.querySelector<HTMLElement>('[aria-selected="true"]');
		activeCell?.scrollIntoView({ inline: "nearest", block: "nearest" });
	};

	tabs.tabs.subscribe(render);
	tabs.active.subscribe(render);
	return { render };
}

export type { Tab };
