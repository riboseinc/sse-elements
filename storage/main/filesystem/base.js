import * as fs from 'fs-extra';
import * as path from 'path';
import AsyncLock from 'async-lock';
export class AbstractLockingFilesystemBackend {
    constructor(baseDir) {
        this.baseDir = baseDir;
        this.fileAccessLock = new AsyncLock();
    }
    expandPath(objId) {
        return path.join(this.baseDir, objId);
    }
    makeRelativePath(absPath) {
        if (path.isAbsolute(absPath)) {
            return path.relative(this.baseDir, absPath);
        }
        else {
            throw new Error("Expecting an absolute path, but got relative");
        }
    }
    async isValidId(value) {
        return true;
    }
    async resolveObjectId(filepath) {
        const objId = filepath.split(path.sep)[0];
        if (!objId || !(await this.isValidId(objId))) {
            throw new Error(`Unable to resolve object ID for path ${filepath}`);
        }
        return objId;
    }
    async readAll() {
        const objPaths = await fs.readdir(this.baseDir);
        var objs = [];
        for (const objPath of objPaths) {
            if (await this.isValidId(objPath)) {
                objs.push(await this.read(await this.resolveObjectId(objPath)));
            }
        }
        return objs;
    }
    async exists(objId) {
        return await fs.pathExists(this.expandPath(objId));
    }
    async read(objId) {
        const filePath = this.expandPath(objId);
        return await this.fileAccessLock.acquire(filePath, async () => {
            return this.parseData(await fs.readFile(filePath, { encoding: 'utf8' }));
        });
    }
    async write(objId, newContents) {
        const filePath = this.expandPath(objId);
        return await this.fileAccessLock.acquire(filePath, async () => {
            if (newContents !== undefined) {
                await fs.writeFile(filePath, this.dumpData(newContents), { encoding: 'utf8' });
            }
            else {
                await fs.remove(filePath);
            }
            return [this.makeRelativePath(filePath)];
        });
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9zdG9yYWdlL21haW4vZmlsZXN5c3RlbS9iYXNlLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLE9BQU8sS0FBSyxFQUFFLE1BQU0sVUFBVSxDQUFDO0FBQy9CLE9BQU8sS0FBSyxJQUFJLE1BQU0sTUFBTSxDQUFDO0FBQzdCLE9BQU8sU0FBUyxNQUFNLFlBQVksQ0FBQztBQTBEbkMsTUFBTSxPQUFnQixnQ0FBZ0M7SUFTcEQsWUFBbUIsT0FBZTtRQUFmLFlBQU8sR0FBUCxPQUFPLENBQVE7UUFDaEMsSUFBSSxDQUFDLGNBQWMsR0FBRyxJQUFJLFNBQVMsRUFBRSxDQUFDO0lBQ3hDLENBQUM7SUFFTSxVQUFVLENBQUMsS0FBYTtRQUM3QixPQUFPLElBQUksQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLE9BQU8sRUFBRSxLQUFLLENBQUMsQ0FBQztJQUN4QyxDQUFDO0lBRU0sZ0JBQWdCLENBQUMsT0FBZTtRQUNyQyxJQUFJLElBQUksQ0FBQyxVQUFVLENBQUMsT0FBTyxDQUFDLEVBQUU7WUFDNUIsT0FBTyxJQUFJLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxPQUFPLEVBQUUsT0FBTyxDQUFDLENBQUM7U0FDN0M7YUFBTTtZQUNMLE1BQU0sSUFBSSxLQUFLLENBQUMsOENBQThDLENBQUMsQ0FBQztTQUNqRTtJQUNILENBQUM7SUFFTSxLQUFLLENBQUMsU0FBUyxDQUFDLEtBQWE7UUFDbEMsT0FBTyxJQUFJLENBQUM7SUFDZCxDQUFDO0lBRU0sS0FBSyxDQUFDLGVBQWUsQ0FBQyxRQUFnQjtRQUMzQyxNQUFNLEtBQUssR0FBRyxRQUFRLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUMxQyxJQUFJLENBQUMsS0FBSyxJQUFJLENBQUMsQ0FBQyxNQUFNLElBQUksQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRTtZQUM1QyxNQUFNLElBQUksS0FBSyxDQUFDLHdDQUF3QyxRQUFRLEVBQUUsQ0FBQyxDQUFDO1NBQ3JFO1FBQ0QsT0FBTyxLQUFLLENBQUM7SUFDZixDQUFDO0lBRU0sS0FBSyxDQUFDLE9BQU87UUFDbEIsTUFBTSxRQUFRLEdBQUcsTUFBTSxFQUFFLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQztRQUNoRCxJQUFJLElBQUksR0FBRyxFQUFFLENBQUM7UUFDZCxLQUFLLE1BQU0sT0FBTyxJQUFJLFFBQVEsRUFBRTtZQUM5QixJQUFJLE1BQU0sSUFBSSxDQUFDLFNBQVMsQ0FBQyxPQUFPLENBQUMsRUFBRTtnQkFDakMsSUFBSSxDQUFDLElBQUksQ0FBQyxNQUFNLElBQUksQ0FBQyxJQUFJLENBQUMsTUFBTSxJQUFJLENBQUMsZUFBZSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQzthQUNqRTtTQUNGO1FBQ0QsT0FBTyxJQUFJLENBQUM7SUFDZCxDQUFDO0lBRU0sS0FBSyxDQUFDLE1BQU0sQ0FBQyxLQUFhO1FBQy9CLE9BQU8sTUFBTSxFQUFFLENBQUMsVUFBVSxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQztJQUNyRCxDQUFDO0lBRU0sS0FBSyxDQUFDLElBQUksQ0FBQyxLQUFhO1FBQzdCLE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyxVQUFVLENBQUMsS0FBSyxDQUFDLENBQUM7UUFDeEMsT0FBTyxNQUFNLElBQUksQ0FBQyxjQUFjLENBQUMsT0FBTyxDQUFDLFFBQVEsRUFBRSxLQUFLLElBQUksRUFBRTtZQUM1RCxPQUFPLElBQUksQ0FBQyxTQUFTLENBQUMsTUFBTSxFQUFFLENBQUMsUUFBUSxDQUFDLFFBQVEsRUFBRSxFQUFFLFFBQVEsRUFBRSxNQUFNLEVBQUUsQ0FBQyxDQUFDLENBQUM7UUFDM0UsQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDO0lBRU0sS0FBSyxDQUFDLEtBQUssQ0FBQyxLQUFhLEVBQUUsV0FBMEI7UUFDMUQsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLFVBQVUsQ0FBQyxLQUFLLENBQUMsQ0FBQztRQUN4QyxPQUFPLE1BQU0sSUFBSSxDQUFDLGNBQWMsQ0FBQyxPQUFPLENBQUMsUUFBUSxFQUFFLEtBQUssSUFBSSxFQUFFO1lBQzVELElBQUksV0FBVyxLQUFLLFNBQVMsRUFBRTtnQkFDN0IsTUFBTSxFQUFFLENBQUMsU0FBUyxDQUFDLFFBQVEsRUFBRSxJQUFJLENBQUMsUUFBUSxDQUFDLFdBQVcsQ0FBQyxFQUFFLEVBQUUsUUFBUSxFQUFFLE1BQU0sRUFBRSxDQUFDLENBQUM7YUFDaEY7aUJBQU07Z0JBQ0wsTUFBTSxFQUFFLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxDQUFDO2FBQzNCO1lBQ0QsT0FBTyxDQUFDLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDO1FBQzNDLENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztDQU1GIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgZnMgZnJvbSAnZnMtZXh0cmEnO1xuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCBBc3luY0xvY2sgZnJvbSAnYXN5bmMtbG9jayc7XG5cblxudHlwZSBGaWxlc3lzdGVtUGF0aCA9IHN0cmluZztcblxuXG5leHBvcnQgaW50ZXJmYWNlIEZpbGVzeXN0ZW1CYWNrZW5kPFQ+IHtcbiAgLyogU3BlYyBmb3IgZmlsZXN5c3RlbSBiYWNrZW5kc1xuICAgICB0aGF0IGNhbiBiZSB1c2VkIHdpdGggR2l0IGZpbGVzeXN0ZW0gb2JqZWN0IHN0b3JlLlxuXG4gICAgIEl0IGhhcyBpdHMgb3duIGNvbmNlcHQgb2Yg4oCcb2JqZWN0IElEc+KAnSxcbiAgICAgd2hpY2ggYXJlIHJlZmVyZW5jZXMgdG8gZmlsZXN5c3RlbSBlbnRyaWVzLlxuICAgICBJZiBiYWNrZW5kIG9wZXJhdGVzIG9uIGZpbGVzIG9mIHNpbmdsZSB0eXBlLFxuICAgICBvYmplY3QgSURzIHdvdWxkIHByb2JhYmx5IGV4Y2x1ZGUgZmlsZW5hbWUgZXh0ZW5zaW9uLlxuICAgICBUaGUgU3RvcmUgdXNpbmcgdGhpcyBiYWNrZW5kIHdvdWxkIGNvbnZlcnQgb2JqZWN0IElEcyB0byAqL1xuXG4gIGJhc2VEaXI6IHN0cmluZztcbiAgLyogQWJzb2x1dGUgcGF0aC5cbiAgICAgQmFja2VuZCBpcyBub3QgY29uY2VybmVkIHdpdGggZmlsZXMgb3V0c2lkZSB0aGlzIHBhdGguXG4gICAgIFRPRE86IENvdWxkIGJldHRlciBiZSBtYWRlIHJlYWQtb25seSwgYmVoaW5kIGFjY2Vzc29yIG1ldGhvZC4gKi9cblxuICByZWFkKG9iaklkOiBzdHJpbmcpOiBQcm9taXNlPFQ+O1xuXG4gIHJlYWRBbGwoKTogUHJvbWlzZTxUW10+O1xuICAvKiBTY2FuIGZpbGVzeXN0ZW0gYW5kIHJldHVybnMgYWxsIHRoZSBvYmplY3RzIGZvdW5kLiAqL1xuXG4gIHdyaXRlKG9iaklkOiBzdHJpbmcsIG5ld0RhdGE6IFQgfCB1bmRlZmluZWQpOiBQcm9taXNlPEZpbGVzeXN0ZW1QYXRoW10+O1xuICAvKiBVcGRhdGVzIGdpdmVuIG9iamVjdCBhbmQgcmV0dXJucyBhIGxpc3Qgb2YgZmlsZXN5c3RlbSBwYXRocyB0aGF0IGNvdWxkIGJlIGFmZmVjdGVkLlxuICAgICBJZiBgbmV3RGF0YWAgaXMgdW5kZWZpbmVkLCB0aGUgb2JqZWN0IGlzIGV4cGVjdGVkIHRvIGJlIGRlbGV0ZWQuICovXG5cblxuICAvLyBUT0RPOiBGb2xsb3dpbmcgdHdvIGNhbiBiZSByZW5hbWVkIGZvciBjbGFyaXR5LlxuXG4gIGV4cGFuZFBhdGgob2JqSWQ6IHN0cmluZyk6IHN0cmluZztcbiAgLyogUmV0dXJucyBhbiBhYnNvbHV0ZSBwYXRoIHRvIG9iamVjdCBmaWxlIG9yIHJvb3QgZGlyZWN0b3J5LFxuICAgICBnaXZlbiBvYmplY3QgSUQuIEFkZHMgYW4gZXh0ZW5zaW9uIHdoZXJlIGFwcGxpY2FibGUuXG4gICAgIFVzZWQgYnkgcmVhZCgpLCB3cml0ZSgpIHVuZGVyIHRoZSBob29kLiBUT0RPOiBTaG91bGQgYmUgbWFkZSBwcml2YXRlPyAqL1xuXG4gIHJlc29sdmVPYmplY3RJZChwYXRoOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZz47XG4gIC8qIEdpdmVuIHBhdGgsIHJldHVybnMgb2JqZWN04oCZcyBGUyBiYWNrZW5kIElELiAqL1xuXG4gIGV4aXN0cyhvYmpJZDogc3RyaW5nKTogUHJvbWlzZTxib29sZWFuPjtcbiAgLyogR2l2ZW4gb2JqZWN0IElELCByZXR1cm5zIHRydWUgaWYgdGhlIG9iamVjdCBhY3R1YWxseSBleGlzdHMuXG4gICAgIFVzZWQgd2hlbiBzdG9yaW5nIGUuZy4gdG8gYXZvaWQgb3ZlcndyaXRpbmcgYW4gZXhpc3Rpbmcgb2JqZWN0LiAqL1xuXG4gIGlzVmFsaWRJZChmaWxlcGF0aDogc3RyaW5nKTogUHJvbWlzZTxib29sZWFuPjtcbiAgLyogR2l2ZW4gYSBwYXRoLCByZXR1cm5zIHRydWUgaWYgaXQgbG9va3MgbGlrZSBhIHZhbGlkIG9iamVjdCBJRC5cblxuICAgICBUaGlzIGlzIGludGVuZGVkIHRvIGJlIHVzZWQgZm9yIHdlZWRpbmcgb3V0IHJhbmRvbSBmaWxlc1xuICAgICB0aGF0IGFyZSBub3QgcGFydCBvZiB0aGUgZGF0YWJhc2UsIGUuZy4gc3lzdGVtIGZpbGVzL2RpcmVjdG9yaWVzLFxuICAgICB3aGVuIGxvYWRpbmcgb2JqZWN0cyBmcm9tIGZpbGVzeXN0ZW0uXG5cbiAgICAgVGhpcyBjYW4gYmUgYXMgc2ltcGxlIGFzIGNvbXBhcmluZyB0aGUgZXh0ZW5zaW9uXG4gICAgIGJ1dCBpZiBuZWNlc3NhcnkgY2FuIGRvIGZ1cnRoZXIgY2hlY2tzIG9uIGZpbGUvZGlyZWN0b3J5IGNvbnRlbnRzLiAqL1xuXG59XG5cblxuZXhwb3J0IGFic3RyYWN0IGNsYXNzIEFic3RyYWN0TG9ja2luZ0ZpbGVzeXN0ZW1CYWNrZW5kPFQ+IGltcGxlbWVudHMgRmlsZXN5c3RlbUJhY2tlbmQ8VD4ge1xuICAvKiBCYXNpYyBmaWxlc3lzdGVtIGJhY2tlbmQgYXJvdW5kIE5vZGUuanMgZnMtZXh0cmEsXG4gICAgIHByb3ZpZGluZyBzdHViIG1ldGhvZHMgZm9yIHBhcnNpbmcvZHVtcGluZyBkYXRhIGZyb20vdG8gcmF3IHN0cmluZyBmaWxlIGNvbnRlbnRzXG4gICAgIGFuZCBpbXBsZW1lbnRpbmcgbG9ja2luZyBhcm91bmQgZmlsZSByZWFkcy93cml0ZXNcbiAgICAgKGxvY2tzIGJhc2VkIG9uIGZpbGUgcGF0aCwgc28gdGhhdCBpdCBjYW5ub3QgYmUgd3JpdHRlbiB0byB3aGlsZSBpdOKAmXMgYmVpbmcgcmVhZCBmcm9tL3dyaXR0ZW4gdG8pLlxuICAqL1xuXG4gIHByaXZhdGUgZmlsZUFjY2Vzc0xvY2s6IEFzeW5jTG9jaztcblxuICBjb25zdHJ1Y3RvcihwdWJsaWMgYmFzZURpcjogc3RyaW5nKSB7XG4gICAgdGhpcy5maWxlQWNjZXNzTG9jayA9IG5ldyBBc3luY0xvY2soKTtcbiAgfVxuXG4gIHB1YmxpYyBleHBhbmRQYXRoKG9iaklkOiBzdHJpbmcpIHtcbiAgICByZXR1cm4gcGF0aC5qb2luKHRoaXMuYmFzZURpciwgb2JqSWQpO1xuICB9XG5cbiAgcHVibGljIG1ha2VSZWxhdGl2ZVBhdGgoYWJzUGF0aDogc3RyaW5nKSB7XG4gICAgaWYgKHBhdGguaXNBYnNvbHV0ZShhYnNQYXRoKSkge1xuICAgICAgcmV0dXJuIHBhdGgucmVsYXRpdmUodGhpcy5iYXNlRGlyLCBhYnNQYXRoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiRXhwZWN0aW5nIGFuIGFic29sdXRlIHBhdGgsIGJ1dCBnb3QgcmVsYXRpdmVcIik7XG4gICAgfVxuICB9XG5cbiAgcHVibGljIGFzeW5jIGlzVmFsaWRJZCh2YWx1ZTogc3RyaW5nKSB7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICBwdWJsaWMgYXN5bmMgcmVzb2x2ZU9iamVjdElkKGZpbGVwYXRoOiBzdHJpbmcpIHtcbiAgICBjb25zdCBvYmpJZCA9IGZpbGVwYXRoLnNwbGl0KHBhdGguc2VwKVswXTtcbiAgICBpZiAoIW9iaklkIHx8ICEoYXdhaXQgdGhpcy5pc1ZhbGlkSWQob2JqSWQpKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmFibGUgdG8gcmVzb2x2ZSBvYmplY3QgSUQgZm9yIHBhdGggJHtmaWxlcGF0aH1gKTtcbiAgICB9XG4gICAgcmV0dXJuIG9iaklkO1xuICB9XG5cbiAgcHVibGljIGFzeW5jIHJlYWRBbGwoKSB7XG4gICAgY29uc3Qgb2JqUGF0aHMgPSBhd2FpdCBmcy5yZWFkZGlyKHRoaXMuYmFzZURpcik7XG4gICAgdmFyIG9ianMgPSBbXTtcbiAgICBmb3IgKGNvbnN0IG9ialBhdGggb2Ygb2JqUGF0aHMpIHtcbiAgICAgIGlmIChhd2FpdCB0aGlzLmlzVmFsaWRJZChvYmpQYXRoKSkge1xuICAgICAgICBvYmpzLnB1c2goYXdhaXQgdGhpcy5yZWFkKGF3YWl0IHRoaXMucmVzb2x2ZU9iamVjdElkKG9ialBhdGgpKSk7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBvYmpzO1xuICB9XG5cbiAgcHVibGljIGFzeW5jIGV4aXN0cyhvYmpJZDogc3RyaW5nKSB7XG4gICAgcmV0dXJuIGF3YWl0IGZzLnBhdGhFeGlzdHModGhpcy5leHBhbmRQYXRoKG9iaklkKSk7XG4gIH1cblxuICBwdWJsaWMgYXN5bmMgcmVhZChvYmpJZDogc3RyaW5nKSB7XG4gICAgY29uc3QgZmlsZVBhdGggPSB0aGlzLmV4cGFuZFBhdGgob2JqSWQpO1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmZpbGVBY2Nlc3NMb2NrLmFjcXVpcmUoZmlsZVBhdGgsIGFzeW5jICgpID0+IHtcbiAgICAgIHJldHVybiB0aGlzLnBhcnNlRGF0YShhd2FpdCBmcy5yZWFkRmlsZShmaWxlUGF0aCwgeyBlbmNvZGluZzogJ3V0ZjgnIH0pKTtcbiAgICB9KTtcbiAgfVxuXG4gIHB1YmxpYyBhc3luYyB3cml0ZShvYmpJZDogc3RyaW5nLCBuZXdDb250ZW50czogVCB8IHVuZGVmaW5lZCkge1xuICAgIGNvbnN0IGZpbGVQYXRoID0gdGhpcy5leHBhbmRQYXRoKG9iaklkKTtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5maWxlQWNjZXNzTG9jay5hY3F1aXJlKGZpbGVQYXRoLCBhc3luYyAoKSA9PiB7XG4gICAgICBpZiAobmV3Q29udGVudHMgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBhd2FpdCBmcy53cml0ZUZpbGUoZmlsZVBhdGgsIHRoaXMuZHVtcERhdGEobmV3Q29udGVudHMpLCB7IGVuY29kaW5nOiAndXRmOCcgfSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBhd2FpdCBmcy5yZW1vdmUoZmlsZVBhdGgpO1xuICAgICAgfVxuICAgICAgcmV0dXJuIFt0aGlzLm1ha2VSZWxhdGl2ZVBhdGgoZmlsZVBhdGgpXTtcbiAgICB9KTtcbiAgfVxuXG4gIHByb3RlY3RlZCBhYnN0cmFjdCBwYXJzZURhdGEoY29udGVudHM6IHN0cmluZyk6IFRcblxuICBwcm90ZWN0ZWQgYWJzdHJhY3QgZHVtcERhdGEoZGF0YTogVCk6IHN0cmluZ1xuXG59XG4iXX0=