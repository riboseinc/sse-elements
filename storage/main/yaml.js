import * as yaml from 'js-yaml';
import { customTimestampType } from './yaml-custom-ts';
export class YAMLStorage {
    constructor(fs) {
        this.fs = fs;
    }
    async load(filePath) {
        const data = await this.fs.readFile(filePath, { encoding: 'utf8' });
        return yaml.load(data, { schema: SCHEMA });
    }
    async loadIfExists(filePath) {
        let fileExists;
        let oldData;
        try {
            fileExists = (await this.fs.stat(filePath)).isFile() === true;
        }
        catch (e) {
            fileExists = false;
        }
        if (fileExists) {
            oldData = await this.load(filePath);
        }
        else {
            oldData = {};
        }
        return oldData || {};
    }
    async store(filePath, data) {
        if (data !== undefined && data !== null) {
            // Merge new data into old data; this way if some YAML properties
            // are not supported we will not lose them after the update.
            let newData;
            let oldData;
            let newContents;
            try {
                oldData = await this.loadIfExists(filePath);
                newData = Object.assign(oldData, data);
            }
            catch (e) {
                console.error("Bad input", filePath, oldData, data);
                throw e;
            }
            // console.debug(`Dumping contents for ${filePath} from ${data}`);
            // console.debug(oldData);
            try {
                newContents = yaml.dump(newData, {
                    schema: SCHEMA,
                    noRefs: true,
                    noCompatMode: true,
                });
            }
            catch (e) {
                console.error(`Failed to save ${filePath} with ${JSON.stringify(newData)}`);
                return;
            }
            // console.debug(`Writing to ${filePath}, file exists: ${fileExists}`);
            // if (fileExists) {
            //   const oldContents: string = await this.fs.readFile(filePath, { encoding: 'utf8' });
            //   console.debug(`Replacing contents of ${filePath}`, oldContents, newContents);
            // }
            await this.fs.writeFile(filePath, newContents, { encoding: 'utf8' });
            return data;
        }
        else {
            await this.fs.remove(filePath);
        }
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoieWFtbC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9zdG9yYWdlL21haW4veWFtbC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxPQUFPLEtBQUssSUFBSSxNQUFNLFNBQVMsQ0FBQztBQUNoQyxPQUFPLEVBQUUsbUJBQW1CLEVBQUUsTUFBTSxrQkFBa0IsQ0FBQztBQUd2RCxNQUFNLE9BQU8sV0FBVztJQUN0QixZQUFvQixFQUFPO1FBQVAsT0FBRSxHQUFGLEVBQUUsQ0FBSztJQUFJLENBQUM7SUFFekIsS0FBSyxDQUFDLElBQUksQ0FBQyxRQUFnQjtRQUNoQyxNQUFNLElBQUksR0FBVyxNQUFNLElBQUksQ0FBQyxFQUFFLENBQUMsUUFBUSxDQUFDLFFBQVEsRUFBRSxFQUFFLFFBQVEsRUFBRSxNQUFNLEVBQUUsQ0FBQyxDQUFDO1FBQzVFLE9BQU8sSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJLEVBQUUsRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLENBQUMsQ0FBQztJQUM3QyxDQUFDO0lBRU8sS0FBSyxDQUFDLFlBQVksQ0FBQyxRQUFnQjtRQUN6QyxJQUFJLFVBQW1CLENBQUM7UUFDeEIsSUFBSSxPQUFZLENBQUM7UUFFakIsSUFBSTtZQUNGLFVBQVUsR0FBRyxDQUFDLE1BQU0sSUFBSSxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxNQUFNLEVBQUUsS0FBSyxJQUFJLENBQUM7U0FDL0Q7UUFBQyxPQUFPLENBQUMsRUFBRTtZQUNWLFVBQVUsR0FBRyxLQUFLLENBQUM7U0FDcEI7UUFFRCxJQUFJLFVBQVUsRUFBRTtZQUNkLE9BQU8sR0FBRyxNQUFNLElBQUksQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUM7U0FDckM7YUFBTTtZQUNMLE9BQU8sR0FBRyxFQUFFLENBQUM7U0FDZDtRQUVELE9BQU8sT0FBTyxJQUFJLEVBQUUsQ0FBQztJQUN2QixDQUFDO0lBRU0sS0FBSyxDQUFDLEtBQUssQ0FBQyxRQUFnQixFQUFFLElBQVM7UUFDNUMsSUFBSSxJQUFJLEtBQUssU0FBUyxJQUFJLElBQUksS0FBSyxJQUFJLEVBQUU7WUFDdkMsaUVBQWlFO1lBQ2pFLDREQUE0RDtZQUM1RCxJQUFJLE9BQVksQ0FBQztZQUNqQixJQUFJLE9BQVksQ0FBQztZQUNqQixJQUFJLFdBQW1CLENBQUM7WUFFeEIsSUFBSTtnQkFDRixPQUFPLEdBQUcsTUFBTSxJQUFJLENBQUMsWUFBWSxDQUFDLFFBQVEsQ0FBQyxDQUFDO2dCQUM1QyxPQUFPLEdBQUcsTUFBTSxDQUFDLE1BQU0sQ0FBQyxPQUFPLEVBQUUsSUFBSSxDQUFDLENBQUM7YUFDeEM7WUFBQyxPQUFPLENBQUMsRUFBRTtnQkFDVixPQUFPLENBQUMsS0FBSyxDQUFDLFdBQVcsRUFBRSxRQUFRLEVBQUUsT0FBTyxFQUFFLElBQUksQ0FBQyxDQUFDO2dCQUNwRCxNQUFNLENBQUMsQ0FBQzthQUNUO1lBRUQsa0VBQWtFO1lBQ2xFLDBCQUEwQjtZQUUxQixJQUFJO2dCQUNGLFdBQVcsR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDLE9BQU8sRUFBRTtvQkFDL0IsTUFBTSxFQUFFLE1BQU07b0JBQ2QsTUFBTSxFQUFFLElBQUk7b0JBQ1osWUFBWSxFQUFFLElBQUk7aUJBQ25CLENBQUMsQ0FBQzthQUNKO1lBQUMsT0FBTyxDQUFDLEVBQUU7Z0JBQ1YsT0FBTyxDQUFDLEtBQUssQ0FBQyxrQkFBa0IsUUFBUSxTQUFTLElBQUksQ0FBQyxTQUFTLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQyxDQUFDO2dCQUM1RSxPQUFPO2FBQ1I7WUFFRCx1RUFBdUU7WUFFdkUsb0JBQW9CO1lBQ3BCLHdGQUF3RjtZQUN4RixrRkFBa0Y7WUFDbEYsSUFBSTtZQUVKLE1BQU0sSUFBSSxDQUFDLEVBQUUsQ0FBQyxTQUFTLENBQUMsUUFBUSxFQUFFLFdBQVcsRUFBRSxFQUFFLFFBQVEsRUFBRSxNQUFNLEVBQUUsQ0FBQyxDQUFDO1lBQ3JFLE9BQU8sSUFBSSxDQUFDO1NBQ2I7YUFBTTtZQUNMLE1BQU0sSUFBSSxDQUFDLEVBQUUsQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLENBQUM7U0FDaEM7SUFDSCxDQUFDO0NBQ0Y7QUFHRCxNQUFNLE1BQU0sR0FBRyxJQUFJLElBQUksQ0FBQyxNQUFNLENBQUM7SUFDN0IsT0FBTyxFQUFFLENBQUMsSUFBSSxDQUFDLG1CQUFtQixDQUFDO0lBRW5DLDRFQUE0RTtJQUM1RSxRQUFRLEVBQUU7UUFDUixHQUFJLElBQUksQ0FBQyxtQkFBMkIsQ0FBQyxRQUFRO1FBQzdDLEdBQUcsQ0FBQyxtQkFBbUIsQ0FBQztLQUN6QjtDQUNGLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIHlhbWwgZnJvbSAnanMteWFtbCc7XG5pbXBvcnQgeyBjdXN0b21UaW1lc3RhbXBUeXBlIH0gZnJvbSAnLi95YW1sLWN1c3RvbS10cyc7XG5cblxuZXhwb3J0IGNsYXNzIFlBTUxTdG9yYWdlIHtcbiAgY29uc3RydWN0b3IocHJpdmF0ZSBmczogYW55KSB7IH1cblxuICBwdWJsaWMgYXN5bmMgbG9hZChmaWxlUGF0aDogc3RyaW5nKTogUHJvbWlzZTxhbnk+IHtcbiAgICBjb25zdCBkYXRhOiBzdHJpbmcgPSBhd2FpdCB0aGlzLmZzLnJlYWRGaWxlKGZpbGVQYXRoLCB7IGVuY29kaW5nOiAndXRmOCcgfSk7XG4gICAgcmV0dXJuIHlhbWwubG9hZChkYXRhLCB7IHNjaGVtYTogU0NIRU1BIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBsb2FkSWZFeGlzdHMoZmlsZVBhdGg6IHN0cmluZyk6IFByb21pc2U8YW55PiB7XG4gICAgbGV0IGZpbGVFeGlzdHM6IGJvb2xlYW47XG4gICAgbGV0IG9sZERhdGE6IGFueTtcblxuICAgIHRyeSB7XG4gICAgICBmaWxlRXhpc3RzID0gKGF3YWl0IHRoaXMuZnMuc3RhdChmaWxlUGF0aCkpLmlzRmlsZSgpID09PSB0cnVlO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIGZpbGVFeGlzdHMgPSBmYWxzZTtcbiAgICB9XG5cbiAgICBpZiAoZmlsZUV4aXN0cykge1xuICAgICAgb2xkRGF0YSA9IGF3YWl0IHRoaXMubG9hZChmaWxlUGF0aCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIG9sZERhdGEgPSB7fTtcbiAgICB9XG5cbiAgICByZXR1cm4gb2xkRGF0YSB8fCB7fTtcbiAgfVxuXG4gIHB1YmxpYyBhc3luYyBzdG9yZShmaWxlUGF0aDogc3RyaW5nLCBkYXRhOiBhbnkpOiBQcm9taXNlPGFueT4ge1xuICAgIGlmIChkYXRhICE9PSB1bmRlZmluZWQgJiYgZGF0YSAhPT0gbnVsbCkge1xuICAgICAgLy8gTWVyZ2UgbmV3IGRhdGEgaW50byBvbGQgZGF0YTsgdGhpcyB3YXkgaWYgc29tZSBZQU1MIHByb3BlcnRpZXNcbiAgICAgIC8vIGFyZSBub3Qgc3VwcG9ydGVkIHdlIHdpbGwgbm90IGxvc2UgdGhlbSBhZnRlciB0aGUgdXBkYXRlLlxuICAgICAgbGV0IG5ld0RhdGE6IGFueTtcbiAgICAgIGxldCBvbGREYXRhOiBhbnk7XG4gICAgICBsZXQgbmV3Q29udGVudHM6IHN0cmluZztcblxuICAgICAgdHJ5IHtcbiAgICAgICAgb2xkRGF0YSA9IGF3YWl0IHRoaXMubG9hZElmRXhpc3RzKGZpbGVQYXRoKTtcbiAgICAgICAgbmV3RGF0YSA9IE9iamVjdC5hc3NpZ24ob2xkRGF0YSwgZGF0YSk7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoXCJCYWQgaW5wdXRcIiwgZmlsZVBhdGgsIG9sZERhdGEsIGRhdGEpO1xuICAgICAgICB0aHJvdyBlO1xuICAgICAgfVxuXG4gICAgICAvLyBjb25zb2xlLmRlYnVnKGBEdW1waW5nIGNvbnRlbnRzIGZvciAke2ZpbGVQYXRofSBmcm9tICR7ZGF0YX1gKTtcbiAgICAgIC8vIGNvbnNvbGUuZGVidWcob2xkRGF0YSk7XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIG5ld0NvbnRlbnRzID0geWFtbC5kdW1wKG5ld0RhdGEsIHtcbiAgICAgICAgICBzY2hlbWE6IFNDSEVNQSxcbiAgICAgICAgICBub1JlZnM6IHRydWUsXG4gICAgICAgICAgbm9Db21wYXRNb2RlOiB0cnVlLFxuICAgICAgICB9KTtcbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcihgRmFpbGVkIHRvIHNhdmUgJHtmaWxlUGF0aH0gd2l0aCAke0pTT04uc3RyaW5naWZ5KG5ld0RhdGEpfWApO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIC8vIGNvbnNvbGUuZGVidWcoYFdyaXRpbmcgdG8gJHtmaWxlUGF0aH0sIGZpbGUgZXhpc3RzOiAke2ZpbGVFeGlzdHN9YCk7XG5cbiAgICAgIC8vIGlmIChmaWxlRXhpc3RzKSB7XG4gICAgICAvLyAgIGNvbnN0IG9sZENvbnRlbnRzOiBzdHJpbmcgPSBhd2FpdCB0aGlzLmZzLnJlYWRGaWxlKGZpbGVQYXRoLCB7IGVuY29kaW5nOiAndXRmOCcgfSk7XG4gICAgICAvLyAgIGNvbnNvbGUuZGVidWcoYFJlcGxhY2luZyBjb250ZW50cyBvZiAke2ZpbGVQYXRofWAsIG9sZENvbnRlbnRzLCBuZXdDb250ZW50cyk7XG4gICAgICAvLyB9XG5cbiAgICAgIGF3YWl0IHRoaXMuZnMud3JpdGVGaWxlKGZpbGVQYXRoLCBuZXdDb250ZW50cywgeyBlbmNvZGluZzogJ3V0ZjgnIH0pO1xuICAgICAgcmV0dXJuIGRhdGE7XG4gICAgfSBlbHNlIHtcbiAgICAgIGF3YWl0IHRoaXMuZnMucmVtb3ZlKGZpbGVQYXRoKTtcbiAgICB9XG4gIH1cbn1cblxuXG5jb25zdCBTQ0hFTUEgPSBuZXcgeWFtbC5TY2hlbWEoe1xuICBpbmNsdWRlOiBbeWFtbC5ERUZBVUxUX1NBRkVfU0NIRU1BXSxcblxuICAvLyBUcmljayBiZWNhdXNlIGpzLXlhbWwgQVBJIGFwcGVhcnMgdG8gbm90IHN1cHBvcnQgYXVnbWVudGluZyBpbXBsaWNpdCB0YWdzXG4gIGltcGxpY2l0OiBbXG4gICAgLi4uKHlhbWwuREVGQVVMVF9TQUZFX1NDSEVNQSBhcyBhbnkpLmltcGxpY2l0LFxuICAgIC4uLltjdXN0b21UaW1lc3RhbXBUeXBlXSxcbiAgXSxcbn0pO1xuIl19