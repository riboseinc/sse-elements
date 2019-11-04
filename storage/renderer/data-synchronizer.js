import { remote, ipcRenderer } from 'electron';
import React, { useEffect, useState } from 'react';
import { H4, Collapse, Card, Label, InputGroup, FormGroup, TextArea, Callout, UL, Button } from '@blueprintjs/core';
import { useWorkspaceRO } from '../../api/renderer';
import { useLocalStorage } from '../../renderer/useLocalStorage';
import styles from './data-synchronizer.scss';
const API_ENDPOINT = 'fetch-commit-push';
export const DataSynchronizer = function () {
    const [username, setUsername] = useLocalStorage('gitUsername', '');
    const [password, setPassword] = useLocalStorage('gitPassword', '');
    const [commitMsg, setCommitMsg] = useState('');
    const [authorName, setAuthorName] = useState('');
    const [authorEmail, setAuthorEmail] = useState('');
    const [repoConfigOpenState, updateRepoConfigOpenState] = useState(false);
    const [repoConfigComplete, updateRepoConfigComplete] = useState(false);
    const repoCfg = useWorkspaceRO('git-config', { originURL: undefined, author: {} });
    useEffect(() => {
        if (repoCfg.originURL !== undefined) {
            const _complete = (username.trim() !== '' &&
                password.trim() !== '' &&
                (repoCfg.originURL || '').trim() !== '');
            updateRepoConfigComplete(_complete);
            if (repoConfigOpenState === false && _complete === false) {
                updateRepoConfigOpenState(true);
            }
        }
    }, [username, password, repoCfg.originURL]);
    const [errors, setErrors] = useState([]);
    const [finished, setFinished] = useState(false);
    const [started, setStarted] = useState(false);
    if (authorName.trim() === '' && repoCfg.author.name !== undefined) {
        setAuthorName(repoCfg.author.name);
    }
    if (authorEmail.trim() === '' && repoCfg.author.email !== undefined) {
        setAuthorEmail(repoCfg.author.email);
    }
    function handleResult(evt, rawData) {
        ipcRenderer.removeListener(`workspace-${API_ENDPOINT}`, handleResult);
        const data = JSON.parse(rawData);
        setStarted(false);
        setFinished(true);
        setErrors(data.errors);
        if (data.errors.length < 1) {
            setCommitMsg('');
        }
    }
    function handleSyncAction() {
        updateRepoConfigOpenState(false);
        setErrors([]);
        ipcRenderer.on(`workspace-${API_ENDPOINT}`, handleResult);
        ipcRenderer.send(`request-workspace-${API_ENDPOINT}`, JSON.stringify({
            commitMsg,
            authorName,
            authorEmail,
            gitUsername: username,
            gitPassword: password,
        }));
        setFinished(false);
        setStarted(true);
    }
    async function handleResetURL() {
        await ipcRenderer.send('clear-setting', 'gitRepoUrl');
        remote.app.relaunch();
        remote.app.quit();
    }
    const complete = (authorName.trim() != '' &&
        authorEmail.trim() != '' &&
        username.trim() != '' &&
        password.trim() != '' &&
        commitMsg.trim() != '');
    return (React.createElement(React.Fragment, null,
        React.createElement("div", { className: styles.dataSyncBase },
            React.createElement(Button, { disabled: !repoConfigComplete, onClick: () => updateRepoConfigOpenState(!repoConfigOpenState) },
                repoConfigComplete && repoConfigOpenState ? 'Hide r' : 'R',
                "epository configuration",
                !repoConfigOpenState && repoConfigComplete ? '…' : null),
            React.createElement(Collapse, { className: styles.repoConfigCollapsible, isOpen: repoConfigOpenState },
                React.createElement(Card, { key: "repoUrl", className: styles.repoUrlCard },
                    React.createElement(FormGroup, { label: "Repository URL", helperText: React.createElement(Callout, { intent: "warning" }, "Note: resetting the URL will cause you to lose any unsubmitted changes.") },
                        React.createElement(InputGroup, { defaultValue: repoCfg.originURL || '', disabled: true, type: "text", rightElement: React.createElement(Button, { intent: "warning", minimal: true, title: "Reset repository URL. Note: you will lose any unsubmitted changes.", onClick: handleResetURL }, "Reset URL") }))),
                React.createElement(Card, { key: "repoAuth", className: styles.repoAuthCard },
                    React.createElement("div", { className: styles.dataSyncRow },
                        React.createElement(Label, { key: "username" },
                            "Git username",
                            React.createElement(InputGroup, { value: username, type: "text", onChange: (evt) => {
                                    setUsername(evt.target.value);
                                } })),
                        React.createElement(Label, { key: "password" },
                            "Password",
                            React.createElement(InputGroup, { value: password, type: "password", onChange: (evt) => {
                                    setPassword(evt.target.value);
                                } }))))),
            finished === true
                ? React.createElement(Collapse, { isOpen: !repoConfigOpenState },
                    React.createElement(Card, { key: "resultMessage", className: styles.resultCard },
                        React.createElement(Callout, { intent: errors.length > 0 ? "warning" : "success", title: errors.length > 0 ? "Errors encountered during merge sequence" : "Merge completed" }, errors.length > 0
                            ? React.createElement(UL, null, errors.map((err) => React.createElement("li", null, err)))
                            : React.createElement("p", null, "Your changes have been merged and submitted."))))
                : '',
            React.createElement(Card, { key: "committerInfo", className: styles.committerInfoCard },
                React.createElement(H4, null, "Committing changes as"),
                React.createElement("div", { className: styles.dataSyncRow },
                    React.createElement(Label, { key: "authorName" },
                        "Author name",
                        React.createElement(InputGroup, { value: authorName, type: "text", onChange: (evt) => {
                                setAuthorName(evt.target.value);
                            } })),
                    React.createElement(Label, { key: "authorEmail" },
                        "Author email",
                        React.createElement(InputGroup, { value: authorEmail, type: "email", onChange: (evt) => {
                                setAuthorEmail(evt.target.value);
                            } })))),
            React.createElement(Card, { key: "commitRow", className: styles.commitCard },
                React.createElement(H4, null, "Change notice"),
                React.createElement(FormGroup, { className: styles.formGroup, key: "commitMsg", intent: "primary" },
                    React.createElement(TextArea, { value: commitMsg, fill: true, large: true, onChange: (evt) => {
                            setCommitMsg(evt.target.value);
                        } })),
                React.createElement(Button, { className: styles.syncButton, icon: "git-merge", intent: "primary", large: true, disabled: complete === false, loading: started === true, title: "Fetch other site editors\u2019 changes, and submit yours", onClick: handleSyncAction }, "Merge Changes")))));
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGF0YS1zeW5jaHJvbml6ZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvc3RvcmFnZS9yZW5kZXJlci9kYXRhLXN5bmNocm9uaXplci50c3giXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsT0FBTyxFQUFFLE1BQU0sRUFBRSxXQUFXLEVBQUUsTUFBTSxVQUFVLENBQUM7QUFDL0MsT0FBTyxLQUFLLEVBQUUsRUFBRSxTQUFTLEVBQUUsUUFBUSxFQUFFLE1BQU0sT0FBTyxDQUFDO0FBQ25ELE9BQU8sRUFBRSxFQUFFLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRSxLQUFLLEVBQUUsVUFBVSxFQUFFLFNBQVMsRUFBRSxRQUFRLEVBQUUsT0FBTyxFQUFFLEVBQUUsRUFBRSxNQUFNLEVBQUUsTUFBTSxtQkFBbUIsQ0FBQztBQUVwSCxPQUFPLEVBQUUsY0FBYyxFQUFFLE1BQU0sb0JBQW9CLENBQUM7QUFDcEQsT0FBTyxFQUFFLGVBQWUsRUFBRSxNQUFNLGdDQUFnQyxDQUFDO0FBSWpFLE9BQU8sTUFBTSxNQUFNLDBCQUEwQixDQUFDO0FBRzlDLE1BQU0sWUFBWSxHQUFHLG1CQUFtQixDQUFDO0FBSXpDLE1BQU0sQ0FBQyxNQUFNLGdCQUFnQixHQUFvQztJQUMvRCxNQUFNLENBQUMsUUFBUSxFQUFFLFdBQVcsQ0FBQyxHQUFHLGVBQWUsQ0FBQyxhQUFhLEVBQUUsRUFBRSxDQUFDLENBQUM7SUFDbkUsTUFBTSxDQUFDLFFBQVEsRUFBRSxXQUFXLENBQUMsR0FBRyxlQUFlLENBQUMsYUFBYSxFQUFFLEVBQUUsQ0FBQyxDQUFDO0lBRW5FLE1BQU0sQ0FBQyxTQUFTLEVBQUUsWUFBWSxDQUFDLEdBQUcsUUFBUSxDQUFDLEVBQUUsQ0FBQyxDQUFDO0lBQy9DLE1BQU0sQ0FBQyxVQUFVLEVBQUUsYUFBYSxDQUFDLEdBQUcsUUFBUSxDQUFDLEVBQUUsQ0FBQyxDQUFDO0lBQ2pELE1BQU0sQ0FBQyxXQUFXLEVBQUUsY0FBYyxDQUFDLEdB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QUFVLElBQ1QsS0FBSyxFQUFFLFdBQVcsRUFDbEIsSUFBSSxFQUFDLE9BQU8sRUFDWixRQUFRLEVBQUUsQ0FBQyxHQUFpQyxFQUFFLEVBQUU7Z0NBQzlDLGNBQWMsQ0FBRSxHQUFHLENBQUMsTUFBMkIsQ0FBQyxLQUFlLENBQUMsQ0FBQzs0QkFDbkUsQ0FBQyxHQUNELENBQ0ksQ0FDSixDQUNEO1lBRVAsb0JBQUMsSUFBSSxJQUFDLEdBQUcsRUFBQyxXQUFXLEVBQUMsU0FBUyxFQUFFLE1BQU0sQ0FBQyxVQUFVO2dCQUNoRCxvQkFBQyxFQUFFLHdCQUFtQjtnQkFFdEIsb0JBQUMsU0FBUyxJQUNOLFNBQVMsRUFBRSxNQUFNLENBQUMsU0FBUyxFQUMzQixHQUFHLEVBQUMsV0FBVyxFQUNmLE1BQU0sRUFBQyxTQUFTO29CQUNsQixvQkFBQyxRQUFRLElBQ1AsS0FBSyxFQUFFLFNBQVMsRUFDaEIsSUFBSSxFQUFFLElBQUksRUFDVixLQUFLLEVBQUUsSUFBSSxFQUNYLFFBQVEsRUFBRSxDQUFDLEdBQWlDLEVBQUUsRUFBRTs0QkFDOUMsWUFBWSxDQUFFLEdBQUcsQ0FBQyxNQUEyQixDQUFDLEtBQWUsQ0FBQyxDQUFDO3dCQUNqRSxDQUFDLEdBQ0QsQ0FDUTtnQkFFWixvQkFBQyxNQUFNLElBQ0wsU0FBUyxFQUFFLE1BQU0sQ0FBQyxVQUFVLEVBQzVCLElBQUksRUFBQyxXQUFXLEVBQ2hCLE1BQU0sRUFBQyxTQUFTLEVBQ2hCLEtBQUssRUFBRSxJQUFJLEVBQ1gsUUFBUSxFQUFFLFFBQVEsS0FBSyxLQUFLLEVBQzVCLE9BQU8sRUFBRSxPQUFPLEtBQUssSUFBSSxFQUN6QixLQUFLLEVBQUMsMERBQXFELEVBQzNELE9BQU8sRUFBRSxnQkFBZ0Isb0JBQXdCLENBQzlDLENBQ0gsQ0FDTCxDQUNKLENBQUM7QUFDSixDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyByZW1vdGUsIGlwY1JlbmRlcmVyIH0gZnJvbSAnZWxlY3Ryb24nO1xuaW1wb3J0IFJlYWN0LCB7IHVzZUVmZmVjdCwgdXNlU3RhdGUgfSBmcm9tICdyZWFjdCc7XG5pbXBvcnQgeyBINCwgQ29sbGFwc2UsIENhcmQsIExhYmVsLCBJbnB1dEdyb3VwLCBGb3JtR3JvdXAsIFRleHRBcmVhLCBDYWxsb3V0LCBVTCwgQnV0dG9uIH0gZnJvbSAnQGJsdWVwcmludGpzL2NvcmUnO1xuXG5pbXBvcnQgeyB1c2VXb3Jrc3BhY2VSTyB9IGZyb20gJy4uLy4uL2FwaS9yZW5kZXJlcic7XG5pbXBvcnQgeyB1c2VMb2NhbFN0b3JhZ2UgfSBmcm9tICcuLi8uLi9yZW5kZXJlci91c2VMb2NhbFN0b3JhZ2UnO1xuXG5pbXBvcnQgeyBHaXRBdXRob3IgfSBmcm9tICcuLi9naXQnO1xuXG5pbXBvcnQgc3R5bGVzIGZyb20gJy4vZGF0YS1zeW5jaHJvbml6ZXIuc2Nzcyc7XG5cblxuY29uc3QgQVBJX0VORFBPSU5UID0gJ2ZldGNoLWNvbW1pdC1wdXNoJztcblxuXG5pbnRlcmZhY2UgRGF0YVN5bmNocm9uaXplclByb3BzIHt9XG5leHBvcnQgY29uc3QgRGF0YVN5bmNocm9uaXplcjogUmVhY3QuRkM8RGF0YVN5bmNocm9uaXplclByb3BzPiA9IGZ1bmN0aW9uICgpIHtcbiAgY29uc3QgW3VzZXJuYW1lLCBzZXRVc2VybmFtZV0gPSB1c2VMb2NhbFN0b3JhZ2UoJ2dpdFVzZXJuYW1lJywgJycpO1xuICBjb25zdCBbcGFzc3dvcmQsIHNldFBhc3N3b3JkXSA9IHVzZUxvY2FsU3RvcmFnZSgnZ2l0UGFzc3dvcmQnLCAnJyk7XG5cbiAgY29uc3QgW2NvbW1pdE1zZywgc2V0Q29tbWl0TXNnXSA9IHVzZVN0YXRlKCcnKTtcbiAgY29uc3QgW2F1dGhvck5hbWUsIHNldEF1dGhvck5hbWVdID0gdXNlU3RhdGUoJycpO1xuICBjb25zdCBbYXV0aG9yRW1haWwsIHNldEF1dGhvckVtYWlsXSA9IHVzZVN0YXRlKCcnKTtcblxuICBjb25zdCBbcmVwb0NvbmZpZ09wZW5TdGF0ZSwgdXBkYXRlUmVwb0NvbmZpZ09wZW5TdGF0ZV0gPSB1c2VTdGF0ZShmYWxzZSk7XG4gIGNvbnN0IFtyZXBvQ29uZmlnQ29tcGxldGUsIHVwZGF0ZVJlcG9Db25maWdDb21wbGV0ZV0gPSB1c2VTdGF0ZShmYWxzZSk7XG5cbiAgY29uc3QgcmVwb0NmZyA9IHVzZVdvcmtzcGFjZVJPPHsgYXV0aG9yOiBHaXRBdXRob3IsIG9yaWdpblVSTDogc3RyaW5nIHwgbnVsbCB8IHVuZGVmaW5lZCB9PihcbiAgICAnZ2l0LWNvbmZpZycsXG4gICAgeyBvcmlnaW5VUkw6IHVuZGVmaW5lZCwgYXV0aG9yOiB7fSB9KTtcblxuICB1c2VFZmZlY3QoKCkgPT4ge1xuICAgIGlmIChyZXBvQ2ZnLm9yaWdpblVSTCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBjb25zdCBfY29tcGxldGUgPSAoXG4gICAgICAgIHVzZXJuYW1lLnRyaW0oKSAhPT0gJycgJiZcbiAgICAgICAgcGFzc3dvcmQudHJpbSgpICE9PSAnJyAmJlxuICAgICAgICAocmVwb0NmZy5vcmlnaW5VUkwgfHwgJycpLnRyaW0oKSAhPT0gJycpO1xuXG4gICAgICB1cGRhdGVSZXBvQ29uZmlnQ29tcGxldGUoX2NvbXBsZXRlKTtcbiAgICAgIGlmIChyZXBvQ29uZmlnT3BlblN0YXRlID09PSBmYWxzZSAmJiBfY29tcGxldGUgPT09IGZhbHNlKSB7XG4gICAgICAgIHVwZGF0ZVJlcG9Db25maWdPcGVuU3RhdGUodHJ1ZSk7XG4gICAgICB9XG4gICAgfVxuICB9LCBbdXNlcm5hbWUsIHBhc3N3b3JkLCByZXBvQ2ZnLm9yaWdpblVSTF0pO1xuXG4gIGNvbnN0IFtlcnJvcnMsIHNldEVycm9yc10gPSB1c2VTdGF0ZShbXSBhcyBzdHJpbmdbXSk7XG4gIGNvbnN0IFtmaW5pc2hlZCwgc2V0RmluaXNoZWRdID0gdXNlU3RhdGUoZmFsc2UpO1xuICBjb25zdCBbc3RhcnRlZCwgc2V0U3RhcnRlZF0gPSB1c2VTdGF0ZShmYWxzZSk7XG5cbiAgaWYgKGF1dGhvck5hbWUudHJpbSgpID09PSAnJyAmJiByZXBvQ2ZnLmF1dGhvci5uYW1lICE9PSB1bmRlZmluZWQpIHsgc2V0QXV0aG9yTmFtZShyZXBvQ2ZnLmF1dGhvci5uYW1lKTsgfVxuICBpZiAoYXV0aG9yRW1haWwudHJpbSgpID09PSAnJyAmJiByZXBvQ2ZnLmF1dGhvci5lbWFpbCAhPT0gdW5kZWZpbmVkKSB7IHNldEF1dGhvckVtYWlsKHJlcG9DZmcuYXV0aG9yLmVtYWlsKTsgfVxuXG4gIGZ1bmN0aW9uIGhhbmRsZVJlc3VsdChldnQ6IGFueSwgcmF3RGF0YTogc3RyaW5nKSB7XG4gICAgaXBjUmVuZGVyZXIucmVtb3ZlTGlzdGVuZXIoYHdvcmtzcGFjZS0ke0FQSV9FTkRQT0lOVH1gLCBoYW5kbGVSZXN1bHQpO1xuICAgIGNvbnN0IGRhdGE6IGFueSA9IEpTT04ucGFyc2UocmF3RGF0YSk7XG4gICAgc2V0U3RhcnRlZChmYWxzZSk7XG4gICAgc2V0RmluaXNoZWQodHJ1ZSk7XG4gICAgc2V0RXJyb3JzKGRhdGEuZXJyb3JzKTtcblxuICAgIGlmIChkYXRhLmVycm9ycy5sZW5ndGggPCAxKSB7XG4gICAgICBzZXRDb21taXRNc2coJycpO1xuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIGhhbmRsZVN5bmNBY3Rpb24oKSB7XG4gICAgdXBkYXRlUmVwb0NvbmZpZ09wZW5TdGF0ZShmYWxzZSk7XG4gICAgc2V0RXJyb3JzKFtdKTtcbiAgICBpcGNSZW5kZXJlci5vbihgd29ya3NwYWNlLSR7QVBJX0VORFBPSU5UfWAsIGhhbmRsZVJlc3VsdCk7XG4gICAgaXBjUmVuZGVyZXIuc2VuZChcbiAgICAgIGByZXF1ZXN0LXdvcmtzcGFjZS0ke0FQSV9FTkRQT0lOVH1gLFxuICAgICAgSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICBjb21taXRNc2csXG4gICAgICAgIGF1dGhvck5hbWUsXG4gICAgICAgIGF1dGhvckVtYWlsLFxuICAgICAgICBnaXRVc2VybmFtZTogdXNlcm5hbWUsXG4gICAgICAgIGdpdFBhc3N3b3JkOiBwYXNzd29yZCxcbiAgICAgIH0pKTtcbiAgICBzZXRGaW5pc2hlZChmYWxzZSk7XG4gICAgc2V0U3RhcnRlZCh0cnVlKTtcbiAgfVxuXG4gIGFzeW5jIGZ1bmN0aW9uIGhhbmRsZVJlc2V0VVJMKCkge1xuICAgIGF3YWl0IGlwY1JlbmRlcmVyLnNlbmQoJ2NsZWFyLXNldHRpbmcnLCAnZ2l0UmVwb1VybCcpO1xuICAgIHJlbW90ZS5hcHAucmVsYXVuY2goKTtcbiAgICByZW1vdGUuYXBwLnF1aXQoKTtcbiAgfVxuXG4gIGNvbnN0IGNvbXBsZXRlID0gKFxuICAgIGF1dGhvck5hbWUudHJpbSgpICE9ICcnICYmXG4gICAgYXV0aG9yRW1haWwudHJpbSgpICE9ICcnICYmXG4gICAgdXNlcm5hbWUudHJpbSgpICE9ICcnICYmXG4gICAgcGFzc3dvcmQudHJpbSgpICE9ICcnICYmXG4gICAgY29tbWl0TXNnLnRyaW0oKSAhPSAnJyk7XG5cbiAgcmV0dXJuIChcbiAgICA8PlxuICAgICAgPGRpdiBjbGFzc05hbWU9e3N0eWxlcy5kYXRhU3luY0Jhc2V9PlxuICAgICAgICA8QnV0dG9uIGRpc2FibGVkPXshcmVwb0NvbmZpZ0NvbXBsZXRlfSBvbkNsaWNrPXsoKSA9PiB1cGRhdGVSZXBvQ29uZmlnT3BlblN0YXRlKCFyZXBvQ29uZmlnT3BlblN0YXRlKX0+XG4gICAgICAgICAge3JlcG9Db25maWdDb21wbGV0ZSAmJiByZXBvQ29uZmlnT3BlblN0YXRlID8gJ0hpZGUgcicgOiAnUid9XG4gICAgICAgICAgZXBvc2l0b3J5IGNvbmZpZ3VyYXRpb25cbiAgICAgICAgICB7IXJlcG9Db25maWdPcGVuU3RhdGUgJiYgcmVwb0NvbmZpZ0NvbXBsZXRlID8gJ+KApic6IG51bGx9XG4gICAgICAgIDwvQnV0dG9uPlxuXG4gICAgICAgIDxDb2xsYXBzZSBjbGFzc05hbWU9e3N0eWxlcy5yZXBvQ29uZmlnQ29sbGFwc2libGV9IGlzT3Blbj17cmVwb0NvbmZpZ09wZW5TdGF0ZX0+XG4gICAgICAgICAgPENhcmQga2V5PVwicmVwb1VybFwiIGNsYXNzTmFtZT17c3R5bGVzLnJlcG9VcmxDYXJkfT5cbiAgICAgICAgICAgIDxGb3JtR3JvdXBcbiAgICAgICAgICAgICAgICBsYWJlbD1cIlJlcG9zaXRvcnkgVVJMXCJcbiAgICAgICAgICAgICAgICBoZWxwZXJUZXh0PXs8Q2FsbG91dCBpbnRlbnQ9XCJ3YXJuaW5nXCI+Tm90ZTogcmVzZXR0aW5nIHRoZSBVUkwgd2lsbCBjYXVzZSB5b3UgdG8gbG9zZSBhbnkgdW5zdWJtaXR0ZWQgY2hhbmdlcy48L0NhbGxvdXQ+fT5cbiAgICAgICAgICAgICAgPElucHV0R3JvdXBcbiAgICAgICAgICAgICAgICBkZWZhdWx0VmFsdWU9e3JlcG9DZmcub3JpZ2luVVJMIHx8ICcnfVxuICAgICAgICAgICAgICAgIGRpc2FibGVkPXt0cnVlfVxuICAgICAgICAgICAgICAgIHR5cGU9XCJ0ZXh0XCJcbiAgICAgICAgICAgICAgICByaWdodEVsZW1lbnQ9e1xuICAgICAgICAgICAgICAgICAgPEJ1dHRvblxuICAgICAgICAgICAgICAgICAgICAgIGludGVudD1cIndhcm5pbmdcIlxuICAgICAgICAgICAgICAgICAgICAgIG1pbmltYWw9e3RydWV9XG4gICAgICAgICAgICAgICAgICAgICAgdGl0bGU9XCJSZXNldCByZXBvc2l0b3J5IFVSTC4gTm90ZTogeW91IHdpbGwgbG9zZSBhbnkgdW5zdWJtaXR0ZWQgY2hhbmdlcy5cIlxuICAgICAgICAgICAgICAgICAgICAgIG9uQ2xpY2s9e2hhbmRsZVJlc2V0VVJMfT5cbiAgICAgICAgICAgICAgICAgICAgUmVzZXQgVVJMXG4gICAgICAgICAgICAgICAgICA8L0J1dHRvbj5cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICA8L0Zvcm1Hcm91cD5cbiAgICAgICAgICA8L0NhcmQ+XG5cbiAgICAgICAgICA8Q2FyZCBrZXk9XCJyZXBvQXV0aFwiIGNsYXNzTmFtZT17c3R5bGVzLnJlcG9BdXRoQ2FyZH0+XG4gICAgICAgICAgICA8ZGl2IGNsYXNzTmFtZT17c3R5bGVzLmRhdGFTeW5jUm93fT5cbiAgICAgICAgICAgICAgPExhYmVsIGtleT1cInVzZXJuYW1lXCI+XG4gICAgICAgICAgICAgICAgR2l0IHVzZXJuYW1lXG4gICAgICAgICAgICAgICAgPElucHV0R3JvdXBcbiAgICAgICAgICAgICAgICAgIHZhbHVlPXt1c2VybmFtZX1cbiAgICAgICAgICAgICAgICAgIHR5cGU9XCJ0ZXh0XCJcbiAgICAgICAgICAgICAgICAgIG9uQ2hhbmdlPXsoZXZ0OiBSZWFjdC5Gb3JtRXZlbnQ8SFRNTEVsZW1lbnQ+KSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIHNldFVzZXJuYW1lKChldnQudGFyZ2V0IGFzIEhUTUxJbnB1dEVsZW1lbnQpLnZhbHVlIGFzIHN0cmluZyk7XG4gICAgICAgICAgICAgICAgICB9fVxuICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgIDwvTGFiZWw+XG4gICAgICAgICAgICAgIDxMYWJlbCBrZXk9XCJwYXNzd29yZFwiPlxuICAgICAgICAgICAgICAgIFBhc3N3b3JkXG4gICAgICAgICAgICAgICAgPElucHV0R3JvdXBcbiAgICAgICAgICAgICAgICAgIHZhbHVlPXtwYXNzd29yZH1cbiAgICAgICAgICAgICAgICAgIHR5cGU9XCJwYXNzd29yZFwiXG4gICAgICAgICAgICAgICAgICBvbkNoYW5nZT17KGV2dDogUmVhY3QuRm9ybUV2ZW50PEhUTUxFbGVtZW50PikgPT4ge1xuICAgICAgICAgICAgICAgICAgICBzZXRQYXNzd29yZCgoZXZ0LnRhcmdldCBhcyBIVE1MSW5wdXRFbGVtZW50KS52YWx1ZSBhcyBzdHJpbmcpO1xuICAgICAgICAgICAgICAgICAgfX1cbiAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICA8L0xhYmVsPlxuICAgICAgICAgICAgPC9kaXY+XG4gICAgICAgICAgPC9DYXJkPlxuICAgICAgICA8L0NvbGxhcHNlPlxuXG4gICAgICAgIHtmaW5pc2hlZCA9PT0gdHJ1ZVxuICAgICAgICAgID8gPENvbGxhcHNlIGlzT3Blbj17IXJlcG9Db25maWdPcGVuU3RhdGV9PlxuICAgICAgICAgICAgICA8Q2FyZCBrZXk9XCJyZXN1bHRNZXNzYWdlXCIgY2xhc3NOYW1lPXtzdHlsZXMucmVzdWx0Q2FyZH0+XG4gICAgICAgICAgICAgICAgPENhbGxvdXRcbiAgICAgICAgICAgICAgICAgIGludGVudD17ZXJyb3JzLmxlbmd0aCA+IDAgPyBcIndhcm5pbmdcIiA6IFwic3VjY2Vzc1wifVxuICAgICAgICAgICAgICAgICAgdGl0bGU9e2Vycm9ycy5sZW5ndGggPiAwID8gXCJFcnJvcnMgZW5jb3VudGVyZWQgZHVyaW5nIG1lcmdlIHNlcXVlbmNlXCIgOiBcIk1lcmdlIGNvbXBsZXRlZFwifT5cblxuICAgICAgICAgICAgICAgIHtlcnJvcnMubGVuZ3RoID4gMFxuICAgICAgICAgICAgICAgICAgPyA8VUw+XG4gICAgICAgICAgICAgICAgICAgICAge2Vycm9ycy5tYXAoKGVycjogc3RyaW5nKSA9PlxuICAgICAgICAgICAgICAgICAgICAgICAgPGxpPntlcnJ9PC9saT5cbiAgICAgICAgICAgICAgICAgICAgICApfVxuICAgICAgICAgICAgICAgICAgICA8L1VMPlxuICAgICAgICAgICAgICAgICAgOiA8cD5Zb3VyIGNoYW5nZXMgaGF2ZSBiZWVuIG1lcmdlZCBhbmQgc3VibWl0dGVkLjwvcD59XG4gICAgICAgICAgICAgICAgPC9DYWxsb3V0PlxuICAgICAgICAgICAgICA8L0NhcmQ+XG4gICAgICAgICAgICA8L0NvbGxhcHNlPlxuICAgICAgICAgIDogJyd9XG5cbiAgICAgICAgPENhcmQga2V5PVwiY29tbWl0dGVySW5mb1wiIGNsYXNzTmFtZT17c3R5bGVzLmNvbW1pdHRlckluZm9DYXJkfT5cbiAgICAgICAgICA8SDQ+Q29tbWl0dGluZyBjaGFuZ2VzIGFzPC9IND5cblxuICAgICAgICAgIDxkaXYgY2xhc3NOYW1lPXtzdHlsZXMuZGF0YVN5bmNSb3d9PlxuICAgICAgICAgICAgPExhYmVsIGtleT1cImF1dGhvck5hbWVcIj5cbiAgICAgICAgICAgICAgQXV0aG9yIG5hbWVcbiAgICAgICAgICAgICAgPElucHV0R3JvdXBcbiAgICAgICAgICAgICAgICB2YWx1ZT17YXV0aG9yTmFtZX1cbiAgICAgICAgICAgICAgICB0eXBlPVwidGV4dFwiXG4gICAgICAgICAgICAgICAgb25DaGFuZ2U9eyhldnQ6IFJlYWN0LkZvcm1FdmVudDxIVE1MRWxlbWVudD4pID0+IHtcbiAgICAgICAgICAgICAgICAgIHNldEF1dGhvck5hbWUoKGV2dC50YXJnZXQgYXMgSFRNTElucHV0RWxlbWVudCkudmFsdWUgYXMgc3RyaW5nKTtcbiAgICAgICAgICAgICAgICB9fVxuICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgPC9MYWJlbD5cbiAgICAgICAgICAgIDxMYWJlbCBrZXk9XCJhdXRob3JFbWFpbFwiPlxuICAgICAgICAgICAgICBBdXRob3IgZW1haWxcbiAgICAgICAgICAgICAgPElucHV0R3JvdXBcbiAgICAgICAgICAgICAgICB2YWx1ZT17YXV0aG9yRW1haWx9XG4gICAgICAgICAgICAgICAgdHlwZT1cImVtYWlsXCJcbiAgICAgICAgICAgICAgICBvbkNoYW5nZT17KGV2dDogUmVhY3QuRm9ybUV2ZW50PEhUTUxFbGVtZW50PikgPT4ge1xuICAgICAgICAgICAgICAgICAgc2V0QXV0aG9yRW1haWwoKGV2dC50YXJnZXQgYXMgSFRNTElucHV0RWxlbWVudCkudmFsdWUgYXMgc3RyaW5nKTtcbiAgICAgICAgICAgICAgICB9fVxuICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgPC9MYWJlbD5cbiAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgPC9DYXJkPlxuXG4gICAgICAgIDxDYXJkIGtleT1cImNvbW1pdFJvd1wiIGNsYXNzTmFtZT17c3R5bGVzLmNvbW1pdENhcmR9PlxuICAgICAgICAgIDxIND5DaGFuZ2Ugbm90aWNlPC9IND5cblxuICAgICAgICAgIDxGb3JtR3JvdXBcbiAgICAgICAgICAgICAgY2xhc3NOYW1lPXtzdHlsZXMuZm9ybUdyb3VwfVxuICAgICAgICAgICAgICBrZXk9XCJjb21taXRNc2dcIlxuICAgICAgICAgICAgICBpbnRlbnQ9XCJwcmltYXJ5XCI+XG4gICAgICAgICAgICA8VGV4dEFyZWFcbiAgICAgICAgICAgICAgdmFsdWU9e2NvbW1pdE1zZ31cbiAgICAgICAgICAgICAgZmlsbD17dHJ1ZX1cbiAgICAgICAgICAgICAgbGFyZ2U9e3RydWV9XG4gICAgICAgICAgICAgIG9uQ2hhbmdlPXsoZXZ0OiBSZWFjdC5Gb3JtRXZlbnQ8SFRNTEVsZW1lbnQ+KSA9PiB7XG4gICAgICAgICAgICAgICAgc2V0Q29tbWl0TXNnKChldnQudGFyZ2V0IGFzIEhUTUxJbnB1dEVsZW1lbnQpLnZhbHVlIGFzIHN0cmluZyk7XG4gICAgICAgICAgICAgIH19XG4gICAgICAgICAgICAvPlxuICAgICAgICAgIDwvRm9ybUdyb3VwPlxuXG4gICAgICAgICAgPEJ1dHRvblxuICAgICAgICAgICAgY2xhc3NOYW1lPXtzdHlsZXMuc3luY0J1dHRvbn1cbiAgICAgICAgICAgIGljb249XCJnaXQtbWVyZ2VcIlxuICAgICAgICAgICAgaW50ZW50PVwicHJpbWFyeVwiXG4gICAgICAgICAgICBsYXJnZT17dHJ1ZX1cbiAgICAgICAgICAgIGRpc2FibGVkPXtjb21wbGV0ZSA9PT0gZmFsc2V9XG4gICAgICAgICAgICBsb2FkaW5nPXtzdGFydGVkID09PSB0cnVlfVxuICAgICAgICAgICAgdGl0bGU9XCJGZXRjaCBvdGhlciBzaXRlIGVkaXRvcnPigJkgY2hhbmdlcywgYW5kIHN1Ym1pdCB5b3Vyc1wiXG4gICAgICAgICAgICBvbkNsaWNrPXtoYW5kbGVTeW5jQWN0aW9ufT5NZXJnZSBDaGFuZ2VzPC9CdXR0b24+XG4gICAgICAgIDwvQ2FyZD5cbiAgICAgIDwvZGl2PlxuICAgIDwvPlxuICApO1xufTtcbiJdfQ==