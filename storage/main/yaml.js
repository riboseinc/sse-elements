import AsyncLock from 'async-lock';
import * as log from 'electron-log';
import * as yaml from 'js-yaml';
import { customTimestampType } from './yaml-custom-ts';
export class YAMLStorage {
    constructor(fs, opts = { debugLog: false }) {
        this.fs = fs;
        this.opts = opts;
        this.fileWriteLock = new AsyncLock();
    }
    debugLog(message, level = 'debug') {
        if (this.opts.debugLog) {
            log[level](message);
        }
    }
    async load(filePath) {
        this.debugLog(`SSE: YAMLStorage: Loading ${filePath}`);
        const data = await this.fs.readFile(filePath, { encoding: 'utf8' });
        return yaml.load(data, { schema: SCHEMA });
    }
    // private async loadIfExists(filePath: string): Promise<any> {
    //   let fileExists: boolean;
    //   let oldData: any;
    //   try {
    //     fileExists = (await this.fs.stat(filePath)).isFile() === true;
    //   } catch (e) {
    //     fileExists = false;
    //   }
    //   if (fileExists) {
    //     oldData = await this.load(filePath);
    //   } else {
    //     oldData = {};
    //   }
    //   return oldData || {};
    // }
    async store(filePath, data) {
        this.debugLog(`SSE: YAMLStorage: Storing ${filePath}`);
        this.debugLog(`SSE: YAMLStorage: Storing ${filePath}: ${JSON.stringify(data)}`, 'silly');
        return await this.fileWriteLock.acquire(filePath, async () => {
            this.debugLog(`SSE: YAMLStorage: Start writing ${filePath}`);
            if (data !== undefined && data !== null) {
                // Merge new data into old data; this way if some YAML properties
                // are not supported we will not lose them after the update.
                // TODO: This should be optional
                // let newData: any;
                // let oldData: any;
                // let newContents: string;
                // try {
                //   oldData = await this.loadIfExists(filePath);
                //   this.debugLog(`SSE: YAMLStorage: Storing ${filePath}: Already existing data: ${oldData}`, 'silly');
                //   newData = Object.assign(oldData, data);
                //   this.debugLog(`SSE: YAMLStorage: Storing ${filePath}: Combined data to write: ${newData}`, 'silly');
                // } catch (e) {
                //   log.error(`SSE: YAMLStorage: Failed to store ${filePath}`);
                //   console.error("Bad input", filePath, oldData, data);
                //   throw e;
                // }
                // console.debug(`Dumping contents for ${filePath} from ${data}`);
                // console.debug(oldData);
                let newContents;
                try {
                    newContents = yaml.dump(data, {
                        schema: SCHEMA,
                        noRefs: true,
                        noCompatMode: true,
                    });
                }
                catch (e) {
                    log.error(`SSE: YAMLStorage: Failed to dump ${filePath}: ${JSON.stringify(data)}`);
                    console.error(`Failed to save ${filePath} with ${JSON.stringify(data)}`, e);
                    return;
                }
                // console.debug(`Writing to ${filePath}, file exists: ${fileExists}`);
                // if (fileExists) {
                //   const oldContents: string = await this.fs.readFile(filePath, { encoding: 'utf8' });
                //   console.debug(`Replacing contents of ${filePath}`, oldContents, newContents);
                // }
                this.debugLog(`SSE: YAMLStorage: Storing ${filePath}: Writing file`);
                this.debugLog(`SSE: YAMLStorage: Storing ${filePath}: Writing file: ${newContents}`, 'silly');
                await this.fs.writeFile(filePath, newContents, { encoding: 'utf8' });
            }
            else {
                this.debugLog(`SSE: YAMLStorage: Storing ${filePath}: Empty data given, removing file`);
                await this.fs.remove(filePath);
            }
            this.debugLog(`SSE: YAMLStorage: Finish writing ${filePath}`);
            return data;
        });
    }
}
const SCHEMA = new yaml.Schema({
    include: [yaml.DEFAULT_SAFE_SCHEMA],
    // Trick because js-yaml API appears to not support augmenting implicit tags
    implicit: [
        ...yaml.DEFAULT_SAFE_SCHEMA.implicit,
        ...[customTimestampType],
    ],
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoieWFtbC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9zdG9yYWdlL21haW4veWFtbC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxPQUFPLFNBQVMsTUFBTSxZQUFZLENBQUM7QUFDbkMsT0FBTyxLQUFLLEdBQUcsTUFBTSxjQUFjLENBQUM7QUFDcEMsT0FBTyxLQUFLLElBQUksTUFBTSxTQUFTLENBQUM7QUFDaEMsT0FBTyxFQUFFLG1CQUFtQixFQUFFLE1BQU0sa0JBQWtCLENBQUM7QUFRdkQsTUFBTSxPQUFPLFdBQVc7SUFHdEIsWUFBb0IsRUFBTyxFQUFVLE9BQTJCLEVBQUUsUUFBUSxFQUFFLEtBQUssRUFBRTtRQUEvRCxPQUFFLEdBQUYsRUFBRSxDQUFLO1FBQVUsU0FBSSxHQUFKLElBQUksQ0FBMEM7UUFDakYsSUFBSSxDQUFDLGFBQWEsR0FBRyxJQUFJLFNBQVMsRUFBRSxDQUFDO0lBQ3ZDLENBQUM7SUFFTyxRQUFRLENBQUMsT0FBZSxFQUFFLFFBQTJCLE9BQU87UUFDbEUsSUFBSSxJQUFJLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFBRTtZQUN0QixHQUFHLENBQUMsS0FBSyxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUM7U0FDckI7SUFDSCxDQUFDO0lBRU0sS0FBSyxDQUFDLElBQUksQ0FBQyxRQUFnQjtRQUNoQyxJQUFJLENBQUMsUUFBUSxDQUFDLDZCQUE2QixRQUFRLEVBQUUsQ0FBQyxDQUFDO1FBQ3ZELE1BQU0sSUFBSSxHQUFXLE1BQU0sSUFBSSxDQUFDLEVBQUUsQ0FBQyxRQUFRLENBQUMsUUFBUSxFQUFFLEVBQUUsUUFBUSxFQUFFLE1BQU0sRUFBRSxDQUFDLENBQUM7UUFDNUUsT0FBTyxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsQ0FBQyxDQUFDO0lBQzdDLENBQUM7SUFFRCwrREFBK0Q7SUFDL0QsNkJBQTZCO0lBQzdCLHNCQUFzQjtJQUV0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SSxJQUFJLENBQUMsbUJBQTJCLENBQUMsUUFBUTtRQUM3QyxHQUFHLENBQUMsbUJBQW1CLENBQUM7S0FDekI7Q0FDRixDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgQXN5bmNMb2NrIGZyb20gJ2FzeW5jLWxvY2snO1xuaW1wb3J0ICogYXMgbG9nIGZyb20gJ2VsZWN0cm9uLWxvZyc7XG5pbXBvcnQgKiBhcyB5YW1sIGZyb20gJ2pzLXlhbWwnO1xuaW1wb3J0IHsgY3VzdG9tVGltZXN0YW1wVHlwZSB9IGZyb20gJy4veWFtbC1jdXN0b20tdHMnO1xuXG5cbmludGVyZmFjZSBZQU1MU3RvcmFnZU9wdGlvbnMge1xuICBkZWJ1Z0xvZzogYm9vbGVhbjtcbn1cblxuXG5leHBvcnQgY2xhc3MgWUFNTFN0b3JhZ2Uge1xuICBwcml2YXRlIGZpbGVXcml0ZUxvY2s6IEFzeW5jTG9jaztcblxuICBjb25zdHJ1Y3Rvcihwcml2YXRlIGZzOiBhbnksIHByaXZhdGUgb3B0czogWUFNTFN0b3JhZ2VPcHRpb25zID0geyBkZWJ1Z0xvZzogZmFsc2UgfSkge1xuICAgIHRoaXMuZmlsZVdyaXRlTG9jayA9IG5ldyBBc3luY0xvY2soKTtcbiAgfVxuXG4gIHByaXZhdGUgZGVidWdMb2cobWVzc2FnZTogc3RyaW5nLCBsZXZlbDogJ3NpbGx5JyB8ICdkZWJ1ZycgPSAnZGVidWcnKSB7XG4gICAgaWYgKHRoaXMub3B0cy5kZWJ1Z0xvZykge1xuICAgICAgbG9nW2xldmVsXShtZXNzYWdlKTtcbiAgICB9XG4gIH1cblxuICBwdWJsaWMgYXN5bmMgbG9hZChmaWxlUGF0aDogc3RyaW5nKTogUHJvbWlzZTxhbnk+IHtcbiAgICB0aGlzLmRlYnVnTG9nKGBTU0U6IFlBTUxTdG9yYWdlOiBMb2FkaW5nICR7ZmlsZVBhdGh9YCk7XG4gICAgY29uc3QgZGF0YTogc3RyaW5nID0gYXdhaXQgdGhpcy5mcy5yZWFkRmlsZShmaWxlUGF0aCwgeyBlbmNvZGluZzogJ3V0ZjgnIH0pO1xuICAgIHJldHVybiB5YW1sLmxvYWQoZGF0YSwgeyBzY2hlbWE6IFNDSEVNQSB9KTtcbiAgfVxuXG4gIC8vIHByaXZhdGUgYXN5bmMgbG9hZElmRXhpc3RzKGZpbGVQYXRoOiBzdHJpbmcpOiBQcm9taXNlPGFueT4ge1xuICAvLyAgIGxldCBmaWxlRXhpc3RzOiBib29sZWFuO1xuICAvLyAgIGxldCBvbGREYXRhOiBhbnk7XG5cbiAgLy8gICB0cnkge1xuICAvLyAgICAgZmlsZUV4aXN0cyA9IChhd2FpdCB0aGlzLmZzLnN0YXQoZmlsZVBhdGgpKS5pc0ZpbGUoKSA9PT0gdHJ1ZTtcbiAgLy8gICB9IGNhdGNoIChlKSB7XG4gIC8vICAgICBmaWxlRXhpc3RzID0gZmFsc2U7XG4gIC8vICAgfVxuXG4gIC8vICAgaWYgKGZpbGVFeGlzdHMpIHtcbiAgLy8gICAgIG9sZERhdGEgPSBhd2FpdCB0aGlzLmxvYWQoZmlsZVBhdGgpO1xuICAvLyAgIH0gZWxzZSB7XG4gIC8vICAgICBvbGREYXRhID0ge307XG4gIC8vICAgfVxuXG4gIC8vICAgcmV0dXJuIG9sZERhdGEgfHwge307XG4gIC8vIH1cblxuICBwdWJsaWMgYXN5bmMgc3RvcmUoZmlsZVBhdGg6IHN0cmluZywgZGF0YTogYW55KTogUHJvbWlzZTxhbnk+IHtcbiAgICB0aGlzLmRlYnVnTG9nKGBTU0U6IFlBTUxTdG9yYWdlOiBTdG9yaW5nICR7ZmlsZVBhdGh9YClcbiAgICB0aGlzLmRlYnVnTG9nKGBTU0U6IFlBTUxTdG9yYWdlOiBTdG9yaW5nICR7ZmlsZVBhdGh9OiAke0pTT04uc3RyaW5naWZ5KGRhdGEpfWAsICdzaWxseScpO1xuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZmlsZVdyaXRlTG9jay5hY3F1aXJlKGZpbGVQYXRoLCBhc3luYyAoKSA9PiB7XG4gICAgICB0aGlzLmRlYnVnTG9nKGBTU0U6IFlBTUxTdG9yYWdlOiBTdGFydCB3cml0aW5nICR7ZmlsZVBhdGh9YCk7XG5cbiAgICAgIGlmIChkYXRhICE9PSB1bmRlZmluZWQgJiYgZGF0YSAhPT0gbnVsbCkge1xuXG4gICAgICAgIC8vIE1lcmdlIG5ldyBkYXRhIGludG8gb2xkIGRhdGE7IHRoaXMgd2F5IGlmIHNvbWUgWUFNTCBwcm9wZXJ0aWVzXG4gICAgICAgIC8vIGFyZSBub3Qgc3VwcG9ydGVkIHdlIHdpbGwgbm90IGxvc2UgdGhlbSBhZnRlciB0aGUgdXBkYXRlLlxuICAgICAgICAvLyBUT0RPOiBUaGlzIHNob3VsZCBiZSBvcHRpb25hbFxuICAgICAgICAvLyBsZXQgbmV3RGF0YTogYW55O1xuICAgICAgICAvLyBsZXQgb2xkRGF0YTogYW55O1xuICAgICAgICAvLyBsZXQgbmV3Q29udGVudHM6IHN0cmluZztcblxuICAgICAgICAvLyB0cnkge1xuICAgICAgICAvLyAgIG9sZERhdGEgPSBhd2FpdCB0aGlzLmxvYWRJZkV4aXN0cyhmaWxlUGF0aCk7XG4gICAgICAgIC8vICAgdGhpcy5kZWJ1Z0xvZyhgU1NFOiBZQU1MU3RvcmFnZTogU3RvcmluZyAke2ZpbGVQYXRofTogQWxyZWFkeSBleGlzdGluZyBkYXRhOiAke29sZERhdGF9YCwgJ3NpbGx5Jyk7XG4gICAgICAgIC8vICAgbmV3RGF0YSA9IE9iamVjdC5hc3NpZ24ob2xkRGF0YSwgZGF0YSk7XG4gICAgICAgIC8vICAgdGhpcy5kZWJ1Z0xvZyhgU1NFOiBZQU1MU3RvcmFnZTogU3RvcmluZyAke2ZpbGVQYXRofTogQ29tYmluZWQgZGF0YSB0byB3cml0ZTogJHtuZXdEYXRhfWAsICdzaWxseScpO1xuICAgICAgICAvLyB9IGNhdGNoIChlKSB7XG4gICAgICAgIC8vICAgbG9nLmVycm9yKGBTU0U6IFlBTUxTdG9yYWdlOiBGYWlsZWQgdG8gc3RvcmUgJHtmaWxlUGF0aH1gKTtcbiAgICAgICAgLy8gICBjb25zb2xlLmVycm9yKFwiQmFkIGlucHV0XCIsIGZpbGVQYXRoLCBvbGREYXRhLCBkYXRhKTtcbiAgICAgICAgLy8gICB0aHJvdyBlO1xuICAgICAgICAvLyB9XG5cbiAgICAgICAgLy8gY29uc29sZS5kZWJ1ZyhgRHVtcGluZyBjb250ZW50cyBmb3IgJHtmaWxlUGF0aH0gZnJvbSAke2RhdGF9YCk7XG4gICAgICAgIC8vIGNvbnNvbGUuZGVidWcob2xkRGF0YSk7XG5cbiAgICAgICAgbGV0IG5ld0NvbnRlbnRzOiBzdHJpbmc7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgbmV3Q29udGVudHMgPSB5YW1sLmR1bXAoZGF0YSwge1xuICAgICAgICAgICAgc2NoZW1hOiBTQ0hFTUEsXG4gICAgICAgICAgICBub1JlZnM6IHRydWUsXG4gICAgICAgICAgICBub0NvbXBhdE1vZGU6IHRydWUsXG4gICAgICAgICAgfSk7XG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICBsb2cuZXJyb3IoYFNTRTogWUFNTFN0b3JhZ2U6IEZhaWxlZCB0byBkdW1wICR7ZmlsZVBhdGh9OiAke0pTT04uc3RyaW5naWZ5KGRhdGEpfWApO1xuICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYEZhaWxlZCB0byBzYXZlICR7ZmlsZVBhdGh9IHdpdGggJHtKU09OLnN0cmluZ2lmeShkYXRhKX1gLCBlKTtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICAvLyBjb25zb2xlLmRlYnVnKGBXcml0aW5nIHRvICR7ZmlsZVBhdGh9LCBmaWxlIGV4aXN0czogJHtmaWxlRXhpc3RzfWApO1xuXG4gICAgICAgIC8vIGlmIChmaWxlRXhpc3RzKSB7XG4gICAgICAgIC8vICAgY29uc3Qgb2xkQ29udGVudHM6IHN0cmluZyA9IGF3YWl0IHRoaXMuZnMucmVhZEZpbGUoZmlsZVBhdGgsIHsgZW5jb2Rpbmc6ICd1dGY4JyB9KTtcbiAgICAgICAgLy8gICBjb25zb2xlLmRlYnVnKGBSZXBsYWNpbmcgY29udGVudHMgb2YgJHtmaWxlUGF0aH1gLCBvbGRDb250ZW50cywgbmV3Q29udGVudHMpO1xuICAgICAgICAvLyB9XG5cbiAgICAgICAgdGhpcy5kZWJ1Z0xvZyhgU1NFOiBZQU1MU3RvcmFnZTogU3RvcmluZyAke2ZpbGVQYXRofTogV3JpdGluZyBmaWxlYCk7XG4gICAgICAgIHRoaXMuZGVidWdMb2coYFNTRTogWUFNTFN0b3JhZ2U6IFN0b3JpbmcgJHtmaWxlUGF0aH06IFdyaXRpbmcgZmlsZTogJHtuZXdDb250ZW50c31gLCAnc2lsbHknKTtcbiAgICAgICAgYXdhaXQgdGhpcy5mcy53cml0ZUZpbGUoZmlsZVBhdGgsIG5ld0NvbnRlbnRzLCB7IGVuY29kaW5nOiAndXRmOCcgfSk7XG5cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMuZGVidWdMb2coYFNTRTogWUFNTFN0b3JhZ2U6IFN0b3JpbmcgJHtmaWxlUGF0aH06IEVtcHR5IGRhdGEgZ2l2ZW4sIHJlbW92aW5nIGZpbGVgKTtcbiAgICAgICAgYXdhaXQgdGhpcy5mcy5yZW1vdmUoZmlsZVBhdGgpO1xuXG4gICAgICB9XG4gICAgICB0aGlzLmRlYnVnTG9nKGBTU0U6IFlBTUxTdG9yYWdlOiBGaW5pc2ggd3JpdGluZyAke2ZpbGVQYXRofWApO1xuICAgICAgcmV0dXJuIGRhdGE7XG4gICAgfSk7XG4gIH1cbn1cblxuXG5jb25zdCBTQ0hFTUEgPSBuZXcgeWFtbC5TY2hlbWEoe1xuICBpbmNsdWRlOiBbeWFtbC5ERUZBVUxUX1NBRkVfU0NIRU1BXSxcblxuICAvLyBUcmljayBiZWNhdXNlIGpzLXlhbWwgQVBJIGFwcGVhcnMgdG8gbm90IHN1cHBvcnQgYXVnbWVudGluZyBpbXBsaWNpdCB0YWdzXG4gIGltcGxpY2l0OiBbXG4gICAgLi4uKHlhbWwuREVGQVVMVF9TQUZFX1NDSEVNQSBhcyBhbnkpLmltcGxpY2l0LFxuICAgIC4uLltjdXN0b21UaW1lc3RhbXBUeXBlXSxcbiAgXSxcbn0pO1xuIl19