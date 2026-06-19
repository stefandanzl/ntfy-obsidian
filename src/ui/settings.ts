import { App, PluginSettingTab, Setting } from 'obsidian';
import MyPlugin from '../main';

export interface MySettings {
	enabled: boolean;
	apiKey: string;
}

export const DEFAULT_SETTINGS: MySettings = {
	enabled: true,
	apiKey: '',
};

export class MyPluginSettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl('h2', { text: 'Settings for My Plugin' });

		new Setting(containerEl)
			.setName('Enable plugin')
			.setDesc('Enable or disable the plugin functionality')
			.addToggle(toggle =>
				toggle.setValue(this.plugin.settings.enabled).onChange(async value => {
					this.plugin.settings.enabled = value;
					await this.plugin.saveData(this.plugin.settings);
				})
			);

		new Setting(containerEl)
			.setName('API Key')
			.setDesc('Enter your API key')
			.addText(text =>
				text
					.setPlaceholder('Enter your API key')
					.setValue(this.plugin.settings.apiKey)
					.onChange(async value => {
						this.plugin.settings.apiKey = value;
						await this.plugin.saveData(this.plugin.settings);
					})
			);
	}
}
