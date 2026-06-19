import { App, Modal, Notice, Setting, TFile } from "obsidian";
import type NtfyPlugin from "../main";
import { VaultFileSuggestModal } from "./AttachmentPickerModal";
import { Priority } from "src/types";

const PRIORITY_OPTIONS: Record<string, string> = {
	"1": "Min",
	"2": "Low",
	"3": "Default",
	"4": "High",
	"5": "Max / Urgent",
};

interface ComposeState {
	title: string;
	message: string;
	markdown: boolean;
	tags: string;
	priority: "1" | "2" | "3" | "4" | "5";
	clickUrl: string;
	attachUrl: string;
	attachFilename: string;
	vaultFile: TFile | null;
}

export class ComposeModal extends Modal {
	private plugin: NtfyPlugin;
	private topic: string;
	private state: ComposeState = {
		title: "",
		message: "",
		markdown: false,
		tags: "",
		priority: "3",
		clickUrl: "",
		attachUrl: "",
		attachFilename: "",
		vaultFile: null,
	};

	constructor(app: App, plugin: NtfyPlugin, topic: string) {
		super(app);
		this.plugin = plugin;
		this.topic = topic;
	}

	onOpen() {
		this.modalEl.addClass("ntfy-compose-modal");
		this.titleEl.setText(`Send to ${this.topic}`);
		this.render();
	}

	private render() {
		const { contentEl } = this;
		contentEl.empty();

		// ── Titel ──────────────────────────────────────────────────────────
		new Setting(contentEl).setName("Title").addText((t) =>
			t
				.setPlaceholder("Notification title, e.g. Disk space warning")
				.setValue(this.state.title)
				.onChange((v) => (this.state.title = v)),
		);

		// ── Nachricht ──────────────────────────────────────────────────────
		new Setting(contentEl).setName("Message").addTextArea((t) => {
			t.setPlaceholder("Enter message here")
				.setValue(this.state.message)
				.onChange((v) => (this.state.message = v));
			t.inputEl.rows = 5;
			t.inputEl.style.width = "100%";
			t.inputEl.style.resize = "vertical";
		});

		// ── Markdown ───────────────────────────────────────────────────────
		new Setting(contentEl)
			.setName("Format as Markdown")
			.setDesc("Sets the Markdown: yes header — clients that support it will render formatting.")
			.addToggle((tog) => tog.setValue(this.state.markdown).onChange((v) => (this.state.markdown = v)));

		// ── Tags ───────────────────────────────────────────────────────────
		new Setting(contentEl).setName("Tags").addText((t) =>
			t
				.setPlaceholder("Comma-separated, e.g. warning,backup")
				.setValue(this.state.tags)
				.onChange((v) => (this.state.tags = v)),
		);

		// ── Priorität ──────────────────────────────────────────────────────
		new Setting(contentEl).setName("Priority").addDropdown((dd) => {
			for (const [val, label] of Object.entries(PRIORITY_OPTIONS)) {
				dd.addOption(val, label);
			}
			dd.setValue(this.state.priority).onChange(
				(v) => (this.state.priority = v as ComposeState["priority"]),
			);
		});

		// ── Klick-URL ──────────────────────────────────────────────────────
		new Setting(contentEl)
			.setName("Click URL")
			.setDesc("URL opened when the notification is clicked.")
			.addText((t) =>
				t
					.setPlaceholder("https://…")
					.setValue(this.state.clickUrl)
					.onChange((v) => (this.state.clickUrl = v)),
			);

		// ── Anhang: URL ────────────────────────────────────────────────────
		new Setting(contentEl).setName("Attach file from URL").addText((t) =>
			t
				.setPlaceholder("https://example.com/file.pdf")
				.setValue(this.state.attachUrl)
				.onChange((v) => (this.state.attachUrl = v)),
		);

		new Setting(contentEl)
			.setName("Attachment filename")
			.setDesc("Optional custom filename for the upload or URL attachment.")
			.addText((t) =>
				t
					.setPlaceholder("file.pdf")
					.setValue(this.state.attachFilename)
					.onChange((v) => (this.state.attachFilename = v)),
			);

		// ── Anhang: Vault-Datei ────────────────────────────────────────────
		const vaultFileSetting = new Setting(contentEl)
			.setName("Attach vault file")
			.setDesc(this.state.vaultFile ? `📎 ${this.state.vaultFile.path}` : "No file selected.");

		vaultFileSetting.addButton((b) =>
			b.setButtonText(this.state.vaultFile ? "Change file" : "Choose file").onClick(() => {
				new VaultFileSuggestModal(this.app, (file) => {
					this.state.vaultFile = file;
					this.render();
				}).open();
			}),
		);

		if (this.state.vaultFile) {
			vaultFileSetting.addButton((b) =>
				b
					.setButtonText("Remove")
					.setWarning()
					.onClick(() => {
						this.state.vaultFile = null;
						this.render();
					}),
			);
		}

		// ── Send / Cancel ──────────────────────────────────────────────────
		new Setting(contentEl)
			.addButton((b) =>
				b
					.setButtonText("Send")
					.setCta()
					.onClick(() => void this.send()),
			)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
	}

	private async send() {
		const { state, topic } = this;

		if (!state.message.trim() && !state.vaultFile && !state.attachUrl && !state.clickUrl) {
			new Notice("ntfy: message or attachment required.");
			return;
		}

		try {
			const tags = state.tags
				? state.tags
						.split(",")
						.map((t) => t.trim())
						.filter(Boolean)
				: undefined;
			const priority = parseInt(state.priority) as Priority;

			if (state.vaultFile) {
				// Binary file upload via PUT
				const data = await this.app.vault.readBinary(state.vaultFile);
				await this.plugin.client.publishWithFileAttachment({
					topic,
					message: state.message,
					title: state.title || undefined,
					priority,
					tags,
					fileData: data,
					filename: state.vaultFile.name,
					mimeType: this.guessMime(state.vaultFile.extension),
					markdown: state.markdown,
					clickUrl: state.clickUrl || undefined,
					attachFilename: state.attachFilename || undefined,
				});
			} else {
				await this.plugin.client.publish({
					topic,
					message: state.message,
					title: state.title || undefined,
					priority,
					tags,
					markdown: state.markdown,
					clickUrl: state.clickUrl || undefined,
					attachUrl: state.attachUrl || undefined,
					attachFilename: state.attachFilename || undefined,
				});
			}

			this.close();
		} catch (e) {
			new Notice(`ntfy send failed: ${(e as Error).message}`);
		}
	}

	onClose() {
		this.contentEl.empty();
	}

	private guessMime(ext: string): string {
		return (
			(
				{
					png: "image/png",
					jpg: "image/jpeg",
					jpeg: "image/jpeg",
					gif: "image/gif",
					webp: "image/webp",
					pdf: "application/pdf",
					// md: "text/markdown",
					// txt: "text/plain",
					json: "application/json",
					zip: "application/zip",
				} as Record<string, string>
			)[ext.toLowerCase()] ?? "application/octet-stream"
		);
	}
}
