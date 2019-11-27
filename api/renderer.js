/* Simple API on top of Electron’s IPC framework, the `renderer` side.
   Provides functions for sending API requests to fetch/store data and/or open window. */
import { ipcRenderer } from 'electron';
import { reviveJsonValue, getEventNamesForEndpoint, getEventNamesForWindowEndpoint } from './utils';
// TODO (#4): Refactor into generic main APIs, rather than Workspace-centered
// TODO: Implement hook for using time travel APIs with undo/redo
// and transactions for race condition avoidance.
class RequestFailure extends Error {
    constructor(errorMessageList) {
        super(errorMessageList.join('; '));
        this.errorMessageList = errorMessageList;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}
export async function notifyAllWindows(evtName, payload) {
    /* Sends an event to all open windows. */
    await ipcRenderer.send('notify-all-windows', evtName, payload);
}
export async function request(endpointName, ...args) {
    // TODO: This does not handle a timeout, so if `main` endpoint is misconfigured and never responds
    // the handler will remain listening
    const eventNames = getEventNamesForEndpoint(endpointName);
    return new Promise((resolve, reject) => {
        function handleResp(evt, rawData) {
            ipcRenderer.removeListener(eventNames.response, handleResp);
            const data = JSON.parse(rawData, reviveJsonValue);
            if (data.errors !== undefined) {
                // Means main is using listen(), new API
                const resp = data;
                if (resp.result === undefined) {
                    if (resp.errors.length > 0) {
                        reject(new RequestFailure(resp.errors));
                    }
                    else {
                        reject(new RequestFailure(["Unknown error"]));
                    }
                }
                resolve(data.result);
            }
            else {
                // Means main is using makeEndpoint(), legacy API
                const resp = data;
                resolve(resp);
            }
        }
        ipcRenderer.on(eventNames.response, handleResp);
        ipcRenderer.send(eventNames.request, ...serializeArgs(args));
    });
}
export function openWindow(endpointName, params) {
    const eventNames = getEventNamesForWindowEndpoint(endpointName);
    ipcRenderer.sendSync(eventNames.request, JSON.stringify(params || {}));
}
function serializeArgs(args) {
    /* Helper function that stringifies an array of objects with JSON.
       We don’t necessarily want Electron to handle that for us,
       because we might want custom parsing for e.g. timestamps in JSON. */
    return args.map(val => JSON.stringify(val));
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVuZGVyZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvYXBpL3JlbmRlcmVyLnRzeCJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTt5RkFDeUY7QUFFekYsT0FBTyxFQUFFLFdBQVcsRUFBRSxNQUFNLFVBQVUsQ0FBQztBQUV2QyxPQUFPLEVBQWUsZUFBZSxFQUFFLHdCQUF3QixFQUFFLDhCQUE4QixFQUFFLE1BQU0sU0FBUyxDQUFDO0FBR2pILDZFQUE2RTtBQUc3RSxpRUFBaUU7QUFDakUsaURBQWlEO0FBR2pELE1BQU0sY0FBZSxTQUFRLEtBQUs7SUFDaEMsWUFBbUIsZ0JBQTBCO1FBQzNDLEtBQUssQ0FBQyxnQkFBZ0IsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQztRQURsQixxQkFBZ0IsR0FBaEIsZ0JBQWdCLENBQVU7UUFFM0MsTUFBTSxDQUFDLGNBQWMsQ0FBQyxJQUFJLEVBQUUsR0FBRyxDQUFDLE1BQU0sQ0FBQyxTQUFTLENBQUMsQ0FBQztJQUNwRCxDQUFDO0NBQ0Y7QUFHRCxNQUFNLENBQUMsS0FBSyxVQUFVLGdCQUFnQixDQUFDLE9BQWUsRUFBRSxPQUFhO0lBQ25FLHlDQUF5QztJQUN6QyxNQUFNLFdBQVcsQ0FBQyxJQUFJLENBQUMsb0JBQW9CLEVBQUUsT0FBTyxFQUFFLE9BQU8sQ0FBQyxDQUFBO0FBQ2hFLENBQUM7QUFHRCxNQUFNLENBQUMsS0FBSyxVQUFVLE9BQU8sQ0FBSSxZQUFvQixFQUFFLEdBQUcsSUFBVztJQUNuRSxrR0FBa0c7SUFDbEcsb0NBQW9DO0lBRXBDLE1BQU0sVUFBVSxHQUFHLHdCQUF3QixDQUFDLFlBQVksQ0FBQyxDQUFDO0lBQzFELE9BQU8sSUFBSSxPQUFPLENBQUksQ0FBQyxPQUFPLEVBQUUsTUFBTSxFQUFFLEVBQUU7UUFDeEMsU0FBUyxVQUFVLENBQUMsR0FBUSxFQUFFLE9BQWU7WUFDM0MsV0FBVyxDQUFDLGNBQWMsQ0FBQyxVQUFVLENBQUMsUUFBUSxFQUFFLFVBQVUsQ0FBQyxDQUFDO1lBQzVELE1BQU0sSUFBSSxHQUFRLElBQUksQ0FBQyxLQUFLLENBQUMsT0FBTyxFQUFFLGVBQWUsQ0FBQyxDQUFDO1lBRXZELElBQUksSUFBSSxDQUFDLE1BQU0sS0FBSyxTQUFTLEVBQUU7Z0JBQzdCLHdDQUF3QztnQkFDeEMsTUFBTSxJQUFJLEdBQW1CLElBQUksQ0FBQztnQkFFbEMsSUFBSSxJQUFJLENBQUMsTUFBTSxLQUFLLFNBQVMsRUFBRTtvQkFDN0IsSUFBSSxJQUFJLENBQUMsTUFBTSxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUU7d0JBQzFCLE1BQU0sQ0FBQyxJQUFJLGNBQWMsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQztxQkFDekM7eUJBQU07d0JBQ0wsTUFBTSxDQUFDLElBQUksY0FBYyxDQUFDLENBQUMsZUFBZSxDQUFDLENBQUMsQ0FBQyxDQUFDO3FCQUMvQztpQkFDRjtnQkFDRCxPQUFPLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDO2FBQ3RCO2lCQUFNO2dCQUNMLGlEQUFpRDtnQkFDakQsTUFBTSxJQUFJLEdBQU0sSUFBSSxDQUFDO2dCQUNyQixPQUFPLENBQUMsSUFBSSxDQUFDLENBQUM7YUFDZjtRQUNILENBQUM7UUFDRCxXQUFXLENBQUMsRUFBRSxDQUFDLFVBQVUsQ0FBQyxRQUFRLEVBQUUsVUFBVSxDQUFDLENBQUM7UUFDaEQsV0FBVyxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsT0FBTyxFQUFFLEdBQUcsYUFBYSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUM7SUFDL0QsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDO0FBR0QsTUFBTSxVQUFVLFVBQVUsQ0FBQyxZQUFvQixFQUFFLE1BQVk7SUFDM0QsTUFBTSxVQUFVLEdBQUcsOEJBQThCLENBQUMsWUFBWSxDQUFDLENBQUM7SUFDaEUsV0FBVyxDQUFDLFFBQVEsQ0FBQyxVQUFVLENBQUMsT0FBTyxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsTUFBTSxJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQUM7QUFDekUsQ0FBQztBQUdELFNBQVMsYUFBYSxDQUFDLElBQVc7SUFDaEM7OzJFQUV1RTtJQUV2RSxPQUFPLElBQUksQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUM7QUFDOUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qIFNpbXBsZSBBUEkgb24gdG9wIG9mIEVsZWN0cm9u4oCZcyBJUEMgZnJhbWV3b3JrLCB0aGUgYHJlbmRlcmVyYCBzaWRlLlxuICAgUHJvdmlkZXMgZnVuY3Rpb25zIGZvciBzZW5kaW5nIEFQSSByZXF1ZXN0cyB0byBmZXRjaC9zdG9yZSBkYXRhIGFuZC9vciBvcGVuIHdpbmRvdy4gKi9cblxuaW1wb3J0IHsgaXBjUmVuZGVyZXIgfSBmcm9tICdlbGVjdHJvbic7XG5cbmltcG9ydCB7IEFQSVJlc3BvbnNlLCByZXZpdmVKc29uVmFsdWUsIGdldEV2ZW50TmFtZXNGb3JFbmRwb2ludCwgZ2V0RXZlbnROYW1lc0ZvcldpbmRvd0VuZHBvaW50IH0gZnJvbSAnLi91dGlscyc7XG5cblxuLy8gVE9ETyAoIzQpOiBSZWZhY3RvciBpbnRvIGdlbmVyaWMgbWFpbiBBUElzLCByYXRoZXIgdGhhbiBXb3Jrc3BhY2UtY2VudGVyZWRcblxuXG4vLyBUT0RPOiBJbXBsZW1lbnQgaG9vayBmb3IgdXNpbmcgdGltZSB0cmF2ZWwgQVBJcyB3aXRoIHVuZG8vcmVkb1xuLy8gYW5kIHRyYW5zYWN0aW9ucyBmb3IgcmFjZSBjb25kaXRpb24gYXZvaWRhbmNlLlxuXG5cbmNsYXNzIFJlcXVlc3RGYWlsdXJlIGV4dGVuZHMgRXJyb3Ige1xuICBjb25zdHJ1Y3RvcihwdWJsaWMgZXJyb3JNZXNzYWdlTGlzdDogc3RyaW5nW10pIHtcbiAgICBzdXBlcihlcnJvck1lc3NhZ2VMaXN0LmpvaW4oJzsgJykpO1xuICAgIE9iamVjdC5zZXRQcm90b3R5cGVPZih0aGlzLCBuZXcudGFyZ2V0LnByb3RvdHlwZSk7XG4gIH1cbn1cblxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gbm90aWZ5QWxsV2luZG93cyhldnROYW1lOiBzdHJpbmcsIHBheWxvYWQ/OiBhbnkpOiBQcm9taXNlPHZvaWQ+IHtcbiAgLyogU2VuZHMgYW4gZXZlbnQgdG8gYWxsIG9wZW4gd2luZG93cy4gKi9cbiAgYXdhaXQgaXBjUmVuZGVyZXIuc2VuZCgnbm90aWZ5LWFsbC13aW5kb3dzJywgZXZ0TmFtZSwgcGF5bG9hZClcbn1cblxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVxdWVzdDxUPihlbmRwb2ludE5hbWU6IHN0cmluZywgLi4uYXJnczogYW55W10pOiBQcm9taXNlPFQ+IHtcbiAgLy8gVE9ETzogVGhpcyBkb2VzIG5vdCBoYW5kbGUgYSB0aW1lb3V0LCBzbyBpZiBgbWFpbmAgZW5kcG9pbnQgaXMgbWlzY29uZmlndXJlZCBhbmQgbmV2ZXIgcmVzcG9uZHNcbiAgLy8gdGhlIGhhbmRsZXIgd2lsbCByZW1haW4gbGlzdGVuaW5nXG5cbiAgY29uc3QgZXZlbnROYW1lcyA9IGdldEV2ZW50TmFtZXNGb3JFbmRwb2ludChlbmRwb2ludE5hbWUpO1xuICByZXR1cm4gbmV3IFByb21pc2U8VD4oKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgIGZ1bmN0aW9uIGhhbmRsZVJlc3AoZXZ0OiBhbnksIHJhd0RhdGE6IHN0cmluZykge1xuICAgICAgaXBjUmVuZGVyZXIucmVtb3ZlTGlzdGVuZXIoZXZlbnROYW1lcy5yZXNwb25zZSwgaGFuZGxlUmVzcCk7XG4gICAgICBjb25zdCBkYXRhOiBhbnkgPSBKU09OLnBhcnNlKHJhd0RhdGEsIHJldml2ZUpzb25WYWx1ZSk7XG5cbiAgICAgIGlmIChkYXRhLmVycm9ycyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIC8vIE1lYW5zIG1haW4gaXMgdXNpbmcgbGlzdGVuKCksIG5ldyBBUElcbiAgICAgICAgY29uc3QgcmVzcDogQVBJUmVzcG9uc2U8VD4gPSBkYXRhO1xuXG4gICAgICAgIGlmIChyZXNwLnJlc3VsdCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgaWYgKHJlc3AuZXJyb3JzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIHJlamVjdChuZXcgUmVxdWVzdEZhaWx1cmUocmVzcC5lcnJvcnMpKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcmVqZWN0KG5ldyBSZXF1ZXN0RmFpbHVyZShbXCJVbmtub3duIGVycm9yXCJdKSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJlc29sdmUoZGF0YS5yZXN1bHQpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gTWVhbnMgbWFpbiBpcyB1c2luZyBtYWtlRW5kcG9pbnQoKSwgbGVnYWN5IEFQSVxuICAgICAgICBjb25zdCByZXNwOiBUID0gZGF0YTtcbiAgICAgICAgcmVzb2x2ZShyZXNwKTtcbiAgICAgIH1cbiAgICB9XG4gICAgaXBjUmVuZGVyZXIub24oZXZlbnROYW1lcy5yZXNwb25zZSwgaGFuZGxlUmVzcCk7XG4gICAgaXBjUmVuZGVyZXIuc2VuZChldmVudE5hbWVzLnJlcXVlc3QsIC4uLnNlcmlhbGl6ZUFyZ3MoYXJncykpO1xuICB9KTtcbn1cblxuXG5leHBvcnQgZnVuY3Rpb24gb3BlbldpbmRvdyhlbmRwb2ludE5hbWU6IHN0cmluZywgcGFyYW1zPzogYW55KTogdm9pZCB7XG4gIGNvbnN0IGV2ZW50TmFtZXMgPSBnZXRFdmVudE5hbWVzRm9yV2luZG93RW5kcG9pbnQoZW5kcG9pbnROYW1lKTtcbiAgaXBjUmVuZGVyZXIuc2VuZFN5bmMoZXZlbnROYW1lcy5yZXF1ZXN0LCBKU09OLnN0cmluZ2lmeShwYXJhbXMgfHwge30pKTtcbn1cblxuXG5mdW5jdGlvbiBzZXJpYWxpemVBcmdzKGFyZ3M6IGFueVtdKTogc3RyaW5nW10ge1xuICAvKiBIZWxwZXIgZnVuY3Rpb24gdGhhdCBzdHJpbmdpZmllcyBhbiBhcnJheSBvZiBvYmplY3RzIHdpdGggSlNPTi5cbiAgICAgV2UgZG9u4oCZdCBuZWNlc3NhcmlseSB3YW50IEVsZWN0cm9uIHRvIGhhbmRsZSB0aGF0IGZvciB1cyxcbiAgICAgYmVjYXVzZSB3ZSBtaWdodCB3YW50IGN1c3RvbSBwYXJzaW5nIGZvciBlLmcuIHRpbWVzdGFtcHMgaW4gSlNPTi4gKi9cblxuICByZXR1cm4gYXJncy5tYXAodmFsID0+IEpTT04uc3RyaW5naWZ5KHZhbCkpO1xufVxuIl19