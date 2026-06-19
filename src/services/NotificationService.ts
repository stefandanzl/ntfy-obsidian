import { Notice } from "obsidian";
import { NtfyMessage, NtfyPluginSettings, TopicSettings } from "../types";
import { playNotificationSound } from "./sound";

const PRIORITY_ICONS: Record<number, string> = {
	1: "🔕",
	2: "🔔",
	3: "🔔",
	4: "🔊",
	5: "🚨",
};

export class NotificationService {
	private settings: NtfyPluginSettings;

	constructor(settings: NtfyPluginSettings) {
		this.settings = settings;
	}

	updateSettings(settings: NtfyPluginSettings) {
		this.settings = settings;
	}

	show(msg: NtfyMessage) {
		const topicSettings = this.getTopicSettings(msg.topic);
		// Per-topic mute wins: fully silent (no pop-up, no sound).
		if (!topicSettings || topicSettings.mute) return;

		const showPopup = !this.settings.disableNotice;
		const playSound = !this.settings.disableSound;
		// Nothing to do — avoid an empty Notice / silent no-op.
		if (!showPopup && !playSound) return;

		if (showPopup) {
			const duration = topicSettings.noticeDuration;
			const icon = PRIORITY_ICONS[msg.priority ?? 3] ?? "🔔";
			const titleLine = msg.title ? `**${msg.title}**\n` : "";
			const body = msg.message ?? "";
			const tagsLine = msg.tags?.length ? `\n🏷 ${msg.tags.join(", ")}` : "";

			const text = `ntfy: ${msg.topic} ${icon}\n${titleLine}${body}${tagsLine}`;

			// duration 0 = stays until clicked (Obsidian Notice uses 0 for that too)
			const notice = new Notice(text, duration);

			if (topicSettings.color) {
				notice.containerEl.style.backgroundColor = `color-mix(in srgb, ${topicSettings.color} 90%, white)`;
			}
			// Inject topic color into the notice element
			this._styleNotice(notice, topicSettings.color);
		}

		if (playSound) {
			playNotificationSound(topicSettings.sound);
		}
	}

	private _styleNotice(notice: Notice, color: string) {
		// Obsidian Notice exposes .noticeEl
		try {
			const el = (notice as unknown as { noticeEl: HTMLElement }).noticeEl;
			if (el) {
				el.style.setProperty("--ntfy-topic-color", color);
				el.addClass("ntfy-notice");
				// Left border accent
				el.style.borderLeft = `4px solid ${color}`;
			}
		} catch {
			// If internal API changes, silently skip styling
		}
	}

	private getTopicSettings(topicName: string): TopicSettings | undefined {
		return this.settings.topics.find((t) => t.name === topicName);
	}
}
