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

/**
 * How strongly the topic color tints the Notice background, by priority —
 * blended OVER the standard Notice background color. Low priority stays close
 * to the default; high/urgent priority is almost the full topic color.
 */
const PRIORITY_COLOR_INTENSITY: Record<number, number> = {
	1: 0, // min — plain Notice background, no tint
	2: 25,
	3: 50, // default
	4: 75,
	5: 100, // max/urgent — near-full topic color
};

export class NotificationService {
	private settings: NtfyPluginSettings;
	/**
	 * Active Notice pop-ups, keyed by sequence id (sequence_id ?? message id).
	 * Populated only by live `show()` (never by polling). Lets clear/delete/
	 * update dismiss the matching pop-up. For a Notice, clear/delete/update all
	 * amount to the same thing — hide it.
	 */
	private notices: Map<string, { notice: Notice; topic: string }> = new Map();

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

			const key = this._seqKey(msg);
			// Update/revive: dismiss any pop-up still open for this sequence.
			this._dismiss(key);

			// duration 0 = stays until clicked (Obsidian Notice uses 0 for that too)
			const notice = new Notice(text, duration);

			if (topicSettings.color) {
				const intensity = PRIORITY_COLOR_INTENSITY[msg.priority ?? 3] ?? 35;
				const newColor = `color-mix(in srgb, var(--background-modifier-message) 100%, ${topicSettings.color} ${intensity}%)`;
				notice.containerEl.style.backgroundColor = newColor;
			}
			// Inject topic color into the notice element
			this._styleNotice(notice, topicSettings.color);

			this.notices.set(key, { notice, topic: msg.topic });
			this._scheduleCleanup(key, notice, duration);
		}

		if (playSound) {
			playNotificationSound(topicSettings.sound);
		}
	}

	/** Dismiss the active pop-up for a sequence key (clear/delete/update). */
	dismissNotice(key: string | undefined) {
		if (key) this._dismiss(key);
	}

	/** Dismiss all active pop-ups for a topic (clear-all, no sequence_id). */
	dismissAllForTopic(topic: string) {
		for (const [key, entry] of this.notices) {
			if (entry.topic === topic) {
				entry.notice.hide();
				this.notices.delete(key);
			}
		}
	}

	private _dismiss(key: string) {
		const entry = this.notices.get(key);
		if (entry) {
			entry.notice.hide();
			this.notices.delete(key);
		}
	}

	/** Remove a pop-up from the map once it hides on its own, so the map
	 *  doesn't grow unbounded over a long session. */
	private _scheduleCleanup(key: string, notice: Notice, duration: number) {
		if (duration > 0) {
			window.setTimeout(() => {
				if (this.notices.get(key)?.notice === notice) this.notices.delete(key);
			}, duration + 1000);
		} else {
			// duration 0 = until clicked: clean up when the user dismisses it.
			try {
				const el = (notice as unknown as { noticeEl?: HTMLElement }).noticeEl;
				el?.addEventListener("click", () => {
					if (this.notices.get(key)?.notice === notice) this.notices.delete(key);
				});
			} catch {
				/* internal API changed — skip cleanup */
			}
		}
	}

	private _seqKey(msg: NtfyMessage): string {
		return msg.sequence_id ?? msg.id;
	}

	private _styleNotice(notice: Notice, color: string) {
		// Obsidian Notice exposes .noticeEl
		try {
			const el = (notice as unknown as { noticeEl: HTMLElement }).noticeEl;
			if (el) {
				el.style.setProperty("--ntfy-topic-color", color);
				el.addClass("ntfy-notice");
				// Left border accent
				// el.style.borderLeft = `4px solid ${color}`;
			}
		} catch {
			// If internal API changes, silently skip styling
		}
	}

	private getTopicSettings(topicName: string): TopicSettings | undefined {
		return this.settings.topics.find((t) => t.name === topicName);
	}
}
