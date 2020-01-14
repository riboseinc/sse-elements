import React, { useState, useContext } from 'react';
import { Icon } from '@blueprintjs/core';

import { SupportedLanguages, LangConfig, Translatable } from './types';

import styles from './styles.scss';


type LocalizerOptions<Languages extends SupportedLanguages> = {
  languageSetup: {
    available: Languages
    default: keyof Languages
    selected: keyof Languages
  }
};
const LocalizerContextProvider: React.FC<LocalizerOptions<any>> = function ({ languageSetup, children }) {
  const [langConfig, setLangConfig] = useState({
    available: languageSetup.available,
    default: languageSetup.default as string,
    selected: languageSetup.selected as string,
    select: (langId: keyof typeof languageSetup.available) => {
      setLangConfig(langConfig => Object.assign({}, langConfig, { selected: langId }));
    },
  });

  return (
    <LangConfigContext.Provider value={langConfig}>
      {children}
    </LangConfigContext.Provider>
  );
};
export default LocalizerContextProvider;


interface LangConfigContextSpec extends LangConfig {
  available: SupportedLanguages,
  select(id: string): void,
}

export const LangConfigContext = React.createContext<LangConfigContextSpec>({
  available: { en: 'English', zh: 'Chinese', ru: 'Russian' },
  default: 'en' as const,
  selected: 'en',
  select: (id: string) => {},
});


interface TranslatableComponentProps { what: Translatable<string> }
export const Trans: React.FC<TranslatableComponentProps> = function ({ what }) {
  const lang = useContext(LangConfigContext);
  const translated = what[lang.selected];
  const untranslated = what[lang.default];

  // const translated = translatable[lang.selected.id];
  // if (!translated) {
  //   // Register missing translation
  // }

  return <span>{translated || untranslated || '(malformed translatable string)'}</span>;
};


interface LangSelectorProps {
  value?: Translatable<any>,
}
export const LangSelector: React.FC<LangSelectorProps> = function ({ value }) {
  const cfg = useContext(LangConfigContext);

  return (
    <p className={styles.langSelector}>
      {Object.keys(cfg.available).map((langId: string) =>
        <LangSelectorButton
          id={langId}
          title={cfg.available[langId]}
          isSelected={langId === cfg.selected}
          onSelect={() => cfg.select(langId)}
          hasTranslation={(value !== undefined) ? (value[langId] === undefined) : undefined}
        />
      )}
    </p>
  );
};


interface LangSelectorButtonProps {
  id: string,
  title: string,
  isSelected: boolean,
  onSelect: () => void,
  hasTranslation: boolean | undefined,
}
const LangSelectorButton: React.FC<LangSelectorButtonProps> = function (props) {
  return (
    <>

      {props.isSelected
        ? <strong className={styles.lang}>
            {props.id}
          </strong>
        : <a
              className={styles.lang}
              title={`Select ${props.title}`}
              href="javascript: void 0;"
              onClick={props.onSelect}>
            <span>{props.id}</span>
          </a>}

      {props.hasTranslation === false
        ? <Icon
            icon="error"
            intent="danger"
            title={`Missing translation for ${props.title}`}
            htmlTitle={`Missing translation for ${props.title}`}
          />
        : ''}

    </>
  );
};
