import { Plugin } from 'obsidian';
import { MySettings, DEFAULT_SETTINGS, MyPluginSettingTab } from './ui/settings';
import { registerCommands } from './commands';

export default class MyPlugin extends Plugin {
	settings: MySettings;

	async onload() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

		// Add settings tab
		this.addSettingTab(new MyPluginSettingTab(this.app, this));

		// Register commands
		registerCommands(this);
	}
}
