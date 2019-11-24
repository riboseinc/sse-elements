import { ipcRenderer } from 'electron';
import { useEffect, useState } from 'react';


export function useSetting<T>(name: string, initialValue: T) {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    ipcRenderer.once('get-setting', handleSettingResponse);
    ipcRenderer.send('get-setting', name);
    return function cleanup() {
      ipcRenderer.removeListener('get-setting', handleSettingResponse);
    }
  }, []);

  function handleSettingResponse(evt: any, receivedSettingName: string, value: any) {
    if (name === receivedSettingName) {
      setValue(value as T);
    }
  }

  async function commit() {
    await ipcRenderer.send('set-setting', name, value);
  }

  return {
    value: value,
    set: setValue,
    commit: commit,
  };
}
