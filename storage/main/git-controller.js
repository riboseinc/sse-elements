import * as path from 'path';
import * as fs from 'fs-extra';
import * as git from 'isomorphic-git';
import { ipcMain } from 'electron';
import { makeEndpoint } from '../../api/main';
import { Setting } from '../../settings/main';
import { openWindow } from '../../main/window';
export class GitController {
    constructor(fs, repoUrl, workDir, corsProxy) {
        this.fs = fs;
        this.repoUrl = repoUrl;
        this.workDir = workDir;
        this.corsProxy = corsProxy;
        this.auth = {};
        git.plugins.set('fs', fs);
    }
    async getAuthor() {
        const name = await git.config({ dir: this.workDir, path: 'user.name' });
        const email = await git.config({ dir: this.workDir, path: 'user.email' });
        return { name: name, email: email };
    }
    async setAuthor(author) {
        await git.config({ dir: this.workDir, path: 'user.name', value: author.name });
        await git.config({ dir: this.workDir, path: 'user.email', value: author.email });
    }
    async setAuth(auth) {
        try {
            // Try fetching with auth; will throw if auth is invalid
            git.fetch(Object.assign({ dir: this.workDir }, auth));
        }
        catch (e) {
            return false;
        }
        this.auth = auth;
        return true;
    }
    async isInitialized() {
        let gitInitialized;
        try {
            gitInitialized = (await this.fs.stat(path.join(this.workDir, '.git'))).isDirectory();
        }
        catch (e) {
            gitInitialized = false;
        }
        return gitInitialized;
    }
    async getOriginUrl() {
        return ((await git.listRemotes({
            dir: this.workDir,
        })).find(r => r.remote === 'origin') || { url: null }).url;
    }
    async getUpstreamUrl() {
        return ((await git.listRemotes({
            dir: this.workDir,
        })).find(r => r.remote === 'upstream') || { url: null }).url;
    }
    async addAllChanges() {
        await git.add({
            dir: this.workDir,
            filepath: '.',
        });
    }
    async listChangedFiles() {
        const FILE = 0, HEAD = 1, WORKDIR = 2;
        return (await git.statusMatrix({ dir: this.workDir }))
            .filter(row => row[HEAD] !== row[WORKDIR])
            .map(row => row[FILE]);
    }
    async pull() {
        await git.pull(Object.assign({ dir: this.workDir, ref: 'master', singleBranch: true, fastForwardOnly: true }, this.auth));
    }
    async commit(msg) {
        await git.commit({
            dir: this.workDir,
            message: msg,
            author: {},
        });
    }
    async push() {
        await git.push(Object.assign({ dir: this.workDir, remote: 'origin' }, this.auth));
    }
    async reset() {
        await this.fs.remove(this.workDir);
        await this.fs.ensureDir(this.workDir);
        await git.clone(Object.assign({ dir: this.workDir, url: this.repoUrl, ref: 'master', singleBranch: true, depth: 10, corsProxy: this.corsProxy }, this.auth));
    }
    setUpAPIEndpoints() {
        makeEndpoint('git-config', async () => {
            return {
                originURL: await this.getOriginUrl(),
                author: await this.getAuthor(),
            };
        });
        makeEndpoint('fetch-commit-push', async ({ commitMsg, authorName, authorEmail, gitUsername, gitPassword, }) => {
            await this.setAuthor({ name: authorName, email: authorEmail });
            try {
                await this.setAuth({ username: gitUsername, password: gitPassword });
            }
            catch (e) {
                return { errors: [`Error while authenticating: ${e.toString()}`] };
            }
            try {
                await this.pull();
            }
            catch (e) {
                return { errors: [`Error while fetching and merging changes: ${e.toString()}`] };
            }
            const changedFiles = await this.listChangedFiles();
            if (changedFiles.length < 1) {
                return { errors: ["No changes to submit!"] };
            }
            await this.addAllChanges();
            await this.commit(commitMsg);
            try {
                await this.push();
            }
            catch (e) {
                return { errors: [`Error while pushing changes: ${e.toString()}`] };
            }
            return { errors: [] };
        });
    }
}
export async function initRepo(workDir, repoUrl, corsProxyUrl, settings) {
    settings.configurePane({
        id: 'dataSync',
        label: "Data synchronization",
        icon: 'git-merge',
    });
    settings.register(new Setting('gitRepoUrl', "Git repository URL", 'dataSync'));
    const gitCtrl = new GitController(fs, repoUrl, workDir, corsProxyUrl);
    if ((await gitCtrl.isInitialized()) === true) {
        const remoteUrl = await gitCtrl.getOriginUrl();
        if (remoteUrl !== null && remoteUrl.trim() === repoUrl.trim()) {
            await gitCtrl.pull();
        }
        else {
            await gitCtrl.reset();
        }
    }
    else {
        await gitCtrl.reset();
    }
    return gitCtrl;
}
/* Promises to return a string containing configured repository URL.
   If repository URL is not configured (e.g., on first run, or after reset)
   opens a window with specified options.
   The window is expected to ask the user to specify the URL and send a `'set-setting'`
   event for `'gitRepoUrl'`. */
