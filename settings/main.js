import * as fs from 'fs-extra';
import * as path from 'path';
import { app, ipcMain } from 'electron';
import { YAMLStorage } from 'storage/main/yaml';
const WORK_DIR = path.join(app.getPath('userData'));
const SETTINGS_PATH = path.join(WORK_DIR, 'itu-ob-settings.yaml');
export class Setting {
    constructor(id, label, paneId) {
        this.id = id;
        this.label = label;
        this.paneId = paneId;
    }
    toUseable(val) { return val; }
    ;
    toStoreable(val) { return val; }
    ;
}
class SettingManager {
    constructor(yaml) {
        this.yaml = yaml;
        this.registry = [];
        this.panes = [];
        this.data = null;
    }
    async getValue(id) {
        const setting = this.get(id);
        if (setting) {
            if (this.data === null) {
                let settingsFileExists;
                try {
                    settingsFileExists = (await fs.stat(SETTINGS_PATH)).isFile();
                }
                catch (e) {
                    settingsFileExists = false;
                }
                if (settingsFileExists) {
                    this.data = (await this.yaml.load(SETTINGS_PATH)) || {};
                }
                else {
                    this.data = {};
                }
            }
            const rawVal = this.data[id];
            return rawVal !== undefined ? setting.toUseable(rawVal) : undefined;
        }
        else {
            throw new Error(`Setting to get value for is not found: ${id}`);
        }
    }
    async setValue(id, val) {
        const setting = this.get(id);
        if (setting) {
            const storeable = setting.toStoreable(val);
            this.data[id] = storeable;
            await this.commit();
        }
        else {
            throw new Error(`Setting to set value for is not found: ${id}`);
        }
    }
    async deleteValue(id) {
        delete this.data[id];
        await this.commit();
    }
    async commit() {
        await fs.remove(SETTINGS_PATH);
        await this.yaml.store(SETTINGS_PATH, this.data);
    }
    get(id) {
        return this.registry.find(s => s.id === id);
    }
    register(setting) {
        if (this.panes.find(p => p.id === setting.paneId)) {
            this.registry.push(setting);
        }
        else {
            throw new Error("Invalid pane ID");
        }
    }
    configurePane(pane) {
        this.panes.push(pane);
    }
    setUpAPIEndpoints() {
        ipcMain.on('set-setting', (evt, name, value) => {
            return this.setValue(name, value);
        });
        ipcMain.on('get-setting', (evt, name) => {
            const value = this.getValue(name);
            evt.reply(value);
        });
        ipcMain.on('clear-setting', async (evt, name) => {
            await this.deleteValue(name);
            evt.reply('ok');
        });
    }
}
export const manager = new SettingManager(new YAMLStorage(fs));
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFpbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9zZXR0aW5ncy9tYWluLnRzeCJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxPQUFPLEtBQUssRUFBRSxNQUFNLFVBQVUsQ0FBQztBQUMvQixPQUFPLEtBQUssSUFBSSxNQUFNLE1BQU0sQ0FBQztBQUU3QixPQUFPLEVBQUUsR0FBRyxFQUFFLE9BQU8sRUFBRSxNQUFNLFVBQVUsQ0FBQztBQUV4QyxPQUFPLEVBQUUsV0FBVyxFQUFFLE1BQU0sbUJBQW1CLENBQUM7QUFHaEQsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsT0FBTyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUM7QUFDcEQsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxRQUFRLEVBQUUsc0JBQXNCLENBQUMsQ0FBQztBQVVsRSxNQUFNLE9BQU8sT0FBTztJQUNsQixZQUNTLEVBQVUsRUFDVixLQUFhLEVBQ2IsTUFBYztRQUZkLE9BQUUsR0FBRixFQUFFLENBQVE7UUFDVixVQUFLLEdBQUwsS0FBSyxDQUFRO1FBQ2IsV0FBTSxHQUFOLE1BQU0sQ0FBUTtJQUFHLENBQUM7SUFDM0IsU0FBUyxDQUFDLEdBQVksSUFBTyxPQUFPLEdBQVEsQ0FBQSxDQUFDLENBQUM7SUFBQSxDQUFDO0lBQy9DLFdBQVcsQ0FBQyxHQUFNLElBQVMsT0FBTyxHQUFVLENBQUEsQ0FBQyxDQUFDO0lBQUEsQ0FBQztDQUNoRDtBQUdELE1BQU0sY0FBYztJQUtsQixZQUFvQixJQUFpQjtRQUFqQixTQUFJLEdBQUosSUFBSSxDQUFhO1FBSjdCLGFBQVEsR0FBbUIsRUFBRSxDQUFDO1FBQzlCLFVBQUssR0FBVyxFQUFFLENBQUM7UUFDbkIsU0FBSSxHQUFlLElBQUksQ0FBQztJQUVRLENBQUM7SUFFbEMsS0FBSyxDQUFDLFFBQVEsQ0FBQyxFQUFVO1FBQzlCLE1BQU0sT0FBTyxHQUFHLElBQUks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RSxDQUFDLEdBQVEsRUFBRSxJQUFZLEVBQUUsS0FBVSxFQUFFLEVBQUU7WUFDL0QsT0FBTyxJQUFJLENBQUMsUUFBUSxDQUFDLElBQUksRUFBRSxLQUFLLENBQUMsQ0FBQztRQUNwQyxDQUFDLENBQUMsQ0FBQztRQUVILE9BQU8sQ0FBQyxFQUFFLENBQUMsYUFBYSxFQUFFLENBQUMsR0FBUSxFQUFFLElBQVksRUFBRSxFQUFFO1lBQ25ELE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLENBQUM7WUFDbEMsR0FBRyxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsQ0FBQztRQUNuQixDQUFDLENBQUMsQ0FBQztRQUVILE9BQU8sQ0FBQyxFQUFFLENBQUMsZUFBZSxFQUFFLEtBQUssRUFBRSxHQUFRLEVBQUUsSUFBWSxFQUFFLEVBQUU7WUFDM0QsTUFBTSxJQUFJLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQyxDQUFDO1lBQzdCLEdBQUcsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDbEIsQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUFHRCxNQUFNLENBQUMsTUFBTSxPQUFPLEdBQUcsSUFBSSxjQUFjLENBQUMsSUFBSSxXQUFXLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGZzIGZyb20gJ2ZzLWV4dHJhJztcbmltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XG5cbmltcG9ydCB7IGFwcCwgaXBjTWFpbiB9IGZyb20gJ2VsZWN0cm9uJztcblxuaW1wb3J0IHsgWUFNTFN0b3JhZ2UgfSBmcm9tICdzdG9yYWdlL21haW4veWFtbCc7XG5cblxuY29uc3QgV09SS19ESVIgPSBwYXRoLmpvaW4oYXBwLmdldFBhdGgoJ3VzZXJEYXRhJykpO1xuY29uc3QgU0VUVElOR1NfUEFUSCA9IHBhdGguam9pbihXT1JLX0RJUiwgJ2l0dS1vYi1zZXR0aW5ncy55YW1sJyk7XG5cblxuZXhwb3J0IGludGVyZmFjZSBQYW5lIHtcbiAgaWQ6IHN0cmluZztcbiAgbGFiZWw6IHN0cmluZztcbiAgaWNvbj86IHN0cmluZztcbn1cblxuXG5leHBvcnQgY2xhc3MgU2V0dGluZzxUPiB7XG4gIGNvbnN0cnVjdG9yKFxuICAgIHB1YmxpYyBpZDogc3RyaW5nLFxuICAgIHB1YmxpYyBsYWJlbDogc3RyaW5nLFxuICAgIHB1YmxpYyBwYW5lSWQ6IHN0cmluZykge31cbiAgdG9Vc2VhYmxlKHZhbDogdW5rbm93bik6IFQgeyByZXR1cm4gdmFsIGFzIFQgfTtcbiAgdG9TdG9yZWFibGUodmFsOiBUKTogYW55IHsgcmV0dXJuIHZhbCBhcyBhbnkgfTtcbn1cblxuXG5jbGFzcyBTZXR0aW5nTWFuYWdlciB7XG4gIHByaXZhdGUgcmVnaXN0cnk6IFNldHRpbmc8YW55PltdID0gW107XG4gIHByaXZhdGUgcGFuZXM6IFBhbmVbXSA9IFtdO1xuICBwcml2YXRlIGRhdGE6IGFueSB8IG51bGwgPSBudWxsO1xuXG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgeWFtbDogWUFNTFN0b3JhZ2UpIHt9XG5cbiAgcHVibGljIGFzeW5jIGdldFZhbHVlKGlkOiBzdHJpbmcpOiBQcm9taXNlPHVua25vd24+IHtcbiAgICBjb25zdCBzZXR0aW5nID0gdGhpcy5nZXQoaWQpO1xuXG4gICAgaWYgKHNldHRpbmcpIHtcbiAgICAgIGlmICh0aGlzLmRhdGEgPT09IG51bGwpIHtcbiAgICAgICAgbGV0IHNldHRpbmdzRmlsZUV4aXN0czogYm9vbGVhbjtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBzZXR0aW5nc0ZpbGVFeGlzdHMgPSAoYXdhaXQgZnMuc3RhdChTRVRUSU5HU19QQVRIKSkuaXNGaWxlKCk7XG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICBzZXR0aW5nc0ZpbGVFeGlzdHMgPSBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoc2V0dGluZ3NGaWxlRXhpc3RzKSB7XG4gICAgICAgICAgdGhpcy5kYXRhID0gKGF3YWl0IHRoaXMueWFtbC5sb2FkKFNFVFRJTkdTX1BBVEgpKSB8fCB7fTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aGlzLmRhdGEgPSB7fTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgY29uc3QgcmF3VmFsID0gdGhpcy5kYXRhW2lkXTtcbiAgICAgIHJldHVybiByYXdWYWwgIT09IHVuZGVmaW5lZCA/IHNldHRpbmcudG9Vc2VhYmxlKHJhd1ZhbCkgOiB1bmRlZmluZWQ7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgU2V0dGluZyB0byBnZXQgdmFsdWUgZm9yIGlzIG5vdCBmb3VuZDogJHtpZH1gKTtcbiAgICB9XG4gIH1cblxuICBwdWJsaWMgYXN5bmMgc2V0VmFsdWUoaWQ6IHN0cmluZywgdmFsOiB1bmtub3duKSB7XG4gICAgY29uc3Qgc2V0dGluZyA9IHRoaXMuZ2V0KGlkKTtcbiAgICBpZiAoc2V0dGluZykge1xuICAgICAgY29uc3Qgc3RvcmVhYmxlID0gc2V0dGluZy50b1N0b3JlYWJsZSh2YWwpO1xuICAgICAgdGhpcy5kYXRhW2lkXSA9IHN0b3JlYWJsZTtcbiAgICAgIGF3YWl0IHRoaXMuY29tbWl0KCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgU2V0dGluZyB0byBzZXQgdmFsdWUgZm9yIGlzIG5vdCBmb3VuZDogJHtpZH1gKTtcbiAgICB9XG4gIH1cblxuICBwdWJsaWMgYXN5bmMgZGVsZXRlVmFsdWUoaWQ6IHN0cmluZykge1xuICAgIGRlbGV0ZSB0aGlzLmRhdGFbaWRdO1xuICAgIGF3YWl0IHRoaXMuY29tbWl0KCk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGNvbW1pdCgpIHtcbiAgICBhd2FpdCBmcy5yZW1vdmUoU0VUVElOR1NfUEFUSCk7XG4gICAgYXdhaXQgdGhpcy55YW1sLnN0b3JlKFNFVFRJTkdTX1BBVEgsIHRoaXMuZGF0YSk7XG4gIH1cblxuICBwcml2YXRlIGdldChpZDogc3RyaW5nKTogU2V0dGluZzxhbnk+IHwgdW5kZWZpbmVkIHtcbiAgICByZXR1cm4gdGhpcy5yZWdpc3RyeS5maW5kKHMgPT4gcy5pZCA9PT0gaWQpO1xuICB9XG5cbiAgcHVibGljIHJlZ2lzdGVyKHNldHRpbmc6IFNldHRpbmc8YW55Pikge1xuICAgIGlmICh0aGlzLnBhbmVzLmZpbmQocCA9PiBwLmlkID09PSBzZXR0aW5nLnBhbmVJZCkpIHtcbiAgICAgIHRoaXMucmVnaXN0cnkucHVzaChzZXR0aW5nKTtcblxuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJJbnZhbGlkIHBhbmUgSURcIik7XG4gICAgfVxuICB9XG5cbiAgcHVibGljIGNvbmZpZ3VyZVBhbmUocGFuZTogUGFuZSkge1xuICAgIHRoaXMucGFuZXMucHVzaChwYW5lKTtcbiAgfVxuXG4gIHB1YmxpYyBzZXRVcEFQSUVuZHBvaW50cygpIHtcbiAgICBpcGNNYWluLm9uKCdzZXQtc2V0dGluZycsIChldnQ6IGFueSwgbmFtZTogc3RyaW5nLCB2YWx1ZTogYW55KSA9PiB7XG4gICAgICByZXR1cm4gdGhpcy5zZXRWYWx1ZShuYW1lLCB2YWx1ZSk7XG4gICAgfSk7XG5cbiAgICBpcGNNYWluLm9uKCdnZXQtc2V0dGluZycsIChldnQ6IGFueSwgbmFtZTogc3RyaW5nKSA9PiB7XG4gICAgICBjb25zdCB2YWx1ZSA9IHRoaXMuZ2V0VmFsdWUobmFtZSk7XG4gICAgICBldnQucmVwbHkodmFsdWUpO1xuICAgIH0pO1xuXG4gICAgaXBjTWFpbi5vbignY2xlYXItc2V0dGluZycsIGFzeW5jIChldnQ6IGFueSwgbmFtZTogc3RyaW5nKSA9PiB7XG4gICAgICBhd2FpdCB0aGlzLmRlbGV0ZVZhbHVlKG5hbWUpO1xuICAgICAgZXZ0LnJlcGx5KCdvaycpO1xuICAgIH0pO1xuICB9XG59XG5cblxuZXhwb3J0IGNvbnN0IG1hbmFnZXIgPSBuZXcgU2V0dGluZ01hbmFnZXIobmV3IFlBTUxTdG9yYWdlKGZzKSk7XG4iXX0=