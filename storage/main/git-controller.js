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
        makeEndpoint('list-local-changes', async () => {
            return { filenames: await this.listChangedFiles() };
        });
        makeEndpoint('fetch-commit-push', async ({ commitMsg, authorName, authorEmail, gitUsername, gitPassword, }) => {
            const changedFiles = await this.listChangedFiles();
            if (changedFiles.length < 1) {
                return { errors: ["No changes to submit!"] };
            }
            await this.setAuthor({ name: authorName, email: authorEmail });
            try {
                await this.setAuth({ username: gitUsername, password: gitPassword });
            }
            catch (e) {
                return { errors: [`Error while authenticating: ${e.toString()}`] };
            }
            await this.addAllChanges();
            await this.commit(commitMsg);
            try {
                await this.pull();
            }
            catch (e) {
                return { errors: [`Error while fetching and merging changes: ${e.toString()}`] };
            }
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
export async function initRepo(workDir, repoUrl, corsProxyUrl) {
    const gitCtrl = new GitController(fs, repoUrl, workDir, corsProxyUrl);
    if ((await gitCtrl.isInitialized()) === true) {
        const remoteUrl = await gitCtrl.getOriginUrl();
        if (remoteUrl !== null && remoteUrl.trim() === repoUrl.trim()) {
            const changedFiles = await gitCtrl.listChangedFiles();
            if (changedFiles.length < 1) {
                await gitCtrl.pull();
            }
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
    settings.configurePane({
        id: 'dataSync',
        label: "Data synchronization",
        icon: 'git-merge',
    });
    settings.register(new Setting('gitRepoUrl', "Git repository URL", 'dataSync'));
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZ2l0LWNvbnRyb2xsZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvc3RvcmFnZS9tYWluL2dpdC1jb250cm9sbGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLE9BQU8sS0FBSyxJQUFJLE1BQU0sTUFBTSxDQUFDO0FBQzdCLE9BQU8sS0FBSyxFQUFFLE1BQU0sVUFBVSxDQUFDO0FBQy9CLE9BQU8sS0FBSyxHQUFHLE1BQU0sZ0JBQWdCLENBQUM7QUFFdEMsT0FBTyxFQUFFLE9BQU8sRUFBRSxNQUFNLFVBQVUsQ0FBQztBQUVuQyxPQUFPLEVBQUUsWUFBWSxFQUFFLE1BQU0sZ0JBQWdCLENBQUM7QUFDOUMsT0FBTyxFQUFFLE9BQU8sRUFBa0IsTUFBTSxxQkFBcUIsQ0FBQztBQUM5RCxPQUFPLEVBQXNCLFVBQVUsRUFBRSxNQUFNLG1CQUFtQixDQUFDO0FBS25FLE1BQU0sT0FBTyxhQUFhO0lBR3hCLFlBQ1ksRUFBTyxFQUNQLE9BQWUsRUFDZixPQUFlLEVBQ2YsU0FBaUI7UUFIakIsT0FBRSxHQUFGLEVBQUUsQ0FBSztRQUNQLFlBQU8sR0FBUCxPQUFPLENBQVE7UUFDZixZQUFPLEdBQVAsT0FBTyxDQUFRO1FBQ2YsY0FBUyxHQUFULFNBQVMsQ0FBUTtRQU5yQixTQUFJLEdBQXNCLEVBQUUsQ0FBQztRQVFuQyxHQUFHLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxJQUFJLEVBQUUsRUFBRSxDQUFDLENBQUM7SUFDNUIsQ0FBQztJQUVELEtBQUssQ0FBQyxTQUFTO1FBQ2IsTUFBTSxJQUFJLEdBQUcsTUFBTSxHQUFHLENBQUMsTUFBTSxDQUFDLEVBQUUsR0FBRyxFQUFFLElBQUksQ0FBQyxPQUFPLEVBQUUsSUFBSSxFQUFFLFdBQVcsRUFBRSxDQUFDLENBQUM7UUFDeEUsTUFBTSxLQUFLLEdBQUcsTUFBTSxHQUFHLENBQUMsTUFBTSxDQUFDLEVBQUUsR0FBRyxFQUFFLElBQUksQ0FBQyxPQUFPLEVBQUUsSUFBSSxFQUFFLFlBQVksRUFBRSxDQUFDLENBQUM7UUFDMUUsT0FBTyxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxDQUFDO0lBQ3RDLENBQUM7SUFFRCxLQUFLLENBQUMsU0FBUyxDQUFDLE1BQWlCO1FBQy9CLE1BQU0sR0FBRyxDQUFDLE1BQU0sQ0FBQyxFQUFFLEdBQUcsRUFBRSxJQUFJLENBQUMsT0FBTyxFQUFFLElBQUksRUFBRSxXQUFXLEVBQUUsS0FBSyxFQUFFLE1BQU0sQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFDO1FBQy9FLE1BQU0sR0FBRyxDQUFDLE1BQU0sQ0FBQyxFQUFFLEdBQUcsRUFBRSxJQUFJLENBQUMsT0FBTyxFQUFFLElBQUksRUFBRSxZQUFZLEVBQUUsS0FBSyxFQUFFLE1BQU0sQ0FBQyxLQUFLLEVBQUUsQ0FBQyxDQUFDO0lBQ25GLENBQUM7SUFFRCxLQUFLLENBQUMsT0FBTyxDQUFDLElBQXVCO1FBQ25DLElBQUk7WUFDRix3REFBd0Q7WUFDeEQsR0FBRyxDQUFDLEtBQUssaUJBQUUsR0FBRyxFQUFFLElBQUksQ0FBQyxPQUFPLElBQUssSUFBSSxFQUFHLENBQUM7U0FDMUM7UUFBQyxPQUFPLENBQUMsRUFBRTtZQUNWLE9BQU8sS0FBSyxDQUFDO1NBQ2Q7UUFFRCxJQUFJLENBQUMsSUFBSSxHQUFHLElBQUksQ0FBQztRQUNqQixPQUFPLElBQUksQ0FBQztJQUNkLENBQUM7SUFFRCxLQUFLLENBQUMsYUFBYTtRQUNqQixJQUFJLGNBQXVCLENBQUM7UUFFNUIsSUFBSTtZQUNGLGNBQWMsR0FBRyxDQUFDLE1BQU0sSUFBSSxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsT0FBTyxFQUFFLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxXQUFXLEVBQUUsQ0FBQztTQUN0RjtRQUFDLE9BQU8sQ0FBQyxFQUFFO1lBQ1YsY0FBYyxHQUFHLEtBQUssQ0FBQztTQUN4QjtRQUVELE9BQU8sY0FBYyxDQUFDO0lBQ3hCLENBQUM7SUFFRCxLQUFLLENBQUMsWUFBWTtRQUNoQixPQUFPLENBQUMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxXQUFXLENBQUM7WUFDN0IsR0FBRyxFQUFFLElBQUksQ0FBQyxPQUFPO1NBQ2xCLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxNQUFNLEtBQUssUUFBUSxDQUFDLElBQUksRUFBRSxHQUFHLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQyxHQUFHLENBQUM7SUFDN0QsQ0FBQztJQUVELEtBQUssQ0FBQyxjQUFjO1FBQ2xCLE9BQU8sQ0FBQyxDQUFDLE1BQU0sR0FBRyxDQUFDLFdBQVcsQ0FBQztZQUM3QixHQUFHLEVBQUUsSUFBSSxDQUFDLE9BQU87U0FDbEIsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLE1BQU0sS0FBSyxVQUFVLENBQUMsSUFBSSxFQUFFLEdBQUcsRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDLEdBQUcsQ0FBQztJQUMvRCxDQUFDO0lBRUQsS0FBSyxDQUFDLGFBQWE7UUFDakIsTUFBTSxHQUFHLENBQUMsR0FBRyxDQUFDO1lBQ1osR0FBRyxFQUFFLElBQUksQ0FBQyxPQUFPO1lBQ2pCLFFBQVEsRUFBRSxHQUFHO1NBQ2QsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQUVELEtBQUssQ0FBQyxnQkFBZ0I7UUFDcEIsTUFBTSxJQUFJLEdBQUcsQ0FBQyxFQUFFLElBQUksR0FBRyxDQUFDLEVBQUUsT0FBTyxHQUFHLENBQUMsQ0FBQztRQUV0QyxPQUFPLENBQUMsTUFBTSxHQUFHLENBQUMsWUFBWSxDQUFDLEVBQUUsR0FBRyxFQUFFLElBQUksQ0FBQyxPQUFPLEVBQUUsQ0FBQyxDQUFDO2FBQ25ELE1BQU0sQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsS0FBSyxHQUFHLENBQUMsT0FBTyxDQUFDLENBQUM7YUFDekMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUM7SUFDM0IsQ0FBQztJQUVELEtBQUssQ0FBQyxJQUFJO1FBQ1IsTUFBTSxHQUFHLENBQUMsSUFBSSxpQkFDWixHQUFHLEVBQUUsSUFBSSxDQUFDLE9BQU8sRUFDakIsR0FBRyxFQUFFLFFBQVEsRUFDYixZQUFZLEVBQUUsSUFBSSxFQUNsQixlQUFlLEVBQUUsSUFBSSxJQUNsQixJQUFJLENBQUMsSUFBSSxFQUNaLENBQUM7SUFDTCxDQUFDO0lBRUQsS0FBSyxDQUFDLE1BQU0sQ0FBQyxHQUFXO1FBQ3RCLE1BQU0sR0FBRyxDQUFDLE1BQU0sQ0FBQztZQUNmLEdBQUcsRUFBRSxJQUFJLENBQUMsT0FBTztZQUNqQixPQUFPLEVBQUUsR0FBRztZQUNaLE1BQU0sRUFBRSxFQUFFO1NBQ1gsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQUVELEtBQUssQ0FBQyxJQUFJO1FBQ1IsTUFBTSxHQUFHLENBQUMsSUFBSSxpQkFDWixHQUFHLEVBQUUsSUFBSSxDQUFDLE9BQU8sRUFDakIsTUFBTSxFQUFFLFFBQVEsSUFDYixJQUFJLENBQUMsSUFBSSxFQUNaLENBQUM7SUFDTCxDQUFDO0lBRUQsS0FBSyxDQUFDLEtBQUs7UUFDVCxNQUFNLElBQUksQ0FBQyxFQUFFLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQztRQUNuQyxNQUFNLElBQUksQ0FBQyxFQUFFLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQztRQUN0QyxNQUFNLEdBQUcsQ0FBQyxLQUFLLGlCQUNiLEdBQUcsRUFBRSxJQUFJLENBQUMsT0FBTyxFQUNqQixHQUFHLEVBQUUsSUFBSSxDQUFDLE9BQU8sRUFDakIsR0FBRyxFQUFFLFFBQVEsRUFDYixZQUFZLEVBQUUsSUFBSSxFQUNsQixLQUFLLEVBQUUsRUFBRSxFQUNULFNBQVMsRUFBRSxJQUFJLENBQUMsU0FBUyxJQUN0QixJQUFJLENBQUMsSUFBSSxFQUNaLENBQUM7SUFDTCxDQUFDO0lBRUQsaUJBQWlCO1FBRWYsWUFBWSxDQUFrRCxZQUFZLEVBQUUsS0FBSyxJQUFJLEVBQUU7WUFDckYsT0FBTztnQkFDTCxTQUFTLEVBQUUsTUFBTSxJQUFJLENBQUMsWUFBWSxFQUFFO2dCQUNwQyxNQUFNLEVBQUUsTUFBTSxJQUFJLENBQUMsU0FBUyxFQUFFO2FBQy9CLENBQUM7UUFDSixDQUFDLENBQUMsQ0FBQztRQUVILFlBQVksQ0FBMEIsb0JBQW9CLEVBQUUsS0FBSyxJQUFJLEVBQUU7WUFDckUsT0FBTyxFQUFFLFNBQVMsRUFBRSxNQUFNLElBQUksQ0FBQyxnQkFBZ0IsRUFBRSxFQUFFLENBQUM7UUFDdEQsQ0FBQyxDQUFDLENBQUM7UUFFSCxZQUFZLENBQXVCLG1CQUFtQixFQUFFLEtBQUssRUFBRSxFQUMzRCxTQUFTLEVBQ1QsVUFBVSxFQUNWLFdBQVcsRUFDWCxXQUFXLEVBQ1gsV0FBVyxHQU9aLEVBQUUsRUFBRTtZQUVMLE1BQU0sWUFBWSxHQUFHLE1BQU0sSUFBSSxDQUFDLGdCQUFnQixFQUFFLENBQUM7WUFDbkQsSUFBSSxZQUFZLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRTtnQkFDM0IsT0FBTyxFQUFFLE1BQU0sRUFBRSxDQUFDLHVCQUF1QixDQUFDLEVBQUUsQ0FBQzthQUM5QztZQUVELE1BQU0sSUFBSSxDQUFDLFNBQVMsQ0FBQyxFQUFFLElBQUksRUFBRSxVQUFVLEVBQUUsS0FBSyxFQUFFLFdBQVcsRUFBRSxDQUFDLENBQUM7WUFFL0QsSUFBSTtnQkFDRixNQUFNLElBQUksQ0FBQyxPQUFPLENBQUMsRUFBRSxRQUFRLEVBQUUsV0FBVyxFQUFFLFFBQVEsRUFBRSxXQUFXLEVBQUUsQ0FBQyxDQUFDO2FBQ3RFO1lBQUMsT0FBTyxDQUFDLEVBQUU7Z0JBQ1YsT0FBTyxFQUFFLE1BQU0sRUFBRSxDQUFDLCtCQUErQixDQUFDLENBQUMsUUFBUSxFQUFFLEVBQUUsQ0FBQyxFQUFFLENBQUM7YUFDcEU7WUFFRCxNQUFNLElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQztZQUMzQixNQUFNLElBQUksQ0FBQyxNQUFNLENBQUMsU0FBUyxDQUFDLENBQUM7WUFFN0IsSUFBSTtnQkFDRixNQUFNLElBQUksQ0FBQyxJQUFJLEVBQUUsQ0FBQzthQUNuQjtZQUFDLE9BQU8sQ0FBQyxFQUFFO2dCQUNWLE9BQU8sRUFBRSxNQUFNLEVBQUUsQ0FBQyw2Q0FBNkMsQ0FBQyxDQUFDLFFBQVEsRUFBRSxFQUFFLENBQUMsRUFBRSxDQUFDO2FBQ2xGO1lBRUQsSUFBSTtnQkFDRixNQUFNLElBQUksQ0FBQyxJQUFJLEVBQUUsQ0FBQzthQUNuQjtZQUFDLE9BQU8sQ0FBQyxFQUFFO2dCQUNWLE9BQU8sRUFBRSxNQUFNLEVBQUUsQ0FBQyxnQ0FBZ0MsQ0FBQyxDQUFDLFFBQVEsRUFBRSxFQUFFLENBQUMsRUFBRSxDQUFDO2FBQ3JFO1lBRUQsT0FBTyxFQUFFLE1BQU0sRUFBRSxFQUFFLEVBQUUsQ0FBQztRQUN4QixDQUFDLENBQUMsQ0FBQztJQUVMLENBQUM7Q0FDRjtBQUdELE1BQU0sQ0FBQyxLQUFLLFVBQVUsUUFBUSxDQUMxQixPQUFlLEVBQ2YsT0FBZSxFQUNmLFlBQW9CO0lBRXRCLE1BQU0sT0FBTyxHQUFHLElBQUksYUFBYSxDQUFDLEVBQUUsRUFBRSxPQUFPLEVBQUUsT0FBTyxFQUFFLFlBQVksQ0FBQyxDQUFDO0lBRXRFLElBQUksQ0FBQyxNQUFNLE9BQU8sQ0FBQyxhQUFhLEVBQUUsQ0FBQyxLQUFLLElBQUksRUFBRTtRQUM1QyxNQUFNLFNBQVMsR0FBRyxNQUFNLE9BQU8sQ0FBQyxZQUFZLEVBQUUsQ0FBQztRQUMvQyxJQUFJLFNBQVMsS0FBSyxJQUFJLElBQUksU0FBUyxDQUFDLElBQUksRUFBRSxLQUFLLE9BQU8sQ0FBQyxJQUFJLEVBQUUsRUFBRTtZQUM3RCxNQUFNLFlBQVksR0FBRyxNQUFNLE9BQU8sQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDO1lBQ3RELElBQUksWUFBWSxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUU7Z0JBQzNCLE1BQU0sT0FBTyxDQUFDLElBQUksRUFBRSxDQUFDO2FBQ3RCO1NBQ0Y7YUFBTTtZQUNMLE1BQU0sT0FBTyxDQUFDLEtBQUssRUFBRSxDQUFDO1NBQ3ZCO0tBQ0Y7U0FBTTtRQUNMLE1BQU0sT0FBTyxDQUFDLEtBQUssRUFBRSxDQUFDO0tBQ3ZCO0lBRUQsT0FBTyxPQUFPLENBQUM7QUFDakIsQ0FBQztBQUdEOzs7OytCQUkrQjtBQUMvQixNQUFNLENBQUMsS0FBSyxVQUFVLFVBQVUsQ0FDNUIsWUFBZ0MsRUFDaEMsUUFBd0I7SUFFMUIsUUFBUSxDQUFDLGFBQWEsQ0FBQztRQUNyQixFQUFFLEVBQUUsVUFBVTtRQUNkLEtBQUssRUFBRSxzQkFBc0I7UUFDN0IsSUFBSSxFQUFFLFdBQVc7S0FDbEIsQ0FBQyxDQUFDO0lBRUgsUUFBUSxDQUFDLFFBQVEsQ0FBQyxJQUFJLE9BQU8sQ0FDM0IsWUFBWSxFQUNaLG9CQUFvQixFQUNwQixVQUFVLENBQ1gsQ0FBQyxDQUFDO0lBRUgsTUFBTSxPQUFPLEdBQVcsTUFBTSxRQUFRLENBQUMsUUFBUSxDQUFDLFlBQVksQ0FBVyxDQUFDO0lBRXhFLE9BQU8sSUFBSSxPQUFPLENBQVMsS0FBSyxFQUFFLE9BQU8sRUFBRSxNQUFNLEVBQUUsRUFBRTtRQUNuRCxJQUFJLENBQUMsT0FBTyxFQUFFO1lBQ1osTUFBTSxVQUFVLENBQUMsWUFBWSxDQUFDLENBQUM7WUFDL0IsT0FBTyxDQUFDLEVBQUUsQ0FBQyxhQUFhLEVBQUUsYUFBYSxDQUFDLENBQUM7WUFFekMsU0FBUyxhQUFhLENBQUMsR0FBUSxFQUFFLElBQVksRUFBRSxLQUFhO2dCQUMxRCxJQUFJLElBQUksS0FBSyxZQUFZLEVBQUU7b0JBQ3pCLE9BQU8sQ0FBQyxjQUFjLENBQUMsYUFBYSxFQUFFLGFBQWEsQ0FBQyxDQUFDO29CQUNyRCxPQUFPLENBQUMsS0FBSyxDQUFDLENBQUM7aUJBQ2hCO2dCQUNELEdBQUcsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUM7WUFDbEIsQ0FBQztTQUNGO2FBQU07WUFDTCxPQUFPLENBQUMsT0FBTyxDQUFDLENBQUM7U0FDbEI7SUFDSCxDQUFDLENBQUMsQ0FBQztBQUNMLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0ICogYXMgZnMgZnJvbSAnZnMtZXh0cmEnO1xuaW1wb3J0ICogYXMgZ2l0IGZyb20gJ2lzb21vcnBoaWMtZ2l0JztcblxuaW1wb3J0IHsgaXBjTWFpbiB9IGZyb20gJ2VsZWN0cm9uJztcblxuaW1wb3J0IHsgbWFrZUVuZHBvaW50IH0gZnJvbSAnLi4vLi4vYXBpL21haW4nO1xuaW1wb3J0IHsgU2V0dGluZywgU2V0dGluZ01hbmFnZXIgfSBmcm9tICcuLi8uLi9zZXR0aW5ncy9tYWluJztcbmltcG9ydCB7IFdpbmRvd09wZW5lclBhcmFtcywgb3BlbldpbmRvdyB9IGZyb20gJy4uLy4uL21haW4vd2luZG93JztcblxuaW1wb3J0IHsgR2l0QXV0aG9yLCBHaXRBdXRoZW50aWNhdGlvbiB9IGZyb20gJy4uL2dpdCc7XG5cblxuZXhwb3J0IGNsYXNzIEdpdENvbnRyb2xsZXIge1xuICBwcml2YXRlIGF1dGg6IEdpdEF1dGhlbnRpY2F0aW9uID0ge307XG5cbiAgY29uc3RydWN0b3IoXG4gICAgICBwcml2YXRlIGZzOiBhbnksXG4gICAgICBwcml2YXRlIHJlcG9Vcmw6IHN0cmluZyxcbiAgICAgIHByaXZhdGUgd29ya0Rpcjogc3RyaW5nLFxuICAgICAgcHJpdmF0ZSBjb3JzUHJveHk6IHN0cmluZykge1xuXG4gICAgZ2l0LnBsdWdpbnMuc2V0KCdmcycsIGZzKTtcbiAgfVxuXG4gIGFzeW5jIGdldEF1dGhvcigpOiBQcm9taXNlPEdpdEF1dGhvcj4ge1xuICAgIGNvbnN0IG5hbWUgPSBhd2FpdCBnaXQuY29uZmlnKHsgZGlyOiB0aGlzLndvcmtEaXIsIHBhdGg6ICd1c2VyLm5hbWUnIH0pO1xuICAgIGNvbnN0IGVtYWlsID0gYXdhaXQgZ2l0LmNvbmZpZyh7IGRpcjogdGhpcy53b3JrRGlyLCBwYXRoOiAndXNlci5lbWFpbCcgfSk7XG4gICAgcmV0dXJuIHsgbmFtZTogbmFtZSwgZW1haWw6IGVtYWlsIH07XG4gIH1cblxuICBhc3luYyBzZXRBdXRob3IoYXV0aG9yOiBHaXRBdXRob3IpIHtcbiAgICBhd2FpdCBnaXQuY29uZmlnKHsgZGlyOiB0aGlzLndvcmtEaXIsIHBhdGg6ICd1c2VyLm5hbWUnLCB2YWx1ZTogYXV0aG9yLm5hbWUgfSk7XG4gICAgYXdhaXQgZ2l0LmNvbmZpZyh7IGRpcjogdGhpcy53b3JrRGlyLCBwYXRoOiAndXNlci5lbWFpbCcsIHZhbHVlOiBhdXRob3IuZW1haWwgfSk7XG4gIH1cblxuICBhc3luYyBzZXRBdXRoKGF1dGg6IEdpdEF1dGhlbnRpY2F0aW9uKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgdHJ5IHtcbiAgICAgIC8vIFRyeSBmZXRjaGluZyB3aXRoIGF1dGg7IHdpbGwgdGhyb3cgaWYgYXV0aCBpcyBpbnZhbGlkXG4gICAgICBnaXQuZmV0Y2goe2RpcjogdGhpcy53b3JrRGlyLCAuLi5hdXRoIH0pO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG5cbiAgICB0aGlzLmF1dGggPSBhdXRoO1xuICAgIHJldHVybiB0cnVlO1xuICB9XG5cbiAgYXN5bmMgaXNJbml0aWFsaXplZCgpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICBsZXQgZ2l0SW5pdGlhbGl6ZWQ6IGJvb2xlYW47XG5cbiAgICB0cnkge1xuICAgICAgZ2l0SW5pdGlhbGl6ZWQgPSAoYXdhaXQgdGhpcy5mcy5zdGF0KHBhdGguam9pbih0aGlzLndvcmtEaXIsICcuZ2l0JykpKS5pc0RpcmVjdG9yeSgpO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIGdpdEluaXRpYWxpemVkID0gZmFsc2U7XG4gICAgfVxuXG4gICAgcmV0dXJuIGdpdEluaXRpYWxpemVkO1xuICB9XG5cbiAgYXN5bmMgZ2V0T3JpZ2luVXJsKCk6IFByb21pc2U8c3RyaW5nIHwgbnVsbD4ge1xuICAgIHJldHVybiAoKGF3YWl0IGdpdC5saXN0UmVtb3Rlcyh7XG4gICAgICBkaXI6IHRoaXMud29ya0RpcixcbiAgICB9KSkuZmluZChyID0+IHIucmVtb3RlID09PSAnb3JpZ2luJykgfHwgeyB1cmw6IG51bGwgfSkudXJsO1xuICB9XG5cbiAgYXN5bmMgZ2V0VXBzdHJlYW1VcmwoKTogUHJvbWlzZTxzdHJpbmcgfCBudWxsPiB7XG4gICAgcmV0dXJuICgoYXdhaXQgZ2l0Lmxpc3RSZW1vdGVzKHtcbiAgICAgIGRpcjogdGhpcy53b3JrRGlyLFxuICAgIH0pKS5maW5kKHIgPT4gci5yZW1vdGUgPT09ICd1cHN0cmVhbScpIHx8IHsgdXJsOiBudWxsIH0pLnVybDtcbiAgfVxuXG4gIGFzeW5jIGFkZEFsbENoYW5nZXMoKSB7XG4gICAgYXdhaXQgZ2l0LmFkZCh7XG4gICAgICBkaXI6IHRoaXMud29ya0RpcixcbiAgICAgIGZpbGVwYXRoOiAnLicsXG4gICAgfSk7XG4gIH1cblxuICBhc3luYyBsaXN0Q2hhbmdlZEZpbGVzKCk6IFByb21pc2U8c3RyaW5nW10+IHtcbiAgICBjb25zdCBGSUxFID0gMCwgSEVBRCA9IDEsIFdPUktESVIgPSAyO1xuXG4gICAgcmV0dXJuIChhd2FpdCBnaXQuc3RhdHVzTWF0cml4KHsgZGlyOiB0aGlzLndvcmtEaXIgfSkpXG4gICAgICAuZmlsdGVyKHJvdyA9PiByb3dbSEVBRF0gIT09IHJvd1tXT1JLRElSXSlcbiAgICAgIC5tYXAocm93ID0+IHJvd1tGSUxFXSk7XG4gIH1cblxuICBhc3luYyBwdWxsKCkge1xuICAgIGF3YWl0IGdpdC5wdWxsKHtcbiAgICAgIGRpcjogdGhpcy53b3JrRGlyLFxuICAgICAgcmVmOiAnbWFzdGVyJyxcbiAgICAgIHNpbmdsZUJyYW5jaDogdHJ1ZSxcbiAgICAgIGZhc3RGb3J3YXJkT25seTogdHJ1ZSxcbiAgICAgIC4uLnRoaXMuYXV0aCxcbiAgICB9KTtcbiAgfVxuXG4gIGFzeW5jIGNvbW1pdChtc2c6IHN0cmluZykge1xuICAgIGF3YWl0IGdpdC5jb21taXQoe1xuICAgICAgZGlyOiB0aGlzLndvcmtEaXIsXG4gICAgICBtZXNzYWdlOiBtc2csXG4gICAgICBhdXRob3I6IHt9LFxuICAgIH0pO1xuICB9XG5cbiAgYXN5bmMgcHVzaCgpIHtcbiAgICBhd2FpdCBnaXQucHVzaCh7XG4gICAgICBkaXI6IHRoaXMud29ya0RpcixcbiAgICAgIHJlbW90ZTogJ29yaWdpbicsXG4gICAgICAuLi50aGlzLmF1dGgsXG4gICAgfSk7XG4gIH1cblxuICBhc3luYyByZXNldCgpIHtcbiAgICBhd2FpdCB0aGlzLmZzLnJlbW92ZSh0aGlzLndvcmtEaXIpO1xuICAgIGF3YWl0IHRoaXMuZnMuZW5zdXJlRGlyKHRoaXMud29ya0Rpcik7XG4gICAgYXdhaXQgZ2l0LmNsb25lKHtcbiAgICAgIGRpcjogdGhpcy53b3JrRGlyLFxuICAgICAgdXJsOiB0aGlzLnJlcG9VcmwsXG4gICAgICByZWY6ICdtYXN0ZXInLFxuICAgICAgc2luZ2xlQnJhbmNoOiB0cnVlLFxuICAgICAgZGVwdGg6IDEwLFxuICAgICAgY29yc1Byb3h5OiB0aGlzLmNvcnNQcm94eSxcbiAgICAgIC4uLnRoaXMuYXV0aCxcbiAgICB9KTtcbiAgfVxuXG4gIHNldFVwQVBJRW5kcG9pbnRzKCkge1xuXG4gICAgbWFrZUVuZHBvaW50PHsgb3JpZ2luVVJMOiBzdHJpbmcgfCBudWxsLCBhdXRob3I6IEdpdEF1dGhvciB9PignZ2l0LWNvbmZpZycsIGFzeW5jICgpID0+IHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIG9yaWdpblVSTDogYXdhaXQgdGhpcy5nZXRPcmlnaW5VcmwoKSxcbiAgICAgICAgYXV0aG9yOiBhd2FpdCB0aGlzLmdldEF1dGhvcigpLFxuICAgICAgfTtcbiAgICB9KTtcblxuICAgIG1ha2VFbmRwb2ludDx7IGZpbGVuYW1lczogc3RyaW5nW10gfT4oJ2xpc3QtbG9jYWwtY2hhbmdlcycsIGFzeW5jICgpID0+IHtcbiAgICAgIHJldHVybiB7IGZpbGVuYW1lczogYXdhaXQgdGhpcy5saXN0Q2hhbmdlZEZpbGVzKCkgfTtcbiAgICB9KTtcblxuICAgIG1ha2VFbmRwb2ludDx7IGVycm9yczogc3RyaW5nW10gfT4oJ2ZldGNoLWNvbW1pdC1wdXNoJywgYXN5bmMgKHtcbiAgICAgICAgY29tbWl0TXNnLFxuICAgICAgICBhdXRob3JOYW1lLFxuICAgICAgICBhdXRob3JFbWFpbCxcbiAgICAgICAgZ2l0VXNlcm5hbWUsXG4gICAgICAgIGdpdFBhc3N3b3JkLFxuICAgICAgfToge1xuICAgICAgICBjb21taXRNc2c6IHN0cmluZyxcbiAgICAgICAgYXV0aG9yTmFtZTogc3RyaW5nLFxuICAgICAgICBhdXRob3JFbWFpbDogc3RyaW5nLFxuICAgICAgICBnaXRVc2VybmFtZTogc3RyaW5nLFxuICAgICAgICBnaXRQYXNzd29yZDogc3RyaW5nXG4gICAgICB9KSA9PiB7XG5cbiAgICAgIGNvbnN0IGNoYW5nZWRGaWxlcyA9IGF3YWl0IHRoaXMubGlzdENoYW5nZWRGaWxlcygpO1xuICAgICAgaWYgKGNoYW5nZWRGaWxlcy5sZW5ndGggPCAxKSB7XG4gICAgICAgIHJldHVybiB7IGVycm9yczogW1wiTm8gY2hhbmdlcyB0byBzdWJtaXQhXCJdIH07XG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHRoaXMuc2V0QXV0aG9yKHsgbmFtZTogYXV0aG9yTmFtZSwgZW1haWw6IGF1dGhvckVtYWlsIH0pO1xuXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLnNldEF1dGgoeyB1c2VybmFtZTogZ2l0VXNlcm5hbWUsIHBhc3N3b3JkOiBnaXRQYXNzd29yZCB9KTtcbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgcmV0dXJuIHsgZXJyb3JzOiBbYEVycm9yIHdoaWxlIGF1dGhlbnRpY2F0aW5nOiAke2UudG9TdHJpbmcoKX1gXSB9O1xuICAgICAgfVxuXG4gICAgICBhd2FpdCB0aGlzLmFkZEFsbENoYW5nZXMoKTtcbiAgICAgIGF3YWl0IHRoaXMuY29tbWl0KGNvbW1pdE1zZyk7XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMucHVsbCgpO1xuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICByZXR1cm4geyBlcnJvcnM6IFtgRXJyb3Igd2hpbGUgZmV0Y2hpbmcgYW5kIG1lcmdpbmcgY2hhbmdlczogJHtlLnRvU3RyaW5nKCl9YF0gfTtcbiAgICAgIH1cblxuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5wdXNoKCk7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIHJldHVybiB7IGVycm9yczogW2BFcnJvciB3aGlsZSBwdXNoaW5nIGNoYW5nZXM6ICR7ZS50b1N0cmluZygpfWBdIH07XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB7IGVycm9yczogW10gfTtcbiAgICB9KTtcblxuICB9XG59XG5cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGluaXRSZXBvKFxuICAgIHdvcmtEaXI6IHN0cmluZyxcbiAgICByZXBvVXJsOiBzdHJpbmcsXG4gICAgY29yc1Byb3h5VXJsOiBzdHJpbmcpOiBQcm9taXNlPEdpdENvbnRyb2xsZXI+IHtcblxuICBjb25zdCBnaXRDdHJsID0gbmV3IEdpdENvbnRyb2xsZXIoZnMsIHJlcG9VcmwsIHdvcmtEaXIsIGNvcnNQcm94eVVybCk7XG5cbiAgaWYgKChhd2FpdCBnaXRDdHJsLmlzSW5pdGlhbGl6ZWQoKSkgPT09IHRydWUpIHtcbiAgICBjb25zdCByZW1vdGVVcmwgPSBhd2FpdCBnaXRDdHJsLmdldE9yaWdpblVybCgpO1xuICAgIGlmIChyZW1vdGVVcmwgIT09IG51bGwgJiYgcmVtb3RlVXJsLnRyaW0oKSA9PT0gcmVwb1VybC50cmltKCkpIHtcbiAgICAgIGNvbnN0IGNoYW5nZWRGaWxlcyA9IGF3YWl0IGdpdEN0cmwubGlzdENoYW5nZWRGaWxlcygpO1xuICAgICAgaWYgKGNoYW5nZWRGaWxlcy5sZW5ndGggPCAxKSB7XG4gICAgICAgIGF3YWl0IGdpdEN0cmwucHVsbCgpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBhd2FpdCBnaXRDdHJsLnJlc2V0KCk7XG4gICAgfVxuICB9IGVsc2Uge1xuICAgIGF3YWl0IGdpdEN0cmwucmVzZXQoKTtcbiAgfVxuXG4gIHJldHVybiBnaXRDdHJsO1xufVxuXG5cbi8qIFByb21pc2VzIHRvIHJldHVybiBhIHN0cmluZyBjb250YWluaW5nIGNvbmZpZ3VyZWQgcmVwb3NpdG9yeSBVUkwuXG4gICBJZiByZXBvc2l0b3J5IFVSTCBpcyBub3QgY29uZmlndXJlZCAoZS5nLiwgb24gZmlyc3QgcnVuLCBvciBhZnRlciByZXNldClcbiAgIG9wZW5zIGEgd2luZG93IHdpdGggc3BlY2lmaWVkIG9wdGlvbnMuXG4gICBUaGUgd2luZG93IGlzIGV4cGVjdGVkIHRvIGFzayB0aGUgdXNlciB0byBzcGVjaWZ5IHRoZSBVUkwgYW5kIHNlbmQgYSBgJ3NldC1zZXR0aW5nJ2BcbiAgIGV2ZW50IGZvciBgJ2dpdFJlcG9VcmwnYC4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzZXRSZXBvVXJsKFxuICAgIGNvbmZpZ1dpbmRvdzogV2luZG93T3BlbmVyUGFyYW1zLFxuICAgIHNldHRpbmdzOiBTZXR0aW5nTWFuYWdlcik6IFByb21pc2U8c3RyaW5nPiB7XG5cbiAgc2V0dGluZ3MuY29uZmlndXJlUGFuZSh7XG4gICAgaWQ6ICdkYXRhU3luYycsXG4gICAgbGFiZWw6IFwiRGF0YSBzeW5jaHJvbml6YXRpb25cIixcbiAgICBpY29uOiAnZ2l0LW1lcmdlJyxcbiAgfSk7XG5cbiAgc2V0dGluZ3MucmVnaXN0ZXIobmV3IFNldHRpbmc8c3RyaW5nPihcbiAgICAnZ2l0UmVwb1VybCcsXG4gICAgXCJHaXQgcmVwb3NpdG9yeSBVUkxcIixcbiAgICAnZGF0YVN5bmMnLFxuICApKTtcblxuICBjb25zdCByZXBvVXJsOiBzdHJpbmcgPSBhd2FpdCBzZXR0aW5ncy5nZXRWYWx1ZSgnZ2l0UmVwb1VybCcpIGFzIHN0cmluZztcblxuICByZXR1cm4gbmV3IFByb21pc2U8c3RyaW5nPihhc3luYyAocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgaWYgKCFyZXBvVXJsKSB7XG4gICAgICBhd2FpdCBvcGVuV2luZG93KGNvbmZpZ1dpbmRvdyk7XG4gICAgICBpcGNNYWluLm9uKCdzZXQtc2V0dGluZycsIGhhbmRsZVNldHRpbmcpO1xuXG4gICAgICBmdW5jdGlvbiBoYW5kbGVTZXR0aW5nKGV2dDogYW55LCBuYW1lOiBzdHJpbmcsIHZhbHVlOiBzdHJpbmcpIHtcbiAgICAgICAgaWYgKG5hbWUgPT09ICdnaXRSZXBvVXJsJykge1xuICAgICAgICAgIGlwY01haW4ucmVtb3ZlTGlzdGVuZXIoJ3NldC1zZXR0aW5nJywgaGFuZGxlU2V0dGluZyk7XG4gICAgICAgICAgcmVzb2x2ZSh2YWx1ZSk7XG4gICAgICAgIH1cbiAgICAgICAgZXZ0LnJlcGx5KCdvaycpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICByZXNvbHZlKHJlcG9VcmwpO1xuICAgIH1cbiAgfSk7XG59XG4iXX0=