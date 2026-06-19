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
	 *
	 * ntfy's message_clear carries a `sequence_id` that matches the
	 * `sequence_id` of the message whose notification should be dismissed.
	 * We resolve that to the first message with a matching sequence_id and
	 * clear exactly that one (e.g. a pomodoro "START" clearing the previous
	 * "PAUSE" notification). If no sequence_id is present, fall back to
	 * clearing all notifications in the topic.
	 */
	markNotificationClearedBySequence(sequenceId: string | undefined, topic: string) {
		if (!sequenceId) {
			this.markAllNotificationsCleared(topic);
			return;
		}
		const target = (this.messages.get(topic) ?? []).find((m) => m.sequence_id === sequenceId);
		if (target) {
			this.clearedIds.add(target.id);
			this._notify(topic);
		}
	}

	/** Clear-all fallback (legacy message_clear without sequence_id). */
	markAllNotificationsCleared(topic: string) {
		const msgs = this.messages.get(topic) ?? [];
		for (const m of msgs) this.clearedIds.add(m.id);
		this._notify(topic);
	}

	isCleared(messageId: string): boolean {
		return this.clearedIds.has(messageId);
	}

	/**
	 * Batch-load a chunk of events (history backfill). Processes `message`,
	 * `message_clear`, and `message_delete` events in one pass: append new
	 * messages (deduped), apply clears by sequence_id, apply deletes by id —
	 * then sort once and notify once. Events arrive chronologically, so a
	 * message always precedes the clear/delete that targets it.
	 */
	loadHistory(topic: string, events: NtfyMessage[]) {
		if (!events.length) return;
		if (!this.messages.has(topic)) this.messages.set(topic, []);
		const existing = this.messages.get(topic)!;
		let changed = false;

		for (const ev of events) {
			if (ev.event === "message") {
				if (existing.some((m) => m.id === ev.id)) continue;
				existing.push(ev);
				changed = true;
			} else if (ev.event === "message_clear" && ev.sequence_id) {
				const target = existing.find((m) => m.sequence_id === ev.sequence_id);
				if (target && this.clearedIds.add(target.id)) changed = true;
			} else if (ev.event === "message_delete") {
				if (this.clearedIds.add(ev.id)) changed = true;
			}
		}

		if (changed) {
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
