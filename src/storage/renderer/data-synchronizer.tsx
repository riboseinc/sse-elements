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
  const [loading, setLoading] = useState(false);

  const [repoCfg, updateRepoCfg] = useState({
    originURL: undefined,
    name: undefined,
    email: undefined,
    username: undefined,
  } as RepoConfig);

  const url = useSetting<string>('gitRepoUrl', '');

  const usingUpstream = url.value && url.value.trim() === upstreamURL.trim();
  let urlIsValid: boolean;
  try {
    if (url.value) {
      new URL(url.value.trim());
      urlIsValid = true;
    } else {
      urlIsValid = false;
    }
  } catch (e) {
    urlIsValid = false;
  }

  useEffect(() => {
    fetchRepoConfig();
  }, []);

  useEffect(() => {
    if (name.trim() === '' && repoCfg.name) { setName(repoCfg.name); }
    if (email.trim() === '' && repoCfg.email) { setEmail(repoCfg.email); }
    if (username.trim() === '' && repoCfg.username) { setUsername(repoCfg.username); }
  }, [name, email, username, JSON.stringify(repoCfg)]);

  const complete = (
    urlIsValid &&
    name.trim() != '' &&
    email.trim() != '' &&
    username.trim() != '');

  async function updateGitConfigAndClose() {
    await request<{ success: true }>('git-config-set', { name, email, username });
    await closeWindow();
  }

  async function handleSaveAndClose() {
    setLoading(true);

    // In pre launch we can modify URL, but updating Git config requires waiting for the app to load,
    // initializing the repo
    if (inPreLaunchSetup) {
      await url.commit();
      ipcRenderer.on('app-loaded', updateGitConfigAndClose);
    } else {
      await updateGitConfigAndClose();
    }
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
    const repoCfg = await request<RepoConfig>('git-config-get');
    updateRepoCfg(repoCfg);
  }

  async function closeWindow() {
    await remote.getCurrentWindow().close();
  }

  return (
    <div className={styles.dataSyncBase}>
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

      <footer key="actionRow" className={styles.windowAction}>
        <Button
            className="confirm-button"
            key="confirm"
            large={true}
            fill={true}
            intent={!usingUpstream ? "primary" : "warning"}
            loading={loading === true}
            disabled={complete !== true}
            onClick={handleSaveAndClose}>
          {inPreLaunchSetup
            ? <>Save settings using {usingUpstream ? "upstream" : "fork"} repository and launch</>
            : <>Save and close</>}
        </Button>
      </footer>
    </div>
  );
};
