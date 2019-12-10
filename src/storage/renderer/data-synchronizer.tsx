import { remote, ipcRenderer } from 'electron';
import { clipboard } from 'electron';

import React, { useState } from 'react';
import { H4, Card, Label, InputGroup, FormGroup, Callout, Button } from '@blueprintjs/core';

import { useSetting } from '../../settings/renderer';

import styles from './data-synchronizer.scss';


interface DataSynchronizerProps {
  upstreamURL: string,
  inPreLaunchSetup: boolean,
}
export const DataSynchronizer: React.FC<DataSynchronizerProps> = function ({ upstreamURL, inPreLaunchSetup }) {
  const [loading, setLoading] = useState(false);

  const url = useSetting<string>('gitRepoUrl', '');
  const name = useSetting<string>('gitAuthorName', '');
  const email = useSetting<string>('gitAuthorEmail', '');
  const username = useSetting<string>('gitUsername', '');

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

  const complete = (
    urlIsValid &&
    name.value && name.value.trim() != '' &&
    email.value && email.value.trim() != '' &&
    username.value && username.value.trim() != '');

  async function handleSaveAndClose() {
    setLoading(true);

    await name.commit();
    await email.commit();
    await username.commit();

    // In pre launch we can modify URL, but updating Git config requires waiting for the app to load,
    // initializing the repo
    if (inPreLaunchSetup) {
      await url.commit();
    }

    setTimeout(() => {
      remote.getCurrentWindow().close();
    }, 2000);
  }

  async function handleResetURL() {
    await ipcRenderer.send('clear-setting', 'gitRepoUrl');
    remote.app.relaunch();
    remote.app.exit(0);
  }

  async function copyUpstreamRepoURL() {
    clipboard.writeText(upstreamURL);
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
              value={name.value}
              type="text"
              onChange={(evt: React.FormEvent<HTMLElement>) => {
                name.set((evt.target as HTMLInputElement).value as string);
              }}
            />
          </Label>

          <Label key="authorEmail">
            Author email
            <InputGroup
              value={email.value}
              type="email"
              onChange={(evt: React.FormEvent<HTMLElement>) => {
                email.set((evt.target as HTMLInputElement).value as string);
              }}
            />
          </Label>

          <Label key="username">
            Username
            <InputGroup
              value={username.value}
              type="text"
              onChange={(evt: React.FormEvent<HTMLElement>) => {
                username.set((evt.target as HTMLInputElement).value as string);
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