export async function setRepoUrl(configWindow, settings) {
    const repoUrl = await settings.getValue('gitRepoUrl');
    return new Promise(async (resolve, reject) => {
        if (!repoUrl) {
            await openWindow(configWindow);
            ipcMain.on('set-setting', handleSetting);
            function handleSetting(evt, name, value) {
                if (name === 'gitRepoUrl') {
                    ipcMain.removeListener('set-setting', handleSetting);
                    resolve(value);
                }
                evt.reply('ok');
            }
        }
        else {
            resolve(repoUrl);
        }
    });
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZ2l0LWNvbnRyb2xsZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvc3RvcmFnZS9tYWluL2dpdC1jb250cm9sbGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLE9BQU8sS0FBSyxJQUFJLE1BQU0sTUFBTSxDQUFDO0FBQzdCLE9BQU8sS0FBSyxFQUFFLE1BQU0sVUFBVSxDQUFDO0FBQy9CLE9BQU8sS0FBSyxHQUFHLE1BQU0sZ0JBQWdCLENBQUM7QUFFdEMsT0FBTyxFQUFFLE9BQU8sRUFBRSxNQUFNLFVBQVUsQ0FBQztBQUVuQyxPQUFPLEVBQUUsWUFBWSxFQUFFLE1BQU0sZ0JBQWdCLENBQUM7QUFDOUMsT0FBTyxFQUFFLE9BQU8sRUFBa0IsTUFBTSxxQkFBcUIsQ0FBQztBQUM5RCxPQUFPLEVBQXNCLFVBQVUsRUFBRSxNQUFNLG1CQUFtQixDQUFDO0FBS25FLE1BQU0sT0FBTyxhQUFhO0lBR3hCLFlBQ1ksRUFBTyxFQUNQLE9BQWUsRUFDZixPQUFlLEVBQ2YsU0FBaUI7UUFIakIsT0FBRSxHQUFGLEVBQUUsQ0FBSztRQUNQLFlBQU8sR0FBUCxPQUFPLENBQVE7UUFDZixZQUFPLEdBQVAsT0FBTyxDQUFRO1FBQ2YsY0FBUyxHQUFULFNBQVMsQ0FBUTtRQU5yQixTQUFJLEdBQXNCLEVBQUUsQ0FBQztRQVFuQyxHQUFHLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxJQUFJLEVBQUUsRUFBRSxDQUFDLENBQUM7SUFDNUIsQ0FBQztJQUVELEtBQUssQ0FBQyxTQUFTO1FBQ2IsTUFBTSxJQUFJLEdBQUcsTUFBTSxHQUFHLENBQUMsTUFBTSxDQUFDLEVBQUUsR0FBRyxFQUFFLElBQUksQ0FBQyxPQUFPLEVBQUUsSUFBSSxFQUFFLFdBQVcsRUFBRSxDQUFDLENBQUM7UUFDeEUsTUFBTSxLQUFLLEdBQUcsTUFBTSxHQUFHLENBQUMsTUFBTSxDQUFDLEVBQUUsR0FBRyxFQUFFLElBQUksQ0FBQyxPQUFPLEVBQUUsSUFB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Q0FBQyxLQUFLLEVBQUUsQ0FBQztTQUN2QjtLQUNGO1NBQU07UUFDTCxNQUFNLE9BQU8sQ0FBQyxLQUFLLEVBQUUsQ0FBQztLQUN2QjtJQUVELE9BQU8sT0FBTyxDQUFDO0FBQ2pCLENBQUM7QUFHRDs7OzsrQkFJK0I7QUFDL0IsTUFBTSxDQUFDLEtBQUssVUFBVSxVQUFVLENBQzVCLFlBQWdDLEVBQ2hDLFFBQXdCO0lBQzFCLE1BQU0sT0FBTyxHQUFXLE1BQU0sUUFBUSxDQUFDLFFBQVEsQ0FBQyxZQUFZLENBQVcsQ0FBQztJQUV4RSxPQUFPLElBQUksT0FBTyxDQUFTLEtBQUssRUFBRSxPQUFPLEVBQUUsTUFBTSxFQUFFLEVBQUU7UUFDbkQsSUFBSSxDQUFDLE9BQU8sRUFBRTtZQUNaLE1BQU0sVUFBVSxDQUFDLFlBQVksQ0FBQyxDQUFDO1lBQy9CLE9BQU8sQ0FBQyxFQUFFLENBQUMsYUFBYSxFQUFFLGFBQWEsQ0FBQyxDQUFDO1lBRXpDLFNBQVMsYUFBYSxDQUFDLEdBQVEsRUFBRSxJQUFZLEVBQUUsS0FBYTtnQkFDMUQsSUFBSSxJQUFJLEtBQUssWUFBWSxFQUFFO29CQUN6QixPQUFPLENBQUMsY0FBYyxDQUFDLGFBQWEsRUFBRSxhQUFhLENBQUMsQ0FBQztvQkFDckQsT0FBTyxDQUFDLEtBQUssQ0FBQyxDQUFDO2lCQUNoQjtnQkFDRCxHQUFHLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDO1lBQ2xCLENBQUM7U0FDRjthQUFNO1lBQ0wsT0FBTyxDQUFDLE9BQU8sQ0FBQyxDQUFDO1NBQ2xCO0lBQ0gsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCAqIGFzIGZzIGZyb20gJ2ZzLWV4dHJhJztcbmltcG9ydCAqIGFzIGdpdCBmcm9tICdpc29tb3JwaGljLWdpdCc7XG5cbmltcG9ydCB7IGlwY01haW4gfSBmcm9tICdlbGVjdHJvbic7XG5cbmltcG9ydCB7IG1ha2VFbmRwb2ludCB9IGZyb20gJy4uLy4uL2FwaS9tYWluJztcbmltcG9ydCB7IFNldHRpbmcsIFNldHRpbmdNYW5hZ2VyIH0gZnJvbSAnLi4vLi4vc2V0dGluZ3MvbWFpbic7XG5pbXBvcnQgeyBXaW5kb3dPcGVuZXJQYXJhbXMsIG9wZW5XaW5kb3cgfSBmcm9tICcuLi8uLi9tYWluL3dpbmRvdyc7XG5cbmltcG9ydCB7IEdpdEF1dGhvciwgR2l0QXV0aGVudGljYXRpb24gfSBmcm9tICcuLi9naXQnO1xuXG5cbmV4cG9ydCBjbGFzcyBHaXRDb250cm9sbGVyIHtcbiAgcHJpdmF0ZSBhdXRoOiBHaXRBdXRoZW50aWNhdGlvbiA9IHt9O1xuXG4gIGNvbnN0cnVjdG9yKFxuICAgICAgcHJpdmF0ZSBmczogYW55LFxuICAgICAgcHJpdmF0ZSByZXBvVXJsOiBzdHJpbmcsXG4gICAgICBwcml2YXRlIHdvcmtEaXI6IHN0cmluZyxcbiAgICAgIHByaXZhdGUgY29yc1Byb3h5OiBzdHJpbmcpIHtcblxuICAgIGdpdC5wbHVnaW5zLnNldCgnZnMnLCBmcyk7XG4gIH1cblxuICBhc3luYyBnZXRBdXRob3IoKTogUHJvbWlzZTxHaXRBdXRob3I+IHtcbiAgICBjb25zdCBuYW1lID0gYXdhaXQgZ2l0LmNvbmZpZyh7IGRpcjogdGhpcy53b3JrRGlyLCBwYXRoOiAndXNlci5uYW1lJyB9KTtcbiAgICBjb25zdCBlbWFpbCA9IGF3YWl0IGdpdC5jb25maWcoeyBkaXI6IHRoaXMud29ya0RpciwgcGF0aDogJ3VzZXIuZW1haWwnIH0pO1xuICAgIHJldHVybiB7IG5hbWU6IG5hbWUsIGVtYWlsOiBlbWFpbCB9O1xuICB9XG5cbiAgYXN5bmMgc2V0QXV0aG9yKGF1dGhvcjogR2l0QXV0aG9yKSB7XG4gICAgYXdhaXQgZ2l0LmNvbmZpZyh7IGRpcjogdGhpcy53b3JrRGlyLCBwYXRoOiAndXNlci5uYW1lJywgdmFsdWU6IGF1dGhvci5uYW1lIH0pO1xuICAgIGF3YWl0IGdpdC5jb25maWcoeyBkaXI6IHRoaXMud29ya0RpciwgcGF0aDogJ3VzZXIuZW1haWwnLCB2YWx1ZTogYXV0aG9yLmVtYWlsIH0pO1xuICB9XG5cbiAgYXN5bmMgc2V0QXV0aChhdXRoOiBHaXRBdXRoZW50aWNhdGlvbik6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIHRyeSB7XG4gICAgICAvLyBUcnkgZmV0Y2hpbmcgd2l0aCBhdXRoOyB3aWxsIHRocm93IGlmIGF1dGggaXMgaW52YWxpZFxuICAgICAgZ2l0LmZldGNoKHtkaXI6IHRoaXMud29ya0RpciwgLi4uYXV0aCB9KTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuXG4gICAgdGhpcy5hdXRoID0gYXV0aDtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuXG4gIGFzeW5jIGlzSW5pdGlhbGl6ZWQoKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgbGV0IGdpdEluaXRpYWxpemVkOiBib29sZWFuO1xuXG4gICAgdHJ5IHtcbiAgICAgIGdpdEluaXRpYWxpemVkID0gKGF3YWl0IHRoaXMuZnMuc3RhdChwYXRoLmpvaW4odGhpcy53b3JrRGlyLCAnLmdpdCcpKSkuaXNEaXJlY3RvcnkoKTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBnaXRJbml0aWFsaXplZCA9IGZhbHNlO1xuICAgIH1cblxuICAgIHJldHVybiBnaXRJbml0aWFsaXplZDtcbiAgfVxuXG4gIGFzeW5jIGdldE9yaWdpblVybCgpOiBQcm9taXNlPHN0cmluZyB8IG51bGw+IHtcbiAgICByZXR1cm4gKChhd2FpdCBnaXQubGlzdFJlbW90ZXMoe1xuICAgICAgZGlyOiB0aGlzLndvcmtEaXIsXG4gICAgfSkpLmZpbmQociA9PiByLnJlbW90ZSA9PT0gJ29yaWdpbicpIHx8IHsgdXJsOiBudWxsIH0pLnVybDtcbiAgfVxuXG4gIGFzeW5jIGdldFVwc3RyZWFtVXJsKCk6IFByb21pc2U8c3RyaW5nIHwgbnVsbD4ge1xuICAgIHJldHVybiAoKGF3YWl0IGdpdC5saXN0UmVtb3Rlcyh7XG4gICAgICBkaXI6IHRoaXMud29ya0RpcixcbiAgICB9KSkuZmluZChyID0+IHIucmVtb3RlID09PSAndXBzdHJlYW0nKSB8fCB7IHVybDogbnVsbCB9KS51cmw7XG4gIH1cblxuICBhc3luYyBhZGRBbGxDaGFuZ2VzKCkge1xuICAgIGF3YWl0IGdpdC5hZGQoe1xuICAgICAgZGlyOiB0aGlzLndvcmtEaXIsXG4gICAgICBmaWxlcGF0aDogJy4nLFxuICAgIH0pO1xuICB9XG5cbiAgYXN5bmMgbGlzdENoYW5nZWRGaWxlcygpOiBQcm9taXNlPHN0cmluZ1tdPiB7XG4gICAgY29uc3QgRklMRSA9IDAsIEhFQUQgPSAxLCBXT1JLRElSID0gMjtcblxuICAgIHJldHVybiAoYXdhaXQgZ2l0LnN0YXR1c01hdHJpeCh7IGRpcjogdGhpcy53b3JrRGlyIH0pKVxuICAgICAgLmZpbHRlcihyb3cgPT4gcm93W0hFQURdICE9PSByb3dbV09SS0RJUl0pXG4gICAgICAubWFwKHJvdyA9PiByb3dbRklMRV0pO1xuICB9XG5cbiAgYXN5bmMgcHVsbCgpIHtcbiAgICBhd2FpdCBnaXQucHVsbCh7XG4gICAgICBkaXI6IHRoaXMud29ya0RpcixcbiAgICAgIHJlZjogJ21hc3RlcicsXG4gICAgICBzaW5nbGVCcmFuY2g6IHRydWUsXG4gICAgICBmYXN0Rm9yd2FyZE9ubHk6IHRydWUsXG4gICAgICAuLi50aGlzLmF1dGgsXG4gICAgfSk7XG4gIH1cblxuICBhc3luYyBjb21taXQobXNnOiBzdHJpbmcpIHtcbiAgICBhd2FpdCBnaXQuY29tbWl0KHtcbiAgICAgIGRpcjogdGhpcy53b3JrRGlyLFxuICAgICAgbWVzc2FnZTogbXNnLFxuICAgICAgYXV0aG9yOiB7fSxcbiAgICB9KTtcbiAgfVxuXG4gIGFzeW5jIHB1c2goKSB7XG4gICAgYXdhaXQgZ2l0LnB1c2goe1xuICAgICAgZGlyOiB0aGlzLndvcmtEaXIsXG4gICAgICByZW1vdGU6ICdvcmlnaW4nLFxuICAgICAgLi4udGhpcy5hdXRoLFxuICAgIH0pO1xuICB9XG5cbiAgYXN5bmMgcmVzZXQoKSB7XG4gICAgYXdhaXQgdGhpcy5mcy5yZW1vdmUodGhpcy53b3JrRGlyKTtcbiAgICBhd2FpdCB0aGlzLmZzLmVuc3VyZURpcih0aGlzLndvcmtEaXIpO1xuICAgIGF3YWl0IGdpdC5jbG9uZSh7XG4gICAgICBkaXI6IHRoaXMud29ya0RpcixcbiAgICAgIHVybDogdGhpcy5yZXBvVXJsLFxuICAgICAgcmVmOiAnbWFzdGVyJyxcbiAgICAgIHNpbmdsZUJyYW5jaDogdHJ1ZSxcbiAgICAgIGRlcHRoOiAxMCxcbiAgICAgIGNvcnNQcm94eTogdGhpcy5jb3JzUHJveHksXG4gICAgICAuLi50aGlzLmF1dGgsXG4gICAgfSk7XG4gIH1cblxuICBzZXRVcEFQSUVuZHBvaW50cygpIHtcblxuICAgIG1ha2VFbmRwb2ludDx7IG9yaWdpblVSTDogc3RyaW5nIHwgbnVsbCwgYXV0aG9yOiBHaXRBdXRob3IgfT4oJ2dpdC1jb25maWcnLCBhc3luYyAoKSA9PiB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBvcmlnaW5VUkw6IGF3YWl0IHRoaXMuZ2V0T3JpZ2luVXJsKCksXG4gICAgICAgIGF1dGhvcjogYXdhaXQgdGhpcy5nZXRBdXRob3IoKSxcbiAgICAgIH07XG4gICAgfSk7XG5cbiAgICBtYWtlRW5kcG9pbnQ8eyBlcnJvcnM6IHN0cmluZ1tdIH0+KCdmZXRjaC1jb21taXQtcHVzaCcsIGFzeW5jICh7XG4gICAgICAgIGNvbW1pdE1zZyxcbiAgICAgICAgYXV0aG9yTmFtZSxcbiAgICAgICAgYXV0aG9yRW1haWwsXG4gICAgICAgIGdpdFVzZXJuYW1lLFxuICAgICAgICBnaXRQYXNzd29yZCxcbiAgICAgIH06IHtcbiAgICAgICAgY29tbWl0TXNnOiBzdHJpbmcsXG4gICAgICAgIGF1dGhvck5hbWU6IHN0cmluZyxcbiAgICAgICAgYXV0aG9yRW1haWw6IHN0cmluZyxcbiAgICAgICAgZ2l0VXNlcm5hbWU6IHN0cmluZyxcbiAgICAgICAgZ2l0UGFzc3dvcmQ6IHN0cmluZ1xuICAgICAgfSkgPT4ge1xuXG4gICAgICBhd2FpdCB0aGlzLnNldEF1dGhvcih7IG5hbWU6IGF1dGhvck5hbWUsIGVtYWlsOiBhdXRob3JFbWFpbCB9KTtcblxuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5zZXRBdXRoKHsgdXNlcm5hbWU6IGdpdFVzZXJuYW1lLCBwYXNzd29yZDogZ2l0UGFzc3dvcmQgfSk7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIHJldHVybiB7IGVycm9yczogW2BFcnJvciB3aGlsZSBhdXRoZW50aWNhdGluZzogJHtlLnRvU3RyaW5nKCl9YF0gfTtcbiAgICAgIH1cblxuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5wdWxsKCk7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIHJldHVybiB7IGVycm9yczogW2BFcnJvciB3aGlsZSBmZXRjaGluZyBhbmQgbWVyZ2luZyBjaGFuZ2VzOiAke2UudG9TdHJpbmcoKX1gXSB9O1xuICAgICAgfVxuXG4gICAgICBjb25zdCBjaGFuZ2VkRmlsZXMgPSBhd2FpdCB0aGlzLmxpc3RDaGFuZ2VkRmlsZXMoKTtcbiAgICAgIGlmIChjaGFuZ2VkRmlsZXMubGVuZ3RoIDwgMSkge1xuICAgICAgICByZXR1cm4geyBlcnJvcnM6IFtcIk5vIGNoYW5nZXMgdG8gc3VibWl0IVwiXSB9O1xuICAgICAgfVxuXG4gICAgICBhd2FpdCB0aGlzLmFkZEFsbENoYW5nZXMoKTtcbiAgICAgIGF3YWl0IHRoaXMuY29tbWl0KGNvbW1pdE1zZyk7XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMucHVzaCgpO1xuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICByZXR1cm4geyBlcnJvcnM6IFtgRXJyb3Igd2hpbGUgcHVzaGluZyBjaGFuZ2VzOiAke2UudG9TdHJpbmcoKX1gXSB9O1xuICAgICAgfVxuXG4gICAgICByZXR1cm4geyBlcnJvcnM6IFtdIH07XG4gICAgfSk7XG5cbiAgfVxufVxuXG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBpbml0UmVwbyhcbiAgICB3b3JrRGlyOiBzdHJpbmcsXG4gICAgcmVwb1VybDogc3RyaW5nLFxuICAgIGNvcnNQcm94eVVybDogc3RyaW5nLFxuICAgIHNldHRpbmdzOiBTZXR0aW5nTWFuYWdlcik6IFByb21pc2U8R2l0Q29udHJvbGxlcj4ge1xuXG4gIHNldHRpbmdzLmNvbmZpZ3VyZVBhbmUoe1xuICAgIGlkOiAnZGF0YVN5bmMnLFxuICAgIGxhYmVsOiBcIkRhdGEgc3luY2hyb25pemF0aW9uXCIsXG4gICAgaWNvbjogJ2dpdC1tZXJnZScsXG4gIH0pO1xuXG4gIHNldHRpbmdzLnJlZ2lzdGVyKG5ldyBTZXR0aW5nPHN0cmluZz4oXG4gICAgJ2dpdFJlcG9VcmwnLFxuICAgIFwiR2l0IHJlcG9zaXRvcnkgVVJMXCIsXG4gICAgJ2RhdGFTeW5jJyxcbiAgKSk7XG5cbiAgY29uc3QgZ2l0Q3RybCA9IG5ldyBHaXRDb250cm9sbGVyKGZzLCByZXBvVXJsLCB3b3JrRGlyLCBjb3JzUHJveHlVcmwpO1xuXG4gIGlmICgoYXdhaXQgZ2l0Q3RybC5pc0luaXRpYWxpemVkKCkpID09PSB0cnVlKSB7XG4gICAgY29uc3QgcmVtb3RlVXJsID0gYXdhaXQgZ2l0Q3RybC5nZXRPcmlnaW5VcmwoKTtcbiAgICBpZiAocmVtb3RlVXJsICE9PSBudWxsICYmIHJlbW90ZVVybC50cmltKCkgPT09IHJlcG9VcmwudHJpbSgpKSB7XG4gICAgICBhd2FpdCBnaXRDdHJsLnB1bGwoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgYXdhaXQgZ2l0Q3RybC5yZXNldCgpO1xuICAgIH1cbiAgfSBlbHNlIHtcbiAgICBhd2FpdCBnaXRDdHJsLnJlc2V0KCk7XG4gIH1cblxuICByZXR1cm4gZ2l0Q3RybDtcbn1cblxuXG4vKiBQcm9taXNlcyB0byByZXR1cm4gYSBzdHJpbmcgY29udGFpbmluZyBjb25maWd1cmVkIHJlcG9zaXRvcnkgVVJMLlxuICAgSWYgcmVwb3NpdG9yeSBVUkwgaXMgbm90IGNvbmZpZ3VyZWQgKGUuZy4sIG9uIGZpcnN0IHJ1biwgb3IgYWZ0ZXIgcmVzZXQpXG4gICBvcGVucyBhIHdpbmRvdyB3aXRoIHNwZWNpZmllZCBvcHRpb25zLlxuICAgVGhlIHdpbmRvdyBpcyBleHBlY3RlZCB0byBhc2sgdGhlIHVzZXIgdG8gc3BlY2lmeSB0aGUgVVJMIGFuZCBzZW5kIGEgYCdzZXQtc2V0dGluZydgXG4gICBldmVudCBmb3IgYCdnaXRSZXBvVXJsJ2AuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gc2V0UmVwb1VybChcbiAgICBjb25maWdXaW5kb3c6IFdpbmRvd09wZW5lclBhcmFtcyxcbiAgICBzZXR0aW5nczogU2V0dGluZ01hbmFnZXIpOiBQcm9taXNlPHN0cmluZz4ge1xuICBjb25zdCByZXBvVXJsOiBzdHJpbmcgPSBhd2FpdCBzZXR0aW5ncy5nZXRWYWx1ZSgnZ2l0UmVwb1VybCcpIGFzIHN0cmluZztcblxuICByZXR1cm4gbmV3IFByb21pc2U8c3RyaW5nPihhc3luYyAocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgaWYgKCFyZXBvVXJsKSB7XG4gICAgICBhd2FpdCBvcGVuV2luZG93KGNvbmZpZ1dpbmRvdyk7XG4gICAgICBpcGNNYWluLm9uKCdzZXQtc2V0dGluZycsIGhhbmRsZVNldHRpbmcpO1xuXG4gICAgICBmdW5jdGlvbiBoYW5kbGVTZXR0aW5nKGV2dDogYW55LCBuYW1lOiBzdHJpbmcsIHZhbHVlOiBzdHJpbmcpIHtcbiAgICAgICAgaWYgKG5hbWUgPT09ICdnaXRSZXBvVXJsJykge1xuICAgICAgICAgIGlwY01haW4ucmVtb3ZlTGlzdGVuZXIoJ3NldC1zZXR0aW5nJywgaGFuZGxlU2V0dGluZyk7XG4gICAgICAgICAgcmVzb2x2ZSh2YWx1ZSk7XG4gICAgICAgIH1cbiAgICAgICAgZXZ0LnJlcGx5KCdvaycpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICByZXNvbHZlKHJlcG9VcmwpO1xuICAgIH1cbiAgfSk7XG59XG4iXX0=