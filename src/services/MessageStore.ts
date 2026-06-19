import { NtfyMessage } from "../types";

/** Simple reactive in-memory store for chat messages, keyed by topic. */
export class MessageStore {
	private messages: Map<string, NtfyMessage[]> = new Map();
	/**
	 * Set of message IDs whose notification has been cleared/deleted.
	 * The message stays in the chat history but is visually marked as cleared.
	 * Populated by incoming message_delete and message_clear events from the stream.
	 */
	private clearedIds: Set<string> = new Set();
	private listeners: Map<string, Set<() => void>> = new Map();

	addMessage(msg: NtfyMessage) {
		const topic = msg.topic;
		if (!this.messages.has(topic)) this.messages.set(topic, []);

		const existing = this.messages.get(topic)!;
		if (existing.some((m) => m.id === msg.id)) return;

		existing.push(msg);
		existing.sort((a, b) => a.time - b.time);
		this._notify(topic);
	}

	/**
	 * Handle a message_delete event from the server stream.
	 * Marks the notification as cleared locally — message stays in history.
	 *
	 * ntfy sends message_delete with the id of the original message
	 * when a server app calls DELETE /<topic>/messages/<id>.
	 */
	markNotificationCleared(messageId: string, topic: string) {
		this.clearedIds.add(messageId);
		this._notify(topic);
	}

	/**
	 * Handle a message_clear event from the server stream.
	 * Clears notification status for ALL messages in the topic.
	 */
	markAllNotificationsCleared(topic: string) {
		const msgs = this.messages.get(topic) ?? [];
		for (const m of msgs) this.clearedIds.add(m.id);
		this._notify(topic);
	}

	isCleared(messageId: string): boolean {
		return this.clearedIds.has(messageId);
	}

	loadHistory(topic: string, msgs: NtfyMessage[]) {
		if (!msgs.length) return;
		if (!this.messages.has(topic)) this.messages.set(topic, []);
		const existing = this.messages.get(topic)!;

		// Batch path: dedupe once, append once, sort once, notify ONCE.
		// (Calling addMessage per msg would re-sort + re-render the whole list
		// for every message — O(n²) DOM work that freezes Obsidian on startup.)
		const seen = new Set(existing.map((m) => m.id));
		let added = false;
		for (const m of msgs) {
			if (seen.has(m.id)) continue;
			seen.add(m.id);
			existing.push(m);
			added = true;
		}
		if (added) {
			existing.sort((a, b) => a.time - b.time);
			this._notify(topic);
		}
	}

	getMessages(topic: string): NtfyMessage[] {
		return this.messages.get(topic) ?? [];
	}

	getTopics(): string[] {
		return Array.from(this.messages.keys());
	}

	subscribe(topic: string, cb: () => void): () => void {
		if (!this.listeners.has(topic)) this.listeners.set(topic, new Set());
		this.listeners.get(topic)!.add(cb);
		return () => this.listeners.get(topic)?.delete(cb);
	}

	private _notify(topic: string) {
		this.listeners.get(topic)?.forEach((cb) => cb());
	}
}
