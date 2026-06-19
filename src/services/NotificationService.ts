import { Notice } from "obsidian";
import { NtfyMessage, NtfyPluginSettings, TopicSettings } from "../types";

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
		if (!topicSettings || topicSettings.mute) return;

		const duration = topicSettings.noticeDuration;
		const icon = PRIORITY_ICONS[msg.priority ?? 3] ?? "🔔";
		const titleLine = msg.title ? `**${msg.title}**\n` : "";
		const body = msg.message ?? "";
		const tagsLine = msg.tags?.length ? `\n🏷 ${msg.tags.join(", ")}` : "";

		const text = `${icon} [${msg.topic}]\n${titleLine}${body}${tagsLine}`;

		// duration 0 = stays until clicked (Obsidian Notice uses 0 for that too)
		const notice = new Notice(text, duration);

		// Inject topic color into the notice element
		this._styleNotice(notice, topicSettings.color);

		this._playSound(topicSettings.sound);
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

	private _playSound(sound: string) {
		if (sound === "none" || sound === "default") return;

		// Map sound names to web audio tones
		const FREQUENCIES: Record<string, number[]> = {
			chime: [523, 659, 784], // C5, E5, G5
			ping: [880],
			pop: [440, 220],
			beep: [660, 660],
		};

		const freqs = FREQUENCIES[sound];
		if (!freqs) return;

		try {
			const ctx = new AudioContext();
			let time = ctx.currentTime;
			for (const freq of freqs) {
				const osc = ctx.createOscillator();
				const gain = ctx.createGain();
				osc.connect(gain);
				gain.connect(ctx.destination);
				osc.frequency.value = freq;
				osc.type = "sine";
				gain.gain.setValueAtTime(0.3, time);
				gain.gain.exponentialRampToValueAtTime(0.001, time + 0.2);
				osc.start(time);
				osc.stop(time + 0.2);
				time += 0.15;
			}
			// Close context after sounds finish
			setTimeout(() => ctx.close(), (time - ctx.currentTime + 0.5) * 1000);
		} catch {
			// AudioContext not available – skip
		}
	}

	private getTopicSettings(topicName: string): TopicSettings | undefined {
		return this.settings.topics.find((t) => t.name === topicName);
	}
}
