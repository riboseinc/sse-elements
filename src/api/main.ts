/* Simple API on top of Electron’s IPC framework, the `main` side.
   Provides functions for handling API requests to fetch/store data and/or open window. */

import * as log from 'electron-log';

import { ipcMain } from 'electron';
import { openWindow, WindowOpenerParams } from '../main/window';

import { APIResponse, reviveJsonValue, getEventNamesForEndpoint, getEventNamesForWindowEndpoint } from './utils';


type Handler<I, O> = (params: I) => Promise<O>;
export function listen<I, O>(name: string, handler: Handler<I, O>) {
  /* Defines an API endpoint with I input and O output types.
     Takes endpoint name and handler function.

     Handler is expected to be an async function
     that takes deserialized input params and returns the output.

     The endpoint handles input deserialization,
     wrapping the output in response object { errors: string[], result: O },
     and response serialization. */

  const eventNames = getEventNamesForEndpoint(name);

  ipcMain.on(eventNames.request, async (evt: any, rawInput?: string) => {
    let response: APIResponse<O>;

    // We may be able to switch to JSON’s own (de)serialization behavior
    // if we find a way to plug our bespoke `reviveJsonValue`.
    const input: I = JSON.parse(rawInput || '{}', reviveJsonValue);

    try {
      response = { errors: [], result: await handler(input) };
    } catch (e) {
      log.error(`SSE: API: Error handling request to ${name}! ${e.name}: ${e.message}`);
      response = { errors: [`${e.message}`], result: undefined };
    }

    log.debug(`SSE: API: handled request to ${name}`);

    evt.reply(eventNames.response, JSON.stringify(response));
  });
}


export function makeWindowEndpoint(name: string, getWindowOpts: (params: any) => WindowOpenerParams): void {
  const eventNames = getEventNamesForWindowEndpoint(name);

  ipcMain.on(eventNames.request, async (evt: any, params?: string) => {
    const parsedParams: any = JSON.parse(params || '{}', reviveJsonValue);
    await openWindow(getWindowOpts(parsedParams));

    const result = JSON.stringify({ errors: [] });
    evt.returnValue = result;
    evt.reply(eventNames.response, result);
  });
}
