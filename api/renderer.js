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
        Object.setPrototypeOf(this, new.target.prototype);
    }
}
export async function request(endpointName, ...args) {
    // TODO: This does not handle a timeout, so if `main` endpoint is misconfigured and never responds
    // the handler will remain listening
    const eventNames = getEventNamesForEndpoint(endpointName);
    return new Promise((resolve, reject) => {
        function handleResp(evt, rawData) {
            ipcRenderer.removeListener(eventNames.response, handleResp);
            const data = JSON.parse(rawData, reviveJsonValue);
            if (data.errors) {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVuZGVyZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvYXBpL3JlbmRlcmVyLnRzeCJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTt5RkFDeUY7QUFFekYsT0FBTyxFQUFFLFdBQVcsRUFBRSxNQUFNLFVBQVUsQ0FBQztBQUV2QyxPQUFPLEVBQWUsZUFBZSxFQUFFLHdCQUF3QixFQUFFLDhCQUE4QixFQUFFLE1BQU0sU0FBUyxDQUFDO0FBR2pILDZFQUE2RTtBQUc3RSxpRUFBaUU7QUFDakUsaURBQWlEO0FBR2pELE1BQU0sY0FBZSxTQUFRLEtBQUs7SUFDaEMsWUFBWSxnQkFBMEI7UUFDcEMsS0FBSyxDQUFDLGdCQUFnQixDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDO1FBQ25DLE1BQU0sQ0FBQyxjQUFjLENBQUMsSUFBSSxFQUFFLEdBQUcsQ0FBQyxNQUFNLENBQUMsU0FBUyxDQUFDLENBQUM7SUFDcEQsQ0FBQztDQUNGO0FBR0QsTUFBTSxDQUFDLEtBQUssVUFBVSxPQUFPLENBQUksWUFBb0IsRUFBRSxHQUFHLElBQVc7SUFDbkUsa0dBQWtHO0lBQ2xHLG9DQUFvQztJQUVwQyxNQUFNLFVBQVUsR0FBRyx3QkFBd0IsQ0FBQyxZQUFZLENBQUMsQ0FBQztJQUMxRCxPQUFPLElBQUksT0FBTyxDQUFJLENBQUMsT0FBTyxFQUFFLE1BQU0sRUFBRSxFQUFFO1FBQ3hDLFNBQVMsVUFBVSxDQUFDLEdBQVEsRUFBRSxPQUFlO1lBQzNDLFdBQVcsQ0FBQyxjQUFjLENBQUMsVUFBVSxDQUFDLFFBQVEsRUFBRSxVQUFVLENBQUMsQ0FBQztZQUM1RCxNQUFNLElBQUksR0FBUSxJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sRUFBRSxlQUFlLENBQUMsQ0FBQztZQUV2RCxJQUFJLElBQUksQ0FBQyxNQUFNLEVBQUU7Z0JBQ2Ysd0NBQXdDO2dCQUN4QyxNQUFNLElBQUksR0FBbUIsSUFBSSxDQUFDO2dCQUVsQyxJQUFJLElBQUksQ0FBQyxNQUFNLEtBQUssU0FBUyxFQUFFO29CQUM3QixJQUFJLElBQUksQ0FBQyxNQUFNLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRTt3QkFDMUIsTUFBTSxDQUFDLElBQUksY0FBYyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDO3FCQUN6Qzt5QkFBTTt3QkFDTCxNQUFNLENBQUMsSUFBSSxjQUFjLENBQUMsQ0FBQyxlQUFlLENBQUMsQ0FBQyxDQUFDLENBQUM7cUJBQy9DO2lCQUNGO2dCQUNELE9BQU8sQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUM7YUFDdEI7aUJBQU07Z0JBQ0wsaURBQWlEO2dCQUNqRCxNQUFNLElBQUksR0FBTSxJQUFJLENBQUM7Z0JBQ3JCLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQzthQUNmO1FBQ0gsQ0FBQztRQUNELFdBQVcsQ0FBQyxFQUFFLENBQUMsVUFBVSxDQUFDLFFBQVEsRUFBRSxVQUFVLENBQUMsQ0FBQztRQUNoRCxXQUFXLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxPQUFPLEVBQUUsR0FBRyxhQUFhLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQztJQUMvRCxDQUFDLENBQUMsQ0FBQztBQUNMLENBQUM7QUFHRCxNQUFNLFVBQVUsVUFBVSxDQUFDLFlBQW9CLEVBQUUsTUFBWTtJQUMzRCxNQUFNLFVBQVUsR0FBRyw4QkFBOEIsQ0FBQyxZQUFZLENBQUMsQ0FBQztJQUNoRSxXQUFXLENBQUMsUUFBUSxDQUFDLFVBQVUsQ0FBQyxPQUFPLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxNQUFNLElBQUksRUFBRSxDQUFDLENBQUMsQ0FBQztBQUN6RSxDQUFDO0FBR0QsU0FBUyxhQUFhLENBQUMsSUFBVztJQUNoQzs7MkVBRXVFO0lBRXZFLE9BQU8sSUFBSSxDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQztBQUM5QyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyogU2ltcGxlIEFQSSBvbiB0b3Agb2YgRWxlY3Ryb27igJlzIElQQyBmcmFtZXdvcmssIHRoZSBgcmVuZGVyZXJgIHNpZGUuXG4gICBQcm92aWRlcyBmdW5jdGlvbnMgZm9yIHNlbmRpbmcgQVBJIHJlcXVlc3RzIHRvIGZldGNoL3N0b3JlIGRhdGEgYW5kL29yIG9wZW4gd2luZG93LiAqL1xuXG5pbXBvcnQgeyBpcGNSZW5kZXJlciB9IGZyb20gJ2VsZWN0cm9uJztcblxuaW1wb3J0IHsgQVBJUmVzcG9uc2UsIHJldml2ZUpzb25WYWx1ZSwgZ2V0RXZlbnROYW1lc0ZvckVuZHBvaW50LCBnZXRFdmVudE5hbWVzRm9yV2luZG93RW5kcG9pbnQgfSBmcm9tICcuL3V0aWxzJztcblxuXG4vLyBUT0RPICgjNCk6IFJlZmFjdG9yIGludG8gZ2VuZXJpYyBtYWluIEFQSXMsIHJhdGhlciB0aGFuIFdvcmtzcGFjZS1jZW50ZXJlZFxuXG5cbi8vIFRPRE86IEltcGxlbWVudCBob29rIGZvciB1c2luZyB0aW1lIHRyYXZlbCBBUElzIHdpdGggdW5kby9yZWRvXG4vLyBhbmQgdHJhbnNhY3Rpb25zIGZvciByYWNlIGNvbmRpdGlvbiBhdm9pZGFuY2UuXG5cblxuY2xhc3MgUmVxdWVzdEZhaWx1cmUgZXh0ZW5kcyBFcnJvciB7XG4gIGNvbnN0cnVjdG9yKGVycm9yTWVzc2FnZUxpc3Q6IHN0cmluZ1tdKSB7XG4gICAgc3VwZXIoZXJyb3JNZXNzYWdlTGlzdC5qb2luKCc7ICcpKTtcbiAgICBPYmplY3Quc2V0UHJvdG90eXBlT2YodGhpcywgbmV3LnRhcmdldC5wcm90b3R5cGUpO1xuICB9XG59XG5cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlcXVlc3Q8VD4oZW5kcG9pbnROYW1lOiBzdHJpbmcsIC4uLmFyZ3M6IGFueVtdKTogUHJvbWlzZTxUPiB7XG4gIC8vIFRPRE86IFRoaXMgZG9lcyBub3QgaGFuZGxlIGEgdGltZW91dCwgc28gaWYgYG1haW5gIGVuZHBvaW50IGlzIG1pc2NvbmZpZ3VyZWQgYW5kIG5ldmVyIHJlc3BvbmRzXG4gIC8vIHRoZSBoYW5kbGVyIHdpbGwgcmVtYWluIGxpc3RlbmluZ1xuXG4gIGNvbnN0IGV2ZW50TmFtZXMgPSBnZXRFdmVudE5hbWVzRm9yRW5kcG9pbnQoZW5kcG9pbnROYW1lKTtcbiAgcmV0dXJuIG5ldyBQcm9taXNlPFQ+KChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICBmdW5jdGlvbiBoYW5kbGVSZXNwKGV2dDogYW55LCByYXdEYXRhOiBzdHJpbmcpIHtcbiAgICAgIGlwY1JlbmRlcmVyLnJlbW92ZUxpc3RlbmVyKGV2ZW50TmFtZXMucmVzcG9uc2UsIGhhbmRsZVJlc3ApO1xuICAgICAgY29uc3QgZGF0YTogYW55ID0gSlNPTi5wYXJzZShyYXdEYXRhLCByZXZpdmVKc29uVmFsdWUpO1xuXG4gICAgICBpZiAoZGF0YS5lcnJvcnMpIHtcbiAgICAgICAgLy8gTWVhbnMgbWFpbiBpcyB1c2luZyBsaXN0ZW4oKSwgbmV3IEFQSVxuICAgICAgICBjb25zdCByZXNwOiBBUElSZXNwb25zZTxUPiA9IGRhdGE7XG5cbiAgICAgICAgaWYgKHJlc3AucmVzdWx0ID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICBpZiAocmVzcC5lcnJvcnMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgcmVqZWN0KG5ldyBSZXF1ZXN0RmFpbHVyZShyZXNwLmVycm9ycykpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICByZWplY3QobmV3IFJlcXVlc3RGYWlsdXJlKFtcIlVua25vd24gZXJyb3JcIl0pKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmVzb2x2ZShkYXRhLnJlc3VsdCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBNZWFucyBtYWluIGlzIHVzaW5nIG1ha2VFbmRwb2ludCgpLCBsZWdhY3kgQVBJXG4gICAgICAgIGNvbnN0IHJlc3A6IFQgPSBkYXRhO1xuICAgICAgICByZXNvbHZlKHJlc3ApO1xuICAgICAgfVxuICAgIH1cbiAgICBpcGNSZW5kZXJlci5vbihldmVudE5hbWVzLnJlc3BvbnNlLCBoYW5kbGVSZXNwKTtcbiAgICBpcGNSZW5kZXJlci5zZW5kKGV2ZW50TmFtZXMucmVxdWVzdCwgLi4uc2VyaWFsaXplQXJncyhhcmdzKSk7XG4gIH0pO1xufVxuXG5cbmV4cG9ydCBmdW5jdGlvbiBvcGVuV2luZG93KGVuZHBvaW50TmFtZTogc3RyaW5nLCBwYXJhbXM/OiBhbnkpOiB2b2lkIHtcbiAgY29uc3QgZXZlbnROYW1lcyA9IGdldEV2ZW50TmFtZXNGb3JXaW5kb3dFbmRwb2ludChlbmRwb2ludE5hbWUpO1xuICBpcGNSZW5kZXJlci5zZW5kU3luYyhldmVudE5hbWVzLnJlcXVlc3QsIEpTT04uc3RyaW5naWZ5KHBhcmFtcyB8fCB7fSkpO1xufVxuXG5cbmZ1bmN0aW9uIHNlcmlhbGl6ZUFyZ3MoYXJnczogYW55W10pOiBzdHJpbmdbXSB7XG4gIC8qIEhlbHBlciBmdW5jdGlvbiB0aGF0IHN0cmluZ2lmaWVzIGFuIGFycmF5IG9mIG9iamVjdHMgd2l0aCBKU09OLlxuICAgICBXZSBkb27igJl0IG5lY2Vzc2FyaWx5IHdhbnQgRWxlY3Ryb24gdG8gaGFuZGxlIHRoYXQgZm9yIHVzLFxuICAgICBiZWNhdXNlIHdlIG1pZ2h0IHdhbnQgY3VzdG9tIHBhcnNpbmcgZm9yIGUuZy4gdGltZXN0YW1wcyBpbiBKU09OLiAqL1xuXG4gIHJldHVybiBhcmdzLm1hcCh2YWwgPT4gSlNPTi5zdHJpbmdpZnkodmFsKSk7XG59XG4iXX0=