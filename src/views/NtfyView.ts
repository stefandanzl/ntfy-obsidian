import { ItemView, Menu, Notice, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import type NtfyPlugin from "../main";
import { NtfyMessage, TopicSettings } from "../types";
import { ComposeModal } from "../modals/ComposeModal";

export const NTFY_VIEW_TYPE = "ntfy-sidebar-view";

// ntfy brand green — matches #338574
const NTFY_GREEN = "#338574";

export class NtfyView extends ItemView {
	private plugin: NtfyPlugin;

	private topicSelect!: HTMLSelectElement;
	private messageList!: HTMLElement;
	private composeInput!: HTMLInputElement;
	private unsubscribers: Array<() => void> = [];
	private currentTopic = "";

	constructor(leaf: WorkspaceLeaf, plugin: NtfyPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType() {
		return NTFY_VIEW_TYPE;
	}
	getDisplayText() {
		return "ntfy";
	}
	getIcon() {
		return "ntfy";
	}

	async onOpen() {
		this._buildUI();
		this._bindTopics();
	}

	async onClose() {
		this.unsubscribers.forEach((u) => u());
		this.unsubscribers = [];
	}

	// ─── UI ──────────────────────────────────────────────────────────────────

	private _buildUI() {
		const root = this.containerEl;
		root.empty();
		root.addClass("ntfy-view");

		// Header: logo + topic picker
		const header = root.createDiv("ntfy-header");
		header.createEl("span", { text: "ntfy", cls: "ntfy-logo" });

		this.topicSelect = header.createEl("select", {
			cls: "dropdown",
			attr: { "aria-label": "Topic" },
		});
		this.topicSelect.addEventListener("change", () => this.switchTopic(this.topicSelect.value));
		// Message list
		this.messageList = root.createDiv("ntfy-message-list");

		// Compose bar (bottom): [detailed modal] [input] [send]
		this._buildComposeBar(root);
	}

	private _buildComposeBar(root: HTMLElement) {
		const bar = root.createDiv("ntfy-compose-bar");

		// Left: open the detailed compose modal (title, priority, attachments…)
		const modalBtn = bar.createEl("button", {
			cls: "ntfy-btn ntfy-compose-modal-btn",
			attr: { title: "Detailed message (title, priority, attachments…)" },
		});
		setIcon(modalBtn, "pencil");
		modalBtn.addEventListener("click", () => {
			if (!this.currentTopic) {
				new Notice("Select a topic first.");
				return;
			}
			new ComposeModal(this.app, this.plugin, this.currentTopic).open();
		});

		// Center: text input (Enter to send)
		this.composeInput = bar.createEl("input", {
			cls: "ntfy-compose-input",
			attr: { type: "text", placeholder: "Message…" },
		});
		this.composeInput.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				void this._sendComposed();
			}
		});

		// Right: send (empty input → sends "triggered", like the ntfy web UI)
		const sendBtn = bar.createEl("button", {
			cls: "ntfy-btn ntfy-compose-send",
			attr: { title: "Send" },
		});
		setIcon(sendBtn, "send");
		sendBtn.addEventListener("click", () => void this._sendComposed());
	}

	/** Send the compose input. Empty input sends "triggered" (ntfy web-UI behavior). */
	private async _sendComposed() {
		if (!this.currentTopic) {
			new Notice("Select a topic first.");
			return;
		}
		const message = this.composeInput.value.trim() || "triggered";
		try {
			await this.plugin.client.publish({ topic: this.currentTopic, message });
			this.composeInput.value = "";
		} catch (e) {
			new Notice(`Send failed: ${(e as Error).message}`);
		}
	}

	// ─── Topics ──────────────────────────────────────────────────────────────

	refreshTopics() {
		this._populateTopicSelect();
		if (this.topicSelect.value) this.switchTopic(this.topicSelect.value);
	}

	private _bindTopics() {
		this._populateTopicSelect();
		const first = this.plugin.settings.topics.find((t) => t.enabled);
		if (first) this.switchTopic(this.currentTopic || first.name);
	}

	private _populateTopicSelect() {
		const previous = this.currentTopic;
		this.topicSelect.empty();
		const topics = this.plugin.settings.topics.filter((t) => t.enabled);
		if (!topics.length) {
			const opt = this.topicSelect.createEl("option", { text: "No topics configured" });
			opt.disabled = true;
			return;
		}
		for (const t of topics) {
			this.topicSelect.createEl("option", { text: t.name, value: t.name });
		}
		this.topicSelect.value =
			previous && topics.some((t) => t.name === previous) ? previous : topics[0].name;
	}

	private switchTopic(topicName: string) {
		if (!topicName) return;
		this.unsubscribers.forEach((u) => u());
		this.unsubscribers = [];
		this.currentTopic = topicName;
		this.topicSelect.value = topicName;

		const color = this._topicColor(topicName);
		this.containerEl.style.setProperty("--ntfy-current-color", color);

		this._renderMessages(topicName);

		// Backfill cached history — deferred so the UI thread can paint first.
		// `since` is passed through verbatim, including "all" (full cache) and
		// "latest" (only the most recent message). Each event is applied during
		// parsing, wrapped in a batch so only one re-render fires.
		this.plugin.store.beginBatch();
		setTimeout(() => {
			this.plugin.client
				.pollAndApply(topicName, this.plugin.settings.since, (ev) => this.plugin.store.applyEvent(ev))
				.catch(() => {
					/* silent */
				})
				.finally(() => this.plugin.store.endBatch());
		}, 0);

		// Live updates
		const unsub = this.plugin.store.subscribe(topicName, () => this._renderMessages(topicName));
		this.unsubscribers.push(unsub);
	}

	// ─── Message rendering ────────────────────────────────────────────────────

	private _renderMessages(topicName: string) {
		const msgs = this.plugin.store.getMessages(topicName);
		// Remember whether the user is pinned to the top (reading newest).
		const atTop = this.messageList.scrollTop <= 20;

		this.messageList.empty();

		if (!msgs.length) {
			this.messageList.createEl("p", { text: "No messages yet.", cls: "ntfy-empty-state" });
			return;
		}

		// Newest first: store is chronological ascending, render from the end.
		for (let i = msgs.length - 1; i >= 0; i--) this._renderMessage(msgs[i]);

		// Keep the user at the top when new messages arrive (unless they
		// scrolled down into older history).
		if (atTop) this.messageList.scrollTop = 0;
	}

	private _renderMessage(msg: NtfyMessage) {
		const color = this._topicColor(msg.topic);
		const isCleared = msg.cleared === true;

		const el = this.messageList.createDiv("ntfy-message");
		el.style.setProperty("--topic-color", color);

		// Interactions: left-click clears the notification (dot off), right-click
		// opens a Clear / Delete menu. Both hit the server; the store is updated
		// optimistically so the UI reacts instantly (idempotent with the SSE event).
		// The sequence key is sequence_id, falling back to the message id (ntfy lets
		// you use a message's id as its sequence id — the first-message anchor case).
		el.style.cursor = "pointer";
		el.addEventListener("click", (e) => {
			// Don't clear when the user clicked an interactive child (attachment link).
			if ((e.target as HTMLElement).closest("a, button")) return;
			void this._clearMessage(msg);
		});
		el.addEventListener("contextmenu", (e) => {
			const menu = new Menu();
			menu.addItem((item) =>
				item
					.setTitle("Clear")
					.setIcon("check")
					.onClick(() => void this._clearMessage(msg)),
			);
			menu.addItem((item) =>
				item
					.setTitle("Delete")
					.setIcon("trash")
					.onClick(() => void this._deleteMessage(msg)),
			);
			menu.showAtMouseEvent(e);
		});

		// ── Meta row: timestamp + notification dot ──────────────────────────
		const meta = el.createDiv("ntfy-message-meta");

		// Date + time, matching ntfy web-UI format
		const d = new Date(msg.time * 1000);
		const dateStr = d.toLocaleDateString([], { day: "2-digit", month: "2-digit", year: "2-digit" });
		const timeStr = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

		const timestampSpan = meta.createEl("span", {
			text: `${dateStr}, ${timeStr}`,
			cls: "ntfy-timestamp",
		});

		// Green dot = notification still active (not cleared by server)
		// No dot = cleared. Exactly like ntfy web-UI.
		if (!isCleared) {
			const NS = "http://www.w3.org/2000/svg";
			const dot = document.createElementNS(NS, "svg");
			dot.setAttribute("viewBox", "0 0 100 100");
			dot.setAttribute("aria-label", "Active notification");
			dot.addClass("ntfy-notif-dot");
			const circle = document.createElementNS(NS, "circle");
			circle.setAttribute("cx", "50");
			circle.setAttribute("cy", "50");
			circle.setAttribute("r", "50");
			circle.setAttribute("fill", NTFY_GREEN);
			dot.appendChild(circle);
			timestampSpan.appendChild(dot);
		}

		// Priority icon (high/urgent only)
		if (msg.priority && msg.priority >= 4) {
			meta.createEl("span", {
				text: msg.priority === 5 ? "🚨" : "🔊",
				cls: "ntfy-priority-icon",
			});
		}

		// ── Title ─────────────────────────────────────────────────────────
		if (msg.title) el.createEl("div", { text: msg.title, cls: "ntfy-message-title" });

		// ── Body ──────────────────────────────────────────────────────────
		el.createDiv("ntfy-message-body").createEl("span", { text: msg.message ?? "" });

		// ── Tags ──────────────────────────────────────────────────────────
		if (msg.tags?.length) {
			const tagsEl = el.createDiv("ntfy-message-tags");
			for (const tag of msg.tags) tagsEl.createEl("span", { text: tag, cls: "ntfy-tag" });
		}

		// ── Attachment ────────────────────────────────────────────────────
		if (msg.attachment) {
			const att = msg.attachment;
			const attEl = el.createDiv("ntfy-attachment");
			const link = attEl.createEl("a", {
				text: `📎 ${att.name}`,
				cls: "ntfy-attachment-link",
			});
			link.href = "#";
			link.addEventListener("click", (e) => {
				e.preventDefault();
				void this._downloadAttachment(att.url, att.name);
			});
			if (att.size) {
				attEl.createEl("span", {
					text: ` (${(att.size / 1024).toFixed(1)} KB)`,
					cls: "ntfy-attachment-size",
				});
			}
		}
	}

	// ─── Clear / Delete ────────────────────────────────────────────────────────

	/** Sequence key for clear/delete: sequence_id, falling back to the message id. */
	private _seqKey(msg: NtfyMessage): string {
		return msg.sequence_id ?? msg.id;
	}

	/** Clear (mark read) a message's notification. Pessimistic: wait for the
	 *  server's 2xx, then update locally + dismiss any open pop-up. On failure
	 *  (e.g. 429 rate limit) leave the state unchanged and notify. */
	private async _clearMessage(msg: NtfyMessage) {
		const seq = this._seqKey(msg);
		try {
			await this.plugin.client.clearNotification(msg.topic, seq);
			this.plugin.store.clearBySequence(seq, msg.topic);
			this.plugin.notifService.dismissNotice(seq);
		} catch (e) {
			new Notice(`Clear failed: ${(e as Error).message}`);
		}
	}

	/** Delete a message entirely. Pessimistic: wait for the server's 2xx, then
	 *  remove locally + dismiss any open pop-up. */
	private async _deleteMessage(msg: NtfyMessage) {
		const seq = this._seqKey(msg);
		try {
			await this.plugin.client.deleteNotification(msg.topic, seq);
			this.plugin.store.deleteBySequence(seq, msg.topic);
			this.plugin.notifService.dismissNotice(seq);
		} catch (e) {
			new Notice(`Delete failed: ${(e as Error).message}`);
		}
	}

	// ─── Download ─────────────────────────────────────────────────────────────

	private async _downloadAttachment(url: string, filename: string) {
		try {
			const data = await this.plugin.client.downloadAttachment(url);
			const folder = this.plugin.settings.downloadFolder;
			if (!(await this.app.vault.adapter.exists(folder))) {
				await this.app.vault.createFolder(folder);
			}
			const dest = `${folder}/${filename}`;
			const existing = this.app.vault.getFileByPath(dest);
			if (existing) await this.app.vault.modifyBinary(existing, data);
			else await this.app.vault.createBinary(dest, data);
			new Notice(`Downloaded: ${dest}`);
		} catch (e) {
			new Notice(`Download failed: ${(e as Error).message}`);
		}
	}

	// ─── Helpers ──────────────────────────────────────────────────────────────

	private _topicColor(topicName: string): string {
		return this.plugin.settings.topics.find((t) => t.name === topicName)?.color ?? "#7c3aed";
	}

	// suppress unused warning — kept for future use
	private _getTopicSettings(topicName: string): TopicSettings | undefined {
		return this.plugin.settings.topics.find((t) => t.name === topicName);
	}
}
