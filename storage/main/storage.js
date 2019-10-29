import * as path from 'path';
import { makeEndpoint } from 'api/main';
import { YAMLStorage } from './yaml';
const YAML_EXT = '.yaml';
export class StoreManager {
    constructor(rootDir) {
        this.rootDir = rootDir;
        this._index = undefined;
    }
    async storeIndex(storage, newIdx) {
        const idx = newIdx || await this.getIndex(storage);
        const items = Object.values(idx);
        for (const obj of items) {
            await this.store(obj, storage);
        }
        this._index = idx;
        return true;
    }
    async getIndex(storage) {
        if (this._index === undefined) {
            this._index = await this._loadIndex(storage);
        }
        return this._index;
    }
    async findObjects(storage, query) {
        const index = await this.getIndex(storage);
        if (query !== undefined) {
            var results = {};
            for (let key of Object.keys(index)) {
                const obj = index[key];
                if (this.objectMatchesQuery(obj, query)) {
                    results[key] = obj;
                }
            }
            return results;
        }
        else {
            return index;
        }
    }
    async _loadIndex(storage) {
        const rootPath = this.rootDir;
        const dirs = await storage.fs.readdir(path.join(storage.workDir, rootPath));
        var idx = {};
        for (const dir of dirs) {
            if (dir != '.DS_Store') {
                const objData = await storage.loadObject(path.join(rootPath, dir));
                if (objData) {
                    const obj = this.postLoad(objData);
                    if (obj.id) {
                        idx[obj.id] = obj;
                    }
                }
            }
        }
        return idx;
    }
    // TODO: Use `toUseableObject(data: any) => O` to post-process loaded data
    // Stores object in DB
    async store(obj, storage) {
        const objDir = path.join(this.rootDir, `${obj.id}`);
        const objPath = path.join(storage.workDir, objDir);
        const storeable = this.toStoreableObject(obj);
        const idx = await this.getIndex(storage);
        await storage.fs.ensureDir(objPath);
        for (const key of Object.keys(storeable)) {
            const data = storeable[key];
            await storage.yaml.store(path.join(objPath, `${key}.yaml`), data);
        }
        idx[obj.id] = obj;
        this._index = idx;
        return true;
    }
    toStoreableObject(obj) {
        return { meta: obj };
    }
    ;
    // Converts object data into valid object, if needed
    // (in cases when partial data is stored or migration took place previously)
    postLoad(obj) {
        return obj;
    }
    objectMatchesQuery(obj, query) {
        return false;
    }
}
export class Storage {
    constructor(fs, workDir, storeManagers) {
        this.fs = fs;
        this.workDir = workDir;
        this.storeManagers = storeManagers;
        this.fs = fs;
        this.workDir = workDir;
        this.yaml = new YAMLStorage(fs);
        this.workspace = Object.keys(storeManagers).reduce((obj, key) => {
            obj[key] = {};
            return obj;
        }, {});
    }
    async loadWorkspace() {
        this.workspace = await Object.keys(this.storeManagers).reduce(async (objP, key) => {
            const obj = await objP;
            obj[key] = await this.storeManagers[key].getIndex(this);
            return obj;
        }, Promise.resolve({}));
    }
    async storeWorkspace() {
        return Promise.all([...Object.keys(this.storeManagers).map(async (key) => {
                return await this.storeManagers[key].storeIndex(this, this.workspace[key]);
            })]).then(() => true);
    }
    // Loads object data from given directory, reading YAML files.
    // meta.yaml is treated specially, populating top-level object payload.
    // Other YAML files populate corresponding object properties.
    async loadObject(objDir) {
        let objData;
        const metaFile = path.join(this.workDir, objDir, 'meta.yaml');
        let metaFileIsFile;
        try {
            metaFileIsFile = (await this.fs.stat(metaFile)).isFile();
        }
        catch (e) {
            return undefined;
        }
        if (!metaFileIsFile) {
            return undefined;
        }
        objData = await this.yaml.load(metaFile);
        const dirContents = await this.fs.readdir(path.join(this.workDir, objDir));
        for (const item of dirContents) {
            if (path.extname(item) == YAML_EXT) {
                const basename = path.basename(item, YAML_EXT);
                if (basename != 'meta') {
                    objData[basename] = await this.yaml.load(path.join(this.workDir, objDir, item));
                }
            }
        }
        // Blindly hope that data structure loaded from YAML
        // is valid for given type.
        return objData;
    }
    setUpAPIEndpoints(notifier) {
        for (let indexName of Object.keys(this.workspace)) {
            makeEndpoint(`storage-${indexName}-all`, async () => {
                return this.workspace[indexName];
            }, async ({ newData, notify }) => {
                await this.storeManagers[indexName].storeIndex(this, newData);
                notifier([indexName, ...(notify || [])]);
            });
            makeEndpoint(`storage-${indexName}`, async ({ objectId }) => {
                return this.workspace[indexName][objectId];
            }, async ({ newData, notify }) => {
                await this.storeManagers[indexName].store(newData, this);
                notifier([indexName, ...(notify || [])]);
            });
            makeEndpoint(`storage-${indexName}-delete`, async ({ objectId }) => {
                delete this.workspace[indexName][objectId];
                await this.storeManagers[indexName].storeIndex(this, this.workspace[indexName]);
                return true;
            });
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3RvcmFnZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9zdG9yYWdlL21haW4vc3RvcmFnZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxPQUFPLEtBQUssSUFBSSxNQUFNLE1BQU0sQ0FBQztBQUU3QixPQUFPLEVBQUUsWUFBWSxFQUFFLE1BQU0sVUFBVSxDQUFDO0FBS3hDLE9BQU8sRUFBRSxXQUFXLEVBQUUsTUFBTSxRQUFRLENBQUM7QUFHckMsTUFBTSxRQUFRLEdBQUcsT0FBTyxDQUFDO0FBR3pCLE1BQU0sT0FBZ0IsWUFBWTtJQUdoQyxZQUFtQixPQUFlO1FBQWYsWUFBTyxHQUFQLE9BQU8sQ0FBUTtRQUYxQixXQUFNLEdBQXlCLFNBQVMsQ0FBQztJQUVaLENBQUM7SUFFL0IsS0FBSyxDQUFDLFVBQVUsQ0FBQyxPQUFxQixFQUFFLE1BQTRCO1FBQ3pFLE1BQU0sR0FBRyxHQUFhLE1BQU0sSUFBSSxNQUFNLElBQUksQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLENBQUM7UUFDN0QsTUFBTSxLQUFLLEdBQVEsTUFBTSxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQztRQUV0QyxLQUFLLE1BQU0sR0FBRyxJQUFJLEtBQUssRUFBRTtZQUN2QixNQUFNLElBQUksQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLE9BQU8sQ0FBQyxDQUFDO1NBQ2hDO1FBRUQsSUFBSSxDQUFDLE1BQU0sR0FBRyxHQUFHLENBQUM7UUFDbEIsT0FBTyxJQUFJLENBQUM7SUFDZCxDQUFDO0lBRU0sS0FBSyxDQUFDLFFBQVEsQ0FBQyxPQUFxQjtRQUN6QyxJQUFJLElBQUksQ0FBQyxNQUFNLEtBQUssU0FBUyxFQUFFO1lBQzdCLElBQUksQ0FBQyxNQUFNLEdBQUcsTUFBTSxJQUFJLENBQUMsVUFBVSxDQUFDLE9BQU8sQ0FBQyxDQUFDO1NBQzlDO1FBQ0QsT0FBTyxJQUFJLENBQUMsTUFBTSxDQUFDO0lBQ3JCLENBQUM7SUFFTSxLQUFL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LENBQUMsQ0FBQztnQkFDOUQsUUFBUSxDQUFDLENBQUMsU0FBUyxFQUFFLEdBQUcsQ0FBQyxNQUFNLElBQUksRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQzNDLENBQUMsQ0FBQyxDQUFDO1lBRUgsWUFBWSxDQUFrQixXQUFXLFNBQVMsRUFBRSxFQUFFLEtBQUssRUFBRSxFQUFFLFFBQVEsRUFBd0IsRUFBRSxFQUFFO2dCQUNqRyxPQUFPLElBQUksQ0FBQyxTQUFTLENBQUMsU0FBUyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUM7WUFDN0MsQ0FBQyxFQUFFLEtBQUssRUFBRSxFQUFFLE9BQU8sRUFBRSxNQUFNLEVBQUUsRUFBRSxFQUFFO2dCQUMvQixNQUFNLElBQUksQ0FBQyxhQUFhLENBQUMsU0FBUyxDQUFDLENBQUMsS0FBSyxDQUFDLE9BQU8sRUFBRSxJQUFJLENBQUMsQ0FBQztnQkFDekQsUUFBUSxDQUFDLENBQUMsU0FBUyxFQUFFLEdBQUcsQ0FBQyxNQUFNLElBQUksRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQzNDLENBQUMsQ0FBQyxDQUFDO1lBRUgsWUFBWSxDQUFVLFdBQVcsU0FBUyxTQUFTLEVBQUUsS0FBSyxFQUFFLEVBQUUsUUFBUSxFQUF3QixFQUFFLEVBQUU7Z0JBQ2hHLE9BQU8sSUFBSSxDQUFDLFNBQVMsQ0FBQyxTQUFTLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQztnQkFDM0MsTUFBTSxJQUFJLENBQUMsYUFBYSxDQUFDLFNBQVMsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDO2dCQUNoRixPQUFPLElBQUksQ0FBQztZQUNkLENBQUMsQ0FBQyxDQUFDO1NBRUo7SUFDSCxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xuXG5pbXBvcnQgeyBtYWtlRW5kcG9pbnQgfSBmcm9tICdhcGkvbWFpbic7XG5cbmltcG9ydCB7IEluZGV4LCBJbmRleGFibGVPYmplY3QgfSBmcm9tICcuLi9xdWVyeSc7XG5pbXBvcnQgeyBXb3Jrc3BhY2UgfSBmcm9tICcuLi93b3Jrc3BhY2UnO1xuXG5pbXBvcnQgeyBZQU1MU3RvcmFnZSB9IGZyb20gJy4veWFtbCc7XG5cblxuY29uc3QgWUFNTF9FWFQgPSAnLnlhbWwnO1xuXG5cbmV4cG9ydCBhYnN0cmFjdCBjbGFzcyBTdG9yZU1hbmFnZXI8TyBleHRlbmRzIEluZGV4YWJsZU9iamVjdD4ge1xuICBwcml2YXRlIF9pbmRleDogSW5kZXg8Tz4gfCB1bmRlZmluZWQgPSB1bmRlZmluZWQ7XG5cbiAgY29uc3RydWN0b3IocHVibGljIHJvb3REaXI6IHN0cmluZykge31cblxuICBwdWJsaWMgYXN5bmMgc3RvcmVJbmRleChzdG9yYWdlOiBTdG9yYWdlPGFueT4sIG5ld0lkeDogSW5kZXg8Tz4gfCB1bmRlZmluZWQpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICBjb25zdCBpZHg6IEluZGV4PE8+ID0gbmV3SWR4IHx8IGF3YWl0IHRoaXMuZ2V0SW5kZXgoc3RvcmFnZSk7XG4gICAgY29uc3QgaXRlbXM6IE9bXSA9IE9iamVjdC52YWx1ZXMoaWR4KTtcblxuICAgIGZvciAoY29uc3Qgb2JqIG9mIGl0ZW1zKSB7XG4gICAgICBhd2FpdCB0aGlzLnN0b3JlKG9iaiwgc3RvcmFnZSk7XG4gICAgfVxuXG4gICAgdGhpcy5faW5kZXggPSBpZHg7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICBwdWJsaWMgYXN5bmMgZ2V0SW5kZXgoc3RvcmFnZTogU3RvcmFnZTxhbnk+KTogUHJvbWlzZTxJbmRleDxPPj4ge1xuICAgIGlmICh0aGlzLl9pbmRleCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aGlzLl9pbmRleCA9IGF3YWl0IHRoaXMuX2xvYWRJbmRleChzdG9yYWdlKTtcbiAgICB9XG4gICAgcmV0dXJuIHRoaXMuX2luZGV4O1xuICB9XG5cbiAgcHVibGljIGFzeW5jIGZpbmRPYmplY3RzKHN0b3JhZ2U6IFN0b3JhZ2U8YW55PiwgcXVlcnk/OiBzdHJpbmcpOiBQcm9taXNlPEluZGV4PE8+PiB7XG4gICAgY29uc3QgaW5kZXggPSBhd2FpdCB0aGlzLmdldEluZGV4KHN0b3JhZ2UpO1xuICAgIGlmIChxdWVyeSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB2YXIgcmVzdWx0czogSW5kZXg8Tz4gPSB7fTtcbiAgICAgIGZvciAobGV0IGtleSBvZiBPYmplY3Qua2V5cyhpbmRleCkpIHtcbiAgICAgICAgY29uc3Qgb2JqID0gaW5kZXhba2V5XVxuICAgICAgICBpZiAodGhpcy5vYmplY3RNYXRjaGVzUXVlcnkob2JqLCBxdWVyeSkpIHtcbiAgICAgICAgICByZXN1bHRzW2tleV0gPSBvYmo7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHJldHVybiByZXN1bHRzO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gaW5kZXg7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBfbG9hZEluZGV4KHN0b3JhZ2U6IFN0b3JhZ2U8YW55Pik6IFByb21pc2U8SW5kZXg8Tz4+IHtcbiAgICBjb25zdCByb290UGF0aCA9IHRoaXMucm9vdERpcjtcbiAgICBjb25zdCBkaXJzID0gYXdhaXQgc3RvcmFnZS5mcy5yZWFkZGlyKHBhdGguam9pbihzdG9yYWdlLndvcmtEaXIsIHJvb3RQYXRoKSk7XG4gICAgdmFyIGlkeDogSW5kZXg8Tz4gPSB7fTtcblxuICAgIGZvciAoY29uc3QgZGlyIG9mIGRpcnMpIHtcbiAgICAgIGlmIChkaXIgIT0gJy5EU19TdG9yZScpIHtcbiAgICAgICAgY29uc3Qgb2JqRGF0YSA9IGF3YWl0IHN0b3JhZ2UubG9hZE9iamVjdChwYXRoLmpvaW4ocm9vdFBhdGgsIGRpcikpO1xuICAgICAgICBpZiAob2JqRGF0YSkge1xuICAgICAgICAgIGNvbnN0IG9iajogTyA9IHRoaXMucG9zdExvYWQob2JqRGF0YSk7XG4gICAgICAgICAgaWYgKG9iai5pZCkge1xuICAgICAgICAgICAgaWR4W29iai5pZF0gPSBvYmo7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBpZHg7XG4gIH1cblxuICAvLyBUT0RPOiBVc2UgYHRvVXNlYWJsZU9iamVjdChkYXRhOiBhbnkpID0+IE9gIHRvIHBvc3QtcHJvY2VzcyBsb2FkZWQgZGF0YVxuXG4gIC8vIFN0b3JlcyBvYmplY3QgaW4gREJcbiAgcHVibGljIGFzeW5jIHN0b3JlKG9iajogTywgc3RvcmFnZTogU3RvcmFnZTxhbnk+KTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgY29uc3Qgb2JqRGlyID0gcGF0aC5qb2luKHRoaXMucm9vdERpciwgYCR7b2JqLmlkfWApO1xuICAgIGNvbnN0IG9ialBhdGggPSBwYXRoLmpvaW4oc3RvcmFnZS53b3JrRGlyLCBvYmpEaXIpO1xuICAgIGNvbnN0IHN0b3JlYWJsZSA9IHRoaXMudG9TdG9yZWFibGVPYmplY3Qob2JqKTtcbiAgICBjb25zdCBpZHggPSBhd2FpdCB0aGlzLmdldEluZGV4KHN0b3JhZ2UpO1xuXG4gICAgYXdhaXQgc3RvcmFnZS5mcy5lbnN1cmVEaXIob2JqUGF0aCk7XG4gICAgZm9yIChjb25zdCBrZXkgb2YgT2JqZWN0LmtleXMoc3RvcmVhYmxlKSkge1xuICAgICAgY29uc3QgZGF0YSA9IHN0b3JlYWJsZVtrZXldO1xuICAgICAgYXdhaXQgc3RvcmFnZS55YW1sLnN0b3JlKHBhdGguam9pbihvYmpQYXRoLCBgJHtrZXl9LnlhbWxgKSwgZGF0YSk7XG4gICAgfVxuXG4gICAgaWR4W29iai5pZF0gPSBvYmo7XG4gICAgdGhpcy5faW5kZXggPSBpZHg7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICBwdWJsaWMgdG9TdG9yZWFibGVPYmplY3Qob2JqOiBPKTogYW55IHtcbiAgICByZXR1cm4geyBtZXRhOiBvYmogYXMgYW55IH07XG4gIH07XG5cbiAgLy8gQ29udmVydHMgb2JqZWN0IGRhdGEgaW50byB2YWxpZCBvYmplY3QsIGlmIG5lZWRlZFxuICAvLyAoaW4gY2FzZXMgd2hlbiBwYXJ0aWFsIGRhdGEgaXMgc3RvcmVkIG9yIG1pZ3JhdGlvbiB0b29rIHBsYWNlIHByZXZpb3VzbHkpXG4gIHB1YmxpYyBwb3N0TG9hZChvYmo6IGFueSk6IE8ge1xuICAgIHJldHVybiBvYmogYXMgTztcbiAgfVxuXG4gIHB1YmxpYyBvYmplY3RNYXRjaGVzUXVlcnkob2JqOiBPLCBxdWVyeTogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG5cblxuZXhwb3J0IGFic3RyYWN0IGNsYXNzIFN0b3JhZ2U8VyBleHRlbmRzIFdvcmtzcGFjZT4ge1xuICBwdWJsaWMgeWFtbDogWUFNTFN0b3JhZ2U7XG4gIHB1YmxpYyB3b3Jrc3BhY2U6IFc7XG5cbiAgY29uc3RydWN0b3IocHVibGljIGZzOiB0eXBlb2YgaW1wb3J0KCdmcy1leHRyYScpLCBwdWJsaWMgd29ya0Rpcjogc3RyaW5nLFxuICAgICAgcHVibGljIHN0b3JlTWFuYWdlcnM6IHsgW2tleTogc3RyaW5nXTogU3RvcmVNYW5hZ2VyPGFueT4gfSkge1xuICAgIHRoaXMuZnMgPSBmcztcbiAgICB0aGlzLndvcmtEaXIgPSB3b3JrRGlyO1xuICAgIHRoaXMueWFtbCA9IG5ldyBZQU1MU3RvcmFnZShmcyk7XG5cbiAgICB0aGlzLndvcmtzcGFjZSA9IE9iamVjdC5rZXlzKHN0b3JlTWFuYWdlcnMpLnJlZHVjZSgob2JqOiBhbnksIGtleTogc3RyaW5nKSA9PiB7XG4gICAgICBvYmpba2V5XSA9IHt9O1xuICAgICAgcmV0dXJuIG9iajtcbiAgICB9LCB7fSkgYXMgVztcbiAgfVxuXG4gIHB1YmxpYyBhYnN0cmFjdCBhc3luYyBmaW5kT2JqZWN0cyhxdWVyeT86IHN0cmluZyk6IFByb21pc2U8Vz5cblxuICBwdWJsaWMgYXN5bmMgbG9hZFdvcmtzcGFjZSgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLndvcmtzcGFjZSA9IGF3YWl0IE9iamVjdC5rZXlzKHRoaXMuc3RvcmVNYW5hZ2VycykucmVkdWNlKGFzeW5jIChvYmpQOiBQcm9taXNlPGFueT4sIGtleTogc3RyaW5nKSA9PiB7XG4gICAgICBjb25zdCBvYmogPSBhd2FpdCBvYmpQO1xuICAgICAgb2JqW2tleV0gPSBhd2FpdCB0aGlzLnN0b3JlTWFuYWdlcnNba2V5XS5nZXRJbmRleCh0aGlzKTtcbiAgICAgIHJldHVybiBvYmo7XG4gICAgfSwgUHJvbWlzZS5yZXNvbHZlKHt9KSkgYXMgVztcbiAgfVxuXG4gIGFzeW5jIHN0b3JlV29ya3NwYWNlKCk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIHJldHVybiBQcm9taXNlLmFsbChbLi4uT2JqZWN0LmtleXModGhpcy5zdG9yZU1hbmFnZXJzKS5tYXAoYXN5bmMgKGtleSkgPT4ge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuc3RvcmVNYW5hZ2Vyc1trZXldLnN0b3JlSW5kZXgodGhpcywgdGhpcy53b3Jrc3BhY2Vba2V5XSk7XG4gICAgfSldKS50aGVuKCgpID0+IHRydWUpO1xuICB9XG5cbiAgLy8gTG9hZHMgb2JqZWN0IGRhdGEgZnJvbSBnaXZlbiBkaXJlY3RvcnksIHJlYWRpbmcgWUFNTCBmaWxlcy5cbiAgLy8gbWV0YS55YW1sIGlzIHRyZWF0ZWQgc3BlY2lhbGx5LCBwb3B1bGF0aW5nIHRvcC1sZXZlbCBvYmplY3QgcGF5bG9hZC5cbiAgLy8gT3RoZXIgWUFNTCBmaWxlcyBwb3B1bGF0ZSBjb3JyZXNwb25kaW5nIG9iamVjdCBwcm9wZXJ0aWVzLlxuICBwdWJsaWMgYXN5bmMgbG9hZE9iamVjdChvYmpEaXI6IHN0cmluZyk6IFByb21pc2U8YW55IHwgdW5kZWZpbmVkPiB7XG4gICAgbGV0IG9iakRhdGE6IHtbcHJvcE5hbWU6IHN0cmluZ106IGFueX07XG5cbiAgICBjb25zdCBtZXRhRmlsZSA9IHBhdGguam9pbih0aGlzLndvcmtEaXIsIG9iakRpciwgJ21ldGEueWFtbCcpO1xuICAgIGxldCBtZXRhRmlsZUlzRmlsZTogYm9vbGVhbjtcbiAgICB0cnkge1xuICAgICAgbWV0YUZpbGVJc0ZpbGUgPSAoYXdhaXQgdGhpcy5mcy5zdGF0KG1ldGFGaWxlKSkuaXNGaWxlKCk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG4gICAgaWYgKCFtZXRhRmlsZUlzRmlsZSkge1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG4gICAgb2JqRGF0YSA9IGF3YWl0IHRoaXMueWFtbC5sb2FkKG1ldGFGaWxlKTtcblxuICAgIGNvbnN0IGRpckNvbnRlbnRzID0gYXdhaXQgdGhpcy5mcy5yZWFkZGlyKHBhdGguam9pbih0aGlzLndvcmtEaXIsIG9iakRpcikpO1xuICAgIGZvciAoY29uc3QgaXRlbSBvZiBkaXJDb250ZW50cykge1xuICAgICAgaWYgKHBhdGguZXh0bmFtZShpdGVtKSA9PSBZQU1MX0VYVCkge1xuICAgICAgICBjb25zdCBiYXNlbmFtZSA9IHBhdGguYmFzZW5hbWUoaXRlbSwgWUFNTF9FWFQpO1xuICAgICAgICBpZiAoYmFzZW5hbWUgIT0gJ21ldGEnKSB7XG4gICAgICAgICAgb2JqRGF0YVtiYXNlbmFtZV0gPSBhd2FpdCB0aGlzLnlhbWwubG9hZChwYXRoLmpvaW4odGhpcy53b3JrRGlyLCBvYmpEaXIsIGl0ZW0pKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIC8vIEJsaW5kbHkgaG9wZSB0aGF0IGRhdGEgc3RydWN0dXJlIGxvYWRlZCBmcm9tIFlBTUxcbiAgICAvLyBpcyB2YWxpZCBmb3IgZ2l2ZW4gdHlwZS5cbiAgICByZXR1cm4gb2JqRGF0YTtcbiAgfVxuXG4gIHNldFVwQVBJRW5kcG9pbnRzKG5vdGlmaWVyOiAobm90aWZ5OiBzdHJpbmdbXSkgPT4gdm9pZCkge1xuICAgIGZvciAobGV0IGluZGV4TmFtZSBvZiBPYmplY3Qua2V5cyh0aGlzLndvcmtzcGFjZSkpIHtcblxuICAgICAgbWFrZUVuZHBvaW50PEluZGV4PGFueT4+KGBzdG9yYWdlLSR7aW5kZXhOYW1lfS1hbGxgLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIHJldHVybiB0aGlzLndvcmtzcGFjZVtpbmRleE5hbWVdO1xuICAgICAgfSwgYXN5bmMgKHsgbmV3RGF0YSwgbm90aWZ5IH0pID0+IHtcbiAgICAgICAgYXdhaXQgdGhpcy5zdG9yZU1hbmFnZXJzW2luZGV4TmFtZV0uc3RvcmVJbmRleCh0aGlzLCBuZXdEYXRhKTtcbiAgICAgICAgbm90aWZpZXIoW2luZGV4TmFtZSwgLi4uKG5vdGlmeSB8fCBbXSldKTtcbiAgICAgIH0pO1xuXG4gICAgICBtYWtlRW5kcG9pbnQ8SW5kZXhhYmxlT2JqZWN0Pihgc3RvcmFnZS0ke2luZGV4TmFtZX1gLCBhc3luYyAoeyBvYmplY3RJZCB9OiB7IG9iamVjdElkOiBzdHJpbmcgfSkgPT4ge1xuICAgICAgICByZXR1cm4gdGhpcy53b3Jrc3BhY2VbaW5kZXhOYW1lXVtvYmplY3RJZF07XG4gICAgICB9LCBhc3luYyAoeyBuZXdEYXRhLCBub3RpZnkgfSkgPT4ge1xuICAgICAgICBhd2FpdCB0aGlzLnN0b3JlTWFuYWdlcnNbaW5kZXhOYW1lXS5zdG9yZShuZXdEYXRhLCB0aGlzKTtcbiAgICAgICAgbm90aWZpZXIoW2luZGV4TmFtZSwgLi4uKG5vdGlmeSB8fCBbXSldKTtcbiAgICAgIH0pO1xuXG4gICAgICBtYWtlRW5kcG9pbnQ8Ym9vbGVhbj4oYHN0b3JhZ2UtJHtpbmRleE5hbWV9LWRlbGV0ZWAsIGFzeW5jICh7IG9iamVjdElkIH06IHsgb2JqZWN0SWQ6IHN0cmluZyB9KSA9PiB7XG4gICAgICAgIGRlbGV0ZSB0aGlzLndvcmtzcGFjZVtpbmRleE5hbWVdW29iamVjdElkXTtcbiAgICAgICAgYXdhaXQgdGhpcy5zdG9yZU1hbmFnZXJzW2luZGV4TmFtZV0uc3RvcmVJbmRleCh0aGlzLCB0aGlzLndvcmtzcGFjZVtpbmRleE5hbWVdKTtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICB9KTtcblxuICAgIH1cbiAgfVxufVxuIl19