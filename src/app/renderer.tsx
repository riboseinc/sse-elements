import React, { useState } from 'react';
import * as ReactDOM from 'react-dom';
import { AppConfig } from '../config/app';
import { RendererConfig } from '../config/renderer';

import { NonIdealState, Spinner } from '@blueprintjs/core';

import { LangConfigContext } from '../localizer/renderer';

import '!style-loader!css-loader!@blueprintjs/datetime/lib/css/blueprint-datetime.css';
import '!style-loader!css-loader!@blueprintjs/core/lib/css/blueprint.css';
import '!style-loader!css-loader!./normalize.css';
import '!style-loader!css-loader!./renderer.css';


interface AppRenderer {
  root: HTMLElement,
}


export const renderApp = async <A extends AppConfig, C extends RendererConfig<A>>(config: C): Promise<AppRenderer> => {

  // electron-webpack guarantees presence of #app in index.html it bundles
  const appRoot = document.getElementById('app') as HTMLElement;

  // Add a class allowing platform-specific styling
  document.documentElement.classList.add(`platform--${process.platform}`);

  const searchParams = new URLSearchParams(window.location.search);
  const componentId = searchParams.get('c');
  const componentImporter = componentId ? config.windowComponents[componentId] : null;

  const App: React.FC<{}> = function ({ children }) {
    var result = children;

    for (const ContextProvider of Object.values(config.contextProviders)) {
      result = <ContextProvider>{result}</ContextProvider>;
    }

    const [langConfig, setLangConfig] = useState({
      available: config.app.languages.available,
      default: config.app.languages.default as string,
      selected: config.app.languages.selected as string,
      select: (langId: keyof typeof config.app.languages.available) => {
        setLangConfig(langConfig => Object.assign({}, langConfig, { selected: langId }));
      },
    });

    return (
      <LangConfigContext.Provider value={langConfig}>
        {result}
      </LangConfigContext.Provider>
    );
  };

  if (componentImporter) {
    ReactDOM.render(<Spinner />, appRoot);
    const ComponentClass = (await componentImporter()).default;
    ReactDOM.render(<App><ComponentClass query={searchParams} /></App>, appRoot);
  } else {
    ReactDOM.render(<NonIdealState
      icon="error"
      title="Unknown component requested" />, appRoot);
  }

  return {
    root: appRoot,
  };

};
