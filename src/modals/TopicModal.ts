import { App, Modal, Setting } from "obsidian";
import { DEFAULT_TOPIC_SETTINGS, NotificationSound, TopicSettings } from "../types";
import { playNotificationSound } from "../services/sound";

const SOUND_OPTIONS: Record<NotificationSound, string> = {
	default: "Default (system)",
	none: "Silent",
	chime: "Chime",
	ping: "Ping",
	pop: "Pop",
	beep: "Beep",
};

export class TopicModal extends Modal {
	private topic: TopicSettings;
	private onSave: (topic: TopicSettings) => void;
	private isNew: boolean;

	constructor(app: App, existing: TopicSettings | null, onSave: (topic: TopicSettings) => void) {
		super(app);
		this.isNew = existing === null;
		this.topic = existing ? { ...existing } : { name: "", ...DEFAULT_TOPIC_SETTINGS };
		this.onSave = onSave;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", {
			text: this.isNew ? "Add topic" : `Edit topic: ${this.topic.name}`,
		});

		// Topic name (only editable when new)
		new Setting(contentEl)
			.setName("Topic name")
			.setDesc("Must match the ntfy topic name exactly.")
			.addText((t) => {
				t.setValue(this.topic.name)
					.setPlaceholder("my-topic")
					.setDisabled(!this.isNew)
					.onChange((v) => (this.topic.name = v.trim()));
			});

		// Color
		new Setting(contentEl)
			.setName("Accent color")
			.setDesc("Used for the notification badge border.")
			.addColorPicker((c) => {
				c.setValue(this.topic.color).onChange((v) => (this.topic.color = v));
			});

		// Notice duration (slider shows seconds; stored as ms for the Notice API)
		new Setting(contentEl)
			.setName("Notice duration")
			.setDesc("How long the notification stays visible in seconds. 0 = until clicked.")
			.addSlider((sl) => {
				sl.setLimits(0, 30, 1)
					.setValue(Math.round(this.topic.noticeDuration / 1000))
					// .setDynamicTooltip()
					.onChange((v) => (this.topic.noticeDuration = v * 1000));
			});

		// Mute toggle
		new Setting(contentEl)
			.setName("Disable notifications")
			.setDesc("No Notification pop-up or sound. Messages will still appear in sidebar.")
			.addToggle((tog) => {
				tog.setValue(this.topic.mute).onChange((v) => (this.topic.mute = v));
			});

		// Sound
		new Setting(contentEl)
			.setName("Notification sound")
			.setDesc("Pick a sound — it plays immediately so you can hear a preview.")
			.addDropdown((dd) => {
				for (const [val, label] of Object.entries(SOUND_OPTIONS)) {
					dd.addOption(val, label);
				}
				dd.setValue(this.topic.sound).onChange((v) => {
					this.topic.sound = v as NotificationSound;
					playNotificationSound(this.topic.sound);
				});
			})
			.addExtraButton((b) =>
				b
					.setIcon("play")
					.setTooltip("Play the selected sound")
					.onClick(() => playNotificationSound(this.topic.sound)),
			);

		// Enabled toggle
		new Setting(contentEl)
			.setName("Enabled")
			.setDesc("Subscribe to this topic on plugin load.")
			.addToggle((tog) => {
				tog.setValue(this.topic.enabled).onChange((v) => (this.topic.enabled = v));
			});

		// Save / Cancel
		new Setting(contentEl)
			.addButton((b) =>
				b
					.setButtonText("Save")
					.setCta()
					.onClick(() => {
						if (!this.topic.name) return;
						this.onSave({ ...this.topic });
						this.close();
					}),
			)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
	}

	onClose() {
		this.contentEl.empty();
	}
}
