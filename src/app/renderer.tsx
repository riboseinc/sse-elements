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


// Render application screen in a new window,
// with given window component and (if applicable) any parameters.
export const renderApp = async <A extends AppConfig, C extends RendererConfig<A>>(config: C): Promise<AppRenderer> => {

  // electron-webpack guarantees presence of #app in index.html it bundles
  const appRoot = document.getElementById('app') as HTMLElement;

  // Add a class allowing platform-specific styling
  document.documentElement.classList.add(`platform--${process.platform}`);

  // Get all params passed to the window via GET query string
  const searchParams = new URLSearchParams(window.location.search);

  // Prepare getter for requested top-level window UI React component
  const componentId = searchParams.get('c');
  const componentImporter = componentId ? config.windowComponents[componentId] : null;

  const App: React.FC<{}> = function ({ children }) {
    /* Top-level abstract component. Renders the requested window UI component
       wrapped in context processors (potentially more later). */

    // Top-level window UI component(s) will be passed as children
    var result = children;

    // Wrap UI component in any context providers configured by app developer
    for (const ContextProvider of Object.values(config.contextProviders)) {
      result = <ContextProvider>{result}</ContextProvider>;
    }

    // Configure localization/translation context provider
    // (currently hard-coded, not user-configurable),
    // and render the total result wrapped in that

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

  // Fetch top-level UI component class and render it.
  // Show loading indicator while it’s being fetched.

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
