import { App, Modal, Setting, TFile, FuzzyMatch, FuzzySuggestModal } from "obsidian";

/** Fuzzy file picker for vault files. */
export class VaultFileSuggestModal extends FuzzySuggestModal<TFile> {
	private onChoose: (file: TFile) => void;

	constructor(app: App, onChoose: (file: TFile) => void) {
		super(app);
		this.onChoose = onChoose;
		this.setPlaceholder("Search vault files…");
	}

	getItems(): TFile[] {
		return this.app.vault.getFiles();
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onChooseItem(file: TFile, _evt: MouseEvent | KeyboardEvent): void {
		this.onChoose(file);
	}
}

/** Shows a list of selected files with remove buttons, plus an add button. */
export class AttachmentPickerModal extends Modal {
	private selectedFiles: TFile[] = [];
	private onConfirm: (files: TFile[]) => void;

	constructor(app: App, onConfirm: (files: TFile[]) => void) {
		super(app);
		this.onConfirm = onConfirm;
	}

	onOpen() {
		this.render();
	}

	private render() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: "Attach vault files" });

		if (this.selectedFiles.length === 0) {
			contentEl.createEl("p", {
				text: "No files selected.",
				cls: "ntfy-no-files",
			});
		} else {
			for (const file of this.selectedFiles) {
				new Setting(contentEl)
					.setName(file.name)
					.setDesc(file.path)
					.addButton((b) =>
						b
							.setIcon("x")
							.setTooltip("Remove")
							.onClick(() => {
								this.selectedFiles = this.selectedFiles.filter((f) => f.path !== file.path);
								this.render();
							}),
					);
			}
		}

		new Setting(contentEl)
			.addButton((b) =>
				b.setButtonText("+ Add file").onClick(() => {
					new VaultFileSuggestModal(this.app, (file) => {
						if (!this.selectedFiles.some((f) => f.path === file.path)) {
							this.selectedFiles.push(file);
						}
						this.render();
					}).open();
				}),
			)
			.addButton((b) =>
				b
					.setButtonText("Attach")
					.setCta()
					.onClick(() => {
						this.onConfirm([...this.selectedFiles]);
						this.close();
					}),
			)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
	}

	onClose() {
		this.contentEl.empty();
	}
}
