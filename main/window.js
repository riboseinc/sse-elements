import * as path from 'path';
import { format as formatUrl } from 'url';
import { BrowserWindow, Menu } from 'electron';
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
export async function notifyAllWindows(eventName, payload) {
    return await Promise.all(windows.map(async (window) => {
        if (window) {
            await window.webContents.send(eventName, payload);
        }
        return;
    }));
}
export async function notifyWindow(windowTitle, eventName, payload) {
    const window = getWindowByTitle(windowTitle);
    if (window) {
        await window.webContents.send(eventName, payload);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2luZG93LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL21haW4vd2luZG93LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLE9BQU8sS0FBSyxJQUFJLE1BQU0sTUFBTSxDQUFBO0FBQzVCLE9BQU8sRUFBRSxNQUFNLElBQUksU0FBUyxFQUFFLE1BQU0sS0FBSyxDQUFDO0FBQzFDLE9BQU8sRUFBRSxhQUFhLEVBQUUsSUFBSSxFQUE4QixNQUFNLFVBQVUsQ0FBQztBQUczRSxNQUFNLGFBQWEsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLFFBQVEsS0FBSyxZQUFZLENBQUM7QUFDNUQsTUFBTSxPQUFPLEdBQUcsT0FBTyxDQUFDLFFBQVEsS0FBSyxRQUFRLENBQUM7QUFFOUMsMkVBQTJFO0FBQzNFLE1BQU0sQ0FBQyxJQUFJLE9BQU8sR0FBb0IsRUFBRSxDQUFDO0FBRXpDLHNDQUFzQztBQUN0QyxJQUFJLGNBQWMsR0FBdUMsRUFBRSxDQUFDO0FBdUI1RCxNQUFNLENBQUMsTUFBTSxVQUFVLEdBQWlCLEtBQUssRUFBRSxFQUMzQyxLQUFLLEVBQ0wsR0FBRyxFQUFFLFNBQVMsRUFBRSxlQUFlLEVBQy9CLFVBQVUsRUFBRSxTQUFTLEVBQ3JCLFNBQVMsRUFBRSxZQUFZLEVBQUUsV0FBVyxFQUFFLEVBQUUsRUFBRTtJQUU1QyxJQUFJLENBQUMsU0FBUyxJQUFJLEVBQUUsQ0FBQyxDQUFDLElBQUksRUFBRSxLQUFLLEVBQUUsSUFBSSxDQUFDLEdBQUcsSUFBSSxFQUFFLENBQUMsQ0FBQyxJQUFJLEVBQUUsS0FBSyxFQUFFLEVBQUU7UUFDaEUsTUFBTSxJQUFJLEtBQUssQ0FBQyxtREFBbUQsQ0FBQyxDQUFDO0tBQ3RFO0lBRUQsTUFBTSxlQUFlLEdBQUcsZ0JBQWdCLENBQUMsS0FBSyxDQUFDLENBQUM7SUFDaEQsSUFBSSxlQUFlLEtBQUssU0FBUyxFQUFFO1FBQ2pDLGVBQWUsQ0FBQyxJQUFJLEVBQUUsQ0FBQztRQUN2QixlQUFl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Q0FBQyxDQUFDO0tBQzdEO1NBQU07UUFDTCxNQUFNLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFDO0tBQ3JCO0lBRUQsTUFBTSxDQUFDLFdBQVcsQ0FBQyxFQUFFLENBQUMsaUJBQWlCLEVBQUUsR0FBRyxFQUFFO1FBQzVDLE1BQU0sQ0FBQyxLQUFLLEVBQUUsQ0FBQztRQUNmLFlBQVksQ0FBQyxHQUFHLEVBQUU7WUFDaEIsTUFBTSxDQUFDLEtBQUssRUFBRSxDQUFBO1FBQ2hCLENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7SUFFSCxPQUFPLE9BQU8sQ0FBQztBQUNqQixDQUFDO0FBR0QsTUFBTSxDQUFDLEtBQUssVUFBVSxnQkFBZ0IsQ0FBQyxTQUFpQixFQUFFLE9BQWE7SUFDckUsT0FBTyxNQUFNLE9BQU8sQ0FBQyxHQUFHLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxLQUFLLEVBQUUsTUFBTSxFQUFFLEVBQUU7UUFDcEQsSUFBSSxNQUFNLEVBQUU7WUFDVixNQUFNLE1BQU0sQ0FBQyxXQUFXLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBRSxPQUFPLENBQUMsQ0FBQztTQUNuRDtRQUNELE9BQU87SUFDVCxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ04sQ0FBQztBQUdELE1BQU0sQ0FBQyxLQUFLLFVBQVUsWUFBWSxDQUFDLFdBQW1CLEVBQUUsU0FBaUIsRUFBRSxPQUFhO0lBQ3RGLE1BQU0sTUFBTSxHQUFHLGdCQUFnQixDQUFDLFdBQVcsQ0FBQyxDQUFDO0lBQzdDLElBQUksTUFBTSxFQUFFO1FBQ1YsTUFBTSxNQUFNLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsT0FBTyxDQUFDLENBQUM7S0FDbkQ7QUFDSCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJ1xuaW1wb3J0IHsgZm9ybWF0IGFzIGZvcm1hdFVybCB9IGZyb20gJ3VybCc7XG5pbXBvcnQgeyBCcm93c2VyV2luZG93LCBNZW51LCBNZW51SXRlbUNvbnN0cnVjdG9yT3B0aW9ucyB9IGZyb20gJ2VsZWN0cm9uJztcblxuXG5jb25zdCBpc0RldmVsb3BtZW50ID0gcHJvY2Vzcy5lbnYuTk9ERV9FTlYgIT09ICdwcm9kdWN0aW9uJztcbmNvbnN0IGlzTWFjT1MgPSBwcm9jZXNzLnBsYXRmb3JtID09PSAnZGFyd2luJztcblxuLy8gS2VlcHMgdHJhY2sgb2Ygd2luZG93cyBhbmQgZW5zdXJlcyAoPykgdGhleSBkbyBub3QgZ2V0IGdhcmJhZ2UgY29sbGVjdGVkXG5leHBvcnQgdmFyIHdpbmRvd3M6IEJyb3dzZXJXaW5kb3dbXSA9IFtdO1xuXG4vLyBBbGxvd3MgdG8gbG9jYXRlIHdpbmRvdyBJRCBieSBsYWJlbFxudmFyIHdpbmRvd3NCeVRpdGxlOiB7IFt0aXRsZTogc3RyaW5nXTogQnJvd3NlcldpbmRvdyB9ID0ge307XG5cblxuLy8gT3BlbiBuZXcgd2luZG93LCBvciBmb2N1cyBpZiBvbmUgd2l0aCB0aGUgc2FtZSB0aXRsZSBhbHJlYWR5IGV4aXN0c1xuZXhwb3J0IGludGVyZmFjZSBXaW5kb3dPcGVuZXJQYXJhbXMge1xuICB0aXRsZTogc3RyaW5nLFxuICB1cmw/OiBzdHJpbmcsXG4gIGNvbXBvbmVudD86IHN0cmluZyxcbiAgY29tcG9uZW50UGFyYW1zPzogc3RyaW5nLFxuICBkaW1lbnNpb25zPzoge1xuICAgIG1pbkhlaWdodD86IG51bWJlcixcbiAgICBtaW5XaWR0aD86IG51bWJlcixcbiAgICBoZWlnaHQ/OiBudW1iZXIsXG4gICAgd2lkdGg/OiBudW1iZXIsXG4gICAgbWF4SGVpZ2h0PzogbnVtYmVyLFxuICAgIG1heFdpZHRoPzogbnVtYmVyLFxuICB9LFxuICBmcmFtZWxlc3M/OiBib29sZWFuLFxuICB3aW5QYXJhbXM/OiBhbnksXG4gIG1lbnVUZW1wbGF0ZT86IE1lbnVJdGVtQ29uc3RydWN0b3JPcHRpb25zW10sXG4gIGlnbm9yZUNhY2hlPzogYm9vbGVhbixcbn1cbmV4cG9ydCB0eXBlIFdpbmRvd09wZW5lciA9IChwcm9wczogV2luZG93T3BlbmVyUGFyYW1zKSA9PiBQcm9taXNlPEJyb3dzZXJXaW5kb3c+O1xuZXhwb3J0IGNvbnN0IG9wZW5XaW5kb3c6IFdpbmRvd09wZW5lciA9IGFzeW5jICh7XG4gICAgdGl0bGUsXG4gICAgdXJsLCBjb21wb25lbnQsIGNvbXBvbmVudFBhcmFtcyxcbiAgICBkaW1lbnNpb25zLCBmcmFtZWxlc3MsXG4gICAgd2luUGFyYW1zLCBtZW51VGVtcGxhdGUsIGlnbm9yZUNhY2hlIH0pID0+IHtcblxuICBpZiAoKGNvbXBvbmVudCB8fCAnJykudHJpbSgpID09PSAnJyAmJiAodXJsIHx8ICcnKS50cmltKCkgPT09ICcnKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwib3BlbldpbmRvdygpIHJlcXVpcmVzIGVpdGhlciBgY29tcG9uZW50YCBvciBgdXJsYFwiKTtcbiAgfVxuXG4gIGNvbnN0IF9leGlzdGluZ1dpbmRvdyA9IGdldFdpbmRvd0J5VGl0bGUodGl0bGUpO1xuICBpZiAoX2V4aXN0aW5nV2luZG93ICE9PSB1bmRlZmluZWQpIHtcbiAgICBfZXhpc3RpbmdXaW5kb3cuc2hvdygpO1xuICAgIF9leGlzdGluZ1dpbmRvdy5mb2N1cygpO1xuICAgIHJldHVybiBfZXhpc3RpbmdXaW5kb3c7XG4gIH1cblxuICBjb25zdCBfZnJhbWVsZXNzT3B0cyA9IHtcbiAgICB0aXRsZUJhclN0eWxlOiBpc01hY09TID8gJ2hpZGRlbkluc2V0JyA6IHVuZGVmaW5lZCxcbiAgfTtcblxuICBjb25zdCBfd2luUGFyYW1zID0ge1xuICAgIHdpZHRoOiAoZGltZW5zaW9ucyB8fCB7fSkud2lkdGgsXG4gICAgbWluV2lkdGg6IChkaW1lbnNpb25zIHx8IHt9KS5taW5XaWR0aCxcbiAgICBoZWlnaHQ6IChkaW1lbnNpb25zIHx8IHt9KS5oZWlnaHQsXG4gICAgbWluSGVpZ2h0OiAoZGltZW5zaW9ucyB8fCB7fSkubWluSGVpZ2h0LFxuICAgIC4uLihmcmFtZWxlc3MgPT09IHRydWUgPyBfZnJhbWVsZXNzT3B0cyA6IHt9KSxcbiAgICAuLi53aW5QYXJhbXMsXG4gIH07XG5cbiAgbGV0IHdpbmRvdzogQnJvd3NlcldpbmRvdztcblxuICBpZiAoY29tcG9uZW50KSB7XG4gICAgY29uc3QgcGFyYW1zID0gYGM9JHtjb21wb25lbnR9JiR7Y29tcG9uZW50UGFyYW1zID8gY29tcG9uZW50UGFyYW1zIDogJyd9YDtcbiAgICB3aW5kb3cgPSBhd2FpdCBjcmVhdGVXaW5kb3dGb3JMb2NhbENvbXBvbmVudCh0aXRsZSwgcGFyYW1zLCBfd2luUGFyYW1zKTtcbiAgfSBlbHNlIGlmICh1cmwpIHtcbiAgICB3aW5kb3cgPSBhd2FpdCBjcmVhdGVXaW5kb3codGl0bGUsIHVybCwgX3dpblBhcmFtcywgaWdub3JlQ2FjaGUpO1xuICB9IGVsc2Uge1xuICAgIHRocm93IG5ldyBFcnJvcihcIkVpdGhlciBjb21wb25lbnQgb3IgdXJsIG11c3QgYmUgZ2l2ZW4gdG8gb3BlbldpbmRvdygpXCIpO1xuICB9XG5cbiAgaWYgKG1lbnVUZW1wbGF0ZSAmJiAhaXNNYWNPUykge1xuICAgIHdpbmRvdy5zZXRNZW51KE1lbnUuYnVpbGRGcm9tVGVtcGxhdGUobWVudVRlbXBsYXRlKSk7XG4gIH1cblxuICB3aW5kb3dzLnB1c2god2luZG93KTtcbiAgd2luZG93c0J5VGl0bGVbdGl0bGVdID0gd2luZG93O1xuICB3aW5kb3cub24oJ2Nsb3NlZCcsICgpID0+IHsgZGVsZXRlIHdpbmRvd3NCeVRpdGxlW3RpdGxlXTsgY2xlYW5VcFdpbmRvd3MoKTsgfSk7XG5cbiAgcmV0dXJuIHdpbmRvdztcbn1cblxuXG5leHBvcnQgZnVuY3Rpb24gZ2V0V2luZG93QnlUaXRsZSh0aXRsZTogc3RyaW5nKTogQnJvd3NlcldpbmRvdyB8IHVuZGVmaW5lZCB7XG4gIHJldHVybiB3aW5kb3dzQnlUaXRsZVt0aXRsZV07XG59XG5cblxuZXhwb3J0IGZ1bmN0aW9uIGdldFdpbmRvdyhmdW5jOiAod2luOiBCcm93c2VyV2luZG93KSA9PiBib29sZWFuKTogQnJvd3NlcldpbmRvdyB8IHVuZGVmaW5lZCB7XG4gIHJldHVybiB3aW5kb3dzLmZpbmQoZnVuYyk7XG59XG5cblxuLy8gSXRlcmF0ZSBvdmVyIGFycmF5IG9mIHdpbmRvd3MgYW5kIHRyeSBhY2Nlc3Npbmcgd2luZG93IElELlxuLy8gSWYgaXQgdGhyb3dzLCB3aW5kb3cgd2FzIGNsb3NlZCBhbmQgd2UgcmVtb3ZlIGl0IGZyb20gdGhlIGFycmF5LlxuLy8gU3VwcG9zZWQgdG8gYmUgcnVuIGFmdGVyIGFueSB3aW5kb3cgaXMgY2xvc2VkXG5mdW5jdGlvbiBjbGVhblVwV2luZG93cygpIHtcbiAgdmFyIGRlbGV0ZWRXaW5kb3dzOiBudW1iZXJbXSA9IFtdO1xuICBmb3IgKGNvbnN0IFtpZHgsIHdpbl0gb2Ygd2luZG93cy5lbnRyaWVzKCkpIHtcbiAgICAvLyBXaGVuIGFjY2Vzc2luZyB0aGUgaWQgYXR0cmlidXRlIG9mIGEgY2xvc2VkIHdpbmRvdyxcbiAgICAvLyBpdOKAmWxsIHRocm93LiBXZeKAmWxsIG1hcmsgaXRzIGluZGV4IGZvciBkZWxldGlvbiB0aGVuLlxuICAgIHRyeSB7XG4gICAgICB3aW4uaWQ7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgZGVsZXRlZFdpbmRvd3MucHVzaChpZHggLSBkZWxldGVkV2luZG93cy5sZW5ndGgpO1xuICAgIH1cbiAgfVxuICBmb3IgKGNvbnN0IGlkeCBvZiBkZWxldGVkV2luZG93cykge1xuICAgIHdpbmRvd3Muc3BsaWNlKGlkeCwgMSk7XG4gIH1cbn1cblxuXG5mdW5jdGlvbiBjcmVhdGVXaW5kb3dGb3JMb2NhbENvbXBvbmVudCh0aXRsZTogc3RyaW5nLCBwYXJhbXM6IHN0cmluZywgd2luUGFyYW1zOiBhbnkpOiBQcm9taXNlPEJyb3dzZXJXaW5kb3c+IHtcbiAgbGV0IHVybDogc3RyaW5nO1xuXG4gIGlmIChpc0RldmVsb3BtZW50KSB7XG4gICAgdXJsID0gYGh0dHA6Ly9sb2NhbGhvc3Q6JHtwcm9jZXNzLmVudi5FTEVDVFJPTl9XRUJQQUNLX1dEU19QT1JUfT8ke3BhcmFtc31gO1xuICB9XG4gIGVsc2Uge1xuICAgIHVybCA9IGAke2Zvcm1hdFVybCh7XG4gICAgICBwYXRobmFtZTogcGF0aC5qb2luKF9fZGlybmFtZSwgJ2luZGV4Lmh0bWwnKSxcbiAgICAgIHByb3RvY29sOiAnZmlsZScsXG4gICAgICBzbGFzaGVzOiB0cnVlLFxuICAgIH0pfT8ke3BhcmFtc31gO1xuICB9XG5cbiAgcmV0dXJuIGNyZWF0ZVdpbmRvdyh0aXRsZSwgdXJsLCB3aW5QYXJhbXMpO1xufVxuXG5cbmZ1bmN0aW9uIGNyZWF0ZVdpbmRvdyh0aXRsZTogc3RyaW5nLCB1cmw6IHN0cmluZywgd2luUGFyYW1zOiBhbnksIGlnbm9yZUNhY2hlOiBib29sZWFuID0gZmFsc2UpOiBQcm9taXNlPEJyb3dzZXJXaW5kb3c+IHtcbiAgY29uc3Qgd2luZG93ID0gbmV3IEJyb3dzZXJXaW5kb3coe1xuICAgIHdlYlByZWZlcmVuY2VzOiB7bm9kZUludGVncmF0aW9uOiB0cnVlfSxcbiAgICB0aXRsZTogdGl0bGUsXG4gICAgc2hvdzogZmFsc2UsXG4gICAgLi4ud2luUGFyYW1zXG4gIH0pO1xuXG4gIGNvbnN0IHByb21pc2UgPSBuZXcgUHJvbWlzZTxCcm93c2VyV2luZG93PigocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgd2luZG93Lm9uY2UoJ3JlYWR5LXRvLXNob3cnLCAoKSA9PiB7XG4gICAgICB3aW5kb3cuc2hvdygpO1xuICAgICAgcmVzb2x2ZSh3aW5kb3cpO1xuICAgIH0pO1xuICB9KTtcblxuICBpZiAoaXNEZXZlbG9wbWVudCkge1xuICAgIHdpbmRvdy53ZWJDb250ZW50cy5vcGVuRGV2VG9vbHMoKTtcbiAgfVxuXG4gIGlmIChpZ25vcmVDYWNoZSkge1xuICAgIHdpbmRvdy5sb2FkVVJMKHVybCwgeydleHRyYUhlYWRlcnMnOiAncHJhZ21hOiBuby1jYWNoZVxcbid9KTtcbiAgfSBlbHNlIHtcbiAgICB3aW5kb3cubG9hZFVSTCh1cmwpO1xuICB9XG5cbiAgd2luZG93LndlYkNvbnRlbnRzLm9uKCdkZXZ0b29scy1vcGVuZWQnLCAoKSA9PiB7XG4gICAgd2luZG93LmZvY3VzKCk7XG4gICAgc2V0SW1tZWRpYXRlKCgpID0+IHtcbiAgICAgIHdpbmRvdy5mb2N1cygpXG4gICAgfSk7XG4gIH0pO1xuXG4gIHJldHVybiBwcm9taXNlO1xufVxuXG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBub3RpZnlBbGxXaW5kb3dzKGV2ZW50TmFtZTogc3RyaW5nLCBwYXlsb2FkPzogYW55KSB7XG4gIHJldHVybiBhd2FpdCBQcm9taXNlLmFsbCh3aW5kb3dzLm1hcChhc3luYyAod2luZG93KSA9PiB7XG4gICAgaWYgKHdpbmRvdykge1xuICAgICAgYXdhaXQgd2luZG93LndlYkNvbnRlbnRzLnNlbmQoZXZlbnROYW1lLCBwYXlsb2FkKTtcbiAgICB9XG4gICAgcmV0dXJuO1xuICB9KSk7XG59XG5cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIG5vdGlmeVdpbmRvdyh3aW5kb3dUaXRsZTogc3RyaW5nLCBldmVudE5hbWU6IHN0cmluZywgcGF5bG9hZD86IGFueSkge1xuICBjb25zdCB3aW5kb3cgPSBnZXRXaW5kb3dCeVRpdGxlKHdpbmRvd1RpdGxlKTtcbiAgaWYgKHdpbmRvdykge1xuICAgIGF3YWl0IHdpbmRvdy53ZWJDb250ZW50cy5zZW5kKGV2ZW50TmFtZSwgcGF5bG9hZCk7XG4gIH1cbn1cbiJdfQ==