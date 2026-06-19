import { App, PluginSettingTab, SettingDefinitionItem } from "obsidian";
import type NtfyPlugin from "../main";
import { TopicModal } from "../modals/TopicModal";
import { TopicSettings } from "../types";

export class NtfySettingTab extends PluginSettingTab {
	plugin: NtfyPlugin;

	constructor(app: App, plugin: NtfyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const p = this.plugin;
		const s = p.settings;

		return [
			// ── Server ──────────────────────────────────────────────────────
			{
				type: "group",
				heading: "Server",
				items: [
					{
						name: "Server URL",
						desc: "Base URL of your ntfy server (e.g. https://ntfy.sh or http://192.168.1.50:2586).",
						control: {
							type: "text",
							key: "serverUrl",
							placeholder: "https://ntfy.sh",
							validate: (v: string) =>
								v && !v.startsWith("http")
									? "URL must start with http:// or https://"
									: undefined,
						},
					},
					{
						name: "Download folder",
						desc: "Vault-relative folder for received file attachments.",
						control: {
							type: "folder",
							key: "downloadFolder",
							includeRoot: false,
						},
					},
					{
						name: "Reconnect delay (ms)",
						desc: "Fallback reconnect delay. EventSource auto-reconnects; this applies after explicit disconnects.",
						control: {
							type: "number",
							key: "reconnectDelayMs",
							min: 1000,
							max: 60000,
							step: 500,
							defaultValue: 5000,
						},
					},
					{
						name: "Fetch history since",
						desc: 'On connect, fetch cached messages since this duration (e.g. "1h", "10m", "all").',
						control: {
							type: "text",
							key: "since",
							placeholder: "all",
						},
					},
				],
			},

			// ── Authentication ───────────────────────────────────────────────
			{
				type: "group",
				heading: "Authentication",
				items: [
					{
						name: "Auth mode",
						desc: '"none" = public topics. "basic" = username + password. "token" = access token (tk_…).',
						control: {
							type: "dropdown",
							key: "auth.mode",
							defaultValue: "none",
							options: {
								none: "None (unauthenticated)",
								basic: "Username + Password",
								token: "Access token",
							},
						},
					},
					{
						name: "Username",
						visible: () => s.auth.mode === "basic",
						control: {
							type: "text",
							key: "auth.username",
							placeholder: "your-username",
						},
					},
					{
						name: "Password",
						visible: () => s.auth.mode === "basic",
						control: {
							type: "text",
							key: "auth.password",
							placeholder: "••••••••",
						},
					},
					{
						name: "Access token",
						desc: "Generate via ntfy CLI: ntfy token add --label=obsidian",
						visible: () => s.auth.mode === "token",
						control: {
							type: "text",
							key: "auth.token",
							placeholder: "tk_AgQdq7mVBoFD37zQVN29RhuMSD3yHZJn",
						},
					},
				],
			},

			// ── Topics (list) ────────────────────────────────────────────────
			{
				type: "list",
				heading: "Topics",
				emptyState: "No topics configured yet. Add one below.",
				addItem: {
					name: "Add topic",
					action: () => {
						new TopicModal(this.app, null, async (newTopic: TopicSettings) => {
							s.topics.push(newTopic);
							await p.saveSettings();
							if (newTopic.enabled) p.client.connect(newTopic.name);
							this.update();
							p.view?.refreshTopics();
						}).open();
					},
				},
				onDelete: async (idx: number) => {
					const removed = s.topics[idx];
					p.client.disconnect(removed.name);
					s.topics.splice(idx, 1);
					await p.saveSettings();
					this.update();
					p.view?.refreshTopics();
				},
				items: s.topics.map((t) => ({
					name: t.name,
					desc: `${t.enabled ? "🟢" : "⭕"} ${t.mute ? "🔇 muted" : "🔔"} · ${t.color}`,
					searchable: false,
					// action signature: (el: HTMLElement, index: number) => void
					action: (_el: HTMLElement, _index: number) => {
						new TopicModal(this.app, t, async (updated: TopicSettings) => {
							const idx2 = s.topics.findIndex((x) => x.name === t.name);
							if (idx2 === -1) return;
							if (!t.enabled && updated.enabled) p.client.connect(updated.name);
							else if (t.enabled && !updated.enabled) p.client.disconnect(updated.name);
							s.topics[idx2] = updated;
							await p.saveSettings();
							this.update();
							p.view?.refreshTopics();
						}).open();
					},
				})),
			},
		];
	}

	// Dot-notation key support for nested settings (auth.mode, auth.username, etc.)
	override getControlValue(key: string): unknown {
		return this._getPath(this.plugin.settings, key);
	}

	override async setControlValue(key: string, value: unknown): Promise<void> {
		this._setPath(this.plugin.settings, key, value);
		await this.plugin.saveSettings();
		if (key === "serverUrl" || key.startsWith("auth.")) {
			this.plugin.reconnectAll();
		}
	}

	private _getPath(obj: unknown, path: string): unknown {
		let cur: unknown = obj;
		for (const part of path.split(".")) {
			if (cur === null || typeof cur !== "object") return undefined;
			cur = (cur as Record<string, unknown>)[part];
		}
		return cur;
	}

	private _setPath(obj: unknown, path: string, value: unknown): void {
		const parts = path.split(".");
		const last = parts.pop()!;
		let cur = obj as Record<string, unknown>;
		for (const part of parts) {
			if (cur[part] === null || typeof cur[part] !== "object") cur[part] = {};
			cur = cur[part] as Record<string, unknown>;
		}
		cur[last] = value;
	}
}
