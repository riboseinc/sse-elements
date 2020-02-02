/* Wraps IPC communication in React hooks & locking queue. */

import AsyncLock from 'async-lock';
import { ipcRenderer } from 'electron';
import { useEffect, useState } from 'react';

import { reviveJsonValue } from '../api/utils';


type IPCResponse<O> = {
  errors: string[]
  result: O | undefined
};


class IPCFailure extends Error {
  constructor(public errorMessageList: string[]) {
    super(errorMessageList.join('; '));
    Object.setPrototypeOf(this, new.target.prototype);
  }
}


export function useIPCValue<I extends object, O>
(endpointName: string, initialValue: O, payload?: I): IPCHook<O> {
  const [value, updateValue] = useState(initialValue);
  const [errors, updateErrors] = useState([] as string[]);
  const [reqCounter, updateReqCounter] = useState(0);

  useEffect(() => {
    ipcEndpointRequestLock.acquire(endpointName, async function () {
      const resp = await ipcRenderer.invoke(endpointName, JSON.stringify(payload || {}));
      const data = JSON.parse(resp, reviveJsonValue);

      if (data.errors !== undefined) {
        const resp = data as IPCResponse<O>;
        updateValue(data.result);

        if (resp.result === undefined) {
          if (resp.errors.length > 0) {
            updateErrors(resp.errors);
          } else {
            updateErrors(["Unknown error"]);
          }
        }
      } else {
        updateValue(data as O);
      }
    });
  }, []);

  return {
    value: value,
    errors: errors,
    refresh: () => updateReqCounter(counter => { return counter += 1 }),
    _reqCounter: reqCounter,
  };
}


export function useIPCRequest<I extends object, O>
(endpointName: string, payload?: I): Promise<O> {
  return ipcEndpointRequestLock.acquire(endpointName, async function () {
    const rawData = await ipcRenderer.invoke(endpointName, JSON.stringify(payload));
    return new Promise<O>((resolve, reject) => {
      const data = JSON.parse(rawData, reviveJsonValue);
      if (data.errors !== undefined) {
        // Means main is using listen(), new API
        const resp: IPCResponse<O> = data;

        if (resp.result === undefined) {
          if (resp.errors.length > 0) {
            reject(new IPCFailure(resp.errors));
          } else {
            reject(new IPCFailure(["Unknown error"]));
          }
        }
        resolve(data.result);
      } else {
        // Means main is using makeEndpoint(), legacy API
        const result: O = data;
        resolve(result);
      }
    });
  });
}


export async function useIPCWindowEventRelayer
<
  I extends object = { eventName: string, eventPayload?: any },
  O = { success: true },
>
(payload: I): Promise<O> {
  return await useIPCRequest<I, O>('relay-event-to-all-windows', payload);
}


interface IPCHook<T> {
  value: T,
  errors: string[],
  refresh: () => void,
  _reqCounter: number,
}


const ipcEndpointRequestLock = new AsyncLock();