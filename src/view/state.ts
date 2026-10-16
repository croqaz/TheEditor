// A minimal signal: holds a value, notifies subscribers on change. Explicit
// subscriptions only; no automatic dependency tracking is needed for two bars.

export type Unsubscribe = () => void;

export class Signal<T> {
	private readonly subscribers = new Set<(value: T) => void>();

	constructor(private value: T) {}

	get(): T {
		return this.value;
	}

	set(next: T): void {
		if (Object.is(next, this.value)) return;
		this.value = next;
		for (const fn of this.subscribers) fn(next);
	}

	update(fn: (current: T) => T): void {
		this.set(fn(this.value));
	}

	/** Subscribe and run immediately with the current value. */
	subscribe(fn: (value: T) => void): Unsubscribe {
		this.subscribers.add(fn);
		fn(this.value);
		return () => this.subscribers.delete(fn);
	}
}

export function signal<T>(value: T): Signal<T> {
	return new Signal(value);
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
	let timer: ReturnType<typeof setTimeout> | null = null;
	const wrapped = (...args: A) => {
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			timer = null;
			fn(...args);
		}, ms);
	};
	wrapped.cancel = () => {
		if (timer) clearTimeout(timer);
		timer = null;
	};
	return wrapped;
}

/** Create an element with class names and optional text. */
export function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	className?: string,
	text?: string,
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
}
