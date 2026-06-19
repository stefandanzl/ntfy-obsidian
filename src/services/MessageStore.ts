import { NtfyMessage } from "../types";

/**
 * In-memory cache of ntfy messages per topic, mirroring the server cache.
 *
 * Behaviour follows the ntfy docs 1:1:
 *   • Publish / Update / Revive  → append the message (the server cache keeps
 *     every version of an updated sequence, so we show them all).
 *   • message_clear(seq)         → mark every message of that sequence as read
 *     (cleared flag, no green dot); the messages stay visible.
 *   • message_delete(seq)        → remove every message of that sequence from
 *     the list (client DB removal). A later message with the same seq (revive)
 *     simply gets appended again.
 *
 * A sequence is matched by `sequence_id === S` OR `id === S` (the first message
 * of a sequence has no sequence_id — its id is the anchor).
 */
export class MessageStore {
	private messages: Map<string, NtfyMessage[]> = new Map();
	private listeners: Map<string, Set<() => void>> = new Map();

	/** Batching defers sort + notify until endBatch() so a history replay (many
	 *  events parsed in one pass) triggers a single re-render, not one per event. */
	private batchDepth = 0;
	private dirtyTopics: Set<string> = new Set();

	// ─── Batching ──────────────────────────────────────────────────────────

	beginBatch() {
		this.batchDepth++;
	}

	endBatch() {
		if (this.batchDepth > 0) this.batchDepth--;
		if (this.batchDepth !== 0) return;
		for (const topic of this.dirtyTopics) {
			const msgs = this.messages.get(topic);
			if (msgs) msgs.sort((a, b) => a.time - b.time);
			this._notify(topic);
		}
		this.dirtyTopics.clear();
	}

	// ─── Event application (shared by live + history paths) ────────────────

	/** Dispatch a single parsed ntfy event to the matching mutation. */
	applyEvent(ev: NtfyMessage) {
		switch (ev.event) {
			case "message":
				this.addMessage(ev);
				break;
			case "message_clear":
				this.clearBySequence(ev.sequence_id, ev.topic);
				break;
			case "message_delete":
				this.deleteBySequence(ev.sequence_id, ev.topic);
				break;
		}
	}

	/** message event: append (dedup by id). Updates keep every version. */
	addMessage(msg: NtfyMessage) {
		const topic = msg.topic;
		let existing = this.messages.get(topic);
		if (!existing) {
			existing = [];
			this.messages.set(topic, existing);
		}
		if (existing.some((m) => m.id === msg.id)) return;
		existing.push(msg);
		this._markChanged(topic);
	}

	/** message_clear: dismiss the notification (no dot), message stays. The read
	 *  state is per notification (= sequence), so flag every cache message of
	 *  that sequence (an updated sequence has several). */
	clearBySequence(sequenceId: string | undefined, topic: string) {
		const msgs = this.messages.get(topic);
		if (!msgs?.length) return;
		if (!sequenceId) {
			for (const m of msgs) m.cleared = true;
			this._markChanged(topic);
			return;
		}
		let changed = false;
		for (const m of msgs) {
			if (this._matchesSeq(m, sequenceId)) {
				m.cleared = true;
				changed = true;
			}
		}
		if (changed) this._markChanged(topic);
	}

	/** message_delete: remove from the client DB entirely. A revive (new message
	 *  with the same sequence_id) simply appends again later. */
	deleteBySequence(sequenceId: string | undefined, topic: string) {
		if (!sequenceId) return;
		const msgs = this.messages.get(topic);
		if (!msgs?.length) return;
		const before = msgs.length;
		for (let i = msgs.length - 1; i >= 0; i--) {
			if (this._matchesSeq(msgs[i], sequenceId)) msgs.splice(i, 1);
		}
		if (msgs.length !== before) this._markChanged(topic);
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

	// ─── Internal ──────────────────────────────────────────────────────────

	/** A message belongs to sequence S if its sequence_id or its id equals S
	 *  (the first message of a sequence has no sequence_id; its id is the anchor). */
	private _matchesSeq(m: NtfyMessage, sequenceId: string): boolean {
		return m.sequence_id === sequenceId || m.id === sequenceId;
	}

	private _markChanged(topic: string) {
		this.dirtyTopics.add(topic);
		if (this.batchDepth === 0) {
			const msgs = this.messages.get(topic);
			if (msgs) msgs.sort((a, b) => a.time - b.time);
			this.dirtyTopics.delete(topic);
			this._notify(topic);
		}
	}

	private _notify(topic: string) {
		this.listeners.get(topic)?.forEach((cb) => cb());
	}
}
