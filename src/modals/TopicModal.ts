import { App, Modal, Setting } from "obsidian";
import { DEFAULT_TOPIC_SETTINGS, NotificationSound, TopicSettings } from "../types";

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

		// Notice duration
		new Setting(contentEl)
			.setName("Notice duration (ms)")
			.setDesc("How long the notification stays visible. 0 = until clicked.")
			.addText((t) => {
				t.setValue(String(this.topic.noticeDuration))
					.setPlaceholder("5000")
					.onChange((v) => {
						const n = parseInt(v, 10);
						if (!isNaN(n) && n >= 0) this.topic.noticeDuration = n;
					});
				t.inputEl.type = "number";
				t.inputEl.min = "0";
			});

		// Mute toggle
		new Setting(contentEl)
			.setName("Mute")
			.setDesc("No Notice() pop-ups for this topic.")
			.addToggle((tog) => {
				tog.setValue(this.topic.mute).onChange((v) => (this.topic.mute = v));
			});

		// Sound
		new Setting(contentEl).setName("Notification sound").addDropdown((dd) => {
			for (const [val, label] of Object.entries(SOUND_OPTIONS)) {
				dd.addOption(val, label);
			}
			dd.setValue(this.topic.sound).onChange((v) => (this.topic.sound = v as NotificationSound));
		});

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
