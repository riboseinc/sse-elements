import { ipcRenderer } from 'electron';
import { useEffect, useState } from 'react';
export function useSetting(name, initialValue) {
    const [value, setValue] = useState(initialValue);
    useEffect(() => {
        ipcRenderer.once('get-setting', handleSettingResponse);
        return function cleanup() {
            ipcRenderer.removeListener('get-setting', handleSettingResponse);
        };
    }, []);
    function handleSettingResponse(evt, value) {
        setValue(value);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVuZGVyZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvc2V0dGluZ3MvcmVuZGVyZXIudHN4Il0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLE9BQU8sRUFBRSxXQUFXLEVBQUUsTUFBTSxVQUFVLENBQUM7QUFDdkMsT0FBTyxFQUFFLFNBQVMsRUFBRSxRQUFRLEVBQUUsTUFBTSxPQUFPLENBQUM7QUFHNUMsTUFBTSxVQUFVLFVBQVUsQ0FBSSxJQUFZLEVBQUUsWUFBZTtJQUN6RCxNQUFNLENBQUMsS0FBSyxFQUFFLFFBQVEsQ0FBQyxHQUFHLFFBQVEsQ0FBQyxZQUFZLENBQUMsQ0FBQztJQUVqRCxTQUFTLENBQUMsR0FBRyxFQUFFO1FBQ2IsV0FBVyxDQUFDLElBQUksQ0FBQyxhQUFhLEVBQUUscUJBQXFCLENBQUMsQ0FBQztRQUN2RCxPQUFPLFNBQVMsT0FBTztZQUNyQixXQUFXLENBQUMsY0FBYyxDQUFDLGFBQWEsRUFBRSxxQkFBcUIsQ0FBQyxDQUFDO1FBQ25FLENBQUMsQ0FBQTtJQUNILENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQztJQUVQLFNBQVMscUJBQXFCLENBQUMsR0FBUSxFQUFFLEtBQVU7UUFDakQsUUFBUSxDQUFDLEtBQVUsQ0FBQyxDQUFDO0lBQ3ZCLENBQUM7SUFFRCxLQUFLLFVBQVUsTUFBTTtRQUNuQixNQUFNLFdBQVcsQ0FBQyxJQUFJLENBQUMsYUFBYSxFQUFFLElBQUksRUFBRSxLQUFLLENBQUMsQ0FBQztJQUNyRCxDQUFDO0lBRUQsT0FBTztRQUNMLEtBQUssRUFBRSxLQUFLO1FBQ1osR0FBRyxFQUFFLFFBQVE7UUFDYixNQUFNLEVBQUUsTUFBTTtLQUNmLENBQUM7QUFDSixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgaXBjUmVuZGVyZXIgfSBmcm9tICdlbGVjdHJvbic7XG5pbXBvcnQgeyB1c2VFZmZlY3QsIHVzZVN0YXRlIH0gZnJvbSAncmVhY3QnO1xuXG5cbmV4cG9ydCBmdW5jdGlvbiB1c2VTZXR0aW5nPFQ+KG5hbWU6IHN0cmluZywgaW5pdGlhbFZhbHVlOiBUKSB7XG4gIGNvbnN0IFt2YWx1ZSwgc2V0VmFsdWVdID0gdXNlU3RhdGUoaW5pdGlhbFZhbHVlKTtcblxuICB1c2VFZmZlY3QoKCkgPT4ge1xuICAgIGlwY1JlbmRlcmVyLm9uY2UoJ2dldC1zZXR0aW5nJywgaGFuZGxlU2V0dGluZ1Jlc3BvbnNlKTtcbiAgICByZXR1cm4gZnVuY3Rpb24gY2xlYW51cCgpIHtcbiAgICAgIGlwY1JlbmRlcmVyLnJlbW92ZUxpc3RlbmVyKCdnZXQtc2V0dGluZycsIGhhbmRsZVNldHRpbmdSZXNwb25zZSk7XG4gICAgfVxuICB9LCBbXSk7XG5cbiAgZnVuY3Rpb24gaGFuZGxlU2V0dGluZ1Jlc3BvbnNlKGV2dDogYW55LCB2YWx1ZTogYW55KSB7XG4gICAgc2V0VmFsdWUodmFsdWUgYXMgVCk7XG4gIH1cblxuICBhc3luYyBmdW5jdGlvbiBjb21taXQoKSB7XG4gICAgYXdhaXQgaXBjUmVuZGVyZXIuc2VuZCgnc2V0LXNldHRpbmcnLCBuYW1lLCB2YWx1ZSk7XG4gIH1cblxuICByZXR1cm4ge1xuICAgIHZhbHVlOiB2YWx1ZSxcbiAgICBzZXQ6IHNldFZhbHVlLFxuICAgIGNvbW1pdDogY29tbWl0LFxuICB9O1xufVxuIl19