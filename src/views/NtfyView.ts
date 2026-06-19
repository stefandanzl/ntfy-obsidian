import { ItemView, Notice, TFile, WorkspaceLeaf, setIcon } from "obsidian";
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
		return "bell";
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

		// Header: logo + topic picker + compose button
		const header = root.createDiv("ntfy-header");
		header.createEl("span", { text: "ntfy", cls: "ntfy-logo" });

		this.topicSelect = header.createEl("select", { cls: "ntfy-topic-select" });
		this.topicSelect.addEventListener("change", () => this.switchTopic(this.topicSelect.value));

		const composeBtn = header.createEl("button", {
			cls: "ntfy-btn ntfy-compose-btn",
			attr: { title: "New message" },
		});
		setIcon(composeBtn, "pencil");
		composeBtn.addEventListener("click", () => {
			if (!this.currentTopic) {
				new Notice("Select a topic first.");
				return;
			}
			new ComposeModal(this.app, this.plugin, this.currentTopic).open();
		});

		// Message list
		this.messageList = root.createDiv("ntfy-message-list");
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

		// Poll cached history — deferred so the UI thread can paint the current
		// view before we kick off the network request + JSON history parse.
		setTimeout(() => {
			this.plugin.client
				.pollMessages(
					topicName,
					this.plugin.settings.since === "all" ? "24h" : this.plugin.settings.since,
				)
				.then((msgs) => this.plugin.store.loadHistory(topicName, msgs))
				.catch(() => {
					/* silent */
				});
		}, 0);

		// Live updates
		const unsub = this.plugin.store.subscribe(topicName, () => this._renderMessages(topicName));
		this.unsubscribers.push(unsub);
	}

	// ─── Message rendering ────────────────────────────────────────────────────

	private _renderMessages(topicName: string) {
		const msgs = this.plugin.store.getMessages(topicName);
		const atBottom =
			this.messageList.scrollTop + this.messageList.clientHeight >= this.messageList.scrollHeight - 20;

		this.messageList.empty();

		if (!msgs.length) {
			this.messageList.createEl("p", { text: "No messages yet.", cls: "ntfy-empty-state" });
			return;
		}

		for (const msg of msgs) this._renderMessage(msg);

		if (atBottom) this.messageList.scrollTop = this.messageList.scrollHeight;
	}

	private _renderMessage(msg: NtfyMessage) {
		const color = this._topicColor(msg.topic);
		const isCleared = this.plugin.store.isCleared(msg.id);

		const el = this.messageList.createDiv("ntfy-message");
		el.style.setProperty("--topic-color", color);

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
