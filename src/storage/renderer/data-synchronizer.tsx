import { remote, ipcRenderer } from 'electron';
import { clipboard } from 'electron';

import React, { useEffect, useState } from 'react';
import { H4, Card, Label, InputGroup, FormGroup, Callout, Button } from '@blueprintjs/core';

import { useSetting } from '../../settings/renderer';
import { request } from '../../api/renderer';

import styles from './data-synchronizer.scss';


type RepoConfig = {
  originURL: string | null | undefined,
  name: string | null | undefined,
  email: string | null | undefined,
  username: string | null | undefined,
};


interface DataSynchronizerProps {
  upstreamURL: string,
  inPreLaunchSetup: boolean,
}
export const DataSynchronizer: React.FC<DataSynchronizerProps> = function ({ upstreamURL, inPreLaunchSetup }) {
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');

  const [repoConfigOpenState, updateRepoConfigOpenState] = useState(false);
  const [repoConfigComplete, updateRepoConfigComplete] = useState(false);

  const [repoCfg, updateRepoCfg] = useState({
    originURL: undefined,
    name: undefined,
    email: undefined,
    username: undefined,
  } as RepoConfig);

  const url = useSetting<string>('gitRepoUrl', repoCfg.originURL || upstreamURL);

  const usingUpstream = url.value.trim() === upstreamURL.trim();
  let urlIsValid: boolean;
  try {
    new URL(url.value.trim());
    urlIsValid = true;
  } catch (e) {
    urlIsValid = false;
  }

  useEffect(() => {
    fetchRepoConfig();
  }, []);

  useEffect(() => {
    const _complete = (
      username.trim() !== '' &&
      name.trim() !== '' &&
      email.trim() !== '' &&
      urlIsValid);

    updateRepoConfigComplete(_complete);
    if (repoConfigOpenState === false && _complete === false) {
      updateRepoConfigOpenState(true);
    }
  }, [username, name, email, repoCfg.originURL]);

  if (name.trim() === '' && repoCfg.name) { setName(repoCfg.name); }
  if (email.trim() === '' && repoCfg.email) { setEmail(repoCfg.email); }
  if (username.trim() === '' && repoCfg.username) { setUsername(repoCfg.username); }

  const complete = (
    urlIsValid &&
    name.trim() != '' &&
    email.trim() != '' &&
    username.trim() != '');

  async function handleSaveAndClose() {
    await url.commit();
    await request<{ errors: string[] }>('git-config-set', { name, email, username });
    closeWindow();
  }

  async function handleResetURL() {
    await ipcRenderer.send('clear-setting', 'gitRepoUrl');
    remote.app.relaunch();
    remote.app.exit(0);
  }

  async function copyUpstreamRepoURL() {
    clipboard.writeText(upstreamURL);
  }

  async function fetchRepoConfig() {
    const repoCfg = await request<RepoConfig>('git-config');
    updateRepoCfg(repoCfg);
  }

  function closeWindow() {
    remote.getCurrentWindow().hide();
  }

  return (
    <div className={styles.dataSyncBase}>
      <Button disabled={!repoConfigComplete} onClick={() => updateRepoConfigOpenState(!repoConfigOpenState)}>
        {repoConfigComplete && repoConfigOpenState ? 'Hide r' : 'R'}
        epository configuration
        {!repoConfigOpenState && repoConfigComplete ? '…': null}
      </Button>

      <Card key="repoUrl" className={styles.repoUrlCard}>
        <FormGroup
            label="Repository URL"
            intent={inPreLaunchSetup && !urlIsValid ? "danger" : undefined}
            helperText={inPreLaunchSetup
              ? <Callout intent="primary">
                  <p>
                    Please enter a valid URL of the repository you have commit access to,
                    and which is a fork of the upstream repository.
                  </p>
                  <p>
                    <Button onClick={copyUpstreamRepoURL}>Copy upstream repository URL</Button>
                  </p>
                </Callout>
              : <Callout intent="warning">
                
                  Note: resetting the URL will cause you to lose any unsubmitted changes.
                </Callout>}>
          <InputGroup
            value={url.value}
            placeholder={upstreamURL}
            disabled={inPreLaunchSetup !== true}
            type="text"
            onChange={inPreLaunchSetup
              ? (evt: React.FormEvent<HTMLElement>) => {
                url.set((evt.target as HTMLInputElement).value as string);
              }
              : undefined}
            rightElement={inPreLaunchSetup
              ? undefined
              : <Button
                    intent="danger"
                    minimal={true}
                    title="Reset repository URL. Note: you will lose any unsubmitted changes."
                    onClick={handleResetURL}>
                  Reset URL
                </Button>}
          />
        </FormGroup>
      </Card>

      <Card key="committerInfo" className={styles.committerInfoCard}>
        <H4>Committing changes as</H4>

        <div className={styles.dataSyncRow}>
          <Label key="authorName">
            Author name
            <InputGroup
              value={name}
              type="text"
              onChange={(evt: React.FormEvent<HTMLElement>) => {
                setName((evt.target as HTMLInputElement).value as string);
              }}
            />
          </Label>

          <Label key="authorEmail">
            Author email
            <InputGroup
              value={email}
              type="email"
              onChange={(evt: React.FormEvent<HTMLElement>) => {
                setEmail((evt.target as HTMLInputElement).value as string);
              }}
            />
          </Label>

          <Label key="username">
            Username
            <InputGroup
              value={username}
              type="text"
              onChange={(evt: React.FormEvent<HTMLElement>) => {
                setUsername((evt.target as HTMLInputElement).value as string);
              }}
            />
          </Label>
        </div>
      </Card>

      <Card key="actionRow" className={styles.actionRowCard}>
        <Button
            className="confirm-button"
            key="confirm"
            intent={!usingUpstream ? "primary" : "warning"}
            disabled={complete !== true}
            onClick={handleSaveAndClose}>
          Save {!usingUpstream ? "upstream" : "fork"} configuration
          {inPreLaunchSetup ? " and launch" : " and close"}
        </Button>
      </Card>
    </div>
  );
};
