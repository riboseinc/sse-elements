import * as path from 'path';
import { format as formatUrl } from 'url';
import { BrowserWindow, Menu } from 'electron';
/* Window-related helpers
   TODO (#4): Move into the framework */
const isDevelopment = process.env.NODE_ENV !== 'production';
const isMacOS = process.platform === 'darwin';
// Keeps track of windows and ensures (?) they do not get garbage collected
export var windows = [];
// Allows to locate window ID by label
var windowsByTitle = {};
export const openWindow = async ({ title, url, component, componentParams, dimensions, frameless, winParams, menuTemplate, ignoreCache }) => {
    if ((component || '').trim() === '' && (url || '').trim() === '') {
        throw new Error("openWindow() requires either `component` or `url`");
    }
    const _existingWindow = getWindowByTitle(title);
    if (_existingWindow !== undefined) {
        _existingWindow.show();
        _existingWindow.focus();
        return _existingWindow;
    }
    const _framelessOpts = {
        titleBarStyle: isMacOS ? 'hiddenInset' : undefined,
    };
    const _winParams = Object.assign(Object.assign({ width: (dimensions || {}).width, minWidth: (dimensions || {}).minWidth, height: (dimensions || {}).height, minHeight: (dimensions || {}).minHeight }, (frameless === true ? _framelessOpts : {})), winParams);
    let window;
    if (component) {
        const params = `c=${component}&${componentParams ? componentParams : ''}`;
        window = await createWindowForLocalComponent(title, params, _winParams);
    }
    else if (url) {
        window = await createWindow(title, url, _winParams, ignoreCache);
    }
    else {
        throw new Error("Either component or url must be given to openWindow()");
    }
    if (menuTemplate && !isMacOS) {
        window.setMenu(Menu.buildFromTemplate(menuTemplate));
    }
    windows.push(window);
    windowsByTitle[title] = window;
    window.on('closed', () => { delete windowsByTitle[title]; cleanUpWindows(); });
    return window;
};
export function getWindowByTitle(title) {
    return windowsByTitle[title];
}
export function getWindow(func) {
    return windows.find(func);
}
// Iterate over array of windows and try accessing window ID.
// If it throws, window was closed and we remove it from the array.
// Supposed to be run after any window is closed
function cleanUpWindows() {
    var deletedWindows = [];
    for (const [idx, win] of windows.entries()) {
        // When accessing the id attribute of a closed window,
        // it’ll throw. We’ll mark its index for deletion then.
        try {
            win.id;
        }
        catch (e) {
            deletedWindows.push(idx - deletedWindows.length);
        }
    }
    for (const idx of deletedWindows) {
        windows.splice(idx, 1);
    }
}
function createWindowForLocalComponent(title, params, winParams) {
    let url;
    if (isDevelopment) {
        url = `http://localhost:${process.env.ELECTRON_WEBPACK_WDS_PORT}?${params}`;
    }
    else {
        url = `${formatUrl({
            pathname: path.join(__dirname, 'index.html'),
            protocol: 'file',
            slashes: true,
        })}?${params}`;
    }
    return createWindow(title, url, winParams);
}
function createWindow(title, url, winParams, ignoreCache = false) {
    const window = new BrowserWindow(Object.assign({ webPreferences: { nodeIntegration: true }, title: title, show: false }, winParams));
    const promise = new Promise((resolve, reject) => {
        window.once('ready-to-show', () => {
            window.show();
            resolve(window);
        });
    });
    if (isDevelopment) {
        window.webContents.openDevTools();
    }
    if (ignoreCache) {
        window.loadURL(url, { 'extraHeaders': 'pragma: no-cache\n' });
    }
    else {
        window.loadURL(url);
    }
    window.webContents.on('devtools-opened', () => {
        window.focus();
        setImmediate(() => {
            window.focus();
        });
    });
    return promise;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2luZG93LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL21haW4vd2luZG93LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLE9BQU8sS0FBSyxJQUFJLE1BQU0sTUFBTSxDQUFBO0FBQzVCLE9BQU8sRUFBRSxNQUFNLElBQUksU0FBUyxFQUFFLE1BQU0sS0FBSyxDQUFDO0FBQzFDLE9BQU8sRUFBRSxhQUFhLEVBQUUsSUFBSSxFQUE4QixNQUFNLFVBQVUsQ0FBQztBQUczRTt3Q0FDd0M7QUFHeEMsTUFBTSxhQUFhLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxRQUFRLEtBQUssWUFBWSxDQUFDO0FBQzVELE1BQU0sT0FBTyxHQUFHLE9BQU8sQ0FBQyxRQUFRLEtBQUssUUFBUSxDQUFDO0FBRTlDLDJFQUEyRTtBQUMzRSxNQUFNLENBQUMsSUFBSSxPQUFPLEdBQW9CLEVBQUUsQ0FBQztBQUV6QyxzQ0FBc0M7QUFDdEMsSUFBSSxjQUFjLEdBQXVDLEVBQUUsQ0FBQztBQWdCNUQsTUFBTSxDQUFDLE1BQU0sVUFBVSxHQUFpQixLQUFLLEVBQUUsRUFDM0MsS0FBSyxFQUNMLEdBQUcsRUFBRSxTQUFTLEVBQUUsZUFBZSxFQUMvQixVQUFVLEVBQUUsU0FBUyxFQUNyQixTQUFTLEVBQUUsWUFBWSxFQUFFLFdBQVcsRUFBRSxFQUFFLEVBQUU7SUFFNUMsSUFBSSxDQUFDLFNBQVMsSUFBSSxFQUFFLENBQUMsQ0FBQyxJQUFJLEVBQUUsS0FBSyxFQUFFLElBQUksQ0FBQyxHQUFHLElBQUksRUFBRSxDQUFDLENBQUMsSUFBSSxFQUFFLEtBQUssRUFBRSxFQUFFO1FBQ2hFLE1BQU0sSUFBSSxLQUFLLENBQUMsbURBQW1ELENBQUMsQ0FBQztLQUN0RTtJQUVELE1BQU0sZUFBZSxHQUFHLGdCQUFnQixDQUFDLEtBQUssQ0FBQyxDQUFDO0lBQ2hELElBQUksZUFBZSxLQUFLLFNBQVMsRUFBRTtRQUNqQyxlQUFlLENBQUMsSUFBSSxFQUFFLENB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LG9CQUFvQixFQUFDLENBQUMsQ0FBQztLQUM3RDtTQUFNO1FBQ0wsTUFBTSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQztLQUNyQjtJQUVELE1BQU0sQ0FBQyxXQUFXLENBQUMsRUFBRSxDQUFDLGlCQUFpQixFQUFFLEdBQUcsRUFBRTtRQUM1QyxNQUFNLENBQUMsS0FBSyxFQUFFLENBQUM7UUFDZixZQUFZLENBQUMsR0FBRyxFQUFFO1lBQ2hCLE1BQU0sQ0FBQyxLQUFLLEVBQUUsQ0FBQTtRQUNoQixDQUFDLENBQUMsQ0FBQztJQUNMLENBQUMsQ0FBQyxDQUFDO0lBRUgsT0FBTyxPQUFPLENBQUM7QUFDakIsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCdcbmltcG9ydCB7IGZvcm1hdCBhcyBmb3JtYXRVcmwgfSBmcm9tICd1cmwnO1xuaW1wb3J0IHsgQnJvd3NlcldpbmRvdywgTWVudSwgTWVudUl0ZW1Db25zdHJ1Y3Rvck9wdGlvbnMgfSBmcm9tICdlbGVjdHJvbic7XG5cblxuLyogV2luZG93LXJlbGF0ZWQgaGVscGVyc1xuICAgVE9ETyAoIzQpOiBNb3ZlIGludG8gdGhlIGZyYW1ld29yayAqL1xuXG5cbmNvbnN0IGlzRGV2ZWxvcG1lbnQgPSBwcm9jZXNzLmVudi5OT0RFX0VOViAhPT0gJ3Byb2R1Y3Rpb24nO1xuY29uc3QgaXNNYWNPUyA9IHByb2Nlc3MucGxhdGZvcm0gPT09ICdkYXJ3aW4nO1xuXG4vLyBLZWVwcyB0cmFjayBvZiB3aW5kb3dzIGFuZCBlbnN1cmVzICg/KSB0aGV5IGRvIG5vdCBnZXQgZ2FyYmFnZSBjb2xsZWN0ZWRcbmV4cG9ydCB2YXIgd2luZG93czogQnJvd3NlcldpbmRvd1tdID0gW107XG5cbi8vIEFsbG93cyB0byBsb2NhdGUgd2luZG93IElEIGJ5IGxhYmVsXG52YXIgd2luZG93c0J5VGl0bGU6IHsgW3RpdGxlOiBzdHJpbmddOiBCcm93c2VyV2luZG93IH0gPSB7fTtcblxuXG4vLyBPcGVuIG5ldyB3aW5kb3csIG9yIGZvY3VzIGlmIG9uZSB3aXRoIHRoZSBzYW1lIHRpdGxlIGFscmVhZHkgZXhpc3RzXG5leHBvcnQgaW50ZXJmYWNlIFdpbmRvd09wZW5lclBhcmFtcyB7XG4gIHRpdGxlOiBzdHJpbmcsXG4gIHVybD86IHN0cmluZyxcbiAgY29tcG9uZW50Pzogc3RyaW5nLFxuICBjb21wb25lbnRQYXJhbXM/OiBzdHJpbmcsXG4gIGRpbWVuc2lvbnM/OiB7IG1pbkhlaWdodD86IG51bWJlciwgbWluV2lkdGg/OiBudW1iZXIsIHdpZHRoPzogbnVtYmVyLCBoZWlnaHQ/OiBudW1iZXIgfSxcbiAgZnJhbWVsZXNzPzogYm9vbGVhbixcbiAgd2luUGFyYW1zPzogYW55LFxuICBtZW51VGVtcGxhdGU/OiBNZW51SXRlbUNvbnN0cnVjdG9yT3B0aW9uc1tdLFxuICBpZ25vcmVDYWNoZT86IGJvb2xlYW4sXG59XG5leHBvcnQgdHlwZSBXaW5kb3dPcGVuZXIgPSAocHJvcHM6IFdpbmRvd09wZW5lclBhcmFtcykgPT4gUHJvbWlzZTxCcm93c2VyV2luZG93PjtcbmV4cG9ydCBjb25zdCBvcGVuV2luZG93OiBXaW5kb3dPcGVuZXIgPSBhc3luYyAoe1xuICAgIHRpdGxlLFxuICAgIHVybCwgY29tcG9uZW50LCBjb21wb25lbnRQYXJhbXMsXG4gICAgZGltZW5zaW9ucywgZnJhbWVsZXNzLFxuICAgIHdpblBhcmFtcywgbWVudVRlbXBsYXRlLCBpZ25vcmVDYWNoZSB9KSA9PiB7XG5cbiAgaWYgKChjb21wb25lbnQgfHwgJycpLnRyaW0oKSA9PT0gJycgJiYgKHVybCB8fCAnJykudHJpbSgpID09PSAnJykge1xuICAgIHRocm93IG5ldyBFcnJvcihcIm9wZW5XaW5kb3coKSByZXF1aXJlcyBlaXRoZXIgYGNvbXBvbmVudGAgb3IgYHVybGBcIik7XG4gIH1cblxuICBjb25zdCBfZXhpc3RpbmdXaW5kb3cgPSBnZXRXaW5kb3dCeVRpdGxlKHRpdGxlKTtcbiAgaWYgKF9leGlzdGluZ1dpbmRvdyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgX2V4aXN0aW5nV2luZG93LnNob3coKTtcbiAgICBfZXhpc3RpbmdXaW5kb3cuZm9jdXMoKTtcbiAgICByZXR1cm4gX2V4aXN0aW5nV2luZG93O1xuICB9XG5cbiAgY29uc3QgX2ZyYW1lbGVzc09wdHMgPSB7XG4gICAgdGl0bGVCYXJTdHlsZTogaXNNYWNPUyA/ICdoaWRkZW5JbnNldCcgOiB1bmRlZmluZWQsXG4gIH07XG5cbiAgY29uc3QgX3dpblBhcmFtcyA9IHtcbiAgICB3aWR0aDogKGRpbWVuc2lvbnMgfHwge30pLndpZHRoLFxuICAgIG1pbldpZHRoOiAoZGltZW5zaW9ucyB8fCB7fSkubWluV2lkdGgsXG4gICAgaGVpZ2h0OiAoZGltZW5zaW9ucyB8fCB7fSkuaGVpZ2h0LFxuICAgIG1pbkhlaWdodDogKGRpbWVuc2lvbnMgfHwge30pLm1pbkhlaWdodCxcbiAgICAuLi4oZnJhbWVsZXNzID09PSB0cnVlID8gX2ZyYW1lbGVzc09wdHMgOiB7fSksXG4gICAgLi4ud2luUGFyYW1zLFxuICB9O1xuXG4gIGxldCB3aW5kb3c6IEJyb3dzZXJXaW5kb3c7XG5cbiAgaWYgKGNvbXBvbmVudCkge1xuICAgIGNvbnN0IHBhcmFtcyA9IGBjPSR7Y29tcG9uZW50fSYke2NvbXBvbmVudFBhcmFtcyA/IGNvbXBvbmVudFBhcmFtcyA6ICcnfWA7XG4gICAgd2luZG93ID0gYXdhaXQgY3JlYXRlV2luZG93Rm9yTG9jYWxDb21wb25lbnQodGl0bGUsIHBhcmFtcywgX3dpblBhcmFtcyk7XG4gIH0gZWxzZSBpZiAodXJsKSB7XG4gICAgd2luZG93ID0gYXdhaXQgY3JlYXRlV2luZG93KHRpdGxlLCB1cmwsIF93aW5QYXJhbXMsIGlnbm9yZUNhY2hlKTtcbiAgfSBlbHNlIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJFaXRoZXIgY29tcG9uZW50IG9yIHVybCBtdXN0IGJlIGdpdmVuIHRvIG9wZW5XaW5kb3coKVwiKTtcbiAgfVxuXG4gIGlmIChtZW51VGVtcGxhdGUgJiYgIWlzTWFjT1MpIHtcbiAgICB3aW5kb3cuc2V0TWVudShNZW51LmJ1aWxkRnJvbVRlbXBsYXRlKG1lbnVUZW1wbGF0ZSkpO1xuICB9XG5cbiAgd2luZG93cy5wdXNoKHdpbmRvdyk7XG4gIHdpbmRvd3NCeVRpdGxlW3RpdGxlXSA9IHdpbmRvdztcbiAgd2luZG93Lm9uKCdjbG9zZWQnLCAoKSA9PiB7IGRlbGV0ZSB3aW5kb3dzQnlUaXRsZVt0aXRsZV07IGNsZWFuVXBXaW5kb3dzKCk7IH0pO1xuXG4gIHJldHVybiB3aW5kb3c7XG59XG5cblxuZXhwb3J0IGZ1bmN0aW9uIGdldFdpbmRvd0J5VGl0bGUodGl0bGU6IHN0cmluZyk6IEJyb3dzZXJXaW5kb3cgfCB1bmRlZmluZWQge1xuICByZXR1cm4gd2luZG93c0J5VGl0bGVbdGl0bGVdO1xufVxuXG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRXaW5kb3coZnVuYzogKHdpbjogQnJvd3NlcldpbmRvdykgPT4gYm9vbGVhbik6IEJyb3dzZXJXaW5kb3cgfCB1bmRlZmluZWQge1xuICByZXR1cm4gd2luZG93cy5maW5kKGZ1bmMpO1xufVxuXG5cbi8vIEl0ZXJhdGUgb3ZlciBhcnJheSBvZiB3aW5kb3dzIGFuZCB0cnkgYWNjZXNzaW5nIHdpbmRvdyBJRC5cbi8vIElmIGl0IHRocm93cywgd2luZG93IHdhcyBjbG9zZWQgYW5kIHdlIHJlbW92ZSBpdCBmcm9tIHRoZSBhcnJheS5cbi8vIFN1cHBvc2VkIHRvIGJlIHJ1biBhZnRlciBhbnkgd2luZG93IGlzIGNsb3NlZFxuZnVuY3Rpb24gY2xlYW5VcFdpbmRvd3MoKSB7XG4gIHZhciBkZWxldGVkV2luZG93czogbnVtYmVyW10gPSBbXTtcbiAgZm9yIChjb25zdCBbaWR4LCB3aW5dIG9mIHdpbmRvd3MuZW50cmllcygpKSB7XG4gICAgLy8gV2hlbiBhY2Nlc3NpbmcgdGhlIGlkIGF0dHJpYnV0ZSBvZiBhIGNsb3NlZCB3aW5kb3csXG4gICAgLy8gaXTigJlsbCB0aHJvdy4gV2XigJlsbCBtYXJrIGl0cyBpbmRleCBmb3IgZGVsZXRpb24gdGhlbi5cbiAgICB0cnkge1xuICAgICAgd2luLmlkO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIGRlbGV0ZWRXaW5kb3dzLnB1c2goaWR4IC0gZGVsZXRlZFdpbmRvd3MubGVuZ3RoKTtcbiAgICB9XG4gIH1cbiAgZm9yIChjb25zdCBpZHggb2YgZGVsZXRlZFdpbmRvd3MpIHtcbiAgICB3aW5kb3dzLnNwbGljZShpZHgsIDEpO1xuICB9XG59XG5cblxuZnVuY3Rpb24gY3JlYXRlV2luZG93Rm9yTG9jYWxDb21wb25lbnQodGl0bGU6IHN0cmluZywgcGFyYW1zOiBzdHJpbmcsIHdpblBhcmFtczogYW55KTogUHJvbWlzZTxCcm93c2VyV2luZG93PiB7XG4gIGxldCB1cmw6IHN0cmluZztcblxuICBpZiAoaXNEZXZlbG9wbWVudCkge1xuICAgIHVybCA9IGBodHRwOi8vbG9jYWxob3N0OiR7cHJvY2Vzcy5lbnYuRUxFQ1RST05fV0VCUEFDS19XRFNfUE9SVH0/JHtwYXJhbXN9YDtcbiAgfVxuICBlbHNlIHtcbiAgICB1cmwgPSBgJHtmb3JtYXRVcmwoe1xuICAgICAgcGF0aG5hbWU6IHBhdGguam9pbihfX2Rpcm5hbWUsICdpbmRleC5odG1sJyksXG4gICAgICBwcm90b2NvbDogJ2ZpbGUnLFxuICAgICAgc2xhc2hlczogdHJ1ZSxcbiAgICB9KX0/JHtwYXJhbXN9YDtcbiAgfVxuXG4gIHJldHVybiBjcmVhdGVXaW5kb3codGl0bGUsIHVybCwgd2luUGFyYW1zKTtcbn1cblxuXG5mdW5jdGlvbiBjcmVhdGVXaW5kb3codGl0bGU6IHN0cmluZywgdXJsOiBzdHJpbmcsIHdpblBhcmFtczogYW55LCBpZ25vcmVDYWNoZTogYm9vbGVhbiA9IGZhbHNlKTogUHJvbWlzZTxCcm93c2VyV2luZG93PiB7XG4gIGNvbnN0IHdpbmRvdyA9IG5ldyBCcm93c2VyV2luZG93KHtcbiAgICB3ZWJQcmVmZXJlbmNlczoge25vZGVJbnRlZ3JhdGlvbjogdHJ1ZX0sXG4gICAgdGl0bGU6IHRpdGxlLFxuICAgIHNob3c6IGZhbHNlLFxuICAgIC4uLndpblBhcmFtc1xuICB9KTtcblxuICBjb25zdCBwcm9taXNlID0gbmV3IFByb21pc2U8QnJvd3NlcldpbmRvdz4oKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgIHdpbmRvdy5vbmNlKCdyZWFkeS10by1zaG93JywgKCkgPT4ge1xuICAgICAgd2luZG93LnNob3coKTtcbiAgICAgIHJlc29sdmUod2luZG93KTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgaWYgKGlzRGV2ZWxvcG1lbnQpIHtcbiAgICB3aW5kb3cud2ViQ29udGVudHMub3BlbkRldlRvb2xzKCk7XG4gIH1cblxuICBpZiAoaWdub3JlQ2FjaGUpIHtcbiAgICB3aW5kb3cubG9hZFVSTCh1cmwsIHsnZXh0cmFIZWFkZXJzJzogJ3ByYWdtYTogbm8tY2FjaGVcXG4nfSk7XG4gIH0gZWxzZSB7XG4gICAgd2luZG93LmxvYWRVUkwodXJsKTtcbiAgfVxuXG4gIHdpbmRvdy53ZWJDb250ZW50cy5vbignZGV2dG9vbHMtb3BlbmVkJywgKCkgPT4ge1xuICAgIHdpbmRvdy5mb2N1cygpO1xuICAgIHNldEltbWVkaWF0ZSgoKSA9PiB7XG4gICAgICB3aW5kb3cuZm9jdXMoKVxuICAgIH0pO1xuICB9KTtcblxuICByZXR1cm4gcHJvbWlzZTtcbn1cbiJdfQ==