import { addIcon, Notice, Plugin, WorkspaceLeaf } from "obsidian";
import { DEFAULT_SETTINGS, NTFY_ICON, NtfyPluginSettings } from "./types";
import { NtfyStreamClient } from "./services/NtfyClient";
import { NotificationService } from "./services/NotificationService";
import { MessageStore } from "./services/MessageStore";
import { NtfyView, NTFY_VIEW_TYPE } from "./views/NtfyView";
import { NtfySettingTab } from "./views/NtfySettingTab";

export default class NtfyPlugin extends Plugin {
	declare settings: NtfyPluginSettings;
	client!: NtfyStreamClient;
	store!: MessageStore;
	notifService!: NotificationService;

	/** The currently open sidebar view instance (if any). */
	get view(): NtfyView | null {
		const leaves = this.app.workspace.getLeavesOfType(NTFY_VIEW_TYPE);
		return leaves.length > 0 ? (leaves[0].view as NtfyView) : null;
	}

	async onload() {
		await this.loadSettings();

		addIcon("ntfy", NTFY_ICON);

		// ── Services ──────────────────────────────────────────────────────────
		this.store = new MessageStore();

		this.client = new NtfyStreamClient(
			this.settings,
			// onMessage
			(msg) => {
				this.store.addMessage(msg);
				this.notifService.show(msg);
			},
			// onDelete — server deleted the notification (sequence_id) → remove from client DB
			(sequenceId, topic) => {
				this.store.deleteBySequence(sequenceId, topic);
				this.notifService.dismissNotice(sequenceId);
			},
			// onClear — server dismissed the notification (sequence_id) → dot off, message stays
			(sequenceId, topic) => {
				this.store.clearBySequence(sequenceId, topic);
				if (sequenceId) this.notifService.dismissNotice(sequenceId);
				else this.notifService.dismissAllForTopic(topic);
			},
			// onError
			(err) => {
				console.error("[ntfy] Stream error:", err);
			},
		);

		this.notifService = new NotificationService(this.settings);

		// ── Sidebar view ──────────────────────────────────────────────────────
		this.registerView(NTFY_VIEW_TYPE, (leaf) => new NtfyView(leaf, this));

		// this.addRibbonIcon("ntfy", "ntfy", () => {
		// 	this.activateView();
		// });

		// ── Commands ──────────────────────────────────────────────────────────
		this.addCommand({
			id: "open-ntfy-sidebar",
			name: "Open ntfy sidebar",
			callback: () => this.activateView(),
		});

		this.addCommand({
			id: "ntfy-reconnect-all",
			name: "Reconnect all topic streams",
			callback: () => {
				this.reconnectAll();
				new Notice("ntfy: reconnecting all topics…");
			},
		});

		// ── Settings tab ──────────────────────────────────────────────────────
		this.addSettingTab(new NtfySettingTab(this.app, this));

		// ── Connect enabled topics ────────────────────────────────────────────
		// Wait for workspace to be ready before connecting
		this.app.workspace.onLayoutReady(() => {
			this.connectEnabledTopics();
		});
	}

	onunload() {
		this.client.disconnectAll();
		this.app.workspace.detachLeavesOfType(NTFY_VIEW_TYPE);
	}

	// ─── Settings ─────────────────────────────────────────────────────────────

	async loadSettings() {
		// Deep merge to handle nested objects like `auth`
		const saved = (await this.loadData()) as Partial<NtfyPluginSettings> | null;
		this.settings = {
			...DEFAULT_SETTINGS,
			...saved,
			auth: {
				...DEFAULT_SETTINGS.auth,
				...(saved?.auth ?? {}),
			},
		};
	}

	async saveSettings() {
		await this.saveData(this.settings);
		// Propagate updated settings to services
		this.client.updateSettings(this.settings);
		this.notifService.updateSettings(this.settings);
	}

	// ─── Connection Management ────────────────────────────────────────────────

	private connectEnabledTopics() {
		for (const topic of this.settings.topics) {
			if (topic.enabled) {
				this.client.connect(topic.name);
			}
		}
	}

	/** Disconnect and reconnect all enabled topics (e.g. after server/auth change). */
	reconnectAll() {
		this.client.disconnectAll();
		this.connectEnabledTopics();
	}

	// ─── Sidebar ─────────────────────────────────────────────────────────────

	async activateView() {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = null;

		const existing = workspace.getLeavesOfType(NTFY_VIEW_TYPE);
		if (existing.length > 0) {
			leaf = existing[0];
		} else {
			leaf = workspace.getRightLeaf(false);
			if (!leaf) leaf = workspace.getLeaf("split", "vertical");
			await leaf.setViewState({ type: NTFY_VIEW_TYPE, active: true });
		}

		workspace.revealLeaf(leaf!);
	}
}
